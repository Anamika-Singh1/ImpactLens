import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { GitHubClient, type GitHubConfig } from './github';
import { unseal } from './crypto';
import { fixture, fixtureArchive } from './fixture';
import { readArchive, LIMITS } from './archive';
import { ImportFailure, safeFailure, canceled } from './errors';
import { runRepositoryAnalysis } from './repository-analysis';
export const IMPORT_QUEUE = 'impactlens-import';
export type ImportConfig = GitHubConfig & {
  CREDENTIAL_ENCRYPTION_KEY: string;
  GITHUB_ENABLED: string;
};
export async function enqueuePending(db: PrismaClient, queue: Queue) {
  const jobs = await db.importJob.findMany({
    // RUNNING rows must also repopulate Redis after a queue loss or process restart.
    // Deterministic queue IDs and the publish transaction prevent duplicate snapshots.
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const job of jobs)
    await queue.add(
      'snapshot',
      { id: job.id, generation: job.generation },
      {
        jobId: `${job.id}-${job.generation}`,
        attempts: 3,
        backoff: { type: 'github' },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );
}
export async function processImport(
  db: PrismaClient,
  id: string,
  generation: number,
  config: ImportConfig,
  attempt: number,
  github = new GitHubClient(config),
  lifecycle: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(lifecycle.timeoutMs ?? LIMITS.timeoutMs),
    ...(lifecycle.signal ? [lifecycle.signal] : []),
  ]);
  const heartbeat = setInterval(() => {
    void db.importJob
      .findUnique({ where: { id }, select: { status: true, generation: true } })
      .then((job) => {
        if (!job || job.status === 'CANCELED' || job.generation !== generation)
          controller.abort();
      })
      .catch(() => controller.abort());
  }, 500);
  let archive: Buffer | undefined;
  try {
    const started = await db.importJob.updateMany({
      where: {
        id,
        generation,
        attempts: { lt: 3 },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: {
        status: 'RUNNING',
        // Persist attempts separately from Redis so a lost queue cannot reset the bound.
        attempts: { increment: 1 },
        stage: 'Fetching repository',
        progress: 5,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (!started.count) {
      await db.importJob.updateMany({
        where: {
          id,
          generation,
          status: { in: ['QUEUED', 'RUNNING'] },
          attempts: { gte: 3 },
        },
        data: {
          status: 'FAILED',
          errorCode: 'ATTEMPT_LIMIT',
          errorMessage: 'Import attempt limit reached. Retry explicitly.',
          finishedAt: new Date(),
        },
      });
      return;
    }
    const job = await db.importJob.findUniqueOrThrow({
      where: { id },
      include: { repository: { include: { installation: true } } },
    });
    attempt = Math.max(attempt, job.attempts);
    const membership = await db.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: job.workspaceId,
          userId: job.requestedById,
        },
      },
    });
    if (!membership || membership.role === 'VIEWER')
      throw new ImportFailure(
        'WORKSPACE_ACCESS',
        'The requester no longer has import permission. Ask an Engineer or Owner to retry.',
      );
    if (job.repository.source === 'FIXTURE') {
      if (job.commitSha !== fixture.commitSha)
        throw new ImportFailure(
          'FIXTURE_VERSION',
          'This demo fixture version is unavailable. Submit the current demo.',
        );
      archive = await fixtureArchive();
    } else if (job.repository.source === 'GITHUB') {
      if (
        !job.repository.installationId &&
        job.repository.isPrivate === false
      ) {
        const repo = await github.publicRepository(
          job.repository.owner,
          job.repository.name,
          signal,
        );
        if (String(repo.id) !== job.repository.githubRepositoryId)
          throw new ImportFailure(
            'REPOSITORY_CHANGED',
            'The repository identity changed. Add the repository again.',
          );
        archive = await github.downloadPublic(repo, job.commitSha, signal);
      } else {
        if (config.GITHUB_ENABLED !== 'true')
          throw new ImportFailure(
            'GITHUB_DISABLED',
            'GitHub is disabled on the worker. Ask the server administrator to configure it.',
          );
        const auth = await db.gitHubAuthorization.findUnique({
          where: { userId: job.requestedById },
        });
        if (!auth || auth.expiresAt <= new Date())
          throw new ImportFailure(
            'AUTH_EXPIRED',
            'GitHub authorization expired. Reconnect in Settings, then retry.',
          );
        const installation = job.repository.installation;
        if (!installation || !job.repository.githubRepositoryId)
          throw new ImportFailure(
            'ACCESS_UNAVAILABLE',
            'Reconnect the workspace GitHub installation before retrying.',
          );
        const token = unseal(
          auth.encryptedToken,
          config.CREDENTIAL_ENCRYPTION_KEY,
        );
        const repo = await github.repository(
          token,
          installation.githubInstallationId,
          job.repository.githubRepositoryId,
          signal,
        );
        await db.importJob.updateMany({
          where: { id, generation, status: 'RUNNING' },
          data: { stage: 'Downloading immutable commit', progress: 20 },
        });
        archive = await github.download(
          installation.githubInstallationId,
          repo,
          job.commitSha,
          signal,
        );
      }
    } else
      throw new ImportFailure(
        'SOURCE_UNAVAILABLE',
        'Select a GitHub repository or the demo fixture to import.',
      );
    signal.throwIfAborted();
    await db.importJob.updateMany({
      where: { id, generation, status: 'RUNNING' },
      data: { stage: 'Scanning files', progress: 45 },
    });
    const result = await readArchive(archive, signal);
    if (!result.files.length)
      throw new ImportFailure(
        'NO_SUPPORTED_FILES',
        'No supported source or manifests could be retained. The repository may be empty, generated-only or outside the supported formats.',
      );
    signal.throwIfAborted();
    await db.importJob.updateMany({
      where: { id, generation, status: 'RUNNING' },
      data: { stage: 'Analyzing code', progress: 65 },
    });
    const analysis = await runRepositoryAnalysis(
      result.files,
      job.commitSha,
      signal,
      (stage, progress) =>
        db.importJob.updateMany({
          where: { id, generation, status: 'RUNNING' },
          data: { stage, progress },
        }),
    );
    signal.throwIfAborted();
    await db.$transaction(
      async (tx) => {
        // Serialize cancellation/retry against commit. Never publish a partial snapshot.
        await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await tx.importJob.findUnique({ where: { id } });
        if (
          !current ||
          current.status !== 'RUNNING' ||
          current.generation !== generation ||
          signal.aborted
        )
          throw canceled();
        const authorized = await tx.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: job.workspaceId,
              userId: job.requestedById,
            },
          },
          include: { user: { select: { name: true } } },
        });
        if (!authorized || authorized.role === 'VIEWER')
          throw new ImportFailure(
            'WORKSPACE_ACCESS',
            'Import permission was removed during ingestion.',
          );
        const key = {
          workspaceId: job.workspaceId,
          repositoryId: job.repositoryId,
          commitSha: job.commitSha,
        };
        let snapshot = await tx.repositorySnapshot.findUnique({
          where: { workspaceId_repositoryId_commitSha: key },
        });
        if (!snapshot) {
          snapshot = await tx.repositorySnapshot.create({
            data: {
              ...key,
              isDemo: job.repository.source === 'FIXTURE',
              importSummary: result.summary,
            },
          });
          for (let offset = 0; offset < result.files.length; offset += 100) {
            signal.throwIfAborted();
            await tx.sourceFile.createMany({
              data: result.files.slice(offset, offset + 100).map((file) => ({
                ...file,
                snapshotId: snapshot!.id,
                workspaceId: job.workspaceId,
                repositoryId: job.repositoryId,
              })),
            });
          }
        }
        const scope = {
          workspaceId: job.workspaceId,
          repositoryId: job.repositoryId,
        };
        const json = (value: unknown) =>
          JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
        await tx.staticGraph.upsert({
          where: { snapshotId: snapshot.id },
          create: {
            ...scope,
            snapshotId: snapshot.id,
            version: analysis.graph.version,
            graph: json(analysis.graph),
          },
          update: {
            version: analysis.graph.version,
            graph: json(analysis.graph),
            analyzedAt: new Date(),
          },
        });
        await tx.repositoryOverview.upsert({
          where: { snapshotId: snapshot.id },
          create: {
            ...scope,
            snapshotId: snapshot.id,
            version: analysis.overview.version,
            data: json(analysis.overview),
          },
          update: {
            version: analysis.overview.version,
            data: json(analysis.overview),
            analyzedAt: new Date(),
          },
        });
        const retained = await tx.sourceFile.findMany({
          where: { ...scope, snapshotId: snapshot.id },
          select: { id: true, path: true, contentText: true },
        });
        for (const suggestion of analysis.overview.suggestions) {
          const feature = await tx.businessFeature.upsert({
            where: {
              workspaceId_repositoryId_key: {
                ...scope,
                key: `overview-${suggestion.key}`,
              },
            },
            create: {
              ...scope,
              key: `overview-${suggestion.key}`,
              name: suggestion.name,
              description: `${suggestion.explanation} Suggested from source names; not confirmed.`,
            },
            update: {},
          });
          for (const proof of suggestion.evidence) {
            const file = retained.find((file) => file.path === proof.filePath);
            const node = analysis.graph.nodes.find(
              (node) => node.id === proof.nodeId,
            );
            if (!file?.contentText || !node) continue;
            const key = {
              ...scope,
              featureId: feature.id,
              snapshotId: snapshot.id,
              fileId: file.id,
              nodeId: node.id,
            };
            if (
              await tx.featureMapping.findUnique({
                where: {
                  workspaceId_repositoryId_featureId_snapshotId_fileId_nodeId:
                    key,
                },
              })
            )
              continue;
            const anchor =
              node.kind === 'FILE'
                ? file.contentText
                : file.contentText
                    .split('\n')
                    .slice(node.evidence.startLine - 1, node.evidence.endLine)
                    .join('\n');
            const mapping = await tx.featureMapping.create({
              data: {
                ...key,
                status: 'SUGGESTED',
                origin: 'HEURISTIC',
                target: json({
                  ...node,
                  analyzerVersion: analysis.graph.version,
                }),
                anchorHash: createHash('sha256').update(anchor).digest('hex'),
                rationale: suggestion.reason,
                heuristic: json({
                  kind: 'overview-name-evidence',
                  version: analysis.overview.version,
                }),
              },
            });
            await tx.mappingRevision.create({
              data: {
                ...scope,
                mappingId: mapping.id,
                revision: mapping.version,
                action: 'SUGGESTED',
                actorId: job.requestedById,
                actorLabel: authorized.user.name,
                snapshotId: snapshot.id,
                state: json(mapping),
              },
            });
          }
        }
        await tx.importJob.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            stage: 'Completed',
            progress: 100,
            snapshotId: snapshot.id,
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
        await tx.auditEvent.create({
          data: {
            workspaceId: job.workspaceId,
            repositoryId: job.repositoryId,
            actorId: job.requestedById,
            action: 'repository.imported',
            targetId: snapshot.id,
          },
        });
      },
      { timeout: 30000 },
    );
  } catch (error) {
    const failure =
      controller.signal.aborted || lifecycle.signal?.aborted
        ? canceled()
        : signal.aborted
          ? new ImportFailure(
              'IMPORT_TIMEOUT',
              'Import exceeded its two-minute time limit.',
              true,
            )
          : safeFailure(error);
    const retry = failure.transient && attempt < 3;
    await db.importJob.updateMany({
      where: { id, generation, status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status:
          failure.code === 'CANCELED'
            ? 'CANCELED'
            : retry
              ? 'QUEUED'
              : 'FAILED',
        stage: retry ? 'Waiting for retry' : 'Import stopped',
        errorCode: failure.code,
        errorMessage: failure.message,
        finishedAt: retry ? null : new Date(),
      },
    });
    if (retry) throw failure;
    throw new UnrecoverableError(failure.message);
  } finally {
    clearInterval(heartbeat);
    controller.abort();
    archive?.fill(0);
    // No temporary files exist: only bounded in-memory buffers and committed DB rows.
  }
}
export function createImportWorker(
  db: PrismaClient,
  connection: Redis,
  config: ImportConfig,
) {
  const worker = new Worker(
    IMPORT_QUEUE,
    (job) =>
      processImport(
        db,
        job.data.id,
        job.data.generation,
        config,
        job.attemptsMade + 1,
      ),
    {
      connection,
      concurrency: 1,
      maxStalledCount: 1,
      lockDuration: 30000,
      settings: {
        backoffStrategy: (attemptsMade, _type, error) =>
          error instanceof ImportFailure
            ? Math.max(error.retryAfterMs, 1000 * 2 ** attemptsMade)
            : 1000 * 2 ** attemptsMade,
      },
    },
  );
  worker.on('failed', (job) => {
    if (!job) return;
    void job
      .getState()
      .then(async (state) => {
        if (state === 'failed')
          await db.importJob.updateMany({
            where: {
              id: job.data.id,
              generation: job.data.generation,
              status: { in: ['RUNNING', 'QUEUED'] },
            },
            data: {
              status: 'FAILED',
              stage: 'Import stopped',
              errorCode: 'WORKER_FAILED',
              errorMessage:
                'Worker could not finish the import. Retry the job.',
              finishedAt: new Date(),
            },
          });
      })
      .catch(() => undefined);
  });
  return worker;
}

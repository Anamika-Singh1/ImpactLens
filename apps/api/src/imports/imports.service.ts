import {
  Injectable,
  OnModuleDestroy,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  GitHubClient,
  ImportFailure,
  digest,
  seal,
  unseal,
  fixture,
  IMPORT_QUEUE,
  parseRepositoryUrl,
  type GitHubRepository,
} from '@impactlens/ingestion';
import { DatabaseService } from '../database.module';
import { readConfig } from '../config';
import type { AuthRequest } from '../auth/security';

@Injectable()
export class ImportsService implements OnModuleDestroy {
  readonly config = readConfig();
  readonly github = new GitHubClient(this.config);
  private readonly connection = new Redis(this.config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  private readonly queue = new Queue(IMPORT_QUEUE, {
    connection: this.connection,
  });
  private readonly queueInitialization: Promise<void>;
  constructor(private readonly db: DatabaseService) {
    this.connection.on('error', () => undefined);
    this.queue.on('error', () => undefined);
    this.queueInitialization = this.queue.waitUntilReady().then(
      () => undefined,
      () => undefined,
    );
  }
  async onModuleDestroy() {
    // Settle initialization before BullMQ removes its error listeners. Otherwise
    // an unavailable Redis server can emit a late unhandled error during close.
    this.connection.disconnect();
    await this.queueInitialization;
    await this.queue.close();
  }
  enabled() {
    if (this.config.GITHUB_ENABLED !== 'true')
      throw new ImportFailure(
        'GITHUB_DISABLED',
        'GitHub is not configured on this server. Use the demo fixture or ask an administrator to configure the App.',
      );
  }
  async token(userId: string) {
    this.enabled();
    const auth = await this.db.gitHubAuthorization.findUnique({
      where: { userId },
    });
    if (!auth || auth.expiresAt <= new Date())
      throw new ImportFailure(
        'AUTH_EXPIRED',
        'Connect your GitHub account in Settings before continuing.',
      );
    return unseal(auth.encryptedToken, this.config.CREDENTIAL_ENCRYPTION_KEY);
  }
  async status(workspaceId: string, userId: string) {
    const auth = await this.db.gitHubAuthorization.findUnique({
      where: { userId },
      select: { login: true, expiresAt: true },
    });
    return {
      enabled: this.config.GITHUB_ENABLED === 'true',
      authorization: auth && auth.expiresAt > new Date() ? auth : null,
      installUrl:
        this.config.GITHUB_ENABLED === 'true'
          ? `https://github.com/apps/${this.config.GITHUB_APP_SLUG}/installations/new`
          : null,
      installations: await this.db.gitHubInstallation.findMany({
        where: { workspaceId },
        select: { id: true, account: true, githubInstallationId: true },
      }),
    };
  }
  async start(workspaceId: string, request: AuthRequest) {
    this.enabled();
    const state = randomBytes(32).toString('hex'),
      verifier = randomBytes(32).toString('base64url');
    await this.db.gitHubFlow.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { sessionId: request.authSession!.id },
        ],
      },
    });
    await this.db.gitHubFlow.create({
      data: {
        stateHash: digest(state),
        verifier,
        userId: request.authSession!.userId!,
        sessionId: request.authSession!.id,
        workspaceId,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.config.GITHUB_CLIENT_ID,
      redirect_uri: this.config.GITHUB_CALLBACK_URL,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  }
  async callback(state: string, code: string, request: AuthRequest) {
    this.enabled();
    if (!/^[a-f0-9]{64}$/.test(state) || !code || code.length > 512)
      throw new BadRequestException(
        'Invalid or denied GitHub authorization. Restart from Settings.',
      );
    const where = {
      stateHash: digest(state),
      sessionId: request.authSession!.id,
      userId: request.authSession!.userId!,
      expiresAt: { gt: new Date() },
    };
    const flow = await this.db.gitHubFlow.findFirst({ where });
    if (!flow || !(await this.db.gitHubFlow.deleteMany({ where })).count)
      throw new BadRequestException(
        'GitHub authorization state expired or was already used. Restart from Settings.',
      );
    const member = await this.db.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: flow.workspaceId,
          userId: flow.userId,
        },
      },
    });
    if (!member || member.role === 'VIEWER')
      throw new ForbiddenException('Import permission is required.');
    const access = await this.github.exchange(
      code,
      flow.verifier,
      this.config.GITHUB_CLIENT_ID,
      this.config.GITHUB_CLIENT_SECRET,
      this.config.GITHUB_CALLBACK_URL,
    );
    const identity = await this.github.json<{ id: number; login: string }>(
      '/user',
      access.token,
    );
    const data = {
      githubUserId: String(identity.id),
      login: identity.login,
      encryptedToken: seal(access.token, this.config.CREDENTIAL_ENCRYPTION_KEY),
      expiresAt: access.expiresAt,
    };
    await this.db.gitHubAuthorization.upsert({
      where: { userId: flow.userId },
      create: { userId: flow.userId, ...data },
      update: data,
    });
    return flow.workspaceId;
  }
  async available(userId: string, page: number) {
    const data = await this.github.installations(
      await this.token(userId),
      page,
    );
    return {
      installations: data.installations
        .filter(
          (i) =>
            String(i.app_id) === this.config.GITHUB_APP_ID && !i.suspended_at,
        )
        .map((i) => ({
          installationId: String(i.id),
          account: i.account.login,
        })),
      hasNext: data.installations.length === 100,
    };
  }
  async bind(workspaceId: string, userId: string, installationId: string) {
    const installation = await this.github.verifyInstallation(
      await this.token(userId),
      installationId,
    );
    return this.db.$transaction(async (tx) => {
      const result = await tx.gitHubInstallation.upsert({
        where: {
          workspaceId_githubInstallationId: {
            workspaceId,
            githubInstallationId: installationId,
          },
        },
        create: {
          workspaceId,
          githubInstallationId: installationId,
          account: installation.account.login,
        },
        update: { account: installation.account.login },
      });
      await tx.auditEvent.create({
        data: {
          workspaceId,
          actorId: userId,
          action: 'github.installation.bound',
          targetId: result.id,
        },
      });
      return {
        id: result.id,
        account: result.account,
        githubInstallationId: result.githubInstallationId,
      };
    });
  }
  async installation(workspaceId: string, id: string) {
    const installation = await this.db.gitHubInstallation.findFirst({
      where: { id, workspaceId },
    });
    if (!installation) throw new NotFoundException('Installation not found');
    return installation;
  }
  async repositories(
    workspaceId: string,
    userId: string,
    id: string,
    page: number,
  ) {
    const installation = await this.installation(workspaceId, id);
    const data = await this.github.repositories(
      await this.token(userId),
      installation.githubInstallationId,
      page,
    );
    return {
      repositories: data.repositories
        .filter((r) => !r.disabled)
        .map((r) => ({
          id: String(r.id),
          owner: r.owner.login,
          name: r.name,
          defaultBranch: r.default_branch,
        })),
      hasNext: data.repositories.length === 100,
    };
  }
  async branches(
    workspaceId: string,
    userId: string,
    id: string,
    repoId: string,
    page: number,
  ) {
    const installation = await this.installation(workspaceId, id),
      token = await this.token(userId);
    const repo = await this.github.repository(
      token,
      installation.githubInstallationId,
      repoId,
    );
    const branches = await this.github.branches(token, repo, page);
    return {
      branches: branches.map((b) => ({
        name: b.name,
        commitSha: b.commit.sha,
      })),
      hasNext: branches.length === 100,
    };
  }
  async submit(
    workspaceId: string,
    userId: string,
    input: {
      source: 'FIXTURE' | 'GITHUB';
      installationId?: string;
      repositoryId?: string;
      branch?: string;
      publicRepository?: GitHubRepository;
    },
  ) {
    let owner: string,
      name: string,
      commitSha: string,
      branch: string,
      githubRepositoryId: string | undefined,
      installationId: string | undefined;
    if (input.source === 'FIXTURE') {
      ({ owner, name, commitSha, branch } = fixture);
    } else {
      if (input.publicRepository) {
        const repo = input.publicRepository;
        branch = input.branch || repo.default_branch;
        if (!branch)
          throw new ImportFailure(
            'EMPTY_REPOSITORY',
            'The repository has no default branch or commits. Push code first.',
          );
        commitSha = await this.github.resolve('', repo, branch);
        owner = repo.owner.login.toLowerCase();
        name = repo.name.toLowerCase();
        githubRepositoryId = String(repo.id);
      } else {
        if (!input.installationId || !input.repositoryId)
          throw new BadRequestException(
            'Select an installation, repository and branch.',
          );
        const installation = await this.installation(
            workspaceId,
            input.installationId,
          ),
          token = await this.token(userId);
        const repo = await this.github.repository(
          token,
          installation.githubInstallationId,
          input.repositoryId,
        );
        branch = input.branch || repo.default_branch;
        commitSha = await this.github.resolve(token, repo, branch);
        owner = repo.owner.login.toLowerCase();
        name = repo.name.toLowerCase();
        githubRepositoryId = String(repo.id);
        installationId = installation.id;
      }
    }
    // A serializable transaction and unique key make concurrent submissions converge.
    let id: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        id = await this.db.$transaction(
          async (tx) => {
            let repo = githubRepositoryId
              ? await tx.repository.findUnique({
                  where: {
                    workspaceId_githubRepositoryId: {
                      workspaceId,
                      githubRepositoryId,
                    },
                  },
                })
              : null;
            repo ??= await tx.repository.findUnique({
              where: { workspaceId_owner_name: { workspaceId, owner, name } },
            });
            if (
              repo &&
              repo.source !== 'METADATA' &&
              (repo.source !== input.source ||
                repo.githubRepositoryId !== (githubRepositoryId ?? null))
            )
              throw new BadRequestException(
                'Repository name belongs to a different source.',
              );
            const data = {
              source: input.source,
              installationId: installationId ?? null,
              githubRepositoryId: githubRepositoryId ?? null,
              ...(input.publicRepository
                ? {
                    isPrivate: false,
                    description: input.publicRepository.description ?? null,
                    defaultBranch: input.publicRepository.default_branch,
                  }
                : {}),
            };
            repo = repo
              ? await tx.repository.update({ where: { id: repo.id }, data })
              : await tx.repository.create({
                  data: { workspaceId, owner, name, ...data },
                });
            const key = { workspaceId, repositoryId: repo.id, commitSha };
            const existing = await tx.importJob.findUnique({
              where: { workspaceId_repositoryId_commitSha: key },
            });
            if (existing) {
              if (
                existing.status === 'COMPLETED' &&
                existing.snapshotId &&
                !(await tx.repositoryOverview.findUnique({
                  where: { snapshotId: existing.snapshotId },
                }))
              ) {
                await tx.importJob.update({
                  where: { id: existing.id },
                  data: {
                    status: 'QUEUED',
                    stage: 'Queued',
                    progress: 0,
                    generation: { increment: 1 },
                    attempts: 0,
                    requestedById: userId,
                    branch,
                    finishedAt: null,
                    errorCode: null,
                    errorMessage: null,
                  },
                });
              }
              return existing.id;
            }
            const job = await tx.importJob.create({
              data: { ...key, branch, stage: 'Queued', requestedById: userId },
            });
            await tx.auditEvent.create({
              data: {
                workspaceId,
                repositoryId: repo.id,
                actorId: userId,
                action: 'repository.import.queued',
                targetId: job.id,
              },
            });
            return job.id;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code) &&
          attempt < 4
        )
          continue;
        throw error;
      }
    }
    const job = await this.db.importJob.findUniqueOrThrow({
      where: { id: id! },
    });
    if (job.status === 'QUEUED') await this.enqueue(job.id, job.generation);
    return this.job(workspaceId, job.id);
  }
  async addUrl(
    workspaceId: string,
    userId: string,
    url: string,
    branch?: string,
  ) {
    const { owner, name } = parseRepositoryUrl(url);
    const selectedBranch = branch?.trim() || undefined;
    let repo: GitHubRepository;
    try {
      repo = await this.github.publicRepository(owner, name);
    } catch (error) {
      if (
        !(error instanceof ImportFailure) ||
        !['ACCESS_UNAVAILABLE', 'AUTH_EXPIRED'].includes(error.code)
      )
        throw error;
      if (this.config.GITHUB_ENABLED !== 'true')
        throw new ImportFailure(
          'GITHUB_CONNECTION_REQUIRED',
          'Repository not found, unavailable or private. Check the URL; private repositories require a GitHub connection and authorized repository access.',
        );
      const token = await this.token(userId);
      repo = await this.github.json<GitHubRepository>(
        `/repos/${owner}/${name}`,
        token,
      );
      const installations = await this.db.gitHubInstallation.findMany({
        where: { workspaceId },
      });
      for (const installation of installations) {
        try {
          await this.github.repository(
            token,
            installation.githubInstallationId,
            String(repo.id),
          );
          const job = await this.submit(workspaceId, userId, {
            source: 'GITHUB',
            installationId: installation.id,
            repositoryId: String(repo.id),
            branch: selectedBranch || repo.default_branch,
          });
          await this.db.repository.updateMany({
            where: { id: job.repositoryId, workspaceId },
            data: {
              isPrivate: repo.private ?? true,
              description: repo.description ?? null,
              defaultBranch: repo.default_branch,
            },
          });
          return job;
        } catch (error) {
          if (
            !(error instanceof ImportFailure) ||
            error.code !== 'ACCESS_UNAVAILABLE'
          )
            throw error;
        }
      }
      throw new ImportFailure(
        'GITHUB_CONNECTION_REQUIRED',
        'No linked GitHub installation grants access to this repository. Ask an Owner to grant repository access in Settings.',
      );
    }
    return this.submit(workspaceId, userId, {
      source: 'GITHUB',
      publicRepository: repo,
      branch: selectedBranch,
    });
  }
  private async enqueue(id: string, generation: number) {
    // DB is the outbox: worker dispatches any queued rows missed during Redis outages.
    await this.queue
      .add(
        'snapshot',
        { id, generation },
        {
          jobId: `${id}-${generation}`,
          attempts: 3,
          backoff: { type: 'github' },
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      )
      .catch(() => undefined);
  }
  jobs(workspaceId: string) {
    return this.db.importJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        repository: { select: { owner: true, name: true, source: true } },
        snapshot: {
          select: {
            id: true,
            commitSha: true,
            isDemo: true,
            importSummary: true,
          },
        },
      },
    });
  }
  async job(workspaceId: string, id: string) {
    const job = await this.db.importJob.findFirst({
      where: { id, workspaceId },
      include: {
        repository: { select: { owner: true, name: true, source: true } },
        snapshot: {
          select: {
            id: true,
            commitSha: true,
            isDemo: true,
            importSummary: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }
  async cancel(workspaceId: string, id: string, userId: string) {
    await this.job(workspaceId, id);
    await this.db.$transaction(async (tx) => {
      const changed = await tx.importJob.updateMany({
        where: { id, workspaceId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: {
          status: 'CANCELED',
          stage: 'Canceled; worker releases in-memory data',
          finishedAt: new Date(),
        },
      });
      if (changed.count)
        await tx.auditEvent.create({
          data: {
            workspaceId,
            actorId: userId,
            action: 'repository.import.canceled',
            targetId: id,
          },
        });
    });
    return this.job(workspaceId, id);
  }
  async retry(workspaceId: string, id: string, userId: string) {
    const job = await this.job(workspaceId, id);
    if (job.repository.source === 'GITHUB') {
      const repo = await this.db.repository.findUniqueOrThrow({
        where: { id: job.repositoryId },
        include: { installation: true },
      });
      if (!repo.installation && repo.isPrivate === false) {
        const current = await this.github.publicRepository(
          repo.owner,
          repo.name,
        );
        if (String(current.id) !== repo.githubRepositoryId)
          throw new BadRequestException(
            'Repository identity changed. Add it again.',
          );
      } else {
        if (!repo.installation || !repo.githubRepositoryId)
          throw new BadRequestException('Reconnect the installation.');
        await this.github.repository(
          await this.token(userId),
          repo.installation.githubInstallationId,
          repo.githubRepositoryId,
        );
      }
    }
    await this.db.importJob.updateMany({
      where: { id, workspaceId, status: { in: ['FAILED', 'CANCELED'] } },
      data: {
        status: 'QUEUED',
        progress: 0,
        stage: 'Waiting for worker',
        generation: { increment: 1 },
        attempts: 0,
        requestedById: userId,
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
      },
    });
    const current = await this.job(workspaceId, id);
    if (current.status === 'QUEUED') await this.enqueue(id, current.generation);
    return current;
  }
}

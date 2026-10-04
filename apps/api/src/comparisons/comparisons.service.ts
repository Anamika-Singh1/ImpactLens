import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { runAnalysisWorker } from '../analysis-worker';
import { impactHash, IMPACT_VERSION } from '@impactlens/analyzer';
import {
  defaultReviewRubric,
  type Criticality,
  type ImpactInput,
  type ImpactResult,
  type MappingTarget,
  type SnapshotGraph,
  type TestArtifact,
} from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import { resolveMapping } from '../features/mapping.logic';
import type { ComparisonDto } from './comparisons.controller';

type Scope = { workspaceId: string; repositoryId: string };
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const summary = {
  id: true,
  baseSnapshotId: true,
  headSnapshotId: true,
  createdAt: true,
  engineVersion: true,
  inputHash: true,
  resultHash: true,
  baseSnapshot: { select: { commitSha: true } },
  headSnapshot: { select: { commitSha: true } },
} as const;

@Injectable()
export class ComparisonsService {
  private running = 0;
  constructor(private readonly db: DatabaseService) {}
  private async repository(scope: Scope) {
    if (
      !(await this.db.repository.findFirst({
        where: { id: scope.repositoryId, workspaceId: scope.workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Repository not found');
  }
  async list(scope: Scope) {
    await this.repository(scope);
    return this.db.analysis.findMany({
      where: { ...scope, engineVersion: { not: null } },
      select: summary,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }
  async detail(scope: Scope, id: string) {
    const stored = await this.db.analysis.findFirst({
      where: { ...scope, id, engineVersion: { not: null } },
      select: { ...summary, input: true, result: true },
    });
    if (!stored) throw new NotFoundException('Comparison not found');
    const input = stored.input as unknown as ImpactInput;
    // Retain source internally for reproducibility; send only review evidence to the browser.
    const { input: _, ...rest } = stored;
    return { ...rest, semantics: input.semantics, rubric: input.rubric };
  }
  private compute(
    input: ImpactInput,
    signal?: AbortSignal,
  ): Promise<ImpactResult> {
    return runAnalysisWorker(
      require.resolve('@impactlens/analyzer/dist/impact-worker.js'),
      input,
      'result',
      signal,
    );
  }
  async create(
    scope: Scope,
    body: ComparisonDto,
    actorId: string,
    signal?: AbortSignal,
  ) {
    if (this.running >= 2)
      throw new ServiceUnavailableException(
        'Comparison capacity is busy. Retry shortly.',
      );
    this.running++;
    try {
      // One consistent database view freezes graphs, feature versions, mappings and test evidence.
      const input = await this.db.$transaction(
        async (tx): Promise<ImpactInput> => {
          const snapshots = await tx.repositorySnapshot.findMany({
            where: {
              ...scope,
              id: { in: [body.baseSnapshotId, body.headSnapshotId] },
            },
            include: { files: { orderBy: { path: 'asc' } }, staticGraph: true },
          });
          const load = (id: string) => {
            const snapshot = snapshots.find((s) => s.id === id);
            if (!snapshot) throw new NotFoundException('Snapshot not found');
            if (!snapshot.staticGraph)
              throw new BadRequestException(
                'Analyze both snapshots in the repository explorer before comparing them.',
              );
            return snapshot;
          };
          const base = load(body.baseSnapshotId),
            head = load(body.headSnapshotId);
          const convert = (snapshot: typeof base) => {
            const inventory = snapshot.importSummary as {
              inventory?: { path: string; contentHash: string }[];
              inventoryComplete?: boolean;
            } | null;
            const files = new Map(
              snapshot.files.map((f) => [
                f.path,
                {
                  path: f.path,
                  contentHash: f.contentHash,
                  contentText: f.contentText,
                },
              ]),
            );
            for (const file of inventory?.inventory ?? [])
              if (!files.has(file.path))
                files.set(file.path, { ...file, contentText: null });
            return {
              id: snapshot.id,
              commitSha: snapshot.commitSha,
              files: [...files.values()].sort((a, b) =>
                a.path.localeCompare(b.path, 'en'),
              ),
              graph: snapshot.staticGraph!.graph as unknown as SnapshotGraph,
              inventoryComplete: inventory?.inventoryComplete === true,
            };
          };
          const features = await tx.businessFeature.findMany({
            where: scope,
            orderBy: { id: 'asc' },
          });
          const mappings = await tx.featureMapping.findMany({
            where: {
              ...scope,
              status: 'CONFIRMED',
              confirmedAt: { not: null },
            },
            orderBy: { id: 'asc' },
          });
          const tests = await tx.testCase.findMany({
            where: { ...scope, testRun: { snapshotId: head.id } },
            orderBy: { id: 'asc' },
          });
          const artifacts = await tx.testArtifact.findMany({
            where: scope,
            orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
            take: 201,
          });
          if (artifacts.length > 200)
            throw new BadRequestException(
              'Comparison supports up to 200 evidence artifacts per repository. Archive older evidence before comparing.',
            );
          const testMappings = await tx.featureTestMapping.findMany({
            where: scope,
            orderBy: { id: 'asc' },
          });
          return {
            testEvidence: {
              asOf: new Date().toISOString(),
              staleAfterDays: 30,
              artifacts: artifacts.map(
                ({
                  content,
                  importedByLabel,
                  workspaceId,
                  repositoryId,
                  ...a
                }) => ({
                  ...a,
                  recordedAt: a.recordedAt.toISOString(),
                  importedAt: a.importedAt.toISOString(),
                }),
              ) as unknown as TestArtifact[],
              mappings: testMappings.map((m) => ({
                ...m,
                createdAt: m.createdAt.toISOString(),
              })),
            },
            version: IMPACT_VERSION,
            semantics: {
              kind: 'TWO_COMMIT_TREES',
              repositoryId: scope.repositoryId,
              baseSha: base.commitSha,
              headSha: head.commitSha,
              description:
                'Compare the complete imported base and head trees. This is not a pull request merge-base comparison.',
            },
            base: convert(base),
            head: convert(head),
            features: features.map((f) => ({
              id: f.id,
              version: f.version,
              name: f.name,
              criticality: f.criticality as Criticality,
            })),
            mappings: mappings
              .filter((m) => m.target !== null && m.anchorHash !== null)
              .map((m) => {
                const target = m.target as unknown as MappingTarget;
                const resolution = (s: typeof base) => {
                  const r = resolveMapping(
                    target,
                    m.anchorHash,
                    s.files,
                    s.staticGraph!.graph as unknown as SnapshotGraph,
                    s.commitSha,
                  );
                  return { node: r.node, reason: r.reason };
                };
                return {
                  id: m.id,
                  version: m.version,
                  featureId: m.featureId,
                  snapshotId: m.snapshotId,
                  confirmedByLabel:
                    m.confirmedByLabel ?? 'Unknown historical reviewer',
                  confirmedAt: m.confirmedAt!.toISOString(),
                  target,
                  base: resolution(base),
                  head: resolution(head),
                };
              }),
            tests: tests
              .filter((t) => t.path !== null)
              .map((t) => ({
                id: t.id,
                path: t.path!,
                snapshotId: head.id,
                outcome: t.outcome,
              })),
            rubric: defaultReviewRubric,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 15000,
        },
      );
      if (Buffer.byteLength(JSON.stringify(input)) > 32 * 1024 * 1024)
        throw new BadRequestException(
          'Comparison input exceeds 32 MiB. Use smaller snapshots.',
        );
      const result = await this.compute(input, signal);
      signal?.throwIfAborted();
      const saved = await this.db.$transaction(async (tx) => {
        signal?.throwIfAborted();
        const member = await tx.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: scope.workspaceId,
              userId: actorId,
            },
          },
        });
        if (!member || member.role === 'VIEWER')
          throw new ForbiddenException('Analysis permission is required.');
        const record = await tx.analysis.create({
          data: {
            ...scope,
            ...body,
            status: 'COMPLETED',
            engineVersion: IMPACT_VERSION,
            input: json(input),
            result: json(result),
            inputHash: impactHash(input),
            resultHash: impactHash(result),
          },
          select: { id: true },
        });
        await tx.auditEvent.create({
          data: {
            ...scope,
            actorId,
            action: 'comparison.completed',
            targetId: record.id,
          },
        });
        return record;
      });
      return this.detail(scope, saved.id);
    } finally {
      this.running--;
    }
  }
}

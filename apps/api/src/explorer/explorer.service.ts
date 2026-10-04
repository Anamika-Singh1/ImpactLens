import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { runAnalysisWorker } from '../analysis-worker';
import { ANALYZER_VERSION, type AnalysisInput } from '@impactlens/analyzer';
import type { SnapshotGraph } from '@impactlens/shared';
import { DatabaseService } from '../database.module';

@Injectable()
export class ExplorerService {
  private running = 0;
  constructor(private readonly db: DatabaseService) {}
  async snapshots(workspaceId: string, repositoryId: string) {
    if (
      !(await this.db.repository.findFirst({
        where: { id: repositoryId, workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Repository not found');
    return this.db.repositorySnapshot.findMany({
      where: { workspaceId, repositoryId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        commitSha: true,
        isDemo: true,
        createdAt: true,
        staticGraph: { select: { version: true, analyzedAt: true } },
        _count: { select: { files: true } },
      },
    });
  }
  async snapshot(
    workspaceId: string,
    repositoryId: string,
    snapshotId: string,
  ) {
    const snapshot = await this.db.repositorySnapshot.findFirst({
      where: { id: snapshotId, workspaceId, repositoryId },
    });
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    return snapshot;
  }
  async graph(workspaceId: string, repositoryId: string, snapshotId: string) {
    await this.snapshot(workspaceId, repositoryId, snapshotId);
    const stored = await this.db.staticGraph.findFirst({
      where: { snapshotId, workspaceId, repositoryId },
    });
    return stored
      ? { graph: stored.graph, analyzedAt: stored.analyzedAt }
      : { graph: null, analyzedAt: null };
  }
  async files(workspaceId: string, repositoryId: string, snapshotId: string) {
    await this.snapshot(workspaceId, repositoryId, snapshotId);
    return this.db.sourceFile.findMany({
      where: { workspaceId, repositoryId, snapshotId },
      select: { id: true, path: true, language: true },
      orderBy: { path: 'asc' },
    });
  }
  async source(
    workspaceId: string,
    repositoryId: string,
    snapshotId: string,
    fileId: string,
  ) {
    const file = await this.db.sourceFile.findFirst({
      where: { id: fileId, workspaceId, repositoryId, snapshotId },
      select: { path: true, contentText: true },
    });
    if (!file) throw new NotFoundException('Source file not found');
    return file;
  }
  private compute(
    input: AnalysisInput,
    signal?: AbortSignal,
  ): Promise<SnapshotGraph> {
    return runAnalysisWorker(
      require.resolve('@impactlens/analyzer/dist/worker.js'),
      input,
      'graph',
      signal,
    );
  }
  async analyze(
    workspaceId: string,
    repositoryId: string,
    snapshotId: string,
    actorId: string,
    signal?: AbortSignal,
  ) {
    const snapshot = await this.snapshot(workspaceId, repositoryId, snapshotId);
    if (this.running >= 2)
      throw new ServiceUnavailableException(
        'Analysis capacity is busy. Retry shortly.',
      );
    this.running++;
    try {
      const files = await this.db.sourceFile.findMany({
        where: { workspaceId, repositoryId, snapshotId },
        select: { path: true, contentText: true },
        orderBy: { path: 'asc' },
      });
      const graph = await this.compute(
        {
          commitSha: snapshot.commitSha,
          files,
        },
        signal,
      );
      signal?.throwIfAborted();
      const stored = await this.db.$transaction(async (tx) => {
        signal?.throwIfAborted();
        const member = await tx.membership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: actorId } },
        });
        if (!member || member.role === 'VIEWER')
          throw new ForbiddenException('Analysis permission is required.');
        const data = {
          version: ANALYZER_VERSION,
          graph: graph as unknown as Prisma.InputJsonValue,
          analyzedAt: new Date(),
        };
        const result = await tx.staticGraph.upsert({
          where: { snapshotId },
          create: { snapshotId, workspaceId, repositoryId, ...data },
          update: data,
        });
        await tx.auditEvent.create({
          data: {
            workspaceId,
            repositoryId,
            actorId,
            action: 'snapshot.analyzed',
            targetId: snapshotId,
          },
        });
        return result;
      });
      return { graph: stored.graph, analyzedAt: stored.analyzedAt };
    } finally {
      this.running--;
    }
  }
}

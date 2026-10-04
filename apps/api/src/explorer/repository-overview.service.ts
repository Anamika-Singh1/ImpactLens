import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { runAnalysisWorker } from '../analysis-worker';
import type {
  RepositoryOverviewData,
  SnapshotGraph,
  MappingTarget,
  ImplementationMatch,
} from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import { resolveMapping } from '../features/mapping.logic';
@Injectable()
export class RepositoryOverviewService {
  private running = 0;
  constructor(private readonly db: DatabaseService) {}
  private async repository(workspaceId: string, id: string) {
    const repo = await this.db.repository.findFirst({
      where: { workspaceId, id },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }
  private async snapshot(
    workspaceId: string,
    repositoryId: string,
    snapshotId?: string,
  ) {
    await this.repository(workspaceId, repositoryId);
    const snapshot = await this.db.repositorySnapshot.findFirst({
      where: {
        workspaceId,
        repositoryId,
        ...(snapshotId ? { id: snapshotId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { overview: true, staticGraph: true },
    });
    if (snapshotId && !snapshot)
      throw new NotFoundException('Snapshot not found in this repository');
    return snapshot;
  }
  async details(
    workspaceId: string,
    repositoryId: string,
    snapshotId?: string,
    jobId?: string,
  ) {
    const repository = await this.repository(workspaceId, repositoryId);
    const job = await this.db.importJob.findFirst({
      where: {
        workspaceId,
        repositoryId,
        ...(jobId ? { id: jobId } : snapshotId ? { snapshotId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (jobId && !job)
      throw new NotFoundException('Analysis job not found in this repository');
    const snapshot =
      job && !job.snapshotId && !snapshotId
        ? null
        : await this.snapshot(
            workspaceId,
            repositoryId,
            snapshotId ?? job?.snapshotId ?? undefined,
          );
    const snapshots = await this.db.repositorySnapshot.findMany({
      where: { workspaceId, repositoryId },
      select: { id: true, commitSha: true },
      orderBy: { createdAt: 'desc' },
    });
    const { overview, staticGraph, ...summary } = snapshot ?? {
      overview: null,
      staticGraph: null,
    };
    return {
      repository: {
        ...repository,
        githubUrl:
          repository.source === 'GITHUB'
            ? `https://github.com/${repository.owner}/${repository.name}`
            : null,
      },
      job,
      snapshots,
      snapshot: snapshot ? summary : null,
      overview:
        (overview?.data as unknown as RepositoryOverviewData | undefined) ??
        null,
      analyzedAt: overview?.analyzedAt ?? staticGraph?.analyzedAt ?? null,
    };
  }
  async overview(
    workspaceId: string,
    repositoryId: string,
    snapshotId?: string,
  ) {
    const snapshot = await this.snapshot(workspaceId, repositoryId, snapshotId);
    return {
      snapshotId: snapshot?.id ?? null,
      overview:
        (snapshot?.overview?.data as unknown as
          | RepositoryOverviewData
          | undefined) ?? null,
      analyzedAt: snapshot?.overview?.analyzedAt ?? null,
    };
  }
  async section(
    workspaceId: string,
    repositoryId: string,
    snapshotId: string | undefined,
    key: 'dependencies' | 'routes',
  ) {
    const result = await this.overview(workspaceId, repositoryId, snapshotId);
    return {
      snapshotId: result.snapshotId,
      [key]: result.overview?.[key] ?? [],
      available: !!result.overview,
    };
  }
  async search(
    workspaceId: string,
    repositoryId: string,
    snapshotId: string | undefined,
    query: string,
    signal?: AbortSignal,
  ) {
    const snapshot = await this.snapshot(workspaceId, repositoryId, snapshotId);
    if (!snapshot?.staticGraph)
      throw new BadRequestException(
        'Repository analysis is not ready. Wait for it to complete or analyze the snapshot.',
      );
    const scope = { workspaceId, repositoryId };
    const files = await this.db.sourceFile.findMany({
      where: { ...scope, snapshotId: snapshot.id },
      select: { id: true, path: true, contentText: true },
      orderBy: { path: 'asc' },
    });
    const graph = snapshot.staticGraph.graph as unknown as SnapshotGraph;
    const mappings = await this.db.featureMapping.findMany({
      where: { ...scope, status: 'CONFIRMED' },
      include: { feature: { select: { name: true } } },
    });
    const confirmed = mappings.flatMap((mapping) => {
      const resolution = resolveMapping(
        mapping.target as unknown as MappingTarget,
        mapping.anchorHash,
        files,
        graph,
        snapshot.commitSha,
      );
      return resolution.status === 'RESOLVED' && resolution.node
        ? [{ name: mapping.feature.name, node: resolution.node }]
        : [];
    });
    if (this.running >= 2)
      throw new ServiceUnavailableException(
        'Implementation search is busy. Try again shortly.',
      );
    this.running++;
    let matches: ImplementationMatch[];
    try {
      matches = await runAnalysisWorker<ImplementationMatch[]>(
        require.resolve('@impactlens/analyzer/dist/search-worker.js'),
        {
          input: { files, commitSha: snapshot.commitSha },
          graph,
          query,
          confirmed,
        },
        'matches',
        signal,
      );
    } finally {
      this.running--;
    }
    return {
      snapshotId: snapshot.id,
      commitSha: snapshot.commitSha,
      query,
      matches,
      message: matches.length
        ? 'These are ranked source candidates. Human-confirmed mappings are marked separately; a text match is not proof of feature behavior.'
        : 'No reliable implementation candidate was found in the retained index. Try a specific file, symbol or route name.',
    };
  }
}

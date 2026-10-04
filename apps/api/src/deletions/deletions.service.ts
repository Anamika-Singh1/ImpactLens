import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.module';
type Scope = { workspaceId: string; repositoryId: string };
@Injectable()
export class DeletionsService {
  constructor(private readonly db: DatabaseService) {}
  private async actor(
    tx: Prisma.TransactionClient,
    scope: Scope,
    actorId: string,
    ownerOnly: boolean,
  ) {
    const rows = await tx.$queryRaw<
      { role: string }[]
    >`SELECT "role" FROM "Membership" WHERE "workspaceId"=${scope.workspaceId}::uuid AND "userId"=${actorId}::uuid FOR SHARE`;
    if (
      !rows[0] ||
      (ownerOnly
        ? rows[0].role !== 'OWNER'
        : !['OWNER', 'ENGINEER'].includes(rows[0].role))
    )
      throw new ForbiddenException('Deletion permission is required');
  }
  async repository(scope: Scope, actorId: string) {
    try {
      await this.db.$transaction(
        async (tx) => {
          await this.actor(tx, scope, actorId, true);
          // Use the same job-before-parent lock order as snapshot publication.
          await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "workspaceId"=${scope.workspaceId}::uuid AND "repositoryId"=${scope.repositoryId}::uuid ORDER BY "id" FOR UPDATE`;
          const parents = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "Repository" WHERE "workspaceId"=${scope.workspaceId}::uuid AND "id"=${scope.repositoryId}::uuid FOR UPDATE`;
          if (!parents.length)
            throw new NotFoundException('Repository not found');
          await tx.importJob.updateMany({
            where: { ...scope, status: { in: ['QUEUED', 'RUNNING'] } },
            data: { status: 'CANCELED', finishedAt: new Date() },
          });
          // The database clears only the live FK; immutable repositoryRef and
          // event content survive. Application code cannot rewrite the ledger.
          await tx.repository.delete({ where: { id: scope.repositoryId } });
          // Explanation cache has opaque hashes rather than a repository FK.
          await tx.aiExplanation.deleteMany({
            where: { workspaceId: scope.workspaceId },
          });
          await tx.auditEvent.create({
            data: {
              workspaceId: scope.workspaceId,
              actorId,
              action: 'repository.deleted',
              targetId: scope.repositoryId,
              repositoryRef: scope.repositoryId,
            },
          });
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2003'].includes(error.code)
      )
        throw new ConflictException(
          'Repository data changed during deletion. Retry after active work stops.',
        );
      throw error;
    }
  }
  async artifact(scope: Scope, id: string, actorId: string) {
    await this.db.$transaction(
      async (tx) => {
        await this.actor(tx, scope, actorId, false);
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "TestArtifact" WHERE "workspaceId"=${scope.workspaceId}::uuid AND "repositoryId"=${scope.repositoryId}::uuid AND "id"=${id}::uuid FOR UPDATE`;
        if (!rows.length) throw new NotFoundException('Artifact not found');
        const runs = await tx.testRun.findMany({
          where: { ...scope, externalRunId: id },
          select: { id: true },
        });
        const cases = await tx.testCase.findMany({
          where: { ...scope, testRunId: { in: runs.map((r) => r.id) } },
          select: { id: true },
        });
        // Preserve legacy recommendations while dropping references to removed live cases.
        await tx.testRecommendation.updateMany({
          where: { ...scope, testCaseId: { in: cases.map((c) => c.id) } },
          data: { testCaseId: null },
        });
        await tx.testRun.deleteMany({
          where: { ...scope, id: { in: runs.map((r) => r.id) } },
        });
        await tx.featureTestMapping.deleteMany({
          where: { ...scope, artifactId: id },
        });
        await tx.testArtifact.delete({ where: { id } });
        await tx.aiExplanation.deleteMany({
          where: { workspaceId: scope.workspaceId },
        });
        await tx.auditEvent.create({
          data: {
            ...scope,
            actorId,
            action: 'test_artifact.deleted',
            targetId: id,
          },
        });
        // Immutable saved comparisons contain their own evidence copy, intentionally retained.
      },
      { timeout: 15000 },
    );
  }
}

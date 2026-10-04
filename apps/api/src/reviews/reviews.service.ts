import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ReviewDecision } from '@prisma/client';
import {
  reviewNeedsNote,
  reviewReadiness,
  type ImpactInput,
  type ImpactResult,
  type ReleaseReport,
  type ReleaseReview,
  type ReviewState,
} from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import type { ReviewDto } from './reviews.controller';
type Scope = { workspaceId: string; repositoryId: string };
const serialize = (r: ReviewDecision): ReleaseReview => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  concerns: r.concerns as ReleaseReview['concerns'],
});
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class ReviewsService {
  constructor(private readonly db: DatabaseService) {}
  private async analysis(
    tx: Prisma.TransactionClient,
    scope: Scope,
    id: string,
  ) {
    const a = await tx.analysis.findFirst({
      where: {
        ...scope,
        id,
        status: 'COMPLETED',
        engineVersion: { not: null },
      },
      include: { baseSnapshot: true, headSnapshot: true, repository: true },
    });
    if (!a || !a.resultHash || !a.inputHash || !a.result || !a.input)
      throw new NotFoundException('Completed comparison not found');
    return a;
  }
  async list(scope: Scope, id: string, page = 1): Promise<ReviewState> {
    return this.db.$transaction(
      async (tx) => {
        const a = await this.analysis(tx, scope, id);
        const where = { ...scope, analysisId: id };
        const [items, total, latest] = await Promise.all([
          tx.reviewDecision.findMany({
            where,
            orderBy: { revision: 'desc' },
            skip: (page - 1) * 20,
            take: 20,
          }),
          tx.reviewDecision.count({ where }),
          tx.reviewDecision.findFirst({ where, orderBy: { revision: 'desc' } }),
        ]);
        return {
          analysisId: id,
          baseSha: a.baseSnapshot.commitSha,
          headSha: a.headSnapshot.commitSha,
          resultHash: a.resultHash!,
          readiness: reviewReadiness(a.result as unknown as ImpactResult),
          items: items.map(serialize),
          latest: latest ? serialize(latest) : null,
          total,
          page,
          pageSize: 20,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async create(
    scope: Scope,
    id: string,
    input: ReviewDto,
    actorId: string,
  ): Promise<ReleaseReview> {
    return this.db.$transaction(async (tx) => {
      // Serialize reviewers of this exact comparison, including across API processes.
      await tx.$queryRaw`SELECT "id" FROM "Analysis" WHERE "id"=${id}::uuid AND "workspaceId"=${scope.workspaceId}::uuid AND "repositoryId"=${scope.repositoryId}::uuid FOR UPDATE`;
      const a = await this.analysis(tx, scope, id);
      const members = await tx.$queryRaw<
        { role: string }[]
      >`SELECT "role" FROM "Membership" WHERE "workspaceId"=${scope.workspaceId}::uuid AND "userId"=${actorId}::uuid FOR SHARE`;
      if (!members[0] || !['OWNER', 'ENGINEER'].includes(members[0].role))
        throw new ForbiddenException('Review permission is required');
      const previous = await tx.reviewDecision.findFirst({
        where: { ...scope, analysisId: id },
        orderBy: { revision: 'desc' },
      });
      if (input.expectedRevision !== (previous?.revision ?? 0))
        throw new ConflictException(
          'Review history changed. Reload before submitting.',
        );
      if (
        input.baseSha !== a.baseSnapshot.commitSha ||
        input.headSha !== a.headSnapshot.commitSha ||
        input.resultHash !== a.resultHash
      )
        throw new ConflictException(
          'Review must match the saved commit pair and result hash.',
        );
      const readiness = reviewReadiness(a.result as unknown as ImpactResult);
      const comment = input.comment?.trim() || null;
      if (
        reviewNeedsNote(input.outcome, readiness, previous?.outcome) &&
        !comment
      )
        throw new BadRequestException(
          'A rationale is required for this decision.',
        );
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { name: true },
      });
      const saved = await tx.reviewDecision.create({
        data: {
          ...scope,
          analysisId: id,
          reviewerId: actorId,
          reviewerLabel: user.name,
          outcome: input.outcome,
          comment,
          revision: (previous?.revision ?? 0) + 1,
          recordVersion: 1,
          baseSha: input.baseSha,
          headSha: input.headSha,
          analysisResultHash: input.resultHash,
          isOverride: !!(previous && previous.outcome !== input.outcome),
          concerns: json(readiness.concerns),
        },
      });
      await tx.auditEvent.create({
        data: {
          ...scope,
          actorId,
          action: 'review.recorded',
          targetId: saved.id,
        },
      });
      return serialize(saved);
    });
  }
  async report(scope: Scope, id: string): Promise<ReleaseReport> {
    return this.db.$transaction(
      async (tx) => {
        const a = await this.analysis(tx, scope, id);
        const reviews = await tx.reviewDecision.findMany({
          where: { ...scope, analysisId: id },
          orderBy: { revision: 'asc' },
          take: 10001,
        });
        if (reviews.length > 10000)
          throw new BadRequestException(
            'Report exceeds 10,000 review records.',
          );
        const audit = await tx.auditEvent.findMany({
          where: {
            ...scope,
            targetId: { in: [id, ...reviews.map((r) => r.id)] },
          },
          include: { actor: { select: { name: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const input = a.input as unknown as ImpactInput;
        const findings = a.result as unknown as ImpactResult;
        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          disclaimer:
            'Human review of recorded static evidence. Approval is not proof of correctness or release safety. Later imports and mappings do not refresh this saved analysis.',
          repository: {
            id: a.repository.id,
            owner: a.repository.owner,
            name: a.repository.name,
          },
          analysis: {
            id,
            baseSha: a.baseSnapshot.commitSha,
            headSha: a.headSnapshot.commitSha,
            createdAt: a.createdAt.toISOString(),
            engineVersion: a.engineVersion!,
            inputHash: a.inputHash!,
            resultHash: a.resultHash!,
            semantics: input.semantics,
          },
          readiness: reviewReadiness(findings),
          findings,
          testResults: input.tests,
          testEvidence: input.testEvidence ?? null,
          reviews: reviews.map(serialize),
          audit: audit.map((e) => ({
            id: e.id,
            action: e.action,
            actorId: e.actorId,
            actorLabel: e.actor?.name ?? null,
            targetId: e.targetId,
            createdAt: e.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

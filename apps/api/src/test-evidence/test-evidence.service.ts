import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ArtifactError, parseArtifact } from '@impactlens/ingestion';
import type { ParsedArtifact } from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import type { ArtifactDto, TestMappingDto } from './test-evidence.controller';
type Scope = { workspaceId: string; repositoryId: string };
const select = {
  id: true,
  workspaceId: true,
  repositoryId: true,
  format: true,
  commitSha: true,
  runner: true,
  recordedAt: true,
  importedAt: true,
  filename: true,
  source: true,
  sourceRoot: true,
  contentHash: true,
  importedByLabel: true,
  parsed: true,
} as const;
@Injectable()
export class TestEvidenceService {
  constructor(private readonly db: DatabaseService) {}
  private async repo(scope: Scope) {
    if (
      !(await this.db.repository.findFirst({
        where: { id: scope.repositoryId, workspaceId: scope.workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Repository not found');
  }
  private async actor(
    tx: Prisma.TransactionClient,
    scope: Scope,
    userId: string,
  ) {
    const member = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId } },
      include: { user: { select: { name: true } } },
    });
    if (!member || member.role === 'VIEWER')
      throw new ForbiddenException(
        'Test evidence management permission is required.',
      );
    return member.user.name;
  }
  private status(recordedAt: Date, commit: string, selected?: string) {
    const ageDays = Math.max(0, (Date.now() - recordedAt.getTime()) / 86400000);
    return {
      ageDays,
      stale: ageDays > 30,
      commitMatch: selected ? commit === selected : null,
    };
  }
  async list(scope: Scope, commit?: string) {
    await this.repo(scope);
    const artifacts = await this.db.testArtifact.findMany({
      where: scope,
      select,
      orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return artifacts.map((a) => {
      const { parsed, ...meta } = a;
      const p = parsed as unknown as ParsedArtifact;
      return {
        ...meta,
        ...this.status(a.recordedAt, a.commitSha, commit),
        testCount: p.tests.length,
        coverageFileCount: p.aggregate.length,
        perTestCount: p.perTest.length,
      };
    });
  }
  async detail(scope: Scope, id: string, commit?: string) {
    const artifact = await this.db.testArtifact.findFirst({
      where: { ...scope, id },
      select,
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return {
      ...artifact,
      ...this.status(artifact.recordedAt, artifact.commitSha, commit),
    };
  }
  async import(scope: Scope, body: ArtifactDto, userId: string) {
    await this.repo(scope);
    if (new Date(body.recordedAt).getTime() > Date.now() + 300000)
      throw new BadRequestException(
        'Artifact timestamp cannot be more than five minutes in the future.',
      );
    let parsed: ParsedArtifact;
    try {
      parsed = parseArtifact(body.format, body.content, body.sourceRoot);
    } catch (error) {
      if (error instanceof ArtifactError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const hash = createHash('sha256')
      .update(body.content, 'utf8')
      .digest('hex');
    const id = await this.db.$transaction(
      async (tx) => {
        const label = await this.actor(tx, scope, userId);
        const artifact = await tx.testArtifact.create({
          data: {
            ...scope,
            ...body,
            recordedAt: new Date(body.recordedAt),
            contentHash: hash,
            parsed: JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue,
            importedByLabel: label,
          },
        });
        // Mirror known-snapshot JUnit outcomes for existing feature/explorer consumers.
        const snapshot = await tx.repositorySnapshot.findFirst({
          where: { ...scope, commitSha: body.commitSha },
          select: { id: true },
        });
        if (body.format === 'JUNIT' && snapshot) {
          const run = await tx.testRun.create({
            data: {
              ...scope,
              snapshotId: snapshot.id,
              provider: body.runner,
              externalRunId: artifact.id,
              recordedAt: new Date(body.recordedAt),
              outcome: parsed.tests.some((t) => t.outcome === 'FAILED')
                ? 'FAILED'
                : parsed.tests.length &&
                    parsed.tests.every((t) => t.outcome === 'PASSED')
                  ? 'PASSED'
                  : 'UNKNOWN',
            },
          });
          if (parsed.tests.length)
            await tx.testCase.createMany({
              data: parsed.tests.map((t) => ({
                ...scope,
                testRunId: run.id,
                ...t,
              })),
            });
        }
        await tx.auditEvent.create({
          data: {
            ...scope,
            actorId: userId,
            action: 'test_artifact.imported',
            targetId: artifact.id,
          },
        });
        return artifact.id;
      },
      { timeout: 15000 },
    );
    return this.detail(scope, id);
  }
  async mappings(scope: Scope) {
    await this.repo(scope);
    return this.db.featureTestMapping.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
    });
  }
  async map(scope: Scope, body: TestMappingDto, userId: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const actorLabel = await this.actor(tx, scope, userId);
        const feature = await tx.businessFeature.findFirst({
          where: { ...scope, id: body.featureId },
          select: { id: true },
        });
        const artifact = await tx.testArtifact.findFirst({
          where: { ...scope, id: body.artifactId },
        });
        if (!feature || !artifact)
          throw new NotFoundException('Feature or test artifact not found');
        if (
          !(artifact.parsed as unknown as ParsedArtifact).tests.some(
            (t) => t.identity === body.testIdentity,
          )
        )
          throw new BadRequestException(
            'Test identity is not present in this artifact.',
          );
        const mapping = await tx.featureTestMapping.create({
          data: { ...scope, ...body, runner: artifact.runner, actorLabel },
        });
        await tx.auditEvent.create({
          data: {
            ...scope,
            actorId: userId,
            action: 'feature_test.mapped',
            targetId: mapping.id,
          },
        });
        return mapping;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'This test is already mapped to the feature.',
        );
      throw error;
    }
  }
  async unmap(scope: Scope, id: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      await this.actor(tx, scope, userId);
      const result = await tx.featureTestMapping.deleteMany({
        where: { ...scope, id },
      });
      if (!result.count) throw new NotFoundException('Test mapping not found');
      await tx.auditEvent.create({
        data: {
          ...scope,
          actorId: userId,
          action: 'feature_test.unmapped',
          targetId: id,
        },
      });
      return { removed: true };
    });
  }
}

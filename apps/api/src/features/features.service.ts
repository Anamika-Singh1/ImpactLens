import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FeatureMapping } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  dependents,
  dependencyKinds,
  type MappingTarget,
  type SnapshotGraph,
} from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import {
  fileNode,
  fingerprint,
  resolveMapping,
  suggestTargets,
} from './mapping.logic';
import type {
  EditMappingDto,
  FeatureDto,
  MappingDto,
  ReviewMappingDto,
  UpdateFeatureDto,
} from './features.dto';
export interface FeatureScope {
  workspaceId: string;
  repositoryId: string;
}
type Tx = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const targetOf = (mapping: { target: Prisma.JsonValue }) =>
  mapping.target as unknown as MappingTarget | null;

@Injectable()
export class FeaturesService {
  constructor(private readonly db: DatabaseService) {}
  private async repo(scope: FeatureScope, tx: Tx = this.db) {
    if (
      !(await tx.repository.findFirst({
        where: { id: scope.repositoryId, workspaceId: scope.workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Repository not found');
  }
  private async feature(
    scope: FeatureScope,
    featureId: string,
    tx: Tx = this.db,
  ) {
    const feature = await tx.businessFeature.findFirst({
      where: { id: featureId, ...scope },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }
  private async actor(scope: FeatureScope, userId: string, tx: Tx) {
    const membership = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId } },
      include: { user: { select: { name: true } } },
    });
    if (!membership || membership.role === 'VIEWER')
      throw new ForbiddenException('Feature management permission is required');
    return { id: userId, label: membership.user.name };
  }
  private async lock(scope: FeatureScope, featureId: string, tx: Tx) {
    await this.feature(scope, featureId, tx);
    await tx.$queryRaw`SELECT id FROM "BusinessFeature" WHERE id = ${featureId}::uuid AND "workspaceId" = ${scope.workspaceId}::uuid AND "repositoryId" = ${scope.repositoryId}::uuid FOR UPDATE`;
  }
  private async context(
    scope: FeatureScope,
    snapshotId?: string,
    tx: Tx = this.db,
  ) {
    const snapshot = await tx.repositorySnapshot.findFirst({
      where: { ...scope, ...(snapshotId ? { id: snapshotId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { staticGraph: true },
    });
    if (!snapshot) {
      if (snapshotId) throw new NotFoundException('Snapshot not found');
      return null;
    }
    const files = await tx.sourceFile.findMany({
      where: { ...scope, snapshotId: snapshot.id },
      select: { id: true, path: true, contentText: true },
      orderBy: { path: 'asc' },
    });
    return {
      snapshot,
      files,
      graph:
        (snapshot.staticGraph?.graph as unknown as SnapshotGraph | null) ??
        null,
    };
  }
  private assess(
    mapping: FeatureMapping,
    context: Awaited<ReturnType<FeaturesService['context']>>,
  ) {
    return context
      ? resolveMapping(
          targetOf(mapping),
          mapping.anchorHash,
          context.files,
          context.graph,
          context.snapshot.commitSha,
        )
      : {
          status: 'NEEDS_REVIEW' as const,
          reason: 'No repository snapshot is available for resolution.',
          node: null,
          candidates: [],
        };
  }
  private counts(
    mappings: (FeatureMapping & {
      resolution: ReturnType<FeaturesService['assess']>;
    })[],
  ) {
    const active = mappings.filter((m) => m.status !== 'REJECTED');
    return {
      confirmed: active.filter((m) => m.status === 'CONFIRMED').length,
      suggested: active.filter((m) => m.status === 'SUGGESTED').length,
      stale: active.filter((m) => m.resolution.status === 'STALE').length,
      needsReview: active.filter(
        (m) =>
          m.resolution.status === 'NEEDS_REVIEW' || m.status === 'NEEDS_REVIEW',
      ).length,
      rejected: mappings.filter((m) => m.status === 'REJECTED').length,
    };
  }
  async list(scope: FeatureScope) {
    await this.repo(scope);
    const context = await this.context(scope);
    const features = await this.db.businessFeature.findMany({
      where: scope,
      include: { mappings: true },
      orderBy: { name: 'asc' },
    });
    return features.map(({ mappings, ...feature }) => ({
      ...feature,
      mappings,
      mappingCounts: this.counts(
        mappings.map((m) => ({ ...m, resolution: this.assess(m, context) })),
      ),
    }));
  }
  async detail(scope: FeatureScope, featureId: string, snapshotId?: string) {
    const feature = await this.feature(scope, featureId);
    const context = await this.context(scope, snapshotId);
    const stored = await this.db.featureMapping.findMany({
      where: { ...scope, featureId },
      include: {
        file: { select: { path: true } },
        history: { orderBy: { revision: 'desc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const mappings = stored.map((mapping) => ({
      ...mapping,
      resolution: this.assess(mapping, context),
    }));
    const graph = context?.graph;
    const graphNodes =
      graph?.nodes ??
      context?.files.map((f) => fileNode(f, context.snapshot.commitSha)) ??
      [];
    const dependencies = mappings
      .filter((m) => m.status !== 'REJECTED' && m.resolution.node)
      .map((m) => {
        const id = m.resolution.node!.id;
        return {
          mappingId: m.id,
          incoming:
            graph?.edges.filter(
              (e) => e.to === id && dependencyKinds.includes(e.kind),
            ) ?? [],
          outgoing:
            graph?.edges.filter(
              (e) => e.from === id && dependencyKinds.includes(e.kind),
            ) ?? [],
          dependents: graph ? dependents(graph, id) : [],
        };
      });
    const testPaths = new Set<string>();
    const isTest = (name: string) =>
      /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(
        name,
      );
    for (const mapping of mappings.filter(
      (m) => m.status === 'CONFIRMED' && m.resolution.node,
    )) {
      const node = mapping.resolution.node!;
      if (isTest(node.filePath)) testPaths.add(node.filePath);
      const ids = graph
        ? new Set([
            ...dependents(graph, node.id),
            ...dependents(graph, 'file:' + node.filePath),
          ])
        : new Set<string>();
      for (const dependent of graphNodes)
        if (
          dependent.kind === 'FILE' &&
          ids.has(dependent.id) &&
          isTest(dependent.filePath)
        )
          testPaths.add(dependent.filePath);
    }
    const cases =
      context && testPaths.size
        ? await this.db.testCase.findMany({
            where: {
              ...scope,
              path: { in: [...testPaths] },
              testRun: { snapshotId: context.snapshot.id },
            },
            select: { id: true, name: true, path: true, outcome: true },
          })
        : [];
    return {
      ...feature,
      mappingCounts: this.counts(mappings),
      mappings,
      snapshot: context
        ? { id: context.snapshot.id, commitSha: context.snapshot.commitSha }
        : null,
      graphNodes,
      dependencies,
      linkedTests: [...testPaths].sort().map((path) => ({
        path,
        basis:
          'Mapped test source or static dependency on confirmed implementation. This is not proof of execution or coverage.',
        cases: cases.filter((c) => c.path === path),
      })),
    };
  }
  private fields(input: FeatureDto) {
    return {
      name: input.name.trim(),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.criticality ? { criticality: input.criticality } : {}),
      ...(input.responsibleTeam !== undefined
        ? { responsibleTeam: input.responsibleTeam?.trim() || null }
        : {}),
      ...(input.customerWorkflow !== undefined
        ? { customerWorkflow: input.customerWorkflow?.trim() || null }
        : {}),
    };
  }
  private async audit(
    scope: FeatureScope,
    actorId: string,
    action: string,
    targetId: string,
    tx: Tx,
  ) {
    await tx.auditEvent.create({
      data: {
        workspaceId: scope.workspaceId,
        repositoryId: scope.repositoryId,
        actorId,
        action,
        targetId,
      },
    });
  }
  private async conflict<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Feature key or mapping target already exists. Review the existing record.',
        );
      throw error;
    }
  }
  async create(scope: FeatureScope, input: FeatureDto, actorId: string) {
    return this.conflict(() =>
      this.db.$transaction(async (tx) => {
        await this.repo(scope, tx);
        await this.actor(scope, actorId, tx);
        const feature = await tx.businessFeature.create({
          data: {
            ...scope,
            ...this.fields(input),
            key: input.key ?? 'feature-' + randomUUID().slice(0, 8),
          },
        });
        await this.audit(scope, actorId, 'feature.created', feature.id, tx);
        return feature;
      }),
    );
  }
  async update(
    scope: FeatureScope,
    featureId: string,
    input: UpdateFeatureDto,
    actorId: string,
  ) {
    return this.conflict(() =>
      this.db.$transaction(async (tx) => {
        await this.lock(scope, featureId, tx);
        await this.actor(scope, actorId, tx);
        const feature = await this.feature(scope, featureId, tx);
        if (feature.version !== input.expectedVersion)
          throw new ConflictException(
            'Feature changed. Reload before editing.',
          );
        const updated = await tx.businessFeature.update({
          where: { id: featureId },
          data: {
            ...this.fields(input),
            ...(input.key ? { key: input.key } : {}),
            version: { increment: 1 },
          },
        });
        await this.audit(scope, actorId, 'feature.updated', featureId, tx);
        return updated;
      }),
    );
  }
  private async target(scope: FeatureScope, input: MappingDto, tx: Tx) {
    const context = await this.context(scope, input.snapshotId, tx);
    const file = context!.files.find((f) => f.id === input.fileId);
    if (!file)
      throw new NotFoundException(
        'Source file not found in this snapshot and repository',
      );
    const nodeId = input.nodeId ?? 'file:' + file.path;
    const node =
      nodeId === 'file:' + file.path
        ? fileNode(file, context!.snapshot.commitSha)
        : context!.graph?.nodes.find(
            (n) => n.id === nodeId && n.filePath === file.path,
          );
    if (!node)
      throw new BadRequestException(
        'Analyze the snapshot and select a valid file, symbol or route.',
      );
    const anchorHash = fingerprint(node, file);
    if (!anchorHash)
      throw new BadRequestException(
        'Source text is unavailable; this mapping requires review.',
      );
    if (
      node.kind !== 'FILE' &&
      context!.graph?.limitations.some(
        (l) => l.code === 'SYNTAX_ERROR' && l.evidence.filePath === file.path,
      )
    )
      throw new BadRequestException(
        'Source has syntax errors. Select a file-level mapping or repair the source.',
      );
    return {
      snapshotId: input.snapshotId,
      fileId: file.id,
      nodeId,
      target: json({
        ...node,
        ...(context!.graph ? { analyzerVersion: context!.graph.version } : {}),
      }),
      anchorHash,
      rationale: input.rationale.trim(),
    };
  }
  private async revision(
    mapping: FeatureMapping,
    action: string,
    actor: { id: string; label: string },
    tx: Tx,
  ) {
    await tx.mappingRevision.create({
      data: {
        mappingId: mapping.id,
        workspaceId: mapping.workspaceId,
        repositoryId: mapping.repositoryId,
        revision: mapping.version,
        action,
        actorId: actor.id,
        actorLabel: actor.label,
        snapshotId: mapping.snapshotId,
        state: json(mapping),
      },
    });
    await this.audit(
      mapping,
      actor.id,
      'feature.mapping.' + action.toLowerCase(),
      mapping.id,
      tx,
    );
  }
  async manual(
    scope: FeatureScope,
    featureId: string,
    input: MappingDto,
    actorId: string,
  ) {
    return this.conflict(() =>
      this.db.$transaction(
        async (tx) => {
          await this.lock(scope, featureId, tx);
          const actor = await this.actor(scope, actorId, tx);
          const target = await this.target(scope, input, tx);
          const mapping = await tx.featureMapping.create({
            data: {
              ...scope,
              featureId,
              ...target,
              origin: 'MANUAL',
              status: 'CONFIRMED',
              confirmedById: actor.id,
              confirmedByLabel: actor.label,
              confirmedAt: new Date(),
            },
          });
          await this.revision(mapping, 'MANUAL_CONFIRMED', actor, tx);
          return mapping;
        },
        { timeout: 15000 },
      ),
    );
  }
  private async mapping(
    scope: FeatureScope,
    featureId: string,
    id: string,
    expectedVersion: number,
    tx: Tx,
  ) {
    const mapping = await tx.featureMapping.findFirst({
      where: { id, featureId, ...scope },
    });
    if (!mapping) throw new NotFoundException('Mapping not found');
    if (mapping.version !== expectedVersion)
      throw new ConflictException(
        'Mapping changed. Reload before reviewing it.',
      );
    return mapping;
  }
  async edit(
    scope: FeatureScope,
    featureId: string,
    id: string,
    input: EditMappingDto,
    actorId: string,
  ) {
    return this.conflict(() =>
      this.db.$transaction(
        async (tx) => {
          await this.lock(scope, featureId, tx);
          const actor = await this.actor(scope, actorId, tx);
          await this.mapping(scope, featureId, id, input.expectedVersion, tx);
          const target = await this.target(scope, input, tx);
          const mapping = await tx.featureMapping.update({
            where: { id },
            data: {
              ...target,
              status: 'SUGGESTED',
              confirmedAt: null,
              confirmedById: null,
              confirmedByLabel: null,
              version: { increment: 1 },
            },
          });
          await this.revision(mapping, 'EDITED_FOR_REVIEW', actor, tx);
          return mapping;
        },
        { timeout: 15000 },
      ),
    );
  }
  async review(
    scope: FeatureScope,
    featureId: string,
    id: string,
    input: ReviewMappingDto,
    actorId: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.lock(scope, featureId, tx);
        const actor = await this.actor(scope, actorId, tx);
        const existing = await this.mapping(
          scope,
          featureId,
          id,
          input.expectedVersion,
          tx,
        );
        if (input.action === 'CONFIRM') {
          if (input.snapshotId !== existing.snapshotId)
            throw new BadRequestException(
              'Edit the mapping to the selected snapshot before confirming it.',
            );
          const context = await this.context(scope, input.snapshotId, tx);
          if (this.assess(existing, context).status !== 'RESOLVED')
            throw new BadRequestException(
              'Mapping cannot be resolved confidently. Edit its target before confirmation.',
            );
          if (existing.status === 'REJECTED')
            throw new BadRequestException(
              'Edit the rejected mapping before confirming it.',
            );
        }
        const mapping = await tx.featureMapping.update({
          where: { id },
          data: {
            status: input.action === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
            ...(input.action === 'CONFIRM'
              ? {
                  confirmedById: actor.id,
                  confirmedByLabel: actor.label,
                  confirmedAt: new Date(),
                }
              : {}),
            version: { increment: 1 },
          },
        });
        await this.revision(
          mapping,
          input.action === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
          actor,
          tx,
        );
        return mapping;
      },
      { timeout: 15000 },
    );
  }
  async suggest(
    scope: FeatureScope,
    featureId: string,
    snapshotId: string,
    actorId: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.lock(scope, featureId, tx);
        const actor = await this.actor(scope, actorId, tx);
        const feature = await this.feature(scope, featureId, tx),
          context = await this.context(scope, snapshotId, tx);
        if (!context?.graph)
          throw new BadRequestException(
            'Analyze this snapshot before requesting suggestions.',
          );
        const existing = await tx.featureMapping.findMany({
          where: { ...scope, featureId, snapshotId },
          select: { nodeId: true },
        });
        const known = new Set(existing.map((m) => m.nodeId));
        let created = 0;
        for (const suggestion of suggestTargets(feature, context.graph)) {
          if (known.has(suggestion.node.id)) continue;
          const file = context.files.find(
            (f) => f.path === suggestion.node.filePath,
          );
          if (!file || !fingerprint(suggestion.node, file)) continue;
          const mapping = await tx.featureMapping.create({
            data: {
              ...scope,
              featureId,
              snapshotId,
              fileId: file.id,
              nodeId: suggestion.node.id,
              target: json({
                ...suggestion.node,
                analyzerVersion: context.graph.version,
              }),
              anchorHash: fingerprint(suggestion.node, file),
              rationale: suggestion.explanation,
              status: 'SUGGESTED',
              origin: 'HEURISTIC',
              heuristic: json({
                explanation: suggestion.explanation,
                matched: suggestion.matched,
                score: suggestion.score,
                evidence: suggestion.evidence,
              }),
            },
          });
          await this.revision(mapping, 'SUGGESTED', actor, tx);
          created++;
        }
        return {
          created,
          message: 'Suggestions are unconfirmed until explicitly accepted.',
        };
      },
      { timeout: 20000 },
    );
  }
}

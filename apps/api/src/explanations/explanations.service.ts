import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AiSettings,
  AnalysisExplanation,
  ImpactResult,
} from '@impactlens/shared';
import { DatabaseService } from '../database.module';
import { readConfig } from '../config';
import {
  cacheKey,
  evidenceBundle,
  InvalidExplanation,
  renderExplanation,
  templatePlan,
  validatePlan,
} from './explanation.logic';
import {
  EXPLANATION_PROVIDER,
  type ExplanationProvider,
  providerBody,
} from './explanation.provider';

type Scope = { workspaceId: string; repositoryId: string };
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class ExplanationsService {
  private readonly config = readConfig();
  private readonly pending = new Map<string, Promise<AnalysisExplanation>>();
  constructor(
    private readonly db: DatabaseService,
    @Inject(EXPLANATION_PROVIDER)
    private readonly provider: ExplanationProvider,
  ) {}
  private configured() {
    return (
      this.config.AI_PROVIDER === 'openai' &&
      !!this.config.AI_API_KEY &&
      !!this.config.AI_MODEL
    );
  }
  async settings(workspaceId: string): Promise<AiSettings> {
    const workspace = await this.db.workspace.findUnique({
      where: { id: workspaceId },
      select: { aiEnabled: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const usage = await this.db.aiUsage.findUnique({
      where: {
        workspaceId_day: {
          workspaceId,
          day: new Date().toISOString().slice(0, 10),
        },
      },
    });
    return {
      enabled: workspace.aiEnabled,
      provider: 'openai',
      configured: this.configured(),
      model: this.config.AI_MODEL || null,
      dailyRequestLimit: this.config.AI_DAILY_REQUEST_LIMIT,
      dailyTokenLimit: this.config.AI_DAILY_TOKEN_LIMIT,
      requestsUsed: usage?.requests ?? 0,
      tokensReserved: usage?.reservedTokens ?? 0,
    };
  }
  async setEnabled(workspaceId: string, enabled: boolean, userId: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId}::uuid FOR UPDATE`;
      const member = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (member?.role !== 'OWNER')
        throw new ForbiddenException('Only Owners can change AI consent');
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { aiEnabled: enabled, aiConsentVersion: { increment: 1 } },
      });
      // Revocation prevents reuse of any previously generated explanation.
      await tx.aiExplanation.deleteMany({ where: { workspaceId } });
      await tx.auditEvent.create({
        data: {
          workspaceId,
          actorId: userId,
          action: enabled ? 'ai.enabled' : 'ai.disabled',
          targetId: workspaceId,
        },
      });
    });
    return this.settings(workspaceId);
  }
  async explain(
    scope: Scope,
    analysisId: string,
    generate = false,
    userId?: string,
  ): Promise<AnalysisExplanation> {
    const record = await this.db.analysis.findFirst({
      where: {
        ...scope,
        id: analysisId,
        status: 'COMPLETED',
        engineVersion: { not: null },
      },
      select: { result: true },
    });
    if (!record?.result)
      throw new NotFoundException('Completed comparison not found');
    const bundle = evidenceBundle(record.result as unknown as ImpactResult);
    const fallback = (reason: AnalysisExplanation['reason']) =>
      renderExplanation(bundle, templatePlan(bundle), 'TEMPLATE', reason, null);
    const workspace = await this.db.workspace.findUnique({
      where: { id: scope.workspaceId },
      select: { aiEnabled: true, aiConsentVersion: true },
    });
    if (!workspace?.aiEnabled) return fallback('DISABLED');
    if (!this.configured()) return fallback('UNCONFIGURED');
    const key = cacheKey(bundle.result, this.config.AI_MODEL);
    const saved = await this.db.aiExplanation.findUnique({
      where: {
        workspaceId_cacheKey: { workspaceId: scope.workspaceId, cacheKey: key },
      },
    });
    if (saved) {
      try {
        return renderExplanation(
          bundle,
          validatePlan(saved.response, bundle),
          'AI',
          null,
          this.config.AI_MODEL,
          true,
        );
      } catch {
        return fallback('INVALID_RESPONSE');
      }
    }
    if (!generate) return fallback('NOT_REQUESTED');
    const pendingKey =
      scope.workspaceId + ':' + workspace.aiConsentVersion + ':' + key;
    const existing = this.pending.get(pendingKey);
    if (existing) return existing;
    if (this.pending.size >= 2) return fallback('LIMIT');
    const work = (async () => {
      try {
        const input = {
          model: this.config.AI_MODEL,
          facts: bundle.facts,
          maxOutputTokens: this.config.AI_MAX_OUTPUT_TOKENS,
        };
        // Conservative UTF-8 byte upper bound plus message framing, rather than an optimistic chars/token estimate.
        const inputTokens =
          Buffer.byteLength(JSON.stringify(providerBody(input)), 'utf8') + 1024;
        if (inputTokens > this.config.AI_MAX_INPUT_TOKENS)
          return fallback('LIMIT');
        const reservedTokens = inputTokens + this.config.AI_MAX_OUTPUT_TOKENS;
        const reservation = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${scope.workspaceId}::uuid FOR UPDATE`;
          const current = await tx.workspace.findUnique({
            where: { id: scope.workspaceId },
          });
          if (
            !current?.aiEnabled ||
            current.aiConsentVersion !== workspace.aiConsentVersion
          )
            return 'CONSENT_CHANGED' as const;
          const member = userId
            ? await tx.membership.findUnique({
                where: {
                  workspaceId_userId: {
                    workspaceId: scope.workspaceId,
                    userId,
                  },
                },
              })
            : null;
          if (!member || member.role === 'VIEWER')
            throw new ForbiddenException('Analysis permission is required');
          const where = {
            workspaceId_day: {
              workspaceId: scope.workspaceId,
              day: new Date().toISOString().slice(0, 10),
            },
          };
          const usage = await tx.aiUsage.upsert({
            where,
            create: { ...where.workspaceId_day },
            update: {},
          });
          if (
            usage.requests >= this.config.AI_DAILY_REQUEST_LIMIT ||
            usage.reservedTokens + reservedTokens >
              this.config.AI_DAILY_TOKEN_LIMIT
          )
            return 'LIMIT' as const;
          await tx.aiUsage.update({
            where,
            data: {
              requests: { increment: 1 },
              reservedTokens: { increment: reservedTokens },
            },
          });
          await tx.auditEvent.create({
            data: {
              ...scope,
              actorId: userId,
              action: 'ai.requested',
              targetId: analysisId,
            },
          });
          return null;
        });
        if (reservation) return fallback(reservation);
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let raw: unknown;
        try {
          raw = await Promise.race([
            this.provider.generate({ ...input, signal: controller.signal }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error('Provider timeout'));
              }, this.config.AI_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
        const plan = validatePlan(raw, bundle);
        const retained = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${scope.workspaceId}::uuid FOR UPDATE`;
          const current = await tx.workspace.findUnique({
            where: { id: scope.workspaceId },
          });
          if (
            !current?.aiEnabled ||
            current.aiConsentVersion !== workspace.aiConsentVersion
          )
            return false;
          await tx.aiExplanation.upsert({
            where: {
              workspaceId_cacheKey: {
                workspaceId: scope.workspaceId,
                cacheKey: key,
              },
            },
            create: {
              workspaceId: scope.workspaceId,
              cacheKey: key,
              response: json(plan),
            },
            update: { response: json(plan) },
          });
          return true;
        });
        return retained
          ? renderExplanation(bundle, plan, 'AI', null, this.config.AI_MODEL)
          : fallback('CONSENT_CHANGED');
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        return fallback(
          error instanceof InvalidExplanation
            ? 'INVALID_RESPONSE'
            : 'UNAVAILABLE',
        );
      }
    })();
    this.pending.set(pendingKey, work);
    try {
      return await work;
    } finally {
      this.pending.delete(pendingKey);
    }
  }
}

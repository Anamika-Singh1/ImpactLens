import 'dotenv/config';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import {
  analyzeSnapshot,
  analyzeImpact,
  impactHash,
  IMPACT_VERSION,
} from '@impactlens/analyzer';
import { defaultReviewRubric, type ImpactInput } from '@impactlens/shared';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.module';
import { configureHttp } from '../src/http';

describe('release review history and evidence exports', () => {
  let app: INestApplication, db: DatabaseService, url: string, id: string;
  type Actor = {
    agent: ReturnType<typeof request.agent>;
    csrf: string;
    workspaceId: string;
    userId: string;
  };
  let owner: Actor, engineer: Actor, viewer: Actor, outsider: Actor;
  const actors: Actor[] = [],
    prefix = randomUUID(),
    origin = 'http://localhost:5173';
  let binding: { baseSha: string; headSha: string; resultHash: string };
  let originalRateLimitPrefix: string | undefined;
  async function register(label: string) {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/api/auth/csrf').expect(200);
    const res = await agent
      .post('/api/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', pre.body.csrfToken)
      .send({
        name: label,
        email: `${prefix}-${label}@example.test`,
        password: 'Review test passphrase 123!',
      })
      .expect(201);
    const actor = {
      agent,
      csrf: res.body.csrfToken,
      workspaceId: res.body.workspaces[0].id,
      userId: res.body.user.id,
    };
    actors.push(actor);
    return actor;
  }
  function post(actor: Actor, data: object) {
    return actor.agent
      .post(url + '/reviews')
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .send(data);
  }
  function decision(
    revision: number,
    outcome = 'NEEDS_MORE_EVIDENCE',
    comment = 'Recorded evidence needs further review.',
  ) {
    return { ...binding, expectedRevision: revision, outcome, comment };
  }
  beforeAll(async () => {
    originalRateLimitPrefix = process.env.AUTH_RATE_LIMIT_PREFIX;
    process.env.AUTH_RATE_LIMIT_PREFIX = 'reviews:' + prefix;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, pino({ level: 'silent' }), origin);
    await app.init();
    db = app.get(DatabaseService);
    owner = await register('owner');
    engineer = await register('engineer');
    viewer = await register('viewer');
    outsider = await register('outsider');
    await db.membership.createMany({
      data: [
        {
          workspaceId: owner.workspaceId,
          userId: engineer.userId,
          role: 'ENGINEER',
        },
        {
          workspaceId: owner.workspaceId,
          userId: viewer.userId,
          role: 'VIEWER',
        },
      ],
    });
    const repo = await db.repository.create({
      data: {
        workspaceId: owner.workspaceId,
        owner: 'fixture',
        name: 'review-export',
      },
    });
    const scope = { workspaceId: owner.workspaceId, repositoryId: repo.id };
    const snapshots = [];
    for (const [i, value] of [1, 2].entries()) {
      const commitSha = String(i + 1).repeat(40),
        files = [
          {
            path: 'checkout.ts',
            contentText: `export const value = ${value};`,
            contentHash: impactHash(value),
          },
        ];
      const s = await db.repositorySnapshot.create({
        data: { ...scope, commitSha },
      });
      snapshots.push({
        id: s.id,
        commitSha,
        files,
        graph: analyzeSnapshot({ commitSha, files }),
        inventoryComplete: true,
      });
    }
    const input: ImpactInput = {
      version: IMPACT_VERSION,
      semantics: {
        kind: 'TWO_COMMIT_TREES',
        repositoryId: repo.id,
        baseSha: snapshots[0]!.commitSha,
        headSha: snapshots[1]!.commitSha,
        description: 'Two saved trees',
      },
      base: snapshots[0]!,
      head: snapshots[1]!,
      features: [],
      mappings: [],
      tests: [],
      rubric: defaultReviewRubric,
    };
    const result = analyzeImpact(input);
    const a = await db.analysis.create({
      data: {
        ...scope,
        baseSnapshotId: input.base.id,
        headSnapshotId: input.head.id,
        status: 'COMPLETED',
        engineVersion: input.version,
        inputHash: impactHash(input),
        resultHash: impactHash(result),
        input: JSON.parse(JSON.stringify(input)),
        result: JSON.parse(JSON.stringify(result)),
      },
    });
    id = a.id;
    binding = {
      baseSha: input.base.commitSha,
      headSha: input.head.commitSha,
      resultHash: a.resultHash!,
    };
    url = `/api/workspaces/${scope.workspaceId}/repositories/${scope.repositoryId}/comparisons/${id}`;
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.workspace.deleteMany({
          where: { id: { in: actors.map((a) => a.workspaceId) } },
        });
        await db.user.deleteMany({
          where: { id: { in: actors.map((a) => a.userId) } },
        });
      }
    } finally {
      await app?.close();
      if (originalRateLimitPrefix === undefined)
        delete process.env.AUTH_RATE_LIMIT_PREFIX;
      else process.env.AUTH_RATE_LIMIT_PREFIX = originalRateLimitPrefix;
    }
  });
  it('enforces roles, CSRF, scope and strict request validation', async () => {
    await viewer.agent.get(url + '/reviews').expect(200);
    await post(viewer, decision(0)).expect(403);
    await outsider.agent.get(url + '/reviews').expect(404);
    await outsider.agent.get(url + '/report').expect(404);
    await owner.agent
      .post(url + '/reviews')
      .send(decision(0))
      .expect(403);
    await post(owner, { ...decision(0), outcome: 'ACKNOWLEDGED' }).expect(400);
    await post(owner, { ...decision(0), extra: 'rejected' }).expect(400);
    await post(owner, { ...decision(0), expectedRevision: -1 }).expect(400);
    await owner.agent.get(url + '/reviews?page=0').expect(400);
    await post(owner, { ...decision(0), headSha: 'f'.repeat(40) }).expect(409);
    await post(owner, decision(0, 'APPROVED', '   ')).expect(400);
    await post(owner, decision(0, 'CHANGES_REQUESTED', '')).expect(400);
  });
  it('records immutable decisions, detects stale submissions and preserves exact provenance', async () => {
    const before = await db.analysis.findUnique({ where: { id } });
    const first = await post(engineer, decision(0)).expect(201);
    expect(first.body).toMatchObject({
      revision: 1,
      outcome: 'NEEDS_MORE_EVIDENCE',
      reviewerLabel: 'engineer',
      isOverride: false,
      analysisResultHash: binding.resultHash,
      baseSha: binding.baseSha,
      headSha: binding.headSha,
    });
    expect(first.body.concerns.length).toBeGreaterThan(0);
    await post(owner, decision(0)).expect(409);
    await post(owner, decision(1, 'APPROVED', '')).expect(400);
    const second = await post(
      owner,
      decision(1, 'APPROVED', 'Manually considered unmapped changes.'),
    ).expect(201);
    expect(second.body).toMatchObject({ revision: 2, isOverride: true });
    await expect(
      db.reviewDecision.update({
        where: { id: first.body.id },
        data: { comment: 'rewrite' },
      }),
    ).rejects.toThrow();
    await expect(
      db.reviewDecision.delete({ where: { id: first.body.id } }),
    ).rejects.toThrow();
    expect(await db.analysis.findUnique({ where: { id } })).toEqual(before);
    const state = await viewer.agent.get(url + '/reviews').expect(200);
    expect(state.body.total).toBe(2);
    expect(
      state.body.items.map((r: { revision: number }) => r.revision),
    ).toEqual([2, 1]);
  });
  it('serializes concurrent decisions with one conflict and exports saved evidence without source content', async () => {
    const responses = await Promise.all([
      post(owner, decision(2)),
      post(engineer, decision(2)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const report = await viewer.agent.get(url + '/report').expect(200);
    expect(report.headers['content-disposition']).toContain('attachment');
    expect(report.body.analysis).toMatchObject({ id, ...binding });
    expect(
      report.body.reviews.map((r: { revision: number }) => r.revision),
    ).toEqual([1, 2, 3]);
    expect(
      report.body.audit.filter(
        (e: { action: string }) => e.action === 'review.recorded',
      ),
    ).toHaveLength(3);
    expect(report.body.findings).toEqual(
      (await db.analysis.findUniqueOrThrow({ where: { id } })).result,
    );
    expect(JSON.stringify(report.body)).not.toMatch(
      /contentText|passwordHash|export const value/,
    );
  });
  it('paginates history while retaining the latest decision on every page', async () => {
    for (let revision = 3; revision < 21; revision++)
      await post(engineer, decision(revision)).expect(201);
    const second = await owner.agent.get(url + '/reviews?page=2').expect(200);
    expect(second.body).toMatchObject({
      total: 21,
      page: 2,
      pageSize: 20,
      latest: { revision: 21 },
    });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].revision).toBe(1);
  });
});

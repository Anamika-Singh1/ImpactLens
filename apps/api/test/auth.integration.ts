import 'dotenv/config';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pino from 'pino';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthRateLimit } from '../src/auth/rate-limit.service';
import { configureHttp } from '../src/http';
import { readConfig } from '../src/config';
import { allowed, permissions } from '../src/auth/security';
import { analyzeSnapshot } from '@impactlens/analyzer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Actor = {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  workspaceId: string;
  email: string;
  cookie: string;
};
describe('Phase 2 real PostgreSQL/Redis integration', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let owner: Actor, engineer: Actor, viewer: Actor, outsider: Actor;
  let repositoryId: string,
    foreignRepositoryId: string,
    snapshotId: string,
    fileId: string,
    foreignSnapshotId: string;
  const prefix = 'phase2-' + randomUUID();
  const password = 'Test-only long passphrase 123!';
  const workspaces: string[] = [];
  const sessionHashes: string[] = [];
  const origin = readConfig().WEB_ORIGIN;
  function cookie(response: request.Response) {
    const values = response.headers['set-cookie'] as unknown as
      | string[]
      | undefined;
    const value = values?.[0]?.split(';')[0] ?? '';
    const token = value.split('=')[1];
    if (token)
      sessionHashes.push(createHash('sha256').update(token).digest('hex'));
    return value;
  }
  async function register(label: string): Promise<Actor> {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/api/auth/csrf').expect(200);
    const oldCookie = cookie(pre);
    const email = prefix + '-' + label + '@example.test';
    const result = await agent
      .post('/api/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', pre.body.csrfToken)
      .send({ name: label, email, password })
      .expect(201);
    const value = cookie(result);
    expect(value).not.toBe(oldCookie);
    const workspaceId = result.body.workspaces[0].id;
    workspaces.push(workspaceId);
    return {
      agent,
      csrf: result.body.csrfToken,
      userId: result.body.user.id,
      workspaceId,
      email,
      cookie: value,
    };
  }
  function mutation(
    actor: Actor,
    method: 'post' | 'patch' | 'delete',
    path: string,
  ) {
    return actor.agent[method]('/api' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf);
  }
  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_PREFIX = 'impactlens:integration:' + prefix;
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
    for (const [actor, role] of [
      [engineer, 'ENGINEER'],
      [viewer, 'VIEWER'],
    ] as const) {
      await mutation(
        owner,
        'post',
        '/workspaces/' + owner.workspaceId + '/members',
      )
        .send({ email: actor.email, role })
        .expect(201);
    }
    repositoryId = (
      await mutation(
        owner,
        'post',
        '/workspaces/' + owner.workspaceId + '/repositories',
      )
        .send({ owner: 'owned', name: 'app' })
        .expect(201)
    ).body.id;
    foreignRepositoryId = (
      await mutation(
        outsider,
        'post',
        '/workspaces/' + outsider.workspaceId + '/repositories',
      )
        .send({ owner: 'owned', name: 'app' })
        .expect(201)
    ).body.id;
    const snapshot = await db.repositorySnapshot.create({
      data: {
        workspaceId: owner.workspaceId,
        repositoryId,
        commitSha: 'a'.repeat(40),
      },
    });
    snapshotId = snapshot.id;
    fileId = (
      await db.sourceFile.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          snapshotId,
          path: 'src/app.ts',
          language: 'typescript',
          contentHash: '1'.repeat(64),
        },
      })
    ).id;
    foreignSnapshotId = (
      await db.repositorySnapshot.create({
        data: {
          workspaceId: outsider.workspaceId,
          repositoryId: foreignRepositoryId,
          commitSha: 'b'.repeat(40),
        },
      })
    ).id;
  }, 60000);
  afterAll(async () => {
    try {
      if (db) {
        await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
        await db.session.deleteMany({
          where: { tokenHash: { in: sessionHashes } },
        });
        await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      }
    } finally {
      if (app) await app.close();
    }
  });
  it('registers an Owner workspace and stores Argon2id hashes, never raw session tokens', async () => {
    const result = await owner.agent.get('/api/auth/me').expect(200);
    expect(result.body.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: owner.workspaceId, role: 'OWNER' }),
      ]),
    );
    expect(result.body.user.passwordHash).toBeUndefined();
    const stored = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(stored.passwordHash.split('$')[3]?.split(',').sort()).toEqual([
      'm=19456',
      'p=1',
      't=2',
    ]);
    const token = owner.cookie.split('=')[1]!;
    expect(
      await db.session.findUnique({ where: { tokenHash: token } }),
    ).toBeNull();
    expect(
      await db.session.findUnique({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      }),
    ).not.toBeNull();
  });
  it('persists isolated snapshot graphs and enforces explorer read/write permissions', async () => {
    await db.sourceFile.update({
      where: { id: fileId },
      data: {
        contentText: 'export function App() { return 1; }\nimport(target);',
      },
    });
    const root = `/workspaces/${owner.workspaceId}/repositories/${repositoryId}/snapshots`;
    const graphPath = `${root}/${snapshotId}/graph`;
    await request(app.getHttpServer())
      .get('/api' + graphPath)
      .expect(401);
    await outsider.agent.get('/api' + graphPath).expect(404);
    await mutation(viewer, 'post', graphPath).send({}).expect(403);
    await owner.agent
      .post('/api' + graphPath)
      .send({})
      .expect(403);
    expect(
      (await viewer.agent.get('/api' + graphPath).expect(200)).body.graph,
    ).toBeNull();
    const analyzed = await mutation(engineer, 'post', graphPath)
      .send({})
      .expect(201);
    expect(analyzed.body.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'FUNCTION', name: 'App' }),
      ]),
    );
    expect(analyzed.body.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'DYNAMIC_IMPORT', to: null }),
      ]),
    );
    const persisted = await viewer.agent.get('/api' + graphPath).expect(200);
    expect(persisted.body.graph).toEqual(analyzed.body.graph);
    expect(
      (await viewer.agent.get('/api' + root).expect(200)).body[0].staticGraph
        .version,
    ).toBe('4.0.0');
    const files = await viewer.agent
      .get(`/api${root}/${snapshotId}/files`)
      .expect(200);
    expect(files.body[0].contentText).toBeUndefined();
    expect(
      (
        await viewer.agent
          .get(`/api${root}/${snapshotId}/files/${fileId}`)
          .expect(200)
      ).body.contentText,
    ).toContain('export function App');
    await viewer.agent
      .get(`/api${root}/${foreignSnapshotId}/graph`)
      .expect(404);
    await viewer.agent
      .get(`/api${root}/${foreignSnapshotId}/files/${fileId}`)
      .expect(404);
    await mutation(owner, 'post', `${root}/${foreignSnapshotId}/graph`)
      .send({})
      .expect(404);
    const rerun = await mutation(owner, 'post', graphPath).send({}).expect(201);
    expect(rerun.body.graph).toEqual(persisted.body.graph);
    expect(await db.staticGraph.count({ where: { snapshotId } })).toBe(1);
    await expect(
      db.staticGraph.create({
        data: {
          snapshotId: foreignSnapshotId,
          repositoryId,
          workspaceId: owner.workspaceId,
          version: 'test',
          graph: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('manages features, explicit suggestions, stale review, immutable history and tenant isolation', async () => {
    const scope = { workspaceId: owner.workspaceId, repositoryId };
    async function snapshotFixture(name: string, sha: string) {
      const contents: Record<string, string> = JSON.parse(
        readFileSync(
          resolve(
            __dirname,
            '../../../fixtures/feature-mapping/' + name + '.json',
          ),
          'utf8',
        ),
      );
      const files = Object.entries(contents).map(([path, contentText]) => ({
        path,
        contentText,
      }));
      const graph = analyzeSnapshot({ commitSha: sha.repeat(40), files });
      const snapshot = await db.repositorySnapshot.create({
        data: { ...scope, commitSha: graph.commitSha },
      });
      await db.sourceFile.createMany({
        data: files.map((f) => ({
          ...f,
          ...scope,
          snapshotId: snapshot.id,
          contentHash: createHash('sha256').update(f.contentText).digest('hex'),
          language: 'typescript',
        })),
      });
      await db.staticGraph.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          version: graph.version,
          graph: JSON.parse(JSON.stringify(graph)),
        },
      });
      return {
        snapshot,
        graph,
        files: await db.sourceFile.findMany({
          where: { ...scope, snapshotId: snapshot.id },
        }),
      };
    }
    const base = await snapshotFixture('base', 'c'),
      moved = await snapshotFixture('moved', 'd');
    const root = `/workspaces/${owner.workspaceId}/repositories/${repositoryId}/features`;
    const create = {
      name: 'Checkout',
      description: 'Place an order',
      criticality: 'CRITICAL',
      responsibleTeam: 'Payments',
      customerWorkflow: 'Customer completes checkout',
      key: 'phase5-checkout',
    };
    const created = await mutation(engineer, 'post', root)
      .send(create)
      .expect(201);
    const featureId = created.body.id,
      url = `${root}/${featureId}`;
    await mutation(viewer, 'patch', url)
      .send({ ...create, expectedVersion: 1 })
      .expect(403);
    await mutation(engineer, 'patch', url)
      .send({ ...create, name: 'Checkout and payment', expectedVersion: 1 })
      .expect(200);
    await mutation(engineer, 'patch', url)
      .send({ ...create, expectedVersion: 1 })
      .expect(409);
    await mutation(engineer, 'patch', url)
      .send({ ...create, criticality: 'INVALID', expectedVersion: 2 })
      .expect(400);
    const initial = (await viewer.agent.get('/api' + url).expect(200)).body;
    expect(initial).toMatchObject({
      name: 'Checkout and payment',
      criticality: 'CRITICAL',
      responsibleTeam: 'Payments',
      customerWorkflow: create.customerWorkflow,
      description: create.description,
    });
    const file = base.files.find((f) => f.path === 'src/checkout.ts')!;
    const target = base.graph.nodes.find(
      (n) => n.kind === 'FUNCTION' && n.name === 'checkout',
    )!;
    const manual = (
      await mutation(engineer, 'post', `${url}/mappings`)
        .send({
          snapshotId: base.snapshot.id,
          fileId: file.id,
          nodeId: target.id,
          rationale: 'Places the customer order',
        })
        .expect(201)
    ).body;
    expect(manual).toMatchObject({
      status: 'CONFIRMED',
      confirmedById: engineer.userId,
      snapshotId: base.snapshot.id,
      origin: 'MANUAL',
    });
    const suggestionRun = await mutation(engineer, 'post', `${url}/suggestions`)
      .send({ snapshotId: base.snapshot.id })
      .expect(201);
    expect(suggestionRun.body.created).toBeGreaterThan(0);
    let detail = (
      await viewer.agent
        .get(`/api${url}?snapshotId=${base.snapshot.id}`)
        .expect(200)
    ).body;
    const suggestion = detail.mappings.find(
      (m: any) => m.status === 'SUGGESTED' && m.target.kind === 'ROUTE',
    );
    const reject = detail.mappings.find(
      (m: any) =>
        m.status === 'SUGGESTED' && m.target.id === 'file:src/checkout.ts',
    );
    expect(suggestion.confirmedAt).toBeNull();
    expect(suggestion.heuristic.explanation).toContain('Unconfirmed');
    expect(detail.linkedTests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tests/checkout.test.ts', cases: [] }),
      ]),
    );
    const run = await db.testRun.create({
      data: {
        ...scope,
        snapshotId: base.snapshot.id,
        provider: 'fixture',
        externalRunId: randomUUID(),
        outcome: 'PASSED',
      },
    });
    await db.testCase.create({
      data: {
        ...scope,
        testRunId: run.id,
        identity: 'checkout',
        name: 'places order',
        path: 'tests/checkout.test.ts',
        outcome: 'PASSED',
      },
    });
    detail = (
      await viewer.agent
        .get(`/api${url}?snapshotId=${base.snapshot.id}`)
        .expect(200)
    ).body;
    expect(detail.linkedTests[0].cases[0].outcome).toBe('PASSED');
    const edited = (
      await mutation(engineer, 'patch', `${url}/mappings/${suggestion.id}`)
        .send({
          snapshotId: base.snapshot.id,
          fileId: suggestion.fileId,
          nodeId: suggestion.nodeId,
          rationale: 'HTTP checkout registration reviewed',
          expectedVersion: suggestion.version,
        })
        .expect(200)
    ).body;
    expect(edited.status).toBe('SUGGESTED');
    expect(edited.confirmedById).toBeNull();
    await mutation(viewer, 'post', `${url}/mappings/${suggestion.id}/review`)
      .send({
        action: 'CONFIRM',
        expectedVersion: edited.version,
        snapshotId: base.snapshot.id,
      })
      .expect(403);
    await mutation(owner, 'post', `${url}/mappings/${suggestion.id}/review`)
      .send({
        action: 'CONFIRM',
        expectedVersion: suggestion.version,
        snapshotId: base.snapshot.id,
      })
      .expect(409);
    await mutation(owner, 'post', `${url}/mappings/${suggestion.id}/review`)
      .send({
        action: 'CONFIRM',
        expectedVersion: edited.version,
        snapshotId: base.snapshot.id,
        confirmedById: engineer.userId,
      })
      .expect(400);
    const accepted = (
      await mutation(owner, 'post', `${url}/mappings/${suggestion.id}/review`)
        .send({
          action: 'CONFIRM',
          expectedVersion: edited.version,
          snapshotId: base.snapshot.id,
        })
        .expect(201)
    ).body;
    expect(accepted.confirmedById).toBe(owner.userId);
    await mutation(owner, 'post', `${url}/mappings/${reject.id}/review`)
      .send({ action: 'REJECT', expectedVersion: reject.version })
      .expect(201);
    expect(
      (
        await mutation(owner, 'post', `${url}/suggestions`)
          .send({ snapshotId: base.snapshot.id })
          .expect(201)
      ).body.created,
    ).toBe(0);
    detail = (
      await viewer.agent
        .get(`/api${url}?snapshotId=${moved.snapshot.id}`)
        .expect(200)
    ).body;
    expect(
      detail.mappings.find((m: any) => m.id === manual.id).resolution.status,
    ).toBe('STALE');
    expect(
      detail.mappings.find((m: any) => m.id === manual.id).confirmedById,
    ).toBe(engineer.userId);
    expect(
      (await viewer.agent.get('/api' + root).expect(200)).body.find(
        (f: any) => f.id === featureId,
      ).mappingCounts.stale,
    ).toBeGreaterThan(0);
    await mutation(owner, 'post', `${url}/mappings/${manual.id}/review`)
      .send({
        action: 'CONFIRM',
        expectedVersion: manual.version,
        snapshotId: moved.snapshot.id,
      })
      .expect(400);
    const replacement = moved.graph.nodes.find(
      (n) => n.kind === 'FUNCTION' && n.name === 'checkout',
    )!;
    const replacementFile = moved.files.find(
      (f) => f.path === replacement.filePath,
    )!;
    const rebound = (
      await mutation(owner, 'patch', `${url}/mappings/${manual.id}`)
        .send({
          expectedVersion: manual.version,
          snapshotId: moved.snapshot.id,
          fileId: replacementFile.id,
          nodeId: replacement.id,
          rationale: 'Reviewed move to payments directory',
        })
        .expect(200)
    ).body;
    expect(rebound.status).toBe('SUGGESTED');
    expect(rebound.confirmedById).toBeNull();
    await mutation(owner, 'post', `${url}/mappings/${manual.id}/review`)
      .send({
        action: 'CONFIRM',
        expectedVersion: rebound.version,
        snapshotId: moved.snapshot.id,
      })
      .expect(201);
    detail = (
      await viewer.agent
        .get(`/api${url}?snapshotId=${moved.snapshot.id}`)
        .expect(200)
    ).body;
    const remapped = detail.mappings.find((m: any) => m.id === manual.id);
    expect(remapped.resolution.status).toBe('RESOLVED');
    expect(remapped.history.map((h: any) => h.action)).toEqual([
      'CONFIRMED',
      'EDITED_FOR_REVIEW',
      'MANUAL_CONFIRMED',
    ]);
    expect(remapped.history[2].state.snapshotId).toBe(base.snapshot.id);
    expect(remapped.history[2].state.confirmedById).toBe(engineer.userId);
    await expect(
      db.mappingRevision.update({
        where: { id: remapped.history[2].id },
        data: { state: {} },
      }),
    ).rejects.toThrow();
    await expect(
      db.mappingRevision.delete({ where: { id: remapped.history[2].id } }),
    ).rejects.toThrow();
    const otherRepo = await db.repository.create({
      data: {
        workspaceId: owner.workspaceId,
        owner: 'isolation',
        name: 'phase5',
      },
    });
    await viewer.agent
      .get(
        `/api/workspaces/${owner.workspaceId}/repositories/${otherRepo.id}/features/${featureId}`,
      )
      .expect(404);
    await outsider.agent.get('/api' + url).expect(404);
    await viewer.agent
      .get(`/api${url}?snapshotId=${foreignSnapshotId}`)
      .expect(404);
    await mutation(owner, 'post', `${url}/suggestions`)
      .send({ snapshotId: foreignSnapshotId })
      .expect(404);
    await mutation(owner, 'post', `${url}/mappings`)
      .send({
        snapshotId: foreignSnapshotId,
        fileId,
        rationale: 'Cross-tenant',
      })
      .expect(404);
    await mutation(owner, 'patch', `${url}/mappings/${manual.id}`)
      .send({
        expectedVersion: remapped.version,
        snapshotId: base.snapshot.id,
        fileId: replacementFile.id,
        rationale: 'Mismatched file snapshot',
      })
      .expect(404);
    const foreignFeature = await db.businessFeature.create({
      data: {
        workspaceId: outsider.workspaceId,
        repositoryId: foreignRepositoryId,
        key: 'phase5',
        name: 'Foreign',
      },
    });
    await mutation(
      owner,
      'post',
      `${root}/${foreignFeature.id}/mappings/${manual.id}/review`,
    )
      .send({ action: 'REJECT', expectedVersion: remapped.version })
      .expect(404);
    await expect(
      db.mappingRevision.create({
        data: {
          mappingId: manual.id,
          workspaceId: outsider.workspaceId,
          repositoryId: foreignRepositoryId,
          revision: 99,
          action: 'INVALID',
          actorLabel: 'invalid',
          snapshotId: foreignSnapshotId,
          state: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  }, 60000);
  it('saves reproducible impact comparisons with review evidence and tenant isolation', async () => {
    const scope = { workspaceId: owner.workspaceId, repositoryId };
    const snapshots: { id: string; fileId: string; nodeId: string }[] = [];
    for (const [index, value] of [1, 2].entries()) {
      const commitSha = String(index + 7).repeat(40);
      const files = [
        {
          path: 'checkout.ts',
          contentText: `export function checkout() { return ${value}; }`,
        },
      ];
      const graph = analyzeSnapshot({ commitSha, files });
      const snapshot = await db.repositorySnapshot.create({
        data: { ...scope, commitSha },
      });
      const file = await db.sourceFile.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          ...files[0]!,
          contentHash: createHash('sha256')
            .update(files[0]!.contentText)
            .digest('hex'),
          language: 'typescript',
        },
      });
      await db.staticGraph.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          version: graph.version,
          graph: JSON.parse(JSON.stringify(graph)),
        },
      });
      snapshots.push({
        id: snapshot.id,
        fileId: file.id,
        nodeId: graph.nodes.find((n) => n.kind === 'FUNCTION')!.id,
      });
    }
    const root = `/workspaces/${owner.workspaceId}/repositories/${repositoryId}`;
    const feature = await mutation(engineer, 'post', root + '/features')
      .send({ name: 'Comparison checkout', criticality: 'CRITICAL' })
      .expect(201);
    const mapped = await mutation(
      engineer,
      'post',
      `${root}/features/${feature.body.id}/mappings`,
    )
      .send({
        snapshotId: snapshots[0]!.id,
        fileId: snapshots[0]!.fileId,
        nodeId: snapshots[0]!.nodeId,
        rationale: 'Checkout implementation',
      })
      .expect(201);
    const body = {
      baseSnapshotId: snapshots[0]!.id,
      headSnapshotId: snapshots[1]!.id,
    };
    await mutation(viewer, 'post', root + '/comparisons')
      .send(body)
      .expect(403);
    await mutation(engineer, 'post', root + '/comparisons')
      .send({ ...body, headSnapshotId: foreignSnapshotId })
      .expect(404);
    await mutation(engineer, 'post', root + '/comparisons')
      .send({ ...body, actorId: owner.userId })
      .expect(400);
    await engineer.agent
      .post('/api' + root + '/comparisons')
      .send(body)
      .expect(403);
    const created = await mutation(engineer, 'post', root + '/comparisons')
      .send(body)
      .expect(201);
    expect(created.body.input).toBeUndefined();
    expect(created.body.result.changes).toHaveLength(1);
    expect(created.body.result.features).toContainEqual(
      expect.objectContaining({
        featureId: feature.body.id,
        kind: 'DIRECT',
        confidence: 'LIMITED',
      }),
    );
    const stored = await db.analysis.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    const { analyzeImpact, impactHash } = await import('@impactlens/analyzer');
    expect(impactHash(stored.input)).toBe(stored.inputHash);
    expect(impactHash(analyzeImpact(stored.input as never))).toBe(
      stored.resultHash,
    );
    await expect(
      db.analysis.update({
        where: { id: stored.id },
        data: { engineVersion: 'tampered' },
      }),
    ).rejects.toThrow();
    const read = await viewer.agent
      .get('/api' + root + '/comparisons/' + stored.id)
      .expect(200);
    expect(read.body.resultHash).toBe(created.body.resultHash);
    await outsider.agent
      .get('/api' + root + '/comparisons/' + stored.id)
      .expect(404);
    await owner.agent
      .get(
        `/api/workspaces/${owner.workspaceId}/repositories/${foreignRepositoryId}/comparisons/${stored.id}`,
      )
      .expect(404);
    await mutation(
      engineer,
      'post',
      `${root}/features/${feature.body.id}/mappings/${mapped.body.id}/review`,
    )
      .send({ action: 'REJECT', expectedVersion: 1 })
      .expect(201);
    const reread = await viewer.agent
      .get('/api' + root + '/comparisons/' + stored.id)
      .expect(200);
    expect(reread.body.result).toEqual(created.body.result);
    const list = await viewer.agent
      .get('/api' + root + '/comparisons')
      .expect(200);
    expect(list.body.some((r: { id: string }) => r.id === stored.id)).toBe(
      true,
    );
    expect(list.body[0].input).toBeUndefined();
  });
  it('requires authentication for workspace and current-user endpoints', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/workspaces').expect(401);
    await request(app.getHttpServer())
      .post('/api/workspaces/' + owner.workspaceId + '/repositories')
      .send({ owner: 'x', name: 'y' })
      .expect(401);
  });
  it('rejects absent/wrong CSRF tokens and foreign/missing origins', async () => {
    const path = '/api/workspaces/' + owner.workspaceId;
    await owner.agent
      .patch(path)
      .set('Origin', origin)
      .send({ name: 'blocked' })
      .expect(403);
    await owner.agent
      .patch(path)
      .set('Origin', origin)
      .set('X-CSRF-Token', viewer.csrf)
      .send({ name: 'blocked' })
      .expect(403);
    await owner.agent
      .patch(path)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'blocked' })
      .expect(403);
    await owner.agent
      .patch(path)
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'blocked' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: owner.email, password })
      .expect(403);
  });
  it('does not expose other tenants through workspace IDs or repository IDs', async () => {
    const result = await owner.agent.get('/api/workspaces').expect(200);
    expect(
      result.body.map((m: { workspace: { id: string } }) => m.workspace.id),
    ).not.toContain(outsider.workspaceId);
    await owner.agent
      .get('/api/workspaces/' + outsider.workspaceId)
      .expect(404);
    await owner.agent
      .get(
        '/api/workspaces/' +
          outsider.workspaceId +
          '/repositories/' +
          foreignRepositoryId,
      )
      .expect(404);
    await owner.agent
      .get(
        '/api/workspaces/' +
          owner.workspaceId +
          '/repositories/' +
          foreignRepositoryId,
      )
      .expect(404);
    await mutation(
      owner,
      'post',
      '/workspaces/' +
        owner.workspaceId +
        '/repositories/' +
        foreignRepositoryId +
        '/features',
    )
      .send({ key: 'unauthorized', name: 'Unauthorized' })
      .expect(404);
  });
  it('allows Viewer reads and denies every exposed mutation category', async () => {
    await viewer.agent
      .get('/api/workspaces/' + owner.workspaceId + '/repositories')
      .expect(200);
    for (const [method, suffix, data] of [
      ['patch', '', { name: 'blocked' }],
      ['post', '/repositories', { owner: 'x', name: 'y' }],
      ['post', '/members', { email: outsider.email, role: 'ENGINEER' }],
      [
        'post',
        '/repositories/' + repositoryId + '/features',
        { key: 'x', name: 'y' },
      ],
      [
        'post',
        '/repositories/' +
          repositoryId +
          '/features/' +
          randomUUID() +
          '/mappings',
        { snapshotId, fileId, rationale: 'x' },
      ],
      [
        'post',
        '/repositories/' + repositoryId + '/analyses',
        { baseSnapshotId: snapshotId, headSnapshotId: snapshotId },
      ],
    ] as const) {
      await mutation(
        viewer,
        method,
        '/workspaces/' + owner.workspaceId + suffix,
      )
        .send(data)
        .expect(403);
    }
  });
  it('lets Engineers create repository, feature, mapping and draft-analysis records but not manage the workspace', async () => {
    const root = '/workspaces/' + owner.workspaceId;
    await mutation(engineer, 'patch', root)
      .send({ name: 'blocked' })
      .expect(403);
    await mutation(engineer, 'post', root + '/members')
      .send({ email: outsider.email, role: 'VIEWER' })
      .expect(403);
    await mutation(engineer, 'post', root + '/repositories')
      .send({ owner: 'engineering', name: 'app' })
      .expect(201);
    const feature = await mutation(
      engineer,
      'post',
      root + '/repositories/' + repositoryId + '/features',
    )
      .send({ key: 'checkout', name: 'Checkout' })
      .expect(201);
    const mapping =
      root +
      '/repositories/' +
      repositoryId +
      '/features/' +
      feature.body.id +
      '/mappings';
    await mutation(engineer, 'post', mapping)
      .send({ snapshotId, fileId, rationale: 'Explicit test mapping' })
      .expect(201);
    await mutation(engineer, 'post', mapping)
      .send({
        snapshotId: foreignSnapshotId,
        fileId,
        rationale: 'must reject mismatched scope',
      })
      .expect(404);
    const analysis = await mutation(
      engineer,
      'post',
      root + '/repositories/' + repositoryId + '/analyses',
    )
      .send({ baseSnapshotId: snapshotId, headSnapshotId: snapshotId })
      .expect(201);
    expect(analysis.body.status).toBe('DRAFT');
    await mutation(
      engineer,
      'post',
      root + '/repositories/' + repositoryId + '/analyses',
    )
      .send({ baseSnapshotId: foreignSnapshotId, headSnapshotId: snapshotId })
      .expect(404);
  });
  it('refreshes role authorization from membership rather than trusting an old session', async () => {
    const root = '/workspaces/' + owner.workspaceId;
    await mutation(owner, 'patch', root + '/members/' + engineer.userId)
      .send({ role: 'VIEWER' })
      .expect(200);
    await mutation(engineer, 'post', root + '/repositories')
      .send({ owner: 'blocked', name: 'blocked' })
      .expect(403);
    await mutation(owner, 'patch', root + '/members/' + engineer.userId)
      .send({ role: 'ENGINEER' })
      .expect(200);
    await mutation(owner, 'delete', root + '/members/' + viewer.userId).expect(
      204,
    );
    await viewer.agent.get('/api/workspaces/' + owner.workspaceId).expect(404);
    await mutation(owner, 'post', root + '/members')
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
  });
  it('prevents owner removal or client-supplied roles and tenant IDs', async () => {
    const root = '/workspaces/' + owner.workspaceId;
    await mutation(owner, 'patch', root + '/members/' + owner.userId)
      .send({ role: 'VIEWER' })
      .expect(404);
    await mutation(owner, 'delete', root + '/members/' + owner.userId).expect(
      404,
    );
    await mutation(owner, 'post', root + '/members')
      .send({ email: outsider.email, role: 'OWNER' })
      .expect(400);
    await mutation(engineer, 'post', root + '/repositories')
      .send({ owner: 'x', name: 'x', workspaceId: outsider.workspaceId })
      .expect(400);
  });
  it('enforces all permission-matrix entries, including reserved integration management', () => {
    for (const permission of Object.keys(
      permissions,
    ) as (keyof typeof permissions)[]) {
      expect(allowed('OWNER', permission)).toBe(true);
      expect(allowed('VIEWER', permission)).toBe(
        permission === 'workspace:read',
      );
      expect(allowed('ENGINEER', permission)).toBe(
        !['workspace:manage', 'integrations:manage'].includes(permission),
      );
    }
  });
  it('records successful changes in tenant-scoped audit events', async () => {
    const result = await owner.agent
      .get('/api/workspaces/' + owner.workspaceId + '/audit-events')
      .expect(200);
    expect(
      result.body.some(
        (event: { action: string }) => event.action === 'repository.registered',
      ),
    ).toBe(true);
    expect(
      result.body.every(
        (event: { workspaceId: string }) =>
          event.workspaceId === owner.workspaceId,
      ),
    ).toBe(true);
    await viewer.agent
      .get('/api/workspaces/' + owner.workspaceId + '/audit-events')
      .expect(403);
  });
  it('rejects invalid commit identifiers, cross-tenant foreign keys, and immutable updates at the database', async () => {
    await expect(
      db.repositorySnapshot.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          commitSha: 'main',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.sourceFile.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          snapshotId: foreignSnapshotId,
          path: 'leak.ts',
          language: 'typescript',
          contentHash: '1'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.repositorySnapshot.update({
        where: { id: snapshotId },
        data: { commitSha: 'c'.repeat(40) },
      }),
    ).rejects.toThrow();
    await expect(
      db.evidence.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          snapshotId,
          commitSha: 'c'.repeat(40),
          kind: 'SOURCE',
          locator: 'src/app.ts:1',
          contentHash: '1'.repeat(64),
          details: {},
        },
      }),
    ).rejects.toThrow();
  });
  it('requires evidence for findings and recommendations unless explicitly suggestions', async () => {
    const analysis = await db.analysis.create({
      data: {
        workspaceId: owner.workspaceId,
        repositoryId,
        baseSnapshotId: snapshotId,
        headSnapshotId: snapshotId,
      },
    });
    const data = {
      workspaceId: owner.workspaceId,
      repositoryId,
      analysisId: analysis.id,
      summary: 'Potential impact',
    };
    await expect(
      db.finding.create({ data: { ...data, kind: 'POTENTIAL_IMPACT' } }),
    ).rejects.toThrow();
    await db.finding.create({ data: { ...data, kind: 'SUGGESTION' } });
    const evidence = await db.evidence.create({
      data: {
        workspaceId: owner.workspaceId,
        repositoryId,
        snapshotId,
        commitSha: 'a'.repeat(40),
        kind: 'SOURCE',
        locator: 'src/app.ts:1',
        contentHash: '1'.repeat(64),
        details: { line: 1 },
      },
    });
    await expect(
      db.evidence.update({
        where: { id: evidence.id },
        data: { locator: 'changed' },
      }),
    ).rejects.toThrow();
    const finding = await db.$transaction(async (tx) => {
      const result = await tx.finding.create({
        data: { ...data, kind: 'POTENTIAL_IMPACT' },
      });
      await tx.findingEvidence.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          findingId: result.id,
          evidenceId: evidence.id,
        },
      });
      return result;
    });
    await expect(
      db.findingEvidence.deleteMany({ where: { findingId: finding.id } }),
    ).rejects.toThrow();
    await expect(
      db.testRecommendation.create({
        data: {
          workspaceId: owner.workspaceId,
          repositoryId,
          analysisId: analysis.id,
          rationale: 'No evidence',
        },
      }),
    ).rejects.toThrow();
    await db.testRecommendation.create({
      data: {
        workspaceId: owner.workspaceId,
        repositoryId,
        analysisId: analysis.id,
        isSuggestion: true,
        rationale: 'Suggested additional scenario',
      },
    });
  });
  it('rotates session IDs at login, uses HttpOnly cookies, and invalidates logout immediately', async () => {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/api/auth/csrf').expect(200);
    const oldCookie = cookie(pre);
    const result = await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', pre.body.csrfToken)
      .send({ email: owner.email.toUpperCase(), password })
      .expect(200);
    const newCookie = cookie(result);
    expect(newCookie).not.toBe(oldCookie);
    expect(result.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(result.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);
    expect(result.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(401);
    await agent
      .post('/api/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', result.body.csrfToken)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', newCookie)
      .expect(401);
  });
  it('rejects expired sessions on the server even if the cookie is replayed', async () => {
    const tokenHash = createHash('sha256')
      .update(outsider.cookie.split('=')[1]!)
      .digest('hex');
    await db.session.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await outsider.agent.get('/api/auth/me').expect(401);
  });
  it('returns the same login error for unknown accounts and wrong passwords, then rate limits by account', async () => {
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/api/auth/csrf').expect(200);
    cookie(pre);
    const attempt = (email: string) =>
      agent
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', pre.body.csrfToken)
        .send({ email, password: 'incorrect password long' });
    const wrong = await attempt(owner.email).expect(401);
    const unknownEmail = prefix + '-missing@example.test';
    const unknown = await attempt(unknownEmail).expect(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    for (let i = 0; i < 9; i++) await attempt(unknownEmail).expect(401);
    const limited = await attempt(unknownEmail).expect(429);
    expect(limited.headers['retry-after']).toBe('600');
  });
  it('uses a host-only Secure cookie in production', async () => {
    const original = {
      NODE_ENV: process.env.NODE_ENV,
      WEB_ORIGIN: process.env.WEB_ORIGIN,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.WEB_ORIGIN = 'https://impactlens.example';
      const auth = new AuthService(db);
      const captured: { name?: string; options?: Record<string, unknown> } = {};
      await auth.csrf(undefined, {
        cookie: (
          name: string,
          token: string,
          options: Record<string, unknown>,
        ) => {
          captured.name = name;
          captured.options = options;
          sessionHashes.push(createHash('sha256').update(token).digest('hex'));
        },
      } as never);
      expect(captured.name).toBe('__Host-impactlens_session');
      expect(captured.options).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(captured.options?.domain).toBeUndefined();
    } finally {
      for (const key of ['NODE_ENV', 'WEB_ORIGIN'] as const) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });
  it('imports immutable test artifacts with scoped access, validation and explicit mappings', async () => {
    const evidenceOutsider = await register('evidence-outsider');
    const scope = { workspaceId: owner.workspaceId, repositoryId };
    const root = `/workspaces/${owner.workspaceId}/repositories/${repositoryId}/test-evidence`;
    const content = readFileSync(
      resolve(__dirname, '../../../fixtures/test-evidence/junit.xml'),
      'utf8',
    );
    const body = {
      format: 'JUNIT',
      commitSha: 'a'.repeat(40),
      runner: 'vitest',
      recordedAt: new Date().toISOString(),
      filename: 'junit.xml',
      source: 'CI fixture run',
      content,
    };
    await mutation(viewer, 'post', root + '/artifacts')
      .send(body)
      .expect(403);
    await owner.agent
      .post('/api' + root + '/artifacts')
      .send(body)
      .expect(403);
    await mutation(engineer, 'post', root + '/artifacts')
      .send({ ...body, content: '<!DOCTYPE testsuite><testsuite/>' })
      .expect(400);
    const imported = await mutation(engineer, 'post', root + '/artifacts')
      .send(body)
      .expect(201);
    const artifact = imported.body;
    expect(artifact.content).toBeUndefined();
    expect(artifact.contentHash).toBe(
      createHash('sha256').update(content).digest('hex'),
    );
    expect(artifact.parsed.tests).toHaveLength(3);
    expect(
      await db.testCase.count({
        where: { ...scope, testRun: { externalRunId: artifact.id } },
      }),
    ).toBe(3);
    const detail = await viewer.agent
      .get(
        '/api' +
          root +
          '/artifacts/' +
          artifact.id +
          '?commitSha=' +
          'b'.repeat(40),
      )
      .expect(200);
    expect(detail.body.commitMatch).toBe(false);
    await evidenceOutsider.agent
      .get('/api' + root + '/artifacts/' + artifact.id)
      .expect(404);
    await owner.agent
      .get(
        `/api/workspaces/${owner.workspaceId}/repositories/${foreignRepositoryId}/test-evidence/artifacts/${artifact.id}`,
      )
      .expect(404);
    await expect(
      db.testArtifact.update({
        where: { id: artifact.id },
        data: { source: 'changed' },
      }),
    ).rejects.toThrow();
    const feature = await db.businessFeature.create({
      data: {
        ...scope,
        key: 'artifact-checkout',
        name: 'Artifact checkout',
        criticality: 'HIGH',
      },
    });
    const mapping = {
      featureId: feature.id,
      artifactId: artifact.id,
      testIdentity: 'checkout-success',
      rationale: 'Checkout acceptance scenario',
    };
    await mutation(engineer, 'post', root + '/mappings')
      .send({ ...mapping, testIdentity: 'missing' })
      .expect(400);
    const mapped = await mutation(engineer, 'post', root + '/mappings')
      .send(mapping)
      .expect(201);
    await mutation(engineer, 'post', root + '/mappings')
      .send(mapping)
      .expect(409);
    await mutation(
      viewer,
      'delete',
      root + '/mappings/' + mapped.body.id,
    ).expect(403);
    await mutation(
      engineer,
      'delete',
      root + '/mappings/' + mapped.body.id,
    ).expect(200);
    expect(
      await db.auditEvent.count({
        where: {
          ...scope,
          targetId: artifact.id,
          action: 'test_artifact.imported',
        },
      }),
    ).toBe(1);
  });
  it('uses Redis-backed atomic limits without trusting X-Forwarded-For', async () => {
    const limiter = app.get(AuthRateLimit);
    await limiter.consume('probe', prefix, 1);
    await expect(limiter.consume('probe', prefix, 1)).rejects.toMatchObject({
      status: 429,
    });
    const adapter = app.getHttpAdapter().getInstance();
    expect(adapter.get('trust proxy')).toBe(false);
  });
});

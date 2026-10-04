import 'dotenv/config';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  fixture,
  fixtureArchive,
  processImport,
  enqueuePending,
  seal,
  ImportFailure,
  type GitHubClient,
  type ImportConfig,
} from '@impactlens/ingestion';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.module';
import { configureHttp } from '../src/http';
import { ExplorerService } from '../src/explorer/explorer.service';
import { ComparisonsService } from '../src/comparisons/comparisons.service';
import { runAnalysisWorker } from '../src/analysis-worker';
import type { ImpactInput, ImpactResult } from '@impactlens/shared';
describe('production hardening with isolated local data', () => {
  let app: INestApplication, db: DatabaseService, root: string;
  type Actor = {
    agent: ReturnType<typeof request.agent>;
    csrf: string;
    workspaceId: string;
    userId: string;
  };
  let owner: Actor,
    engineer: Actor,
    viewer: Actor,
    outsider: Actor,
    originalPrefix: string | undefined;
  const actors: Actor[] = [],
    prefix = randomUUID(),
    origin = 'http://localhost:5173';
  const config: ImportConfig = {
    GITHUB_ENABLED: 'true',
    GITHUB_APP_ID: 'fixture',
    GITHUB_PRIVATE_KEY_BASE64: '',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  async function register(label: string) {
    const agent = request.agent(app.getHttpServer()),
      pre = await agent.get('/api/auth/csrf').expect(200);
    const res = await agent
      .post('/api/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', pre.body.csrfToken)
      .send({
        name: label,
        email: `${prefix}-${label}@example.test`,
        password: 'Hardening passphrase 123!',
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
  function mutate(actor: Actor, method: 'post' | 'delete', path: string) {
    return actor.agent[method](path)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf);
  }
  beforeAll(async () => {
    originalPrefix = process.env.AUTH_RATE_LIMIT_PREFIX;
    process.env.AUTH_RATE_LIMIT_PREFIX = 'hardening:' + prefix;
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
    root = `/api/workspaces/${owner.workspaceId}`;
    await db.gitHubAuthorization.create({
      data: {
        userId: owner.userId,
        githubUserId: '1',
        login: 'fixture',
        encryptedToken: seal(
          'fake-fixture-credential',
          config.CREDENTIAL_ENCRYPTION_KEY,
        ),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  });
  afterAll(async () => {
    try {
      if (db && actors.length) {
        await db.workspace.deleteMany({
          where: { id: { in: actors.map((a) => a.workspaceId) } },
        });
        await db.user.deleteMany({
          where: { id: { in: actors.map((a) => a.userId) } },
        });
      }
    } finally {
      await app?.close();
      if (originalPrefix === undefined)
        delete process.env.AUTH_RATE_LIMIT_PREFIX;
      else process.env.AUTH_RATE_LIMIT_PREFIX = originalPrefix;
    }
  });
  async function job(name: string, github = false) {
    const installation = github
      ? await db.gitHubInstallation.create({
          data: {
            workspaceId: owner.workspaceId,
            githubInstallationId: randomUUID(),
            account: 'fixture',
          },
        })
      : null;
    const repo = await db.repository.create({
      data: {
        workspaceId: owner.workspaceId,
        owner: 'fixture',
        name,
        source: github ? 'GITHUB' : 'FIXTURE',
        ...(installation
          ? {
              installationId: installation.id,
              githubRepositoryId: randomUUID(),
            }
          : {}),
      },
    });
    const record = await db.importJob.create({
      data: {
        workspaceId: owner.workspaceId,
        repositoryId: repo.id,
        commitSha: fixture.commitSha,
        branch: 'main',
        requestedById: owner.userId,
      },
    });
    return {
      repo,
      record,
      scope: { workspaceId: owner.workspaceId, repositoryId: repo.id },
    };
  }
  it('recovers a lost Redis job from RUNNING database outbox state and publishes exactly once', async () => {
    const { record, scope } = await job('restart');
    await db.importJob.update({
      where: { id: record.id },
      data: { status: 'RUNNING', attempts: 1 },
    });
    const connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue('hardening-' + prefix, { connection });
    try {
      await enqueuePending(db, queue);
      const queued = await queue.getJob(`${record.id}-${record.generation}`);
      expect(queued?.data).toEqual({ id: record.id, generation: 1 });
      await processImport(db, record.id, 1, config, 1);
      await processImport(db, record.id, 1, config, 2);
      expect(await db.repositorySnapshot.count({ where: scope })).toBe(1);
      expect(await db.sourceFile.count({ where: scope })).toBeGreaterThan(0);
      expect(
        await db.importJob.findUniqueOrThrow({ where: { id: record.id } }),
      ).toMatchObject({ status: 'COMPLETED', attempts: 2 });
      expect(
        await db.auditEvent.count({
          where: { ...scope, action: 'repository.imported' },
        }),
      ).toBe(1);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  });
  it('keeps the three-attempt budget across queue loss and stops transient failures', async () => {
    const { record, scope } = await job('retry-budget', true);
    const provider = {
      repository: jest
        .fn()
        .mockRejectedValue(
          new ImportFailure(
            'GITHUB_UNAVAILABLE',
            'Safe transient failure',
            true,
          ),
        ),
    } as unknown as GitHubClient;
    for (let attempt = 1; attempt <= 3; attempt++)
      await expect(
        processImport(db, record.id, 1, config, 1, provider),
      ).rejects.toThrow('Safe transient failure');
    await processImport(db, record.id, 1, config, 1, provider);
    expect(provider.repository).toHaveBeenCalledTimes(3);
    expect(await db.repositorySnapshot.count({ where: scope })).toBe(0);
    expect(
      await db.importJob.findUniqueOrThrow({ where: { id: record.id } }),
    ).toMatchObject({ status: 'FAILED', attempts: 3 });
  });
  it('aborts timed-out downloads and releases their buffers without committing a snapshot', async () => {
    const { record, scope } = await job('timeout', true);
    let observed: AbortSignal | undefined;
    const provider = {
      repository: async () => ({}),
      download: async (
        _a: unknown,
        _b: unknown,
        _c: unknown,
        signal: AbortSignal,
      ) => {
        observed = signal;
        signal.throwIfAborted();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        );
      },
    } as unknown as GitHubClient;
    await expect(
      processImport(db, record.id, 1, config, 1, provider, { timeoutMs: 80 }),
    ).rejects.toThrow('time limit');
    expect(observed?.aborted).toBe(true);
    expect(await db.repositorySnapshot.count({ where: scope })).toBe(0);
    expect(
      await db.importJob.findUniqueOrThrow({ where: { id: record.id } }),
    ).toMatchObject({ status: 'QUEUED', errorCode: 'IMPORT_TIMEOUT' });
  });
  it('honors cancellation and generation fences even if a stale downloader returns late', async () => {
    const { record, scope } = await job('cancel', true);
    const buffer = await fixtureArchive();
    const provider = {
      repository: async () => ({}),
      download: async () => {
        await db.importJob.update({
          where: { id: record.id },
          data: { status: 'CANCELED', generation: 2 },
        });
        return buffer;
      },
    } as unknown as GitHubClient;
    await expect(
      processImport(db, record.id, 1, config, 1, provider),
    ).rejects.toThrow();
    expect(await db.repositorySnapshot.count({ where: scope })).toBe(0);
    expect(buffer.every((v) => v === 0)).toBe(true);
    expect(
      await db.importJob.findUniqueOrThrow({ where: { id: record.id } }),
    ).toMatchObject({ status: 'CANCELED', generation: 2 });
  });
  it('does not publish a crashed or canceled analysis, and a replacement computes an immutable result', async () => {
    const { record, scope } = await job('analysis-restart');
    await processImport(db, record.id, 1, config, 1);
    const snapshot = await db.repositorySnapshot.findFirstOrThrow({
        where: scope,
      }),
      explorer = app.get(ExplorerService),
      comparisons = app.get(ComparisonsService);
    const controller = new AbortController();
    controller.abort();
    await expect(
      explorer.analyze(
        scope.workspaceId,
        scope.repositoryId,
        snapshot.id,
        owner.userId,
        controller.signal,
      ),
    ).rejects.toThrow('canceled');
    expect(await db.staticGraph.count({ where: scope })).toBe(0);
    await explorer.analyze(
      scope.workspaceId,
      scope.repositoryId,
      snapshot.id,
      owner.userId,
    );
    const binding = {
      baseSnapshotId: snapshot.id,
      headSnapshotId: snapshot.id,
    };
    const methods = comparisons as unknown as {
      compute: (
        input: ImpactInput,
        signal?: AbortSignal,
      ) => Promise<ImpactResult>;
    };
    const compute = methods.compute;
    methods.compute = () =>
      runAnalysisWorker(
        require.resolve('./fixtures/analysis-worker.cjs'),
        { mode: 'crash' },
        'result',
      );
    try {
      await expect(
        comparisons.create(scope, binding, owner.userId),
      ).rejects.toThrow('stopped');
      expect(await db.analysis.count({ where: scope })).toBe(0);
    } finally {
      methods.compute = compute;
    }
    const saved = await comparisons.create(scope, binding, owner.userId),
      before = await db.analysis.findUniqueOrThrow({ where: { id: saved.id } });
    await comparisons.create(scope, binding, owner.userId);
    expect(
      await db.analysis.findUniqueOrThrow({ where: { id: saved.id } }),
    ).toEqual(before);
    await expect(
      db.analysis.update({
        where: { id: saved.id },
        data: { resultHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow();
  });
  it('validates artifact payloads and deletes live evidence without changing saved comparison copies', async () => {
    const { record, scope } = await job('artifact-deletion');
    await processImport(db, record.id, 1, config, 1);
    const snapshot = await db.repositorySnapshot.findFirstOrThrow({
      where: scope,
    });
    const url = `${root}/repositories/${scope.repositoryId}/test-evidence/artifacts`;
    const body = {
      format: 'JUNIT',
      runner: 'fixture-tests',
      commitSha: fixture.commitSha,
      recordedAt: new Date().toISOString(),
      filename: 'results.xml',
      source: 'local-owned-fixture',
      content:
        '<testsuite><testcase name="checkout" file="src/checkout.ts"/></testsuite>',
    };
    await mutate(viewer, 'post', url).send(body).expect(403);
    for (const invalid of [
      {
        ...body,
        content: '<!DOCTYPE testsuite SYSTEM "file:///etc/passwd"><testsuite/>',
      },
      { ...body, filename: '../secret.xml' },
      { ...body, recordedAt: new Date(Date.now() + 3600000).toISOString() },
      {
        ...body,
        format: 'PER_TEST',
        content:
          '{"version":1,"tests":[{"identity":"a","name":"a","covers":[{"path":"../secret"}]}]}',
      },
    ])
      await mutate(engineer, 'post', url).send(invalid).expect(400);
    const artifact = (
      await mutate(engineer, 'post', url).send(body).expect(201)
    ).body;
    const feature = await db.businessFeature.create({
      data: {
        ...scope,
        key: 'checkout-delete',
        name: 'Checkout',
        criticality: 'HIGH',
      },
    });
    const identity = artifact.parsed.tests[0].identity;
    await mutate(
      engineer,
      'post',
      `${root}/repositories/${scope.repositoryId}/test-evidence/mappings`,
    )
      .send({
        featureId: feature.id,
        artifactId: artifact.id,
        testIdentity: identity,
        rationale: 'Known fixture test',
      })
      .expect(201);
    await app
      .get(ExplorerService)
      .analyze(
        scope.workspaceId,
        scope.repositoryId,
        snapshot.id,
        owner.userId,
      );
    const saved = await app
        .get(ComparisonsService)
        .create(
          scope,
          { baseSnapshotId: snapshot.id, headSnapshotId: snapshot.id },
          owner.userId,
        ),
      before = await db.analysis.findUniqueOrThrow({ where: { id: saved.id } });
    await mutate(viewer, 'delete', url + '/' + artifact.id).expect(403);
    await outsider.agent.get(url + '/' + artifact.id).expect(404);
    await mutate(owner, 'delete', url + '/' + artifact.id)
      .set('X-CSRF-Token', 'wrong')
      .expect(403);
    const foreign = await db.repository.create({
      data: {
        workspaceId: owner.workspaceId,
        owner: 'fixture',
        name: 'foreign-ids',
      },
    });
    await mutate(
      owner,
      'delete',
      `${root}/repositories/${foreign.id}/test-evidence/artifacts/${artifact.id}`,
    ).expect(404);
    await mutate(engineer, 'delete', url + '/' + artifact.id).expect(204);
    expect(await db.testArtifact.count({ where: { id: artifact.id } })).toBe(0);
    expect(
      await db.featureTestMapping.count({
        where: { ...scope, artifactId: artifact.id },
      }),
    ).toBe(0);
    expect(
      await db.testRun.count({
        where: { ...scope, externalRunId: artifact.id },
      }),
    ).toBe(0);
    expect(await db.testCase.count({ where: scope })).toBe(0);
    expect(
      await db.analysis.findUniqueOrThrow({ where: { id: saved.id } }),
    ).toEqual(before);
    expect(JSON.stringify(before.input)).toContain(artifact.id);
  });
  it('permits Owner repository removal only and prevents late worker resurrection', async () => {
    const { record, scope } = await job('repository-deletion');
    await processImport(db, record.id, 1, config, 1);
    const snapshot = await db.repositorySnapshot.findFirstOrThrow({
      where: scope,
    });
    await app
      .get(ExplorerService)
      .analyze(
        scope.workspaceId,
        scope.repositoryId,
        snapshot.id,
        owner.userId,
      );
    const saved = await app
      .get(ComparisonsService)
      .create(
        scope,
        { baseSnapshotId: snapshot.id, headSnapshotId: snapshot.id },
        owner.userId,
      );
    await mutate(
      owner,
      'post',
      `${root}/repositories/${scope.repositoryId}/comparisons/${saved.id}/reviews`,
    )
      .send({
        outcome: 'NEEDS_MORE_EVIDENCE',
        comment: 'Fixture decision',
        expectedRevision: 0,
        baseSha: fixture.commitSha,
        headSha: fixture.commitSha,
        resultHash: saved.resultHash,
      })
      .expect(201);
    const url = `${root}/repositories/${scope.repositoryId}`;
    await mutate(viewer, 'delete', url).expect(403);
    await mutate(engineer, 'delete', url).expect(403);
    await mutate(outsider, 'delete', url).expect(404);
    await owner.agent.delete(url).expect(403);
    const audit = await db.auditEvent.findFirstOrThrow({ where: scope });
    await expect(
      db.auditEvent.update({
        where: { id: audit.id },
        data: { repositoryId: null },
      }),
    ).rejects.toThrow();
    await mutate(owner, 'delete', url).expect(204);
    await owner.agent.get(url).expect(404);
    await processImport(db, record.id, 1, config, 1);
    expect(
      await db.auditEvent.findUniqueOrThrow({ where: { id: audit.id } }),
    ).toMatchObject({
      repositoryId: null,
      repositoryRef: scope.repositoryId,
      action: audit.action,
    });
    await expect(
      db.auditEvent.update({
        where: { id: audit.id },
        data: { action: 'rewrite' },
      }),
    ).rejects.toThrow();
    for (const count of [
      db.repositorySnapshot.count({ where: scope }),
      db.sourceFile.count({ where: scope }),
      db.analysis.count({ where: scope }),
      db.reviewDecision.count({ where: scope }),
      db.importJob.count({ where: scope }),
    ])
      expect(await count).toBe(0);
    expect(
      await db.auditEvent.count({
        where: {
          workspaceId: owner.workspaceId,
          action: 'repository.deleted',
          targetId: scope.repositoryId,
          repositoryId: null,
        },
      }),
    ).toBe(1);
  });
});

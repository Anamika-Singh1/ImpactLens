import 'dotenv/config';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database.module';
import { ImportsService } from '../src/imports/imports.service';
import { configureHttp } from '../src/http';
import {
  fixture,
  fixtureArchive,
  processImport,
  ImportFailure,
} from '@impactlens/ingestion';

describe('repository URL to indexed overview with isolated owned source', () => {
  let app: INestApplication, db: DatabaseService, imports: ImportsService;
  const users: { id: string; workspaceId: string }[] = [];
  const prefix = randomUUID();
  const origin = 'http://localhost:5173';
  const metadata = {
    id: 987654,
    name: 'shop',
    owner: { login: 'fixture-team' },
    description: 'Owned synthetic import fixture',
    private: false,
    disabled: false,
    archived: false,
    default_branch: 'main',
    size: 2,
  };
  type Actor = {
    agent: ReturnType<typeof request.agent>;
    csrf: string;
    userId: string;
    workspaceId: string;
  };
  let owner: Actor, viewer: Actor, outsider: Actor;
  let originalPrefix: string | undefined;
  async function actor(role: 'OWNER' | 'VIEWER') {
    const user = await db.user.create({
      data: {
        email: `${prefix.slice(0, 16)}-${randomUUID().slice(0, 16)}@example.test`,
        name: 'Overview tester',
        passwordHash: await hash('Overview passphrase 123!'),
        memberships: {
          create: {
            role,
            workspace: { create: { name: 'Isolated overview test' } },
          },
        },
      },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]!.workspaceId;
    users.push({ id: user.id, workspaceId });
    const agent = request.agent(app.getHttpServer());
    const pre = await agent.get('/api/auth/csrf').expect(200);
    const login = await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', pre.body.csrfToken)
      .send({ email: user.email, password: 'Overview passphrase 123!' })
      .expect(200);
    return { agent, csrf: login.body.csrfToken, userId: user.id, workspaceId };
  }
  function post(actor: Actor, path: string, body: object) {
    return actor.agent
      .post(path)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .send(body);
  }
  beforeAll(async () => {
    originalPrefix = process.env.AUTH_RATE_LIMIT_PREFIX;
    process.env.AUTH_RATE_LIMIT_PREFIX = `overview-test:${prefix}`;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, pino({ level: 'silent' }), origin);
    await app.init();
    db = app.get(DatabaseService);
    imports = app.get(ImportsService);
    const addUrl = imports.addUrl.bind(imports);
    jest.spyOn(imports, 'addUrl').mockImplementation(async (...args) => {
      try {
        return await addUrl(...args);
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
    jest
      .spyOn(
        imports as unknown as {
          enqueue: (id: string, generation: number) => Promise<void>;
        },
        'enqueue',
      )
      .mockResolvedValue();
    owner = await actor('OWNER');
    viewer = await actor('VIEWER');
    outsider = await actor('OWNER');
    await db.membership.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: viewer.userId,
        role: 'VIEWER',
      },
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    for (const user of users)
      await db.workspace.deleteMany({ where: { id: user.workspaceId } });
    await db.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
    await app.close();
    if (originalPrefix === undefined) delete process.env.AUTH_RATE_LIMIT_PREFIX;
    else process.env.AUTH_RATE_LIMIT_PREFIX = originalPrefix;
  });
  it('queues one exact commit without OAuth, atomically indexes it, exposes evidence and reuses human mapping review', async () => {
    jest.spyOn(imports.github, 'publicRepository').mockResolvedValue(metadata);
    const resolve = jest
      .spyOn(imports.github, 'resolve')
      .mockResolvedValue(fixture.commitSha);
    const path = `/api/workspaces/${owner.workspaceId}/repositories/import`;
    const responses = await Promise.all([
      post(owner, path, { url: 'https://github.com/fixture-team/shop' }).expect(
        201,
      ),
      post(owner, path, { url: 'https://github.com/fixture-team/shop' }).expect(
        201,
      ),
    ]);
    const job = responses[0]!.body;
    expect(responses[1]!.body.id).toBe(job.id);
    expect(resolve).toHaveBeenCalledWith('', metadata, 'main');
    expect(
      await db.importJob.count({ where: { workspaceId: owner.workspaceId } }),
    ).toBe(1);
    const root = `/api/workspaces/${owner.workspaceId}/repositories/${job.repositoryId}`;
    const pending = await owner.agent
      .get(root + '/details?jobId=' + job.id)
      .expect(200);
    expect(pending.body.overview).toBeNull();
    const progress = jest.spyOn(db.importJob, 'updateMany');
    const github = imports.github;
    jest
      .spyOn(github, 'downloadPublic')
      .mockResolvedValue(await fixtureArchive());
    await processImport(
      db,
      job.id,
      job.generation,
      {
        GITHUB_ENABLED: 'false',
        GITHUB_APP_ID: '',
        GITHUB_PRIVATE_KEY_BASE64: '',
        CREDENTIAL_ENCRYPTION_KEY: '',
      },
      1,
      github,
    );
    const stages = progress.mock.calls
      .map((args) => args[0]?.data?.stage)
      .filter(Boolean);
    expect(stages).toEqual(
      expect.arrayContaining([
        'Fetching repository',
        'Scanning files',
        'Analyzing code',
        'Preparing overview',
      ]),
    );
    const details = await owner.agent
      .get(root + '/details?jobId=' + job.id)
      .expect(200);
    expect(details.body.job).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
    });
    expect(details.body.repository).toMatchObject({
      isPrivate: false,
      description: metadata.description,
      githubUrl: 'https://github.com/fixture-team/shop',
    });
    expect(details.body.snapshot.commitSha).toBe(fixture.commitSha);
    expect(details.body.overview.sourceFileCount).toBeGreaterThan(0);
    expect(
      details.body.overview.routes.some(
        (route: { path: string }) => route.path === '/total',
      ),
    ).toBe(true);
    expect(details.body.overview.purpose).toContain(
      'cannot be confidently determined',
    );
    await owner.agent.get(root + '/dependencies').expect(200);
    await owner.agent.get(root + '/routes').expect(200);
    const features = await owner.agent.get(root + '/features').expect(200);
    const feature = features.body.find(
      (item: { key: string }) => item.key === 'overview-checkout',
    );
    expect(feature.mappingCounts.confirmed).toBe(0);
    expect(feature.mappingCounts.suggested).toBeGreaterThan(0);
    const mapping = feature.mappings[0];
    await post(
      owner,
      `${root}/features/${feature.id}/mappings/${mapping.id}/review`,
      {
        expectedVersion: mapping.version,
        action: 'CONFIRM',
        snapshotId: details.body.snapshot.id,
      },
    ).expect(201);
    const search = await owner.agent
      .get(root + '/implementation-search')
      .query({
        q: 'Which files handle checkout?',
        snapshotId: details.body.snapshot.id,
      })
      .expect(200);
    expect(
      search.body.matches.some(
        (item: { status: string }) => item.status === 'CONFIRMED_MAPPING',
      ),
    ).toBe(true);
    expect(search.body.matches[0].excerpt.length).toBeGreaterThan(0);
    const absent = await owner.agent
      .get(root + '/implementation-search')
      .query({ q: 'astrophysics', snapshotId: details.body.snapshot.id })
      .expect(200);
    expect(absent.body.matches).toEqual([]);
    await viewer.agent.get(root + '/details').expect(200);
    await post(viewer, path, {
      url: 'https://github.com/fixture-team/shop',
    }).expect(403);
    await outsider.agent.get(root + '/details').expect(404);
    await outsider.agent
      .get(root + '/implementation-search')
      .query({ q: 'checkout' })
      .expect(404);
    const wrongSnapshot = await db.repositorySnapshot.create({
      data: {
        workspaceId: outsider.workspaceId,
        repositoryId: (
          await db.repository.create({
            data: {
              workspaceId: outsider.workspaceId,
              owner: 'other',
              name: 'repo',
            },
          })
        ).id,
        commitSha: 'b'.repeat(40),
      },
    });
    await owner.agent
      .get(root + '/details')
      .query({ snapshotId: wrongSnapshot.id })
      .expect(404);
    const repeated = await post(owner, path, {
      url: 'https://github.com/fixture-team/shop',
    }).expect(201);
    expect(repeated.body.id).toBe(job.id);
    expect(repeated.body.status).toBe('COMPLETED');
  }, 60000);
  it('rejects credential-bearing URLs, unavailable/private repositories and empty metadata without creating jobs', async () => {
    const path = `/api/workspaces/${owner.workspaceId}/repositories/import`;
    const count = await db.importJob.count({
      where: { workspaceId: owner.workspaceId },
    });
    await post(owner, path, {
      url: 'https://user:secret@github.com/team/repo',
    }).expect(424);
    jest
      .spyOn(imports.github, 'publicRepository')
      .mockRejectedValue(
        new ImportFailure('ACCESS_UNAVAILABLE', 'Not available'),
      );
    const unavailable = await post(owner, path, {
      url: 'https://github.com/team/private',
    }).expect(424);
    expect(unavailable.body.error.message).toMatch(
      /GitHub connection|Connect your GitHub account|GitHub access/i,
    );
    jest
      .spyOn(imports.github, 'publicRepository')
      .mockRejectedValue(
        new ImportFailure('EMPTY_REPOSITORY', 'This repository is empty.'),
      );
    const empty = await post(owner, path, {
      url: 'https://github.com/team/empty',
    }).expect(424);
    expect(empty.body.error.code).toBe('EMPTY_REPOSITORY');
    expect(
      await db.importJob.count({ where: { workspaceId: owner.workspaceId } }),
    ).toBe(count);
  });
});

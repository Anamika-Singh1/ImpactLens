import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Post, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import request from 'supertest';
import pino from 'pino';
import { configureHttp } from '../src/http';
import { runAnalysisWorker, requestCancellation } from '../src/analysis-worker';
import { ImportsService } from '../src/imports/imports.service';
import { DatabaseService } from '../src/database.module';
const secret = 'must-never-log-secret';
@Controller('redaction/:name')
class Probe {
  @Post() fail(@Req() req: Request) {
    throw new Error(
      `${secret} ${req.headers.authorization} ${JSON.stringify(req.body)}`,
    );
  }
}
describe('log data minimization', () => {
  let app: INestApplication;
  const logs: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [Probe],
    }).compile();
    app = module.createNestApplication();
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    configureHttp(
      app,
      pino({ level: 'info' }, stream),
      'http://localhost:5173',
    );
    await app.init();
  });
  afterAll(() => app.close());
  it('does not log bodies, headers, OAuth query values, path parameters or raw errors', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/redaction/${secret}?code=${secret}`)
      .set('Authorization', `Bearer ${secret}`)
      .set('Cookie', `session=${secret}`)
      .send({ password: secret, token: secret, source: secret })
      .expect(500);
    await request(app.getHttpServer())
      .get(`/api/unknown/${secret}?token=${secret}`)
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(logs.join('')).not.toContain(secret);
    expect(
      logs
        .map((l) => JSON.parse(l))
        .some((l) => l.route === '/api/redaction/:name'),
    ).toBe(true);
    expect(
      logs.map((l) => JSON.parse(l)).some((l) => l.route === '[unmatched]'),
    ).toBe(true);
  });
});
describe('bounded analysis lifecycle', () => {
  const fixture = require.resolve('./fixtures/analysis-worker.cjs');
  it('terminates on deadline and abort without leaking worker capacity', async () => {
    await expect(
      runAnalysisWorker(fixture, { mode: 'hang' }, 'result', undefined, 40),
    ).rejects.toThrow('time limit');
    const controller = new AbortController();
    const task = runAnalysisWorker(
      fixture,
      { mode: 'hang' },
      'result',
      controller.signal,
    );
    controller.abort();
    await expect(task).rejects.toThrow('canceled');
    await expect(
      runAnalysisWorker(fixture, { mode: 'ok' }, 'result'),
    ).resolves.toEqual({ recorded: true });
  });
  it('rejects crash output and permits a clean replacement worker', async () => {
    await expect(
      runAnalysisWorker(fixture, { mode: 'crash' }, 'result'),
    ).rejects.toThrow('stopped');
    await expect(
      runAnalysisWorker(fixture, { mode: 'ok' }, 'result'),
    ).resolves.toEqual({ recorded: true });
  });
  it('binds cancellation to premature response close and removes listeners', () => {
    const req = new EventEmitter() as Request,
      res = new EventEmitter() as Response;
    const pending = requestCancellation(req, res);
    res.emit('close');
    expect(pending.signal.aborted).toBe(true);
    pending.dispose();
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    Object.assign(res, { writableEnded: true });
    const completed = requestCancellation(req, res);
    res.emit('close');
    expect(completed.signal.aborted).toBe(false);
    completed.dispose();
  });
});
describe('shutdown with unavailable dependencies', () => {
  it('settles Redis initialization before removing queue error listeners', async () => {
    const original = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      const service = new ImportsService({} as DatabaseService);
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = original;
    }
  });
});

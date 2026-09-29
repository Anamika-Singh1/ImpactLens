import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import pino from 'pino';
import { HealthController } from '../src/health.controller';
import { DependenciesService } from '../src/dependencies.service';
import { configureHttp } from '../src/http';
class ValidationDto {
  @IsString() name!: string;
}
@Controller('validation-probe')
class ValidationProbe {
  @Post() create(@Body() body: ValidationDto) {
    return body;
  }
}
describe('HTTP foundation', () => {
  let app: INestApplication;
  const check = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ValidationProbe, HealthController],
      providers: [DependenciesService],
    })
      .overrideProvider(DependenciesService)
      .useValue({ check })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, pino({ level: 'silent' }), 'http://localhost:5173');
    await app.init();
  });
  afterAll(() => app.close());
  it('liveness is independent of dependency availability', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/health/live')
      .set('x-request-id', 'test-request')
      .expect(200);
    expect(result.body.status).toBe('ok');
    expect(result.headers['x-request-id']).toBe('test-request');
    expect(check).not.toHaveBeenCalled();
  });
  it('readiness requires both dependencies', async () => {
    check.mockResolvedValue({ postgres: 'up', redis: 'up' });
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    check.mockResolvedValue({ postgres: 'down', redis: 'up' });
    const result = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(result.body.dependencies.postgres).toBe('down');
    check.mockResolvedValue({ postgres: 'up', redis: 'down' });
    await request(app.getHttpServer()).get('/api/health/ready').expect(503);
  });
  it('returns consistent errors and replaces unsafe request IDs', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/missing')
      .set('x-request-id', 'not a safe id')
      .expect(404);
    expect(result.body.error.code).toBe('HTTP_404');
    expect(result.body.error.requestId).toBe(result.headers['x-request-id']);
    expect(result.body.error.requestId).not.toBe('not a safe id');
  });
  it('rejects invalid fields and unknown properties', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/validation-probe')
      .send({ name: 4, unexpected: true })
      .expect(400);
    expect(result.body.error.message).toEqual(
      expect.arrayContaining([
        'property unexpected should not exist',
        'name must be a string',
      ]),
    );
  });
});

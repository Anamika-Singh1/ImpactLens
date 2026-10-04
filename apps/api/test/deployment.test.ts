import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get, Req } from '@nestjs/common';
import type { Request, Response } from 'express';
import request from 'supertest';
import pino from 'pino';
import { configureHttp } from '../src/http';
import { AuthService } from '../src/auth/auth.service';
import type { DatabaseService } from '../src/database.module';

@Controller('proxy-probe')
class ProxyProbe {
  @Get() probe(@Req() req: Request) {
    return { ip: req.ip, secure: req.secure };
  }
}
describe('deployment security', () => {
  it('ignores spoofed forwarding headers unless the direct peer is explicitly trusted', async () => {
    for (const trusted of ['', '127.0.0.1,127.0.0.0/8']) {
      const module = await Test.createTestingModule({
        controllers: [ProxyProbe],
      }).compile();
      const app = module.createNestApplication();
      configureHttp(
        app,
        pino({ level: 'silent' }),
        'https://example.test',
        trusted,
      );
      await app.init();
      try {
        const response = await request(app.getHttpServer())
          .get('/api/proxy-probe')
          .set('X-Forwarded-For', '203.0.113.7')
          .set('X-Forwarded-Proto', 'https')
          .expect(200);
        expect(response.body.secure).toBe(Boolean(trusted));
        expect(response.body.ip === '203.0.113.7').toBe(Boolean(trusted));
      } finally {
        await app.close();
      }
    }
  });
  it('sets host-only Secure HttpOnly SameSite cookies in production', async () => {
    const before = {
      NODE_ENV: process.env.NODE_ENV,
      WEB_ORIGIN: process.env.WEB_ORIGIN,
    };
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = 'https://example.test';
    const cookie = jest.fn();
    try {
      const auth = new AuthService({
        session: { deleteMany: async () => ({}), create: async () => ({}) },
      } as unknown as DatabaseService);
      await auth.csrf(undefined, { cookie } as unknown as Response);
      expect(cookie.mock.calls[0][0]).toBe('__Host-impactlens_session');
      expect(cookie.mock.calls[0][2]).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(cookie.mock.calls[0][2]).not.toHaveProperty('domain');
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

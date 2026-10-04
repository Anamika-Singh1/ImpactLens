import { describe, expect, it } from 'vitest';
import { apiEnvSchema, workerEnvSchema, parseEnv } from './env';
describe('environment validation', () => {
  it('rejects blanket or malformed proxy trust and accepts explicit private subnets', () => {
    const values = {
      DATABASE_URL: 'postgresql://localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'https://example.test',
      NODE_ENV: 'production',
    };
    for (const TRUSTED_PROXIES of [
      'true',
      '1',
      '0.0.0.0/0',
      '999.1.1.1',
      '10.0.0.1/33',
    ])
      expect(() =>
        parseEnv(apiEnvSchema, { ...values, TRUSTED_PROXIES }),
      ).toThrow('TRUSTED_PROXIES');
    expect(
      parseEnv(apiEnvSchema, {
        ...values,
        HOST: '0.0.0.0',
        TRUSTED_PROXIES: '172.20.0.0/24,127.0.0.1',
      }).TRUSTED_PROXIES,
    ).toBe('172.20.0.0/24,127.0.0.1');
  });
  it('requires an HTTPS origin in production and bounds session lifetime', () => {
    const values = {
      DATABASE_URL: 'postgresql://localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      NODE_ENV: 'production',
    };
    expect(() =>
      parseEnv(apiEnvSchema, { ...values, WEB_ORIGIN: 'http://example.com' }),
    ).toThrow('must use HTTPS');
    expect(() =>
      parseEnv(apiEnvSchema, {
        ...values,
        WEB_ORIGIN: 'https://example.com/path',
      }),
    ).toThrow('must be an origin');
    expect(() =>
      parseEnv(apiEnvSchema, {
        ...values,
        WEB_ORIGIN: 'https://example.com',
        SESSION_TTL_HOURS: 169,
      }),
    ).toThrow('SESSION_TTL_HOURS');
    expect(
      parseEnv(apiEnvSchema, { ...values, WEB_ORIGIN: 'https://example.com' })
        .SESSION_TTL_HOURS,
    ).toBe(24);
  });
  it('names missing variables without exposing supplied values', () => {
    expect(() => parseEnv(apiEnvSchema, {})).toThrow('DATABASE_URL');
    expect(() => parseEnv(workerEnvSchema, {})).toThrow('REDIS_URL');
  });
  it('rejects invalid ports and protocols', () => {
    expect(() =>
      parseEnv(apiEnvSchema, {
        DATABASE_URL: 'https://example.com',
        REDIS_URL: 'https://example.com',
        PORT: 0,
        WEB_ORIGIN: 'file:///tmp',
      }),
    ).toThrow('Invalid environment');
  });
  it('accepts local dependency configuration', () => {
    expect(
      parseEnv(apiEnvSchema, {
        DATABASE_URL: 'postgresql://localhost/db',
        REDIS_URL: 'redis://localhost:6379',
        WEB_ORIGIN: 'http://localhost:5173',
      }).PORT,
    ).toBe(3000);
  });
});

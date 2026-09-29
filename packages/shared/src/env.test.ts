import { describe, expect, it } from 'vitest';
import { apiEnvSchema, workerEnvSchema, parseEnv } from './env';
describe('environment validation', () => {
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

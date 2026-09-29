import { afterEach, expect, it, vi } from 'vitest';
import { fetchHealth } from './api';
afterEach(() => vi.unstubAllGlobals());
it('accepts a real dependency-unavailable response', async () => {
  const health = {
    status: 'unavailable',
    service: 'impactlens-api',
    timestamp: new Date().toISOString(),
    dependencies: { postgres: 'down', redis: 'up' },
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, json: async () => health }),
  );
  expect(await fetchHealth()).toEqual(health);
});
it('rejects unexpected responses instead of showing healthy', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
  await expect(fetchHealth()).rejects.toThrow('unexpected health response');
});

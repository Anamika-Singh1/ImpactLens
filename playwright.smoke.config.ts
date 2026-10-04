import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/smoke',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.SMOKE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
});

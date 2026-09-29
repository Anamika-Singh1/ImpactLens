import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npm run start -w @impactlens/api',
      env: { AUTH_RATE_LIMIT_PREFIX: 'impactlens:e2e:' + Date.now() },
      url: 'http://127.0.0.1:3000/api/health/live',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -w @impactlens/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});

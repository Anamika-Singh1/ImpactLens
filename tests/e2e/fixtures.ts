import { test as base, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
config({ path: 'apps/api/.env' });
export const test = base.extend<{
  account: { email: string; password: string; workspaceId: string };
}>({
  account: [
    async ({ page }, use) => {
      const email = 'e2e-' + randomUUID() + '@example.test';
      const password = 'Browser test passphrase 123!';
      const pre = await page.request.get('/api/auth/csrf');
      expect(pre.status()).toBe(200);
      const result = await page.request.post('/api/auth/register', {
        headers: {
          Origin: 'http://localhost:5173',
          'X-CSRF-Token': (await pre.json()).csrfToken,
        },
        data: { email, password, name: 'Browser tester' },
      });
      expect(result.status()).toBe(201);
      const body = await result.json();
      try {
        await use({ email, password, workspaceId: body.workspaces[0].id });
      } finally {
        const db = new PrismaClient();
        try {
          await db.workspace.delete({ where: { id: body.workspaces[0].id } });
          await db.user.delete({ where: { id: body.user.id } });
        } finally {
          await db.$disconnect();
        }
      }
    },
    { auto: true },
  ],
});
export { expect };

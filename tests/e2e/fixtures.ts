import { test as base, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { hash, argon2id } from 'argon2';
config({ path: 'apps/api/.env' });
export const test = base.extend<{
  account: { email: string; password: string; workspaceId: string };
}>({
  account: [
    async ({ page }, use) => {
      const email = 'e2e-' + randomUUID() + '@example.test';
      const password = 'Browser test passphrase 123!';
      const db = new PrismaClient();
      let userId: string | undefined, workspaceId: string | undefined;
      try {
        // Seed isolated fixtures; registration itself has its own browser test.
        // Do not exhaust or weaken the production registration rate limit as the suite grows.
        const user = await db.user.create({
          data: {
            email,
            name: 'Browser tester',
            passwordHash: await hash(password, {
              type: argon2id,
              memoryCost: 19456,
              timeCost: 2,
              parallelism: 1,
            }),
            memberships: {
              create: {
                role: 'OWNER',
                workspace: { create: { name: "Browser tester's workspace" } },
              },
            },
          },
          include: { memberships: true },
        });
        userId = user.id;
        workspaceId = user.memberships[0]!.workspaceId;
        const pre = await page.request.get('/api/auth/csrf');
        expect(pre.status()).toBe(200);
        const result = await page.request.post('/api/auth/login', {
          headers: {
            Origin: 'http://localhost:5173',
            'X-CSRF-Token': (await pre.json()).csrfToken,
          },
          data: { email, password },
        });
        expect(result.status()).toBe(200);
        await use({ email, password, workspaceId });
      } finally {
        try {
          if (workspaceId)
            await db.workspace.delete({ where: { id: workspaceId } });
          if (userId) await db.user.delete({ where: { id: userId } });
        } finally {
          await db.$disconnect();
        }
      }
    },
    { auto: true },
  ],
});
export { expect };

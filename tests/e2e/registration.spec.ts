import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
config({ path: 'apps/api/.env' });
test('a new user can register through the browser and receives an Owner workspace', async ({
  page,
}) => {
  const email = 'e2e-registration-' + randomUUID() + '@example.test';
  const db = new PrismaClient();
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Create an account', exact: true })
      .click();
    await page.getByLabel('Your name').fill('Release reviewer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('Browser registration passphrase!');
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const response = await page.request.get('/api/auth/me');
    expect(response.status()).toBe(200);
    const current = await response.json();
    expect(current.user.email).toBe(email);
    expect(current.workspaces).toHaveLength(1);
    expect(current.workspaces[0].role).toBe('OWNER');
    await page.screenshot({
      path: 'test-results/authenticated-overview.png',
      fullPage: true,
    });
  } finally {
    const user = await db.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    if (user) {
      await db.workspace.deleteMany({
        where: { id: { in: user.memberships.map((m) => m.workspaceId) } },
      });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.$disconnect();
  }
});

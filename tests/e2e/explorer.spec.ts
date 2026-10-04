import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
test('explorer analyzes snapshots, displays evidence, filters nodes and preserves deleted source', async ({
  page,
  account,
}) => {
  test.setTimeout(90000);
  const db = new PrismaClient();
  let repoId: string;
  try {
    const repo = await db.repository.create({
      data: {
        workspaceId: account.workspaceId,
        owner: 'fixture',
        name: 'static-analysis',
      },
    });
    repoId = repo.id;
    for (const [name, commitSha] of [
      ['base', 'a'.repeat(40)],
      ['head', 'b'.repeat(40)],
    ] as const) {
      const snapshot = await db.repositorySnapshot.create({
        data: {
          workspaceId: account.workspaceId,
          repositoryId: repo.id,
          commitSha,
          isDemo: true,
        },
      });
      const files: Record<string, string> = JSON.parse(
        readFileSync(`fixtures/static-analysis/${name}.json`, 'utf8'),
      );
      await db.sourceFile.createMany({
        data: Object.entries(files).map(([path, contentText]) => ({
          workspaceId: account.workspaceId,
          repositoryId: repo.id,
          snapshotId: snapshot.id,
          path,
          contentText,
          contentHash: createHash('sha256').update(contentText).digest('hex'),
          language: 'typescript',
        })),
      });
    }
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/repositories/${repoId}?tab=structure`);
  await expect(
    page.getByRole('heading', { name: 'Repository explorer' }),
  ).toBeVisible();
  await page
    .getByLabel('Snapshot', { exact: true })
    .selectOption({ label: 'aaaaaaaaaaaa · 12 files · Demo' });
  await page
    .getByRole('button', { name: 'Analyze snapshot', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Dependency graph', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'deleted.ts', exact: true }).click();
  await expect(page.getByLabel('Source preview')).toContainText('obsolete');
  await expect(page.getByText('Transitive dependents (1)')).toBeVisible();
  await page.getByLabel('Node type', { exact: true }).selectOption('COMPONENT');
  await page.getByLabel('Search nodes', { exact: true }).fill('View');
  await expect(
    page.getByRole('button', { name: 'COMPONENT View', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'COMPONENT View', exact: true })
    .click();
  await expect(page.getByLabel('Source preview')).toContainText(
    'export function View',
  );
  await page.getByLabel('Search nodes', { exact: true }).fill('');
  await page.getByLabel('Node type', { exact: true }).selectOption('FILE');
  await page.getByRole('button', { name: 'main.ts', exact: true }).click();
  await expect(page.getByLabel('Source preview')).toContainText(
    'const unknown',
  );
  const lines = page.getByLabel('Source preview').locator('.source-line');
  const firstLine = await lines.nth(0).boundingBox();
  const secondLine = await lines.nth(1).boundingBox();
  expect(secondLine!.y).toBeGreaterThan(firstLine!.y);
  await expect(
    page.getByRole('heading', { name: 'Outgoing dependencies' }),
  ).toBeVisible();
  await expect(
    page.getByText('Unknown dependency', { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/explorer.png', fullPage: true });
  await page
    .getByLabel('Snapshot', { exact: true })
    .selectOption({ label: 'bbbbbbbbbbbb · 2 files · Demo' });
  await expect(
    page.getByRole('button', { name: 'deleted.ts', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Analyze snapshot', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: /Analysis limitations/ }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'main.ts', exact: true }).click();
  await expect(page.getByText('./deleted', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Dependency graph', exact: true }),
  ).toBeVisible();
});

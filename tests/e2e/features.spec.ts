import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { analyzeSnapshot } from '@impactlens/analyzer';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('feature catalog supports explicit mapping review, stale remapping and history', async ({
  page,
  account,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const db = new PrismaClient();
  let repositoryId = '',
    baseId = '',
    movedId = '',
    baseNode = '',
    movedNode = '';
  try {
    const repo = await db.repository.create({
      data: {
        workspaceId: account.workspaceId,
        owner: 'fixture',
        name: 'feature-mapping',
      },
    });
    repositoryId = repo.id;
    for (const [name, sha] of [
      ['base', 'e'.repeat(40)],
      ['moved', 'f'.repeat(40)],
    ] as const) {
      const source: Record<string, string> = JSON.parse(
        readFileSync(`fixtures/feature-mapping/${name}.json`, 'utf8'),
      );
      const files = Object.entries(source).map(([path, contentText]) => ({
        path,
        contentText,
      }));
      const graph = analyzeSnapshot({ commitSha: sha, files });
      const snapshot = await db.repositorySnapshot.create({
        data: {
          workspaceId: account.workspaceId,
          repositoryId,
          commitSha: sha,
        },
      });
      await db.sourceFile.createMany({
        data: files.map((file) => ({
          ...file,
          workspaceId: account.workspaceId,
          repositoryId,
          snapshotId: snapshot.id,
          contentHash: createHash('sha256')
            .update(file.contentText)
            .digest('hex'),
          language: 'typescript',
        })),
      });
      await db.staticGraph.create({
        data: {
          workspaceId: account.workspaceId,
          repositoryId,
          snapshotId: snapshot.id,
          version: graph.version,
          graph: JSON.parse(JSON.stringify(graph)),
        },
      });
      const nodeId = graph.nodes.find(
        (n) => n.kind === 'FUNCTION' && n.name === 'checkout',
      )!.id;
      if (name === 'base') {
        baseId = snapshot.id;
        baseNode = nodeId;
      } else {
        movedId = snapshot.id;
        movedNode = nodeId;
      }
    }
  } finally {
    await db.$disconnect();
  }
  await page.goto('/features');
  await expect(
    page.getByRole('heading', { name: 'Features', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Feature name', { exact: true }).fill('Checkout');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Place and pay for an order.');
  await page
    .getByLabel('Business criticality', { exact: true })
    .selectOption('CRITICAL');
  await page
    .getByLabel('Responsible team (optional)', { exact: true })
    .fill('Payments');
  await page
    .getByLabel('Customer workflow', { exact: true })
    .fill('Customer completes checkout.');
  await page
    .getByRole('button', { name: 'Create feature', exact: true })
    .click();
  await page.getByRole('link', { name: 'Checkout', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Checkout', exact: true }),
  ).toBeVisible();
  await page.getByText('Edit feature', { exact: true }).click();
  await page
    .getByLabel('Description', { exact: true })
    .fill('Complete checkout and submit payment.');
  await page.getByRole('button', { name: 'Save feature', exact: true }).click();
  await expect(page.locator('.feature-description')).toHaveText(
    'Complete checkout and submit payment.',
  );
  await page
    .getByLabel('Review snapshot', { exact: true })
    .selectOption(baseId);
  await page
    .getByLabel('Implementation target', { exact: true })
    .selectOption(baseNode);
  await page
    .getByLabel('Mapping rationale', { exact: true })
    .fill('This function places the customer order.');
  await page
    .getByRole('button', { name: 'Confirm manual mapping', exact: true })
    .click();
  const manual = page.locator('.mapping-record').filter({
    has: page.getByRole('heading', { name: 'checkout', exact: true }),
  });
  await expect(
    manual.getByText('Confirmed mapping', { exact: true }),
  ).toBeVisible();
  await expect(manual).toContainText('Browser tester');
  await expect(
    page.getByRole('heading', { name: 'Linked tests', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'tests/checkout.test.ts', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Find suggestions', exact: true })
    .click();
  const route = page.locator('.mapping-record').filter({
    has: page.getByRole('heading', { name: 'POST /checkout', exact: true }),
  });
  await expect(
    route.getByText('Unconfirmed suggestion', { exact: true }),
  ).toBeVisible();
  await route
    .getByText('Suggestion evidence (unconfirmed when generated)', {
      exact: true,
    })
    .click();
  await expect(route).toContainText('lexical overlap');
  await route
    .getByRole('button', { name: 'Edit / remap', exact: true })
    .click();
  await page.getByLabel('Target kind', { exact: true }).selectOption('ROUTE');
  await page
    .getByLabel('Implementation target', { exact: true })
    .selectOption({ label: 'ROUTE · POST /checkout · src/server.ts:4' });
  await page
    .getByLabel('Mapping rationale', { exact: true })
    .fill('Reviewed checkout endpoint for this workflow.');
  await page
    .getByRole('button', { name: 'Save edit for review', exact: true })
    .click();
  await expect(
    route.getByText('Unconfirmed suggestion', { exact: true }),
  ).toBeVisible();
  await route
    .getByRole('button', { name: 'Accept mapping', exact: true })
    .click();
  await expect(
    route.getByText('Confirmed mapping', { exact: true }),
  ).toBeVisible();
  const fileSuggestion = page.locator('.mapping-record').filter({
    has: page.getByRole('heading', { name: 'src/checkout.ts', exact: true }),
  });
  await fileSuggestion
    .getByRole('button', { name: 'Reject suggestion', exact: true })
    .click();
  await expect(
    fileSuggestion.getByText('Rejected / retired', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Review snapshot', { exact: true })
    .selectOption(movedId);
  await expect(
    manual.getByText('Stale — review required', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/feature-stale.png',
    fullPage: true,
  });
  await manual
    .getByRole('link', { name: 'View original source', exact: true })
    .click();
  await expect(page.getByLabel('Snapshot', { exact: true })).toHaveValue(
    baseId,
  );
  await expect(page.getByLabel('Source preview')).toContainText(
    "return 'order placed'",
  );
  await page.goBack();
  await expect(
    manual.getByText('Stale — review required', { exact: true }),
  ).toBeVisible();
  await manual
    .getByRole('button', { name: 'Edit / remap', exact: true })
    .click();
  await page
    .getByLabel('Implementation target', { exact: true })
    .selectOption(movedNode);
  await page
    .getByLabel('Mapping rationale', { exact: true })
    .fill('Reviewed move to the payments directory.');
  await page
    .getByRole('button', { name: 'Save edit for review', exact: true })
    .click();
  await expect(
    manual.getByText('Unconfirmed suggestion', { exact: true }),
  ).toBeVisible();
  await manual
    .getByRole('button', { name: 'Accept mapping', exact: true })
    .click();
  await expect(
    manual.getByText('Target resolved', { exact: true }),
  ).toBeVisible();
  await manual.getByText('Mapping history (3)', { exact: true }).click();
  await expect(manual).toContainText('MANUAL_CONFIRMED');
  await expect(manual).toContainText(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  );
  await page.screenshot({
    path: 'test-results/feature-detail.png',
    fullPage: true,
  });
  await page
    .getByRole('link', { name: '← Feature catalog', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Checkout', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.criticality-critical')).toHaveText('CRITICAL');
});

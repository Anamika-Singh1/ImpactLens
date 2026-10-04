import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { analyzeSnapshot } from '@impactlens/analyzer';
import { createHash } from 'node:crypto';

test('compares snapshots, opens saved evidence and preserves results after reload', async ({
  page,
  account,
}) => {
  test.setTimeout(120000);
  const db = new PrismaClient();
  let repositoryId = '';
  const ids: string[] = [];
  try {
    const repository = await db.repository.create({
      data: {
        workspaceId: account.workspaceId,
        owner: 'fixture',
        name: 'impact-comparison',
      },
    });
    repositoryId = repository.id;
    const scope = { workspaceId: account.workspaceId, repositoryId };
    for (const [i, value] of [1, 2].entries()) {
      const commitSha = String(i + 1).repeat(40);
      const files = [
        {
          path: 'checkout.ts',
          contentText: `export function checkout() { return ${value}; }`,
        },
      ];
      const graph = analyzeSnapshot({ commitSha, files });
      const snapshot = await db.repositorySnapshot.create({
        data: { ...scope, commitSha },
      });
      ids.push(snapshot.id);
      const file = await db.sourceFile.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          ...files[0]!,
          contentHash: createHash('sha256')
            .update(files[0]!.contentText)
            .digest('hex'),
          language: 'typescript',
        },
      });
      await db.staticGraph.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          version: graph.version,
          graph: JSON.parse(JSON.stringify(graph)),
        },
      });
      if (i === 0) {
        const csrf = (await (await page.request.get('/api/auth/csrf')).json())
          .csrfToken;
        const options = {
          headers: { Origin: 'http://localhost:5173', 'X-CSRF-Token': csrf },
        };
        const root = `/api/workspaces/${account.workspaceId}/repositories/${repositoryId}/features`;
        const featureResponse = await page.request.post(root, {
          ...options,
          data: { name: 'Checkout review', criticality: 'CRITICAL' },
        });
        expect(featureResponse.status()).toBe(201);
        const feature = await featureResponse.json();
        const mapping = await page.request.post(
          `${root}/${feature.id}/mappings`,
          {
            ...options,
            data: {
              snapshotId: snapshot.id,
              fileId: file.id,
              nodeId: graph.nodes.find((n) => n.kind === 'FUNCTION')!.id,
              rationale: 'Customer checkout',
            },
          },
        );
        expect(mapping.status()).toBe(201);
      }
    }
  } finally {
    await db.$disconnect();
  }
  await page.goto('/analyses');
  await expect(
    page.getByRole('heading', { name: 'Change impact', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Base snapshot', { exact: true }).selectOption(ids[0]!);
  await page.getByLabel('Head snapshot', { exact: true }).selectOption(ids[1]!);
  await page
    .getByRole('button', { name: 'Compare snapshots', exact: true })
    .click();
  await page
    .getByRole('link', { name: '111111111111 → 222222222222', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Change-impact review', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Deterministic template explanation', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Suggested test scenarios — not executed',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('AI sharing is disabled for this workspace.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generate AI explanation', exact: true }),
  ).toHaveCount(0);
  await page
    .getByText('Explanation evidence references', { exact: true })
    .click();
  await expect(page.locator('#explanation-E-F-0')).toContainText(
    'Checkout review',
  );
  await expect(
    page.getByRole('heading', { name: 'Checkout review', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('MAPPING_REVIEW', { exact: true })).toBeVisible();
  await expect(
    page.getByText('No statically linked test files were found.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText('Priority factors', { exact: true }).click();
  await expect(
    page.getByText('Business criticality: +35 — CRITICAL', { exact: true }),
  ).toBeVisible();
  await page
    .getByText('base: checkout.ts → checkout (DIRECT)', { exact: true })
    .click();
  await expect(
    page.locator('.impact-path[open]').getByText(/confirmed by Browser tester/),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'View original mapped source',
      exact: true,
    }),
  ).toHaveAttribute('href', new RegExp(ids[0]!));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Checkout review', exact: true }),
  ).toBeVisible();
  const reviewPanel = page.getByRole('region', { name: 'Release decision' });
  await expect(
    reviewPanel.getByText('No decision recorded', { exact: false }),
  ).toBeVisible();
  await reviewPanel.getByLabel('Review outcome').selectOption('APPROVED');
  await expect(
    reviewPanel.getByRole('button', { name: 'Record review', exact: true }),
  ).toBeDisabled();
  await reviewPanel
    .getByLabel('Review rationale (required)')
    .fill(
      'Considered the saved mapping and test gaps; manual checkout verification is recorded separately.',
    );
  await reviewPanel
    .getByRole('button', { name: 'Record review', exact: true })
    .click();
  await expect(
    reviewPanel.getByText('Revision 1: Approve', { exact: true }),
  ).toBeVisible();
  await reviewPanel
    .getByLabel('Review outcome')
    .selectOption('CHANGES_REQUESTED');
  await reviewPanel
    .getByLabel('Review rationale (required)')
    .fill('Require current automated checkout evidence before release.');
  await reviewPanel
    .getByRole('button', { name: 'Record review', exact: true })
    .click();
  await expect(
    reviewPanel.getByText('Revision 2: Request Changes', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    reviewPanel.getByText('Revision 1: Approve', { exact: true }),
  ).toBeVisible();
  await expect(
    reviewPanel.getByText('Revision 2: Request Changes', { exact: true }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await reviewPanel
    .getByRole('button', { name: 'Download review report (JSON)', exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^impactlens-review-.*\.json$/);
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(report.reviews.map((r: { outcome: string }) => r.outcome)).toEqual([
    'APPROVED',
    'CHANGES_REQUESTED',
  ]);
  expect(report.analysis.baseSha).toBe('1'.repeat(40));
  expect(report.analysis.headSha).toBe('2'.repeat(40));
  expect(report.findings.features[0].name).toBe('Checkout review');
  await page.screenshot({
    path: 'test-results/change-impact.png',
    fullPage: true,
  });
  await page.goto(
    `/repositories/${repositoryId}?snapshotId=${ids[0]}&filePath=excluded.bin`,
  );
  await expect(
    page.getByText('Source text is unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Source preview', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.explorer-preview')).toContainText('excluded.bin');
  await expect(page.locator('pre[aria-label="Source preview"]')).toHaveCount(0);
});

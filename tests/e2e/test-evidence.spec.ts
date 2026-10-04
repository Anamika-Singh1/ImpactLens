import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

test('imports CI evidence, reviews provenance and manages explicit test mappings', async ({
  page,
  account,
}) => {
  const db = new PrismaClient();
  let repositoryId: string;
  try {
    const repo = await db.repository.create({
      data: {
        workspaceId: account.workspaceId,
        owner: 'fixture',
        name: 'test-evidence',
      },
    });
    repositoryId = repo.id;
    const scope = { workspaceId: account.workspaceId, repositoryId };
    await db.repositorySnapshot.create({
      data: { ...scope, commitSha: 'a'.repeat(40) },
    });
    await db.businessFeature.create({
      data: { ...scope, key: 'checkout', name: 'Checkout' },
    });
  } finally {
    await db.$disconnect();
  }
  await page.goto('/test-evidence');
  await expect(
    page.getByRole('heading', { name: 'Test Evidence', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Review commit', { exact: true })
    .selectOption('a'.repeat(40));
  await page.getByLabel('Format', { exact: true }).selectOption('JUNIT');
  await page
    .getByLabel('Artifact file', { exact: true })
    .setInputFiles(resolve('fixtures/test-evidence/junit.xml'));
  await page
    .getByLabel('Artifact commit SHA', { exact: true })
    .fill('a'.repeat(40));
  await page.getByLabel('Test runner', { exact: true }).fill('vitest');
  await page
    .getByLabel('Artifact provenance', { exact: true })
    .fill('CI fixture run 17');
  await page
    .getByRole('button', { name: 'Import artifact', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Artifact: junit.xml', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Provenance: CI fixture run 17', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Exact review commit/)).toBeVisible();
  await page
    .getByLabel('Test identity', { exact: true })
    .selectOption('checkout-success');
  await page
    .getByLabel('Test mapping rationale', { exact: true })
    .fill('Checks customer checkout');
  await page
    .getByRole('button', { name: 'Confirm test mapping', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove test mapping', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Checks customer checkout/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Remove test mapping', exact: true })
    .click();
  await expect(
    page.getByText('No individual test mappings recorded.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/test-evidence.png',
    fullPage: true,
  });
  // Both deletion screens name the data being removed and require confirmation.
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete selected artifact', exact: true })
    .click();
  await expect(
    page.getByText('No test or coverage artifacts imported.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('No test or coverage artifacts imported.', { exact: true }),
  ).toBeVisible();
  await page.goto('/repositories');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('button', { name: 'Delete fixture/test-evidence', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'fixture/test-evidence', exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete fixture/test-evidence', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'No repositories registered',
      exact: true,
    }),
  ).toBeVisible();
});

import { test, expect } from '@playwright/test';
test('same-origin synthetic demo preserves evidence, gaps and a recorded decision', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('viewer@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic demo passphrase 123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await page.goto('/analyses');
  await page.getByRole('link', { name: /111111111111.*222222222222/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Checkout', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Order history', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Revision 1: Request Changes', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record review', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/knownCheckoutTotal/).first()).toBeVisible();
  const evidencePath = page
    .locator('details.impact-path')
    .filter({ hasText: 'src/pricing.ts' })
    .first();
  await evidencePath.locator('summary').click();
  await expect(
    evidencePath.getByRole('link', { name: /View changed source/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Revision 1: Request Changes', { exact: true }),
  ).toBeVisible();
  const identity = await (await page.request.get('/api/auth/me')).json();
  const workspaceId = identity.workspaces[0].id;
  const repositories = await (
    await page.request.get(`/api/workspaces/${workspaceId}/repositories`)
  ).json();
  const root = `/api/workspaces/${workspaceId}/repositories/${repositories[0].id}`;
  const comparisons = await (
    await page.request.get(root + '/comparisons')
  ).json();
  const detail = await (
    await page.request.get(root + '/comparisons/' + comparisons[0].id)
  ).json();
  expect(detail.result.testReview.gaps.length).toBeGreaterThan(0);
  expect(
    detail.result.features.some(
      (f: { paths: unknown[] }) => f.paths.length > 0,
    ),
  ).toBe(true);
  const denied = await page.request.post(root + '/features', {
    headers: {
      Origin: new URL(test.info().project.use.baseURL!).origin,
      'X-CSRF-Token': identity.csrfToken,
    },
    data: { name: 'Must not persist' },
  });
  expect(denied.status()).toBe(403);
});

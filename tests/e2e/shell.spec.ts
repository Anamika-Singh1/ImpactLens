import { expect, test } from './fixtures';
test('shell reaches the real API and navigates to honest empty states', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Release confidence starts with evidence.',
    }),
  ).toBeVisible();
  await expect(page.getByText('API ready', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  for (const title of [
    'Repositories',
    'Features',
    'Analyses',
    'Test Evidence',
    'Settings',
  ]) {
    await page
      .getByRole('navigation')
      .getByRole('link', { name: title, exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: title === 'Analyses' ? 'Change impact' : title,
        exact: true,
      }),
    ).toBeVisible();
  }
});
test('connection failure offers retry', async ({ page }) => {
  await page.route('**/api/health/ready', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Connection unavailable');
  await expect(
    page.getByRole('button', { name: 'Retry connection' }),
  ).toBeVisible();
});
test('loading is visible while health is pending', async ({ page }) => {
  await page.route('**/api/health/ready', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Checking API and dependencies…')).toBeVisible();
});

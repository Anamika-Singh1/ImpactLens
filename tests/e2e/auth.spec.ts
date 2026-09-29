import { test, expect } from './fixtures';
test('browser persists cookie sessions through reload and supports logout and login', async ({
  page,
  account,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  const cookies = await page.context().cookies();
  expect(
    cookies.find((cookie) => cookie.name === 'impactlens_session')?.httpOnly,
  ).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
test('Owner settings and repository metadata persist through the real backend', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByLabel('Workspace name').fill('Release review team');
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByRole('status')).toHaveText('Workspace updated.');
  await page.reload();
  await expect(page.getByLabel('Workspace name')).toHaveValue(
    'Release review team',
  );
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Repositories', exact: true })
    .click();
  await page.getByLabel('GitHub owner').fill('authorized-owner');
  await page.getByLabel('Repository name').fill('portfolio-app');
  await page.getByRole('button', { name: 'Register metadata' }).click();
  await expect(
    page.getByText('authorized-owner/portfolio-app', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('authorized-owner/portfolio-app', { exact: true }),
  ).toBeVisible();
});

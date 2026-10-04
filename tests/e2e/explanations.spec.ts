import { test, expect } from './fixtures';
test('workspace owner explicitly opts in to redacted AI sharing and can revoke it', async ({
  page,
}) => {
  await page.goto('/settings');
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Optional AI explanations',
      exact: true,
    }),
  });
  await expect(panel).toContainText('Workspace AI: Disabled');
  await expect(panel).toContainText(
    'Source code, comments, file and feature names',
  );
  await panel
    .getByRole('button', {
      name: 'Enable AI and allow redacted evidence sharing',
      exact: true,
    })
    .click();
  await expect(panel).toContainText('Workspace AI: Enabled');
  await page.reload();
  await expect(panel).toContainText('Workspace AI: Enabled');
  await panel
    .getByRole('button', { name: 'Disable AI explanations', exact: true })
    .click();
  await expect(panel).toContainText('Workspace AI: Disabled');
});

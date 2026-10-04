import { test, expect } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const installation = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  account: 'my-team',
  githubInstallationId: '123',
};
const imported = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  repositoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  branch: 'feature/checkout',
  commitSha: 'a'.repeat(40),
  status: 'COMPLETED',
  progress: 100,
  stage: 'Snapshot imported',
  errorMessage: null,
  repository: { owner: 'my-team', name: 'shop', source: 'GITHUB' },
  snapshot: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
};
const connected = {
  enabled: true,
  authorization: { login: 'my-user', expiresAt: '2099-01-01T00:00:00Z' },
  installUrl: 'https://github.com/apps/impactlens/installations/new',
  installations: [] as (typeof installation)[],
};

test('frontend links GitHub access, pages repositories, handles branch failure and imports the selected branch', async ({
  page,
  account,
}) => {
  let linked = false;
  let job: typeof imported | null = null;
  let branchFailed = false;
  let submitted: unknown;
  await page.route(
    `**/api/workspaces/${account.workspaceId}/**`,
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.split(account.workspaceId)[1];
      let json: unknown;
      if (path === '/github/authorize')
        json = {
          url: 'https://github.com/login/oauth/authorize?client_id=fixture&state=synthetic',
        };
      else if (path === '/github')
        json = { ...connected, installations: linked ? [installation] : [] };
      else if (path === '/github/available-installations')
        json = {
          installations: [{ installationId: '123', account: 'my-team' }],
          hasNext: false,
        };
      else if (path === '/github/installations') {
        expect(route.request().postDataJSON()).toEqual({
          installationId: '123',
        });
        expect(route.request().headers()['x-csrf-token']).toBeTruthy();
        linked = true;
        json = installation;
      } else if (
        path === `/github/installations/${installation.id}/repositories`
      ) {
        const secondPage = url.searchParams.get('page') === '2';
        json = {
          repositories: [
            {
              id: secondPage ? '222' : '111',
              owner: 'my-team',
              name: secondPage ? 'shop' : 'other',
              defaultBranch: 'main',
            },
          ],
          hasNext: !secondPage,
        };
      } else if (
        path ===
        `/github/installations/${installation.id}/repositories/222/branches`
      ) {
        if (!branchFailed) {
          branchFailed = true;
          return route.fulfill({
            status: 424,
            json: {
              error: {
                message: 'GitHub access expired. Reconnect your account.',
              },
            },
          });
        }
        json = {
          branches: [{ name: 'feature/checkout', commitSha: 'a'.repeat(40) }],
          hasNext: false,
        };
      } else if (path === '/imports' && route.request().method() === 'POST') {
        submitted = route.request().postDataJSON();
        job = imported;
        json = job;
      } else if (path === '/imports') json = job ? [job] : [];
      else return route.continue();
      await route.fulfill({ json });
    },
  );
  await page.goto('/repositories');
  await page
    .getByText('GitHub access, sample imports and import history', {
      exact: true,
    })
    .click();
  await expect(page.getByText('Connected as my-user')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Choose repository access on GitHub' }),
  ).toHaveAttribute('href', connected.installUrl);
  await page
    .getByRole('combobox', { name: 'Available GitHub account', exact: true })
    .selectOption('123');
  await page
    .getByRole('button', { name: 'Link GitHub account', exact: true })
    .click();
  await expect(
    page.getByText('GitHub account linked to this workspace.'),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Linked GitHub account', exact: true })
    .selectOption(installation.id);
  await expect(
    page.getByRole('option', { name: 'my-team/other' }),
  ).toBeAttached();
  await page
    .getByRole('button', { name: 'Next repositories', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'GitHub repository', exact: true })
    .selectOption('222');
  await expect(page.getByRole('alert')).toContainText('GitHub access expired');
  await page
    .getByRole('button', { name: 'Refresh branches', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Branch', exact: true })
    .selectOption('feature/checkout');
  await page
    .getByRole('button', { name: 'Import repository snapshot', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'View imported code', exact: true }),
  ).toHaveAttribute(
    'href',
    `/repositories/${imported.repositoryId}?snapshotId=${imported.snapshot.id}`,
  );
  expect(submitted).toEqual({
    source: 'GITHUB',
    installationId: installation.id,
    repositoryId: '222',
    branch: 'feature/checkout',
  });
  await page.route('https://github.com/login/oauth/authorize**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Mock GitHub consent</h1>',
    }),
  );
  await page
    .getByRole('button', { name: 'Reconnect GitHub', exact: true })
    .click();
  await expect(page).toHaveURL(
    'https://github.com/login/oauth/authorize?client_id=fixture&state=synthetic',
  );
});

test('disabled GitHub offers a sample, polls progress and supports cancellation and retry', async ({
  page,
  account,
}) => {
  let job: typeof imported | null = null;
  let finished = false;
  await page.route(
    `**/api/workspaces/${account.workspaceId}/**`,
    async (route) => {
      const path = new URL(route.request().url()).pathname.split(
        account.workspaceId,
      )[1];
      let json: unknown;
      if (path === '/github')
        json = {
          enabled: false,
          authorization: null,
          installUrl: null,
          installations: [],
        };
      else if (path === '/imports' && route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ source: 'FIXTURE' });
        job = {
          ...imported,
          status: 'QUEUED',
          progress: 0,
          stage: 'Waiting for worker',
        };
        json = job;
      } else if (path === `/imports/${imported.id}/cancel`) {
        job = {
          ...imported,
          status: 'CANCELED',
          progress: 0,
          stage: 'Canceled',
        };
        json = job;
      } else if (path === `/imports/${imported.id}/retry`) {
        job = {
          ...imported,
          status: 'RUNNING',
          progress: 55,
          stage: 'Validating source archive',
        };
        json = job;
      } else if (path === '/imports')
        json = job ? [finished ? imported : job] : [];
      else return route.continue();
      await route.fulfill({ json });
    },
  );
  await page.goto('/repositories');
  await page
    .getByText('GitHub access, sample imports and import history', {
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/GitHub connection is unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect GitHub', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Import sample repository', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Cancel import', exact: true })
    .click();
  await page.getByRole('button', { name: 'Retry import', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '55');
  finished = true;
  await expect(
    page.getByRole('link', { name: 'View imported code', exact: true }),
  ).toBeVisible({ timeout: 10000 });
});

test('Viewer can open saved imports without authorization or import controls', async ({
  page,
  account,
}) => {
  const db = new PrismaClient();
  try {
    await db.membership.updateMany({
      where: { workspaceId: account.workspaceId },
      data: { role: 'VIEWER' },
    });
  } finally {
    await db.$disconnect();
  }
  let queriedAvailable = false;
  await page.route(
    `**/api/workspaces/${account.workspaceId}/**`,
    async (route) => {
      const path = new URL(route.request().url()).pathname.split(
        account.workspaceId,
      )[1];
      if (path === '/github')
        return route.fulfill({
          json: { ...connected, installations: [installation] },
        });
      if (path === '/imports') return route.fulfill({ json: [imported] });
      if (path === '/github/available-installations') queriedAvailable = true;
      await route.continue();
    },
  );
  await page.goto('/repositories');
  await page
    .getByText('GitHub access, sample imports and import history', {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('link', { name: 'View imported code', exact: true }),
  ).toBeVisible();
  for (const name of [
    'Connect GitHub',
    'Reconnect GitHub',
    'Link GitHub account',
    'Import sample repository',
    'Import repository snapshot',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      0,
    );
  expect(queriedAvailable).toBe(false);
});

test('sample import runs through the real worker and opens source in the frontend', async ({
  page,
}) => {
  test.setTimeout(90000);
  let worker: ChildProcess | undefined;
  let workerOrigin = 'http://127.0.0.1:3001';
  async function ready() {
    return fetch(workerOrigin + '/ready', { signal: AbortSignal.timeout(2000) })
      .then((response) => response.ok)
      .catch(() => false);
  }
  try {
    if (!(await ready())) {
      workerOrigin = 'http://127.0.0.1:13001';
      worker = spawn(process.execPath, ['dist/main.js'], {
        cwd: resolve('apps/worker'),
        env: { ...process.env, WORKER_HEALTH_PORT: '13001' },
        stdio: 'ignore',
      });
      await expect.poll(ready, { timeout: 20000 }).toBe(true);
    }
    await page.goto('/repositories');
    await page
      .getByText('GitHub access, sample imports and import history', {
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: 'Import sample repository', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'View imported code', exact: true })
      .click({ timeout: 60000 });
    await page.getByRole('button', { name: 'Structure', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Repository explorer', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'checkout.ts', exact: true })
      .click();
    await expect(page.getByLabel('Source preview')).toContainText(
      'export function total',
    );
    await expect(
      page.getByRole('button', { name: '.env', exact: true }),
    ).toHaveCount(0);
  } finally {
    worker?.kill();
  }
});

test('GitHub callback restores its workspace without preventing later workspace selection', async ({
  page,
  account,
}) => {
  const db = new PrismaClient();
  let workspaceId: string | undefined;
  try {
    const member = await db.membership.findFirstOrThrow({
      where: { workspaceId: account.workspaceId },
    });
    const secondary = await db.workspace.create({
      data: {
        name: 'GitHub callback workspace',
        memberships: { create: { userId: member.userId, role: 'OWNER' } },
      },
    });
    workspaceId = secondary.id;
    await page.goto(`/settings?github=connected&workspaceId=${secondary.id}`);
    await expect(
      page.getByRole('combobox', { name: 'Active workspace', exact: true }),
    ).toHaveValue(secondary.id);
    await expect(page).not.toHaveURL(/workspaceId=/);
    await expect(
      page.getByText(
        'GitHub account connected. Choose repository access below.',
      ),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Active workspace', exact: true })
      .selectOption(account.workspaceId);
    await expect(
      page.getByRole('combobox', { name: 'Active workspace', exact: true }),
    ).toHaveValue(account.workspaceId);
  } finally {
    if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
    await db.$disconnect();
  }
});

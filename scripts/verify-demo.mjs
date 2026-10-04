import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://localhost:8080';
let cookie = '',
  csrf = '';
async function request(path, data) {
  const response = await fetch(base + '/api' + path, {
    method: data ? 'POST' : 'GET',
    headers: {
      Origin: new URL(base).origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (response.headers.get('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  const body = await response.json();
  if (body.csrfToken) csrf = body.csrfToken;
  return { response, body };
}
assert.equal((await fetch(base + '/health/live')).status, 200);
assert.equal((await request('/health/ready')).response.status, 200);
await request('/auth/csrf');
const login = await request('/auth/login', {
  email: 'viewer@example.test',
  password: 'Synthetic demo passphrase 123!',
});
assert.equal(login.response.status, 200);
const workspace = login.body.workspaces[0];
assert.equal(workspace.role, 'VIEWER');
const repositories = (await request(`/workspaces/${workspace.id}/repositories`))
  .body;
const root = `/workspaces/${workspace.id}/repositories/${repositories.find((r) => r.name === 'commerce-demo').id}`;
const comparisons = (await request(root + '/comparisons')).body;
assert.equal(comparisons.length, 1);
const saved = (await request(root + '/comparisons/' + comparisons[0].id)).body;
assert.equal(saved.baseSnapshot.commitSha, '1'.repeat(40));
assert.equal(saved.headSnapshot.commitSha, '2'.repeat(40));
assert(
  saved.result.features.some((f) => f.name === 'Checkout' && f.paths.length),
);
assert(
  saved.result.features.some(
    (f) => f.name === 'Order history' && f.paths.length,
  ),
);
assert(
  saved.result.testReview.recommendations.some((r) =>
    r.name.includes('knownCheckoutTotal'),
  ),
);
assert(saved.result.testReview.gaps.length > 0);
const reviews = (await request(root + '/comparisons/' + saved.id + '/reviews'))
  .body;
const report = (await request(root + '/comparisons/' + saved.id + '/report'))
  .body;
assert.equal(report.reviews.length, 1);
assert.equal(report.reviews[0].outcome, 'CHANGES_REQUESTED');
assert.equal(
  (await request(root + '/features', { name: 'must not persist' })).response
    .status,
  403,
);
assert.equal(
  (await request(root + '/comparisons/' + saved.id)).body.resultHash,
  saved.resultHash,
);
console.log(
  JSON.stringify(
    {
      syntheticDemo: 'verified',
      resultHash: saved.resultHash,
      featurePaths: saved.result.features.map((f) => ({
        name: f.name,
        paths: f.paths.length,
      })),
      recommendations: saved.result.testReview.recommendations.length,
      gaps: saved.result.testReview.gaps.length,
      reviewOutcome: report.reviews[0].outcome,
      reviewReadStatus: reviews ? 'ok' : 'unavailable',
    },
    null,
    2,
  ),
);

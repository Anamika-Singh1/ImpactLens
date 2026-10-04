import { PrismaClient } from '@prisma/client';
import { hash, argon2id } from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { analyzeSnapshot } from '@impactlens/analyzer';

// No general-purpose seed/reset endpoint. This script can only target the demo database.
const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  process.env.DEMO_SEED_ALLOWED !== 'synthetic-only' ||
  process.env.NODE_ENV === 'production' ||
  database.hostname !== 'postgres-demo' ||
  database.pathname !== '/impactlens_demo'
) {
  throw new Error(
    'Demo seed requires the isolated postgres-demo/impactlens_demo database and explicit synthetic-only opt-in.',
  );
}
const db = new PrismaClient();
const api = process.env.DEMO_API_URL ?? 'http://api:3000';
const origin = process.env.WEB_ORIGIN;
const email = 'viewer@example.test';
const password = 'Synthetic demo passphrase 123!';
let cookie = '',
  csrf = '';
async function request(path, data) {
  const response = await fetch(api + '/api' + path, {
    method: data || path === '/auth/logout' ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      'Synthetic demo request failed: ' + path + ' status ' + response.status,
    );
  if (result.csrfToken) csrf = result.csrfToken;
  return result;
}
try {
  const existing = await db.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
  if (existing) {
    const workspaceId = existing.memberships[0]?.workspaceId;
    if (
      !workspaceId ||
      !(await db.reviewDecision.count({ where: { workspaceId } }))
    )
      throw new Error(
        'Partial synthetic seed detected; reset only the dedicated demo volumes before reseeding.',
      );
    console.log(
      'Demo already seeded. Viewer: viewer@example.test; password: Synthetic demo passphrase 123!',
    );
    process.exitCode = 0;
  } else {
    if (await db.user.findUnique({ where: { email: 'reviewer@example.test' } }))
      throw new Error(
        'Partial synthetic seed detected; reset only the dedicated demo volumes before reseeding.',
      );
    await request('/auth/csrf');
    const owner = await request('/auth/register', {
      email: 'reviewer@example.test',
      name: 'Synthetic reviewer',
      password: randomBytes(24).toString('hex'),
    });
    const workspaceId = owner.workspaces[0].id;
    await db.user.create({
      data: {
        email,
        name: 'Demo viewer',
        passwordHash: await hash(password, {
          type: argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        memberships: { create: { workspaceId, role: 'VIEWER' } },
      },
    });
    const repository = await db.repository.create({
      data: {
        workspaceId,
        owner: 'synthetic',
        name: 'commerce-demo',
        source: 'FIXTURE',
      },
    });
    const scope = { workspaceId, repositoryId: repository.id };
    const root = `/workspaces/${workspaceId}/repositories/${repository.id}`;
    const snapshots = [];
    for (const [index, multiplier] of [2, 3].entries()) {
      const commitSha = String(index + 1).repeat(40);
      const files = [
        {
          path: 'src/pricing.ts',
          contentText: `export function total(quantity: number) { return quantity * ${multiplier}; }\n`,
        },
        {
          path: 'src/checkout.ts',
          contentText:
            "import { total } from './pricing';\nexport function checkout(quantity: number) { return total(quantity); }\n",
        },
        {
          path: 'src/orders.ts',
          contentText:
            "import { total } from './pricing';\nexport function orderHistory() { return total(1); }\n",
        },
        {
          path: 'tests/checkout.test.ts',
          contentText:
            "import { checkout } from '../src/checkout';\nexport function knownCheckoutTotal() { return checkout(2) === 4; }\n",
        },
      ];
      const graph = analyzeSnapshot({ commitSha, files });
      const snapshot = await db.repositorySnapshot.create({
        data: {
          ...scope,
          commitSha,
          importSummary: { inventoryComplete: true, synthetic: true },
        },
      });
      const stored = [];
      for (const file of files)
        stored.push(
          await db.sourceFile.create({
            data: {
              ...scope,
              snapshotId: snapshot.id,
              ...file,
              language: 'typescript',
              contentHash: createHash('sha256')
                .update(file.contentText)
                .digest('hex'),
            },
          }),
        );
      await db.staticGraph.create({
        data: {
          ...scope,
          snapshotId: snapshot.id,
          version: graph.version,
          graph: JSON.parse(JSON.stringify(graph)),
        },
      });
      snapshots.push(snapshot);
      if (index === 0) {
        for (const [name, path, symbol] of [
          ['Checkout', 'src/checkout.ts', 'checkout'],
          ['Order history', 'src/orders.ts', 'orderHistory'],
        ]) {
          const feature = await request(root + '/features', {
            name,
            criticality: 'HIGH',
            description: 'Synthetic demonstration feature',
          });
          await request(root + `/features/${feature.id}/mappings`, {
            snapshotId: snapshot.id,
            fileId: stored.find((f) => f.path === path).id,
            nodeId: graph.nodes.find(
              (n) =>
                n.filePath === path &&
                n.name === symbol &&
                n.kind === 'FUNCTION',
            ).id,
            rationale:
              'Synthetic reviewer confirmed this customer workflow entry point.',
          });
        }
      }
    }
    // Explicitly declared sample evidence, not a claim these synthetic tests ran in CI.
    const artifact = await request(root + '/test-evidence/artifacts', {
      format: 'JUNIT',
      commitSha: snapshots[0].commitSha,
      runner: 'synthetic-sample',
      recordedAt: new Date().toISOString(),
      filename: 'synthetic-checkout.xml',
      source: 'Synthetic demonstration sample; not an executed CI run',
      content:
        '<testsuite name="synthetic"><testcase name="knownCheckoutTotal" file="tests/checkout.test.ts"/></testsuite>',
    });
    const evidence = await request(
      root + `/test-evidence/artifacts/${artifact.id}`,
    );
    const features = await request(root + '/features');
    await request(root + '/test-evidence/mappings', {
      featureId: features.find((f) => f.name === 'Checkout').id,
      artifactId: artifact.id,
      testIdentity: evidence.parsed.tests[0].identity,
      rationale:
        'Synthetic example of a manually confirmed feature-test link; evidence belongs to the base commit.',
    });
    const analysis = await request(root + '/comparisons', {
      baseSnapshotId: snapshots[0].id,
      headSnapshotId: snapshots[1].id,
    });
    await request(root + `/comparisons/${analysis.id}/reviews`, {
      outcome: 'CHANGES_REQUESTED',
      expectedRevision: 0,
      baseSha: snapshots[0].commitSha,
      headSha: snapshots[1].commitSha,
      resultHash: analysis.resultHash,
      comment:
        'Synthetic review: shared pricing changed. Run current checkout tests and add order-history coverage before release; sample evidence is from the base commit.',
    });
    await request('/auth/logout');
    console.log(
      'Synthetic demo seeded. Open http://localhost:8080 and log in as viewer@example.test',
    );
    console.log('Password: Synthetic demo passphrase 123!');
    console.log(`Saved comparison: /analyses/${repository.id}/${analysis.id}`);
  }
} finally {
  await db.$disconnect();
}

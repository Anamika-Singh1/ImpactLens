import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

config({ path: 'apps/api/.env' });
const require = createRequire(import.meta.url);
const schema = 'phase5_upgrade_' + randomUUID().replaceAll('-', '');
assert.match(schema, /^phase5_upgrade_[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema);
const admin = new PrismaClient();
const db = new PrismaClient({ datasourceUrl: url.toString() });
let created = false;
function execute(sql) {
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'db',
      'execute',
      '--schema',
      'apps/api/prisma/schema.prisma',
      '--stdin',
    ],
    {
      input: sql,
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}
try {
  const existing =
    await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`;
  assert.equal(existing.length, 0);
  await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
  created = true;
  const migration = '20260930020000_feature_mappings';
  const previous = readdirSync('apps/api/prisma/migrations')
    .filter((name) => /^\d/.test(name) && name < migration)
    .sort();
  execute(
    previous
      .map((name) =>
        readFileSync(
          `apps/api/prisma/migrations/${name}/migration.sql`,
          'utf8',
        ),
      )
      .join('\n'),
  );
  const workspaceId = randomUUID(),
    repositoryId = randomUUID(),
    snapshotId = randomUUID(),
    fileId = randomUUID(),
    featureId = randomUUID(),
    mappingId = randomUUID();
  await db.$executeRaw`INSERT INTO "Workspace" (id, name, "updatedAt") VALUES (${workspaceId}::uuid, 'Upgrade fixture', CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO "Repository" (id, "workspaceId", owner, name, "updatedAt") VALUES (${repositoryId}::uuid, ${workspaceId}::uuid, 'fixture', 'upgrade', CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO "RepositorySnapshot" (id, "workspaceId", "repositoryId", "commitSha") VALUES (${snapshotId}::uuid, ${workspaceId}::uuid, ${repositoryId}::uuid, ${'a'.repeat(40)})`;
  await db.$executeRaw`INSERT INTO "SourceFile" (id, "workspaceId", "repositoryId", "snapshotId", path, "contentHash", language) VALUES (${fileId}::uuid, ${workspaceId}::uuid, ${repositoryId}::uuid, ${snapshotId}::uuid, 'checkout.ts', ${'a'.repeat(64)}, 'typescript')`;
  await db.$executeRaw`INSERT INTO "BusinessFeature" (id, "workspaceId", "repositoryId", key, name, description) VALUES (${featureId}::uuid, ${workspaceId}::uuid, ${repositoryId}::uuid, 'checkout', 'Checkout', 'Original description')`;
  await db.$executeRaw`INSERT INTO "FeatureMapping" (id, "workspaceId", "repositoryId", "featureId", "snapshotId", "fileId", rationale) VALUES (${mappingId}::uuid, ${workspaceId}::uuid, ${repositoryId}::uuid, ${featureId}::uuid, ${snapshotId}::uuid, ${fileId}::uuid, 'Original rationale')`;
  execute(
    readFileSync(
      `apps/api/prisma/migrations/${migration}/migration.sql`,
      'utf8',
    ),
  );
  const mapping = await db.featureMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { history: true },
  });
  assert.equal(mapping.status, 'NEEDS_REVIEW');
  assert.equal(mapping.origin, 'LEGACY');
  assert.equal(mapping.confirmedById, null);
  assert.equal(mapping.confirmedAt, null);
  assert.equal(mapping.rationale, 'Original rationale');
  assert.equal(mapping.nodeId, 'file:checkout.ts');
  assert.equal(mapping.history.length, 1);
  assert.equal(mapping.history[0].action, 'LEGACY_IMPORTED');
  assert.equal(mapping.history[0].state.rationale, 'Original rationale');
  assert.equal(mapping.history[0].snapshotId, snapshotId);
  assert.equal(
    (await db.businessFeature.findUniqueOrThrow({ where: { id: featureId } }))
      .description,
    'Original description',
  );
  console.log(
    'Legacy mapping upgrade preserves source/rationale/history without inventing confirmation.',
  );
} finally {
  await db.$disconnect();
  if (created)
    await admin.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
  await admin.$disconnect();
}

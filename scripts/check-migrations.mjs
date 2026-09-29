import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

config({ path: 'apps/api/.env' });
const require = createRequire(import.meta.url);
const schema = 'phase2_verify_' + randomUUID().replaceAll('-', '');
assert.match(schema, /^phase2_verify_[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema);
const admin = new PrismaClient();
const isolated = new PrismaClient({ datasourceUrl: url.toString() });
let created = false;
try {
  const existing =
    await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`;
  assert.equal(existing.length, 0, 'Refuse to reuse an existing schema');
  created = true;
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        'apps/api/prisma/schema.prisma',
      ],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
  console.log(migrate());
  assert.equal(await isolated.repository.count(), 0);
  assert.equal(await isolated.user.count(), 0);
  console.log(migrate());
  console.log(
    'All migrations apply to an isolated empty schema; repeat deployment is idempotent.',
  );
} finally {
  await isolated.$disconnect();
  // Only the random schema verified absent above can be removed.
  if (created)
    await admin.$executeRawUnsafe(
      'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
    );
  await admin.$disconnect();
}

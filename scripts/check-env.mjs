import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Suppress dotenv files without editing the developer's local configuration.
const env = {
  ...process.env,
  DOTENV_CONFIG_PATH: resolve('.missing-env-for-startup-check'),
};
for (const key of ['DATABASE_URL', 'REDIS_URL', 'WEB_ORIGIN']) delete env[key];
for (const [app, fields] of [
  ['api', ['DATABASE_URL', 'REDIS_URL', 'WEB_ORIGIN']],
  ['worker', ['REDIS_URL', 'DATABASE_URL']],
]) {
  const result = spawnSync(
    process.execPath,
    [resolve(`apps/${app}/dist/main.js`)],
    { env, encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(
    result.status,
    1,
    `${app} must exit with status 1: ${result.stderr}`,
  );
  for (const field of fields) assert.match(result.stderr, new RegExp(field));
  console.log(
    `${app}: missing required variables rejected with field-specific errors`,
  );
}

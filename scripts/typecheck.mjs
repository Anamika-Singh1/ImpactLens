import { spawnSync } from 'node:child_process';
for (const workspace of [
  'packages/shared',
  'packages/analyzer',
  'packages/ingestion',
  'apps/api',
  'apps/worker',
  'apps/web',
]) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '-p',
      workspace + '/tsconfig.json',
      '--noEmit',
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

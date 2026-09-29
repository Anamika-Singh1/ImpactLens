import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
for (const folder of ['.', 'apps/api', 'apps/worker', 'apps/web']) {
  try {
    await copyFile(
      folder + '/.env.example',
      folder + '/.env',
      constants.COPYFILE_EXCL,
    );
    console.log('Created ' + folder + '/.env');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Kept existing ' + folder + '/.env');
  }
}

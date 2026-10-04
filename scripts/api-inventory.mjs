import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const rows = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith('controller.ts')) {
      const source = await readFile(file, 'utf8');
      for (const block of source.split(/(?=@Controller\()/)) {
        const base = block.match(
          /@Controller\(\s*['"]([^'"]+)['"]\s*,?\s*\)/,
        )?.[1];
        if (!base) continue;
        for (const method of block.matchAll(
          /@(Get|Post|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g,
        ))
          rows.push(
            `| ${method[1].toUpperCase()} | /api/${base}${method[2] ? '/' + method[2] : ''} | [controller](../${file.replaceAll('\\', '/')}) |`,
          );
      }
    }
  }
}
await walk('apps/api/src');
rows.sort();
await writeFile(
  'docs/api-routes.md',
  '# Implemented API routes\n\nGenerated from controller decorators by `node scripts/api-inventory.mjs`. See [API documentation](api.md) for sessions, CSRF, permissions, schemas and errors.\n\n| Method | Path | Validation source |\n| --- | --- | --- |\n' +
    rows.join('\n') +
    '\n',
);
console.log(`Documented ${rows.length} controller routes.`);

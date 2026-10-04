import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
// A deterministic local Git tree/commit, not a claim about a remote repository.
export const fixtureFiles: Record<string, string> = {
  'src/checkout.ts':
    'export function total(prices: number[]) { return prices.reduce((sum, price) => sum + price, 0); }\n',
  'src/Checkout.tsx':
    'import { total } from "./checkout";\nexport function Checkout() { return <p>Total: {total([12, 8])}</p>; }\n',
  'src/server.ts':
    'import express from "express";\nimport { total } from "./checkout";\nconst app = express();\napp.get("/total", (_req, res) => res.json({ total: total([12, 8]) }));\n',
  'test/checkout.test.ts':
    'import { expect, test } from "vitest";\nimport { total } from "../src/checkout";\ntest("adds prices", () => expect(total([12, 8])).toBe(20));\n',
  'package.json':
    '{"name":"impactlens-demo-checkout","private":true,"scripts":{"postinstall":"node must-never-execute.js"}}\n',
  'must-never-execute.js':
    'throw new Error("Imported repository code must never execute");\n',
  '.env': 'DEMO_SECRET=excluded-fixture-placeholder\n',
  'node_modules/excluded.js': 'throw new Error("Excluded dependency");\n',
  'dist/generated.js': '// Excluded build output\n',
};
function gitObject(kind: string, bytes: Buffer) {
  return createHash('sha1')
    .update(Buffer.from(`${kind} ${bytes.length}\0`))
    .update(bytes)
    .digest();
}
function tree(prefix = ''): Buffer {
  const children = [
    ...new Set(
      Object.keys(fixtureFiles)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length).split('/')[0]!),
    ),
  ];
  return gitObject(
    'tree',
    Buffer.concat(
      children
        .sort((a, b) =>
          Buffer.compare(
            Buffer.from(
              a + (fixtureFiles[prefix + a] === undefined ? '/' : ''),
            ),
            Buffer.from(
              b + (fixtureFiles[prefix + b] === undefined ? '/' : ''),
            ),
          ),
        )
        .map((name) => {
          const file = fixtureFiles[prefix + name];
          return Buffer.concat([
            Buffer.from(`${file === undefined ? '40000' : '100644'} ${name}\0`),
            file === undefined
              ? tree(prefix + name + '/')
              : gitObject('blob', Buffer.from(file)),
          ]);
        }),
    ),
  );
}
export const fixtureCommit = `tree ${tree().toString('hex')}\nauthor ImpactLens Demo <demo@example.invalid> 0 +0000\ncommitter ImpactLens Demo <demo@example.invalid> 0 +0000\n\nDeterministic checkout demo fixture\n`;
export const fixture = {
  id: 'checkout-demo',
  owner: 'impactlens-demo',
  name: 'checkout-demo',
  branch: 'main',
  commitSha: gitObject('commit', Buffer.from(fixtureCommit)).toString('hex'),
  isDemo: true,
};
export async function fixtureArchive() {
  const archive = pack();
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of archive) {
      if (!Buffer.isBuffer(chunk))
        throw new Error('Invalid fixture stream data');
      chunks.push(Buffer.from(chunk));
    }
  })();
  for (const [path, content] of Object.entries(fixtureFiles))
    archive.entry(
      { name: `checkout-demo/${path}`, mtime: new Date(0), mode: 0o644 },
      content,
    );
  archive.finalize();
  await collecting;
  return gzipSync(Buffer.concat(chunks));
}

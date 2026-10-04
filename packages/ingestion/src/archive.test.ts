import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { archivePath, readArchive, LIMITS } from './archive';
import { fixtureArchive } from './fixture';

async function archive(
  entries: { name: string; content?: string; type?: 'file' | 'symlink' }[],
) {
  const stream = pack();
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid test stream');
      chunks.push(chunk);
    }
  })();
  for (const entry of entries) {
    stream.entry(
      {
        name: entry.name,
        type: entry.type ?? 'file',
        ...(entry.type === 'symlink' ? { linkname: '../../outside' } : {}),
      },
      entry.content ?? '',
    );
  }
  stream.finalize();
  await collecting;
  return gzipSync(Buffer.concat(chunks));
}

describe('source archive validation', () => {
  it('imports fixture source without dependencies, build output or environment files', async () => {
    const result = await readArchive(await fixtureArchive());
    expect(result.files.map((file) => file.path)).toEqual([
      'must-never-execute.js',
      'package.json',
      'src/checkout.ts',
      'src/Checkout.tsx',
      'src/server.ts',
      'test/checkout.test.ts',
    ]);
    expect(result.summary.excludedFiles).toBe(3);
  });

  it.each([
    'root/../outside.ts',
    '/root/file.ts',
    'root\\file.ts',
    'root/con.ts',
  ])('rejects unsafe path %s', (path) => {
    expect(() => archivePath(path)).toThrow();
  });

  it('rejects symlinks', async () => {
    await expect(
      readArchive(await archive([{ name: 'root/link', type: 'symlink' }])),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects case-colliding files', async () => {
    await expect(
      readArchive(
        await archive([{ name: 'root/a.ts' }, { name: 'root/A.ts' }]),
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('excludes private keys embedded in source', async () => {
    const result = await readArchive(
      await archive([
        {
          name: 'root/config.ts',
          content: 'const key = "-----BEGIN PRIVATE KEY-----";',
        },
      ]),
    );
    expect(result.files).toEqual([]);
    expect(result.summary.excludedFiles).toBe(1);
  });

  it('rejects malformed archives', async () => {
    await expect(readArchive(Buffer.from('invalid'))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
  });
  it('rejects multiple roots, duplicate entries, oversized downloads and too many entries', async () => {
    for (const entries of [
      [{ name: 'one/a.ts' }, { name: 'two/b.ts' }],
      [{ name: 'root/a.ts' }, { name: 'root/a.ts' }],
    ])
      await expect(readArchive(await archive(entries))).rejects.toMatchObject({
        code: 'UNSAFE_ARCHIVE',
      });
    await expect(
      readArchive(Buffer.alloc(LIMITS.download + 1)),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_LIMIT' });
    await expect(
      readArchive(
        await archive(
          Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({
            name: `root/${i}.ts`,
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: 'FILE_COUNT_LIMIT' });
  });
  it('cancels before any retained source is returned', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readArchive(await fixtureArchive(), controller.signal),
    ).rejects.toThrow();
  });
});

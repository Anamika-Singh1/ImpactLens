import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import { ImportFailure } from './errors';

export const LIMITS = {
  download: 25 * 1024 * 1024,
  extracted: 100 * 1024 * 1024,
  retained: 20 * 1024 * 1024,
  file: 1024 * 1024,
  entries: 5000,
  timeoutMs: 120000,
} as const;
export type ImportedFile = {
  path: string;
  contentText: string;
  contentHash: string;
  language: string;
};
export function archivePath(name: string): string {
  if (
    !name ||
    name.length > 500 ||
    /[\\:\x00-\x1f\x7f]/.test(name) ||
    name.startsWith('/')
  )
    throw new ImportFailure(
      'UNSAFE_ARCHIVE',
      'Archive contains an unsafe path. Import a regular GitHub source archive.',
    );
  const parts = name.replace(/\/$/, '').split('/');
  if (
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
    )
  )
    throw new ImportFailure(
      'UNSAFE_ARCHIVE',
      'Archive contains an unsafe path.',
    );
  return parts.join('/');
}
function included(path: string) {
  if (
    path
      .split('/')
      .some((p) =>
        /^(node_modules|\.git|dist|build|coverage|vendor|\.next|\.nuxt|out|target|generated|__generated__|\.cache)$/i.test(
          p,
        ),
      )
  )
    return false;
  if (
    /(^|\/)(\.env.*|.*(?:secret|credential|token|private.?key).*|id_rsa|id_ed25519|\.npmrc|\.pypirc)$/i.test(
      path,
    )
  )
    return false;
  if (/\.(min|bundle|generated)\.[cm]?jsx?$|\.d\.ts$/i.test(path)) return false;
  return (
    /\.(?:[cm]?js|jsx|[cm]?ts|tsx|py|go|java|rs|php|rb|cs|vue|svelte|css|html|md|toml|ya?ml)$/.test(
      path,
    ) ||
    /(^|\/)(package|package-lock|npm-shrinkwrap|tsconfig|composer)\.json$/.test(
      path,
    ) ||
    /(^|\/)(yarn\.lock|bun\.lock|Cargo\.lock|poetry\.lock|go\.mod|go\.sum|requirements\.txt|Dockerfile)$/.test(
      path,
    )
  );
}

// Deliberately no filesystem extraction. Validated text is persisted transactionally
// by the worker. Neither safe nor malicious archive paths can cause a disk write.
export async function readArchive(compressed: Buffer, signal?: AbortSignal) {
  if (compressed.length > LIMITS.download)
    throw new ImportFailure(
      'DOWNLOAD_LIMIT',
      'Archive exceeds the 25 MiB download limit. Select a smaller repository.',
    );
  const effectiveSignal = AbortSignal.any([
    AbortSignal.timeout(LIMITS.timeoutMs),
    ...(signal ? [signal] : []),
  ]);
  const files: ImportedFile[] = [];
  const inventory: { path: string; contentHash: string }[] = [];
  let entries = 0,
    expanded = 0,
    retained = 0,
    excluded = 0;
  let root: string | undefined;
  const paths = new Set<string>();
  const parser = extract();
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      expanded += chunk.length;
      callback(
        expanded > LIMITS.extracted
          ? new ImportFailure(
              'EXTRACTED_LIMIT',
              'Expanded archive exceeds the 100 MiB limit.',
            )
          : null,
        chunk,
      );
    },
  });
  parser.on('entry', (header, stream, next) => {
    void (async () => {
      if (++entries > LIMITS.entries)
        throw new ImportFailure(
          'FILE_COUNT_LIMIT',
          'Archive exceeds the 5,000-entry limit.',
        );
      const full = archivePath(header.name);
      const [entryRoot, ...rest] = full.split('/');
      root ??= entryRoot;
      if (root !== entryRoot)
        throw new ImportFailure(
          'UNSAFE_ARCHIVE',
          'Archive must contain a single repository root.',
        );
      if (header.type !== 'file' && header.type !== 'directory')
        throw new ImportFailure(
          'UNSAFE_ARCHIVE',
          'Symlinks, hard links and special archive entries are not supported. Remove them before importing.',
        );
      const key = full.toLowerCase();
      if (paths.has(key))
        throw new ImportFailure(
          'UNSAFE_ARCHIVE',
          'Archive contains duplicate or case-colliding paths.',
        );
      paths.add(key);
      const path = rest.join('/');
      const keep =
        header.type === 'file' &&
        !!path &&
        included(path) &&
        (header.size ?? 0) <= LIMITS.file;
      if (header.type === 'file' && !path)
        throw new ImportFailure(
          'UNSAFE_ARCHIVE',
          'Archive must contain a repository directory.',
        );
      const chunks: Buffer[] = [];
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of stream) {
        effectiveSignal.throwIfAborted();
        if (!Buffer.isBuffer(chunk))
          throw new ImportFailure(
            'INVALID_ARCHIVE',
            'Archive contains invalid stream data.',
          );
        size += chunk.length;
        hash.update(chunk);
        if (keep) {
          if (size > LIMITS.file)
            throw new ImportFailure(
              'FILE_LIMIT',
              'Source file exceeds the 1 MiB limit.',
            );
          chunks.push(Buffer.from(chunk));
        }
      }
      if (header.type === 'file')
        inventory.push({ path, contentHash: hash.digest('hex') });
      if (keep) {
        const content = Buffer.concat(chunks);
        let contentText: string | undefined;
        try {
          contentText = new TextDecoder('utf-8', { fatal: true }).decode(
            content,
          );
        } catch {
          /* binary */
        }
        if (
          contentText !== undefined &&
          !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(contentText) &&
          !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(
            contentText,
          )
        ) {
          retained += content.length;
          if (retained > LIMITS.retained)
            throw new ImportFailure(
              'SOURCE_LIMIT',
              'Retained source exceeds the 20 MiB limit.',
            );
          files.push({
            path,
            contentText,
            contentHash: createHash('sha256').update(content).digest('hex'),
            language: /\.[cm]?tsx?$/.test(path)
              ? 'typescript'
              : /\.json$/.test(path)
                ? 'json'
                : /\.[cm]?jsx?$/.test(path)
                  ? 'javascript'
                  : /\.py$/.test(path)
                    ? 'python'
                    : /\.go$/.test(path)
                      ? 'go'
                      : /\.java$/.test(path)
                        ? 'java'
                        : /\.rs$/.test(path)
                          ? 'rust'
                          : /\.php$/.test(path)
                            ? 'php'
                            : /\.rb$/.test(path)
                              ? 'ruby'
                              : /\.cs$/.test(path)
                                ? 'csharp'
                                : 'text',
          });
        } else excluded++;
      } else if (header.type === 'file') excluded++;
      next();
    })().catch((error) =>
      parser.destroy(
        error instanceof Error ? error : new Error('Invalid archive'),
      ),
    );
  });
  try {
    await pipeline(Readable.from([compressed]), createGunzip(), bound, parser, {
      signal: effectiveSignal,
    });
    if (!entries)
      throw new ImportFailure('INVALID_ARCHIVE', 'Archive is empty.');
    return {
      files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')),
      summary: {
        inventory: inventory.sort((a, b) => a.path.localeCompare(b.path, 'en')),
        inventoryComplete: true,
        entries,
        retainedFiles: files.length,
        excludedFiles: excluded,
        retainedBytes: retained,
        limitations: [
          'Static JavaScript/TypeScript relationship analysis; other retained text is browsable. No code was executed.',
          'Excluded generated output, binaries, likely secrets, unsupported extensions and files over 1 MiB. Secret detection is heuristic.',
          'Git submodules and Git LFS objects are not fetched; runtime dependencies are not resolved.',
        ],
      },
    };
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    if (effectiveSignal.aborted)
      throw new ImportFailure(
        'TIMEOUT',
        'Import timed out or was canceled. Retry a smaller repository.',
        true,
      );
    throw new ImportFailure(
      'INVALID_ARCHIVE',
      'Archive is malformed or truncated. Retry; if it persists, verify the repository archive.',
    );
  }
}

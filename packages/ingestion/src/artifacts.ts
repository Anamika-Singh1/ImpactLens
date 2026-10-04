import { SaxesParser } from 'saxes';
import { z } from 'zod';
import type {
  ArtifactFormat,
  ParsedArtifact,
  ImportedTest,
  CoverageFile,
} from '@impactlens/shared';

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export class ArtifactError extends Error {}
function fail(message: string): never {
  throw new ArtifactError(message);
}
const text = z
  .string()
  .min(1)
  .max(1000)
  .refine((s) => !/[\x00-\x1f]/.test(s), 'Control characters are not allowed');
const line = z.number().int().min(1).max(10000000);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Artifact paths are logical repository paths. Never resolve them on the server filesystem. */
export function sourcePath(value: string, sourceRoot?: string): string {
  const clean = (s: string) => {
    if (!s || s.length > 2000 || /[\x00-\x1f\x7f%?#]/.test(s))
      fail('Source path contains invalid characters.');
    const p = s.replace(/\\/g, '/');
    if (p.split('/').includes('..'))
      fail('Parent traversal is not allowed in source paths.');
    return p
      .replace(/\/\.\//g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/\/+$/, '');
  };
  let path = clean(value);
  if (/^(\/|[A-Za-z]:)/.test(path)) {
    if (!sourceRoot)
      fail('Absolute source paths require the CI checkout sourceRoot.');
    const root = clean(sourceRoot!);
    if (!/^(\/|[A-Za-z]:\/)/.test(root) || !path.startsWith(root + '/'))
      fail('Source path is outside the declared sourceRoot.');
    path = path.slice(root.length + 1);
  }
  if (
    !path ||
    path.startsWith('/') ||
    path.includes(':') ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    fail('Expected a repository-relative source path.');
  return path;
}
function junit(content: string, root?: string): ParsedArtifact {
  // Saxes has no external resolver. Reject DTDs and custom entities entirely as well.
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(content))
    fail('JUnit DTDs and entity declarations are disabled.');
  const parser = new SaxesParser({ xmlns: false });
  const stack: string[] = [],
    suites: string[] = [],
    tests: ImportedTest[] = [];
  let current: ImportedTest | null = null,
    rootName = '',
    nodes = 0;
  parser.on('doctype', () => fail('JUnit DTDs are disabled.'));
  parser.on('error', () =>
    fail(
      'Malformed JUnit XML. Check XML nesting, attributes and entity references.',
    ),
  );
  parser.on('opentag', (node) => {
    if (++nodes > 100000 || stack.length >= 64)
      fail('JUnit exceeds the element or nesting limit.');
    const parent = stack.at(-1);
    if (!stack.length) {
      rootName = node.name;
      if (!['testsuite', 'testsuites'].includes(rootName))
        fail('JUnit root must be testsuite or testsuites.');
    }
    const a = node.attributes as Record<string, string>;
    if (node.name === 'testsuite') {
      if (parent && !['testsuites', 'testsuite'].includes(parent))
        fail('Invalid testsuite nesting.');
      suites.push(a.name ?? '');
    }
    if (node.name === 'testcase') {
      if (parent !== 'testsuite' || current)
        fail('JUnit testcase must belong to a testsuite.');
      const name = text.parse(a.name);
      const identity = a.id
        ? text.parse(a.id)
        : JSON.stringify([
            suites.filter(Boolean).join('/'),
            a.classname ?? '',
            name,
          ]);
      if (identity.length > 1000)
        fail('JUnit test identity exceeds 1000 characters.');
      current = {
        identity,
        name,
        path: a.file ? sourcePath(a.file, root) : null,
        outcome: 'PASSED',
      };
    }
    if (current && parent === 'testcase') {
      if (node.name === 'failure' || node.name === 'error')
        current.outcome = 'FAILED';
      else if (node.name === 'skipped' && current.outcome !== 'FAILED')
        current.outcome = 'SKIPPED';
    }
    stack.push(node.name);
  });
  parser.on('closetag', (node) => {
    if (node.name === 'testcase' && current) {
      tests.push(current);
      current = null;
      if (tests.length > 10000) fail('JUnit exceeds 10,000 tests.');
    }
    if (node.name === 'testsuite') suites.pop();
    stack.pop();
  });
  parser.write(content).close();
  if (!rootName) fail('JUnit XML is empty.');
  if (new Set(tests.map((t) => t.identity)).size !== tests.length)
    fail(
      'JUnit contains duplicate test identities. Export stable unique testcase id attributes.',
    );
  return {
    tests,
    aggregate: [],
    perTest: [],
    limitations: ['JUnit records outcomes, not source coverage.'],
  };
}
const location = z
  .object({
    start: z.object({ line, column: count }),
    end: z.object({ line, column: count }),
  })
  .refine((v) => v.end.line >= v.start.line, 'Invalid statement range');
function istanbul(content: string, root?: string): ParsedArtifact {
  const schema = z.record(
    z.object({
      path: text,
      statementMap: z.record(location),
      s: z.record(count),
      fnMap: z.record(
        z.object({
          name: text,
          loc: location,
          decl: location.optional(),
          line: line.optional(),
        }),
      ),
      f: z.record(count),
      branchMap: z.record(
        z.object({
          type: text,
          loc: location.optional(),
          line: line.optional(),
          locations: z.array(location),
        }),
      ),
      b: z.record(z.array(count)),
    }),
  );
  const parsed = schema.parse(JSON.parse(content));
  const aggregate: CoverageFile[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const path = sourcePath(value.path, root);
    if (sourcePath(key, root) !== path)
      fail('Istanbul file key and path disagree.');
    if (
      Object.keys(value.statementMap).sort().join(',') !==
      Object.keys(value.s).sort().join(',')
    )
      fail('Istanbul statement counts and statementMap IDs must match.');
    if (
      Object.keys(value.fnMap).sort().join(',') !==
        Object.keys(value.f).sort().join(',') ||
      Object.keys(value.branchMap).sort().join(',') !==
        Object.keys(value.b).sort().join(',')
    )
      fail('Istanbul function/branch counts and maps must have matching IDs.');
    for (const [id, branch] of Object.entries(value.branchMap))
      if (branch.locations.length !== value.b[id]!.length)
        fail('Istanbul branch counts do not match branch locations.');
    aggregate.push({
      path,
      ranges: Object.entries(value.statementMap).map(([id, r]) => ({
        start: r.start.line,
        end: r.end.line,
        hits: value.s[id]!,
      })),
    });
  }
  if (!aggregate.length) fail('Istanbul report contains no files.');
  if (new Set(aggregate.map((f) => f.path)).size !== aggregate.length)
    fail('Coverage contains duplicate normalized paths.');
  return {
    tests: [],
    aggregate,
    perTest: [],
    limitations: [
      'Aggregate statement coverage cannot identify individual tests or prove branch coverage.',
    ],
  };
}
function lcov(content: string, root?: string): ParsedArtifact {
  const aggregate: CoverageFile[] = [];
  let current: CoverageFile | null = null;
  let seen = new Set<number>();
  for (const raw of content.split(/\r?\n/)) {
    const value = raw.trim();
    if (!value) continue;
    if (value.startsWith('SF:')) {
      if (current) fail('LCOV record is missing end_of_record.');
      current = { path: sourcePath(value.slice(3), root), ranges: [] };
      seen = new Set();
    } else if (value.startsWith('DA:')) {
      if (!current || !/^DA:[1-9]\d*,\d+(?:,[a-fA-F0-9]+)?$/.test(value))
        fail('Invalid LCOV DA line record.');
      const [start, hits] = value.slice(3).split(',').map(Number);
      line.parse(start);
      count.parse(hits);
      if (seen.has(start!)) fail('Duplicate LCOV line in a file record.');
      seen.add(start!);
      current.ranges.push({ start: start!, end: start!, hits: hits! });
    } else if (value === 'end_of_record') {
      if (!current) fail('LCOV end_of_record has no file.');
      aggregate.push(current!);
      current = null;
    } else if (
      !/^(?:TN:.*|VER:.+|FN:[1-9]\d*,(?:[1-9]\d*,)?.+|FNDA:\d+,.+|(?:FNF|FNH|BRF|BRH|LF|LH):\d+|BRDA:[1-9]\d*,\d+,\d+,(?:\d+|-))$/.test(
        value,
      )
    )
      fail('Unsupported or malformed LCOV record.');
  }
  if (current) fail('LCOV record is missing end_of_record.');
  if (!aggregate.length || !aggregate.some((f) => f.ranges.length))
    fail('LCOV report contains no line coverage.');
  // Separate records (including TN sections) are suite data, never individual-test attribution.
  const merged = new Map<string, Map<number, number>>();
  for (const file of aggregate) {
    const records = merged.get(file.path) ?? new Map<number, number>();
    for (const r of file.ranges)
      records.set(r.start, Math.max(records.get(r.start) ?? 0, r.hits));
    merged.set(file.path, records);
  }
  return {
    tests: [],
    aggregate: [...merged].map(([path, records]) => ({
      path,
      ranges: [...records].map(([start, hits]) => ({
        start,
        end: start,
        hits,
      })),
    })),
    perTest: [],
    limitations: [
      'LCOV is treated as aggregate line coverage, including named TN sections. Individual attribution requires the per-test format.',
    ],
  };
}
function perTest(content: string, root?: string): ParsedArtifact {
  const target = z
    .object({
      path: text,
      lines: z.array(line).min(1).max(100000).optional(),
      symbol: z
        .object({ name: text, startLine: line, endLine: line })
        .strict()
        .refine((s) => s.endLine >= s.startLine, 'Invalid symbol range')
        .optional(),
    })
    .strict()
    .refine((t) => !(t.lines && t.symbol), 'Choose lines or symbol, not both');
  const schema = z
    .object({
      version: z.literal(1),
      tests: z
        .array(
          z
            .object({
              identity: text,
              name: text,
              path: text.optional(),
              covers: z.array(target).max(10000),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict();
  const value = schema.parse(JSON.parse(content));
  if (new Set(value.tests.map((t) => t.identity)).size !== value.tests.length)
    fail('Per-test report contains duplicate identities.');
  return {
    tests: value.tests.map((t) => ({
      identity: t.identity,
      name: t.name,
      path: t.path ? sourcePath(t.path, root) : null,
      outcome: 'UNKNOWN',
    })),
    aggregate: [],
    perTest: value.tests.map((t) => ({
      identity: t.identity,
      targets: t.covers.map((c) => ({
        ...c,
        path: sourcePath(c.path, root),
        ...(c.lines
          ? { lines: [...new Set(c.lines)].sort((a, b) => a - b) }
          : {}),
      })),
    })),
    limitations: [
      'Per-test coverage is supplied by CI; file-only entries do not establish changed-line coverage.',
    ],
  };
}
export function parseArtifact(
  format: ArtifactFormat,
  content: string,
  root?: string,
): ParsedArtifact {
  if (!content.trim()) fail('Artifact is empty.');
  if (Buffer.byteLength(content, 'utf8') > ARTIFACT_MAX_BYTES)
    fail('Artifact exceeds the 2 MiB limit.');
  try {
    const result =
      format === 'JUNIT'
        ? junit(content, root)
        : format === 'ISTANBUL'
          ? istanbul(content, root)
          : format === 'LCOV'
            ? lcov(content, root)
            : format === 'PER_TEST'
              ? perTest(content, root)
              : fail('Unsupported artifact format.');
    if (
      result.aggregate.length > 10000 ||
      result.aggregate.reduce((n, f) => n + f.ranges.length, 0) > 100000 ||
      result.perTest.reduce((n, t) => n + t.targets.length, 0) > 100000
    )
      fail('Artifact exceeds the 10,000-file or 100,000-coverage-entry limit.');
    return result;
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    if (error instanceof z.ZodError)
      fail(
        'Artifact schema is invalid: ' +
          error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
      );
    fail('Malformed artifact. Check the selected format and JSON/XML syntax.');
  }
}

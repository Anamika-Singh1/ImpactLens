import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from './analyze';
import { dependents } from '@impactlens/shared';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../..',
        'fixtures/static-analysis',
        name + '.json',
      ),
      'utf8',
    ),
  );
const input = (files: Record<string, string>, commitSha = 'a'.repeat(40)) => ({
  commitSha,
  files: Object.entries(files).map(([path, contentText]) => ({
    path,
    contentText,
  })),
});
const base = analyzeSnapshot(input(fixture('base')));
describe('static snapshot analyzer', () => {
  it('matches the complete expected resolved module graph', () => {
    const actual = base.edges
      .filter(
        (e) =>
          e.to?.startsWith('file:') &&
          ['IMPORT', 'REEXPORT', 'DYNAMIC_IMPORT', 'REQUIRE'].includes(e.kind),
      )
      .map((e) => [e.evidence.filePath, e.kind, e.to!.slice(5)]);
    expect(actual.sort()).toEqual(fixture('expected').sort());
  });
  it('retains source evidence and direct imported symbols', () => {
    const symbol = base.nodes.find(
      (n) => n.name === 'sum' && n.kind === 'FUNCTION',
    )!;
    expect(symbol.evidence).toMatchObject({
      commitSha: 'a'.repeat(40),
      filePath: 'src/core/math.ts',
      startLine: 1,
      endLine: 3,
    });
    expect(base.edges).toContainEqual(
      expect.objectContaining({
        from: 'file:src/main.ts',
        to: symbol.id,
        kind: 'IMPORT_SYMBOL',
        resolution: 'SYMBOL',
      }),
    );
    expect(
      base.edges.find(
        (e) => e.kind === 'IMPORT' && e.from === 'file:src/main.ts',
      )?.evidence,
    ).toMatchObject({ startLine: 1, endLine: 1, relationship: 'IMPORT' });
    expect(
      base.edges.some((e) => e.kind === 'EXPORTS' && e.specifier === 'value'),
    ).toBe(true);
    expect(
      base.nodes.some((n) => n.kind === 'CLASS' && n.name === 'Calculator'),
    ).toBe(true);
  });
  it('traverses cycles once and leaves disconnected nodes isolated', () => {
    expect(dependents(base, 'file:src/cycle/a.ts')).toEqual([
      'file:src/barrel.ts',
      'file:src/cycle/b.ts',
      'file:src/main.ts',
    ]);
    expect(dependents(base, 'file:src/isolated.ts')).toEqual([]);
  });
  it('keeps deleted files in the old commit and missing imports in the new commit', () => {
    const head = analyzeSnapshot(input(fixture('head'), 'b'.repeat(40)));
    expect(base.nodes.some((n) => n.id === 'file:src/deleted.ts')).toBe(true);
    expect(head.nodes.some((n) => n.id === 'file:src/deleted.ts')).toBe(false);
    expect(head.edges).toContainEqual(
      expect.objectContaining({
        specifier: './deleted',
        to: null,
        resolution: 'UNKNOWN',
      }),
    );
    expect(dependents(base, 'file:src/deleted.ts')).toEqual([
      'file:src/main.ts',
    ]);
    expect(
      head.edges.every((e) => e.evidence.commitSha === 'b'.repeat(40)),
    ).toBe(true);
  });
  it('records dynamic unknowns, unsupported syntax and barrel fallbacks', () => {
    expect(base.edges).toContainEqual(
      expect.objectContaining({
        kind: 'DYNAMIC_IMPORT',
        to: null,
        specifier: '<non-literal>',
      }),
    );
    for (const code of [
      'UNKNOWN_DEPENDENCY',
      'UNRESOLVED_IMPORT',
      'SYNTAX_UNSUPPORTED',
      'SYMBOL_FALLBACK',
    ])
      expect(base.limitations.some((l) => l.code === code)).toBe(true);
  });
  it('extracts supported Express routes and middleware without shadowed receiver false positives', () => {
    expect(
      base.nodes.filter((n) => n.kind === 'ROUTE').map((n) => n.name),
    ).toEqual(['GET /items', 'POST /items', 'USE /api']);
    const auth = base.nodes.find((n) => n.name === 'auth')!;
    const handler = base.nodes.find((n) => n.name === 'handler')!;
    expect(
      base.edges.some((e) => e.kind === 'MIDDLEWARE' && e.to === auth.id),
    ).toBe(true);
    expect(
      base.edges.some((e) => e.kind === 'ROUTE_HANDLER' && e.to === handler.id),
    ).toBe(true);
    expect(
      base.limitations.filter((l) => l.code === 'ROUTE_UNSUPPORTED'),
    ).toHaveLength(2);
  });
  it('identifies JSX component declarations', () => {
    expect(
      base.nodes.filter((n) => n.kind === 'COMPONENT').map((n) => n.name),
    ).toEqual(['View', 'Badge', 'Panel']);
  });
  it('never executes source or configuration and reports invalid syntax', () => {
    const graph = analyzeSnapshot(
      input({
        'tsconfig.json':
          '{"extends":"./execute.js","compilerOptions":{"plugins":[{"name":"execute"}]}}',
        'execute.js': 'throw new Error("must not execute");',
        'bad.ts': 'export function broken( {',
      }),
    );
    expect(graph.limitations.some((l) => l.code === 'CONFIG_UNSUPPORTED')).toBe(
      true,
    );
    expect(graph.limitations.some((l) => l.code === 'SYNTAX_ERROR')).toBe(true);
  });
  it('supports nearest config, exact aliases, wildcards, index files and JS extension substitution', () => {
    const graph = analyzeSnapshot(
      input({
        'pkg/tsconfig.json':
          '{"compilerOptions":{"paths":{"@x":["lib"],"@x/*":["lib/*"]}}}',
        'pkg/lib/index.ts': 'export const x = 1;',
        'pkg/lib/value.ts': 'export default 2;',
        'pkg/main.ts':
          'import "@x"; import "@x/value"; import "./lib/value.js";',
      }),
    );
    expect(
      graph.edges.filter((e) => e.kind === 'IMPORT').map((e) => e.to),
    ).toEqual([
      'file:pkg/lib/index.ts',
      'file:pkg/lib/value.ts',
      'file:pkg/lib/value.ts',
    ]);
  });
  it('rejects unsafe snapshot paths and bounds input', () => {
    expect(() => analyzeSnapshot(input({ '../secret.ts': '' }))).toThrow(
      'unsafe paths',
    );
    expect(() =>
      analyzeSnapshot({
        commitSha: 'a',
        files: Array.from({ length: 5001 }, (_, i) => ({
          path: `${i}.ts`,
          contentText: '',
        })),
      }),
    ).toThrow('limits');
  });
  it('uses extension-specific substitution and does not infer baseUrl from paths', () => {
    const graph = analyzeSnapshot(
      input({
        'tsconfig.json': '{"compilerOptions":{"paths":{"@x":["x"]}}}',
        'main.ts': 'import "./x.mjs"; import "x";',
        'x.ts': '',
        'x.mts': '',
      }),
    );
    expect(
      graph.edges.filter((e) => e.kind === 'IMPORT').map((e) => e.to),
    ).toEqual(['file:x.mts', null]);
  });
  it('supports CommonJS Express factories and records unsupported computed methods', () => {
    const graph = analyzeSnapshot(
      input({
        'server.js':
          "const express = require('express'); const app = express(); app.get('/x', (req, res) => {}); app['post']('/x', handler); let router = express.Router(); let other = fetch('/');",
      }),
    );
    expect(
      graph.nodes.filter((n) => n.kind === 'ROUTE').map((n) => n.name),
    ).toEqual(['GET /x']);
    expect(
      graph.limitations.filter((l) => l.code === 'ROUTE_UNSUPPORTED'),
    ).toHaveLength(2);
  });
});

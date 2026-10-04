import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  defaultReviewRubric,
  type ImpactInput,
  type ImpactSnapshot,
} from '@impactlens/shared';
import { analyzeSnapshot } from './analyze';
import {
  analyzeImpact,
  diffSnapshots,
  impactHash,
  IMPACT_VERSION,
} from './impact';
const snapshot = (
  source: Record<string, string>,
  id: string,
): ImpactSnapshot => {
  const files = Object.entries(source).map(([path, contentText]) => ({
    path,
    contentText,
    contentHash: createHash('sha256').update(contentText).digest('hex'),
  }));
  return {
    id,
    commitSha: id.repeat(40),
    files,
    graph: analyzeSnapshot({ commitSha: id.repeat(40), files }),
    inventoryComplete: true,
  };
};
function input(
  base: Record<string, string>,
  head: Record<string, string>,
): ImpactInput {
  return {
    version: IMPACT_VERSION,
    semantics: {
      kind: 'TWO_COMMIT_TREES',
      repositoryId: 'repo',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      description: 'test',
    },
    base: snapshot(base, 'a'),
    head: snapshot(head, 'b'),
    features: [],
    mappings: [],
    tests: [],
    rubric: defaultReviewRubric,
  };
}
function map(data: ImpactInput, path: string) {
  const base = data.base.graph.nodes.find(
    (n) => n.filePath === path && n.kind === 'FUNCTION',
  )!;
  const head =
    data.head.graph.nodes.find(
      (n) => n.filePath === path && n.kind === 'FUNCTION',
    ) ?? null;
  data.features.push({
    id: 'checkout',
    version: 1,
    name: 'Checkout',
    criticality: 'CRITICAL',
  });
  data.mappings.push({
    id: 'mapping',
    version: 1,
    featureId: 'checkout',
    snapshotId: 'a',
    confirmedByLabel: 'Reviewer',
    confirmedAt: '2026-01-01T00:00:00.000Z',
    target: base,
    base: { node: base, reason: 'Resolved' },
    head: { node: head, reason: head ? 'Resolved' : 'Missing' },
  });
}
describe('change-impact analysis', () => {
  it('detects additions, deletions, modifications and unique exact-content renames', () => {
    const data = input(
      {
        'old.ts': 'export const old=1;',
        'edit.ts': 'a\nb\nc',
        'gone.ts': 'removed',
      },
      {
        'new.ts': 'export const old=1;',
        'edit.ts': 'a\nx\nc',
        'added.ts': 'added',
      },
    );
    expect(
      diffSnapshots(data)
        .map((c) => c.status)
        .sort(),
    ).toEqual(['ADDED', 'DELETED', 'MODIFIED', 'RENAMED']);
    expect(
      diffSnapshots(data).find((c) => c.status === 'MODIFIED'),
    ).toMatchObject({
      baseLines: [[2, 2]],
      headLines: [[2, 2]],
      precision: 'LINES',
    });
  });
  it('does not guess ambiguous rename pairs', () => {
    expect(
      diffSnapshots(
        input({ 'a.ts': 'same', 'b.ts': 'same' }, { 'c.ts': 'same' }),
      )
        .map((c) => c.status)
        .sort(),
    ).toEqual(['ADDED', 'DELETED', 'DELETED']);
  });
  it('handles insert-only and delete-only line changes', () => {
    const data = input(
      { 'a.ts': 'first\nlast' },
      { 'a.ts': 'first\ninsert\nlast' },
    );
    expect(diffSnapshots(data)[0]).toMatchObject({
      baseLines: [],
      headLines: [[2, 2]],
    });
    expect(
      diffSnapshots({ base: data.head, head: data.base })[0],
    ).toMatchObject({ baseLines: [[2, 2]], headLines: [] });
  });
  it('reports unavailable source and bounded diff fallback conservatively', () => {
    const data = input(
      { 'a.ts': Array(1100).fill('a').join('\n') },
      { 'a.ts': Array(1100).fill('b').join('\n') },
    );
    expect(diffSnapshots(data)[0]?.precision).toBe('FILE');
    data.base.files[0]!.contentText = null;
    expect(analyzeImpact(data).unknowns).toContainEqual(
      expect.objectContaining({ code: 'FILE_DIFF_FALLBACK' }),
    );
  });
  it('traces reverse imports through cycles and retains source evidence', () => {
    const base = {
      'core.ts': 'export const value=1;',
      'checkout.ts':
        "import { value } from './core';\nimport './cycle';\nexport function checkout() { return value; }",
      'cycle.ts': "import './checkout';",
      'unrelated.ts': 'export const x=1;',
    };
    const data = input(base, { ...base, 'core.ts': 'export const value=2;' });
    map(data, 'checkout.ts');
    const feature = analyzeImpact(data).features[0]!;
    expect(feature.kind).toBe('TRANSITIVE');
    expect(feature.confidence).toBe('LIMITED');
    expect(feature.paths).toHaveLength(2);
    expect(feature.paths[0]?.edges[0]?.evidence).toMatchObject({
      filePath: 'checkout.ts',
      startLine: 1,
      commitSha: 'a'.repeat(40),
    });
    expect(feature.paths.some((p) => p.changedPath === 'unrelated.ts')).toBe(
      false,
    );
  });
  it('uses base evidence for deleted mapped code', () => {
    const data = input(
      { 'checkout.ts': 'export function checkout() { return 1; }' },
      {},
    );
    map(data, 'checkout.ts');
    expect(analyzeImpact(data).features[0]?.paths).toEqual([
      expect.objectContaining({ side: 'base', kind: 'DIRECT' }),
    ]);
    expect(analyzeImpact(data).unknowns).toContainEqual(
      expect.objectContaining({ side: 'head', code: 'MAPPING_REVIEW' }),
    );
  });
  it('does not mark an unrelated same-file symbol as directly affected', () => {
    const data = input(
      {
        'a.ts':
          'export function checkout() { return 1; }\nexport const other=1;',
      },
      {
        'a.ts':
          'export function checkout() { return 1; }\nexport const other=2;',
      },
    );
    map(data, 'a.ts');
    expect(analyzeImpact(data).features).toEqual([]);
    expect(analyzeImpact(data).unknowns).toContainEqual(
      expect.objectContaining({ code: 'UNMAPPED_CHANGE' }),
    );
  });
  it('preserves unresolved mappings as limited evidence, not automatic confirmations', () => {
    const data = input(
      { 'a.ts': 'export function checkout() { return 1; }' },
      { 'a.ts': 'export function checkout() { return 2; }' },
    );
    map(data, 'a.ts');
    data.mappings[0]!.head = {
      node: null,
      reason: 'Changed source requires review',
    };
    const result = analyzeImpact(data);
    expect(result.features[0]?.paths).toContainEqual(
      expect.objectContaining({
        kind: 'UNRESOLVED',
        reason: 'Changed source requires review',
      }),
    );
    expect(result.features[0]?.confidence).toBe('LIMITED');
    expect(data.mappings[0]!.head.node).toBeNull();
  });
  it('does not let one passing test conceal failures or missing results', () => {
    const base = {
      'core.ts': 'export const value=1;',
      'checkout.ts':
        "import { value } from './core';\nexport function checkout() { return value; }",
      'checkout.test.ts': "import './checkout';",
      'checkout.spec.ts': "import './checkout';",
    };
    const data = input(base, { ...base, 'core.ts': 'export const value=2;' });
    map(data, 'checkout.ts');
    data.tests = [
      { id: '1', path: 'checkout.test.ts', snapshotId: 'b', outcome: 'PASSED' },
      { id: '2', path: 'checkout.spec.ts', snapshotId: 'a', outcome: 'PASSED' },
    ];
    const points = () =>
      analyzeImpact(data).features[0]!.priority.factors.find(
        (f) => f.name === 'Testing evidence',
      )!.points;
    expect(points()).toBe(defaultReviewRubric.testsWithoutPassingRun);
    data.tests[1]!.snapshotId = 'b';
    data.tests[1]!.outcome = 'FAILED';
    expect(points()).toBe(defaultReviewRubric.testsWithoutPassingRun);
    data.tests[1]!.outcome = 'PASSED';
    expect(points()).toBe(0);
  });
  it('labels config changes and incomplete inventories, including without mapped features', () => {
    const data = input(
      { 'package.json': '{}' },
      { 'package.json': '{"private":true}' },
    );
    data.base.inventoryComplete = false;
    const result = analyzeImpact(data);
    expect(result.broaderReview).toHaveLength(1);
    expect(result.unknowns).toContainEqual(
      expect.objectContaining({ code: 'PARTIAL_INVENTORY', side: 'base' }),
    );
    expect(result.features).toEqual([]);
  });
  it('is deterministic and treats identical trees as no changes', () => {
    const data = input(
      { 'a.ts': 'export const x=1;' },
      { 'a.ts': 'export const x=1;' },
    );
    expect(analyzeImpact(data).changes).toEqual([]);
    expect(impactHash(analyzeImpact(data))).toBe(
      impactHash(analyzeImpact(structuredClone(data))),
    );
    expect(impactHash({ a: 1, b: 2 })).toBe(impactHash({ b: 2, a: 1 }));
    expect(() => analyzeImpact({ ...data, version: 'bad' })).toThrow(
      'Unsupported',
    );
  });
});

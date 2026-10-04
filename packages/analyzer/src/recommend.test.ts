import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  defaultReviewRubric,
  type ImpactInput,
  type TestArtifact,
} from '@impactlens/shared';
import { analyzeSnapshot } from './analyze';
import { analyzeImpact, IMPACT_VERSION, impactHash } from './impact';
function input(): ImpactInput {
  const snapshot = (id: string, value: number) => {
    const files = [
      {
        path: 'src/checkout.ts',
        contentText: `export function checkout() {\n return ${value};\n}`,
      },
    ].map((f) => ({
      ...f,
      contentHash: createHash('sha256').update(f.contentText).digest('hex'),
    }));
    return {
      id,
      commitSha: id.repeat(40),
      files,
      graph: analyzeSnapshot({ commitSha: id.repeat(40), files }),
      inventoryComplete: true,
    };
  };
  const base = snapshot('a', 1),
    head = snapshot('b', 2),
    node = base.graph.nodes.find((n) => n.kind === 'FUNCTION')!;
  return {
    version: IMPACT_VERSION,
    semantics: {
      kind: 'TWO_COMMIT_TREES',
      repositoryId: 'repo',
      baseSha: base.commitSha,
      headSha: head.commitSha,
      description: 'test',
    },
    base,
    head,
    features: [
      { id: 'feature', name: 'Checkout', criticality: 'HIGH', version: 1 },
    ],
    mappings: [
      {
        id: 'map',
        featureId: 'feature',
        version: 1,
        snapshotId: 'a',
        confirmedByLabel: 'Reviewer',
        confirmedAt: '2026-09-01T00:00:00Z',
        target: node,
        base: { node, reason: 'Resolved' },
        head: { node: null, reason: 'Changed' },
      },
    ],
    tests: [],
    rubric: defaultReviewRubric,
    testEvidence: {
      asOf: '2026-09-30T00:00:00Z',
      staleAfterDays: 30,
      artifacts: [],
      mappings: [],
    },
  };
}
function artifact(format: TestArtifact['format'] = 'PER_TEST'): TestArtifact {
  return {
    id: 'artifact',
    format,
    commitSha: 'b'.repeat(40),
    runner: 'vitest',
    recordedAt: '2026-09-29T00:00:00Z',
    importedAt: '2026-09-30T00:00:00Z',
    filename: 'report.json',
    source: 'CI build 17',
    sourceRoot: null,
    contentHash: 'c'.repeat(64),
    parsed: { tests: [], aggregate: [], perTest: [], limitations: [] },
  };
}
function covered(data: ImpactInput) {
  const a = artifact();
  a.parsed.tests = [
    {
      identity: 'checkout-success',
      name: 'Checkout succeeds',
      path: 'test.ts',
      outcome: 'UNKNOWN',
    },
  ];
  a.parsed.perTest = [
    {
      identity: 'checkout-success',
      targets: [{ path: 'src/checkout.ts', lines: [2] }],
    },
  ];
  data.testEvidence!.artifacts.push(a);
  return a;
}
describe('evidence-backed test recommendations', () => {
  it('does not invent individual tests from aggregate coverage or JUnit outcomes', () => {
    const data = input();
    const a = artifact('LCOV');
    a.parsed.aggregate = [
      { path: 'src/checkout.ts', ranges: [{ start: 2, end: 2, hits: 1 }] },
    ];
    const junit = artifact('JUNIT');
    junit.id = 'junit';
    junit.parsed.tests = [
      {
        identity: 'checkout-success',
        name: 'Checkout succeeds',
        path: 'test.ts',
        outcome: 'PASSED',
      },
    ];
    data.testEvidence!.artifacts = [a, junit];
    const review = analyzeImpact(data).testReview!;
    expect(review.recommendations.map((r) => r.kind)).toEqual(['WEAK']);
    expect(review.gaps.map((g) => g.code)).toContain('NO_INDIVIDUAL_MAPPING');
    expect(review.gaps.map((g) => g.code)).not.toContain('NOT_EXERCISED');
  });
  it('selects known tests with direct changed-line evidence and traceable provenance', () => {
    const data = input();
    covered(data);
    const r = analyzeImpact(data).testReview!.recommendations[0]!;
    expect(r).toMatchObject({
      identity: 'checkout-success',
      featureId: 'feature',
      kind: 'DIRECT',
    });
    expect(r.evidence[0]).toMatchObject({
      artifactId: 'artifact',
      path: 'src/checkout.ts',
      ageDays: 1,
      commitMatch: true,
      stale: false,
      source: 'CI build 17',
    });
  });
  it('never aligns base coverage to head lines or treats old uploads as fresh', () => {
    for (const mismatch of ['commit', 'age']) {
      const data = input();
      const a = covered(data);
      if (mismatch === 'commit') a.commitSha = data.base.commitSha;
      else a.recordedAt = '2026-07-01T00:00:00Z';
      const review = analyzeImpact(data).testReview!;
      expect(review.recommendations[0]!.kind).toBe('INFERRED');
      expect(review.gaps.map((g) => g.code)).toContain('STALE');
      expect(review.broaderRun.length).toBeGreaterThan(0);
    }
  });
  it('distinguishes no artifacts, unexercised changes and no individual mapping', () => {
    const data = input();
    let review = analyzeImpact(data).testReview!;
    expect(review.gaps.map((g) => g.code)).toEqual(
      expect.arrayContaining(['NO_ARTIFACT', 'NO_INDIVIDUAL_MAPPING']),
    );
    const a = artifact('ISTANBUL');
    a.parsed.aggregate = [
      { path: 'src/checkout.ts', ranges: [{ start: 2, end: 2, hits: 0 }] },
    ];
    data.testEvidence!.artifacts = [a];
    review = analyzeImpact(data).testReview!;
    expect(review.gaps.map((g) => g.code)).toContain('NOT_EXERCISED');
    expect(review.gaps.map((g) => g.code)).not.toContain('NO_ARTIFACT');
    expect(review.recommendations).toEqual([]);
  });
  it('supports manual associations without claiming coverage', () => {
    const data = input();
    const a = artifact('JUNIT');
    a.parsed.tests = [
      {
        identity: 'opaque-id',
        name: 'Scenario 19',
        path: null,
        outcome: 'PASSED',
      },
    ];
    data.testEvidence!.artifacts = [a];
    data.testEvidence!.mappings = [
      {
        id: 'manual',
        featureId: 'feature',
        artifactId: a.id,
        testIdentity: 'opaque-id',
        runner: 'vitest',
        actorLabel: 'Engineer',
        createdAt: '2026-09-29T12:00:00Z',
        rationale: 'Exercises the checkout acceptance criteria',
      },
    ];
    const r = analyzeImpact(data).testReview!.recommendations[0]!;
    expect(r.kind).toBe('MANUAL');
    expect(r.reason).toContain('acceptance');
    expect(r.evidence[0]!.mappingId).toBe('manual');
    expect(analyzeImpact(data).testReview!.gaps.map((g) => g.code)).toContain(
      'NO_ARTIFACT',
    );
  });
  it('treats file-only coverage as inferred and matches symbols explicitly', () => {
    const data = input();
    const a = covered(data);
    a.parsed.perTest[0]!.targets = [{ path: 'src/checkout.ts' }];
    expect(analyzeImpact(data).testReview!.recommendations[0]!.kind).toBe(
      'INFERRED',
    );
    a.parsed.perTest[0]!.targets = [
      {
        path: 'src/checkout.ts',
        symbol: { name: 'checkout', startLine: 1, endLine: 3 },
      },
    ];
    expect(analyzeImpact(data).testReview!.recommendations[0]!.kind).toBe(
      'DIRECT',
    );
    expect(analyzeImpact(data).testReview!.gaps.map((g) => g.code)).toContain(
      'NOT_EXERCISED',
    );
  });
  it('does not upgrade disjoint line evidence to direct coverage', () => {
    const data = input();
    const a = covered(data);
    a.parsed.perTest[0]!.targets = [{ path: 'src/checkout.ts', lines: [1] }];
    expect(
      analyzeImpact(data).testReview!.recommendations.map((r) => r.kind),
    ).toEqual(['WEAK']);
  });
  it('preserves frozen recommendation age and legacy comparisons', () => {
    const data = input();
    covered(data);
    expect(impactHash(analyzeImpact(data))).toBe(
      impactHash(analyzeImpact(structuredClone(data))),
    );
    delete data.testEvidence;
    data.version = '6.0.0';
    expect(analyzeImpact(data).version).toBe('6.0.0');
    expect(analyzeImpact(data).testReview).toBeUndefined();
  });
});

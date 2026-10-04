import {
  reviewNeedsNote,
  reviewReadiness,
  type ImpactResult,
} from '@impactlens/shared';
const clean: ImpactResult = {
  version: 'test',
  changes: [],
  features: [],
  unknowns: [],
  broaderReview: [],
  statement: 'Recorded facts',
};
describe('review evidence policy', () => {
  it('requires rationale for concerns, negative decisions and overrides', () => {
    const recorded = reviewReadiness(clean);
    expect(reviewNeedsNote('APPROVED', recorded)).toBe(false);
    expect(reviewNeedsNote('CHANGES_REQUESTED', recorded)).toBe(true);
    expect(reviewNeedsNote('NEEDS_MORE_EVIDENCE', recorded)).toBe(true);
    expect(reviewNeedsNote('APPROVED', recorded, 'NEEDS_MORE_EVIDENCE')).toBe(
      true,
    );
    const partial = reviewReadiness({
      ...clean,
      unknowns: [{ code: 'UNRESOLVED', message: 'Unknown import' }],
    });
    expect(partial.state).toBe('PARTIAL');
    expect(reviewNeedsNote('APPROVED', partial)).toBe(true);
  });
  it('requires consideration of high priority, unresolved mappings and nonpassing tests', () => {
    const feature = {
      featureId: 'feature',
      name: 'Checkout',
      criticality: 'CRITICAL' as const,
      kind: 'UNRESOLVED' as const,
      confidence: 'LIMITED' as const,
      paths: [],
      tests: [{ path: 'checkout.test.ts', outcomes: ['FAILED'] }],
      priority: { score: 60, factors: [] },
    };
    const readiness = reviewReadiness({ ...clean, features: [feature] });
    expect(readiness.concerns.map((c) => c.code)).toEqual([
      'HIGH_PRIORITY',
      'UNRESOLVED_FEATURE',
      'TEST_RESULTS',
    ]);
    expect(readiness.state).toBe('PARTIAL');
    const highOnly = reviewReadiness({
      ...clean,
      features: [
        {
          ...feature,
          kind: 'DIRECT',
          confidence: 'HIGH',
          tests: [{ path: 'checkout.test.ts', outcomes: ['PASSED'] }],
        },
      ],
    });
    expect(highOnly.state).toBe('RECORDED');
    expect(reviewNeedsNote('APPROVED', highOnly)).toBe(true);
  });
});

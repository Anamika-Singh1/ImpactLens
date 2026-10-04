import type { ImpactResult, ImpactInput } from './impact';
export const reviewOutcomes = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'NEEDS_MORE_EVIDENCE',
] as const;
export type ReviewOutcome = (typeof reviewOutcomes)[number];
export const reviewLabels: Record<ReviewOutcome | string, string> = {
  APPROVED: 'Approve',
  CHANGES_REQUESTED: 'Request Changes',
  NEEDS_MORE_EVIDENCE: 'Needs More Evidence',
  ACKNOWLEDGED: 'Legacy acknowledgement',
};
export interface ReviewConcern {
  code: string;
  message: string;
  featureId?: string;
}
export interface ReviewReadiness {
  state: 'RECORDED' | 'PARTIAL';
  highPriorityThreshold: number;
  concerns: ReviewConcern[];
}
export interface ReleaseReview {
  id: string;
  analysisId: string;
  revision: number;
  outcome: string;
  comment: string | null;
  createdAt: string;
  reviewerId: string;
  reviewerLabel: string | null;
  baseSha: string | null;
  headSha: string | null;
  analysisResultHash: string | null;
  isOverride: boolean;
  recordVersion: number;
  concerns: ReviewConcern[] | null;
}
export interface ReviewState {
  analysisId: string;
  baseSha: string;
  headSha: string;
  resultHash: string;
  readiness: ReviewReadiness;
  latest: ReleaseReview | null;
  items: ReleaseReview[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReleaseReport {
  version: 1;
  exportedAt: string;
  disclaimer: string;
  repository: { id: string; owner: string; name: string };
  analysis: {
    id: string;
    baseSha: string;
    headSha: string;
    createdAt: string;
    engineVersion: string;
    inputHash: string;
    resultHash: string;
    semantics: ImpactInput['semantics'];
  };
  readiness: ReviewReadiness;
  findings: ImpactResult;
  testResults: ImpactInput['tests'];
  testEvidence: ImpactInput['testEvidence'] | null;
  reviews: ReleaseReview[];
  audit: {
    id: string;
    action: string;
    actorId: string | null;
    actorLabel: string | null;
    targetId: string | null;
    createdAt: string;
  }[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function reviewReadiness(result: ImpactResult): ReviewReadiness {
  const concerns: ReviewConcern[] = [];
  for (const feature of result.features) {
    if (feature.priority.score >= 60)
      concerns.push({
        code: 'HIGH_PRIORITY',
        featureId: feature.featureId,
        message: `${feature.name} has review priority ${feature.priority.score}; record how its evidence was considered.`,
      });
    if (feature.confidence === 'LIMITED' || feature.kind === 'UNRESOLVED')
      concerns.push({
        code: 'UNRESOLVED_FEATURE',
        featureId: feature.featureId,
        message: `${feature.name} has limited or unresolved impact evidence.`,
      });
    if (
      !feature.tests.length ||
      feature.tests.some(
        (t) => !t.outcomes.length || t.outcomes.some((o) => o !== 'PASSED'),
      )
    )
      concerns.push({
        code: 'TEST_RESULTS',
        featureId: feature.featureId,
        message: `${feature.name} lacks passing recorded results for all statically linked tests.`,
      });
  }
  if (result.unknowns.length)
    concerns.push({
      code: 'ANALYSIS_UNKNOWNS',
      message: `${result.unknowns.length} analysis limitations or unknowns remain.`,
    });
  if (result.broaderReview.length)
    concerns.push({
      code: 'BROADER_REVIEW',
      message: 'The analyzer requests broader regression review.',
    });
  if (result.changes.some((c) => c.precision === 'FILE'))
    concerns.push({
      code: 'FILE_PRECISION',
      message: 'Some changes support whole-file review only.',
    });
  if (result.testReview?.gaps.length)
    concerns.push({
      code: 'COVERAGE_GAPS',
      message: `${result.testReview.gaps.length} test-evidence gaps remain.`,
    });
  if (result.changes.length && !result.features.length)
    concerns.push({
      code: 'UNMAPPED_CHANGES',
      message:
        'Changed code has no affected confirmed business-feature mappings.',
    });
  return {
    state: concerns.some((c) => c.code !== 'HIGH_PRIORITY')
      ? 'PARTIAL'
      : 'RECORDED',
    highPriorityThreshold: 60,
    concerns,
  };
}
export function reviewNeedsNote(
  outcome: ReviewOutcome,
  readiness: ReviewReadiness,
  previous?: string | null,
) {
  return (
    outcome !== 'APPROVED' ||
    readiness.concerns.length > 0 ||
    !!(previous && previous !== outcome)
  );
}

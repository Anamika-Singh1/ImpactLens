export const artifactFormats = [
  'JUNIT',
  'ISTANBUL',
  'LCOV',
  'PER_TEST',
] as const;
export type ArtifactFormat = (typeof artifactFormats)[number];
export interface ImportedTest {
  identity: string;
  name: string;
  path: string | null;
  outcome: 'PASSED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';
}
export interface CoverageFile {
  path: string;
  ranges: { start: number; end: number; hits: number }[];
}
export interface TestCoverageTarget {
  path: string;
  lines?: number[];
  symbol?: { name: string; startLine: number; endLine: number };
}
export interface ParsedArtifact {
  tests: ImportedTest[];
  aggregate: CoverageFile[];
  perTest: { identity: string; targets: TestCoverageTarget[] }[];
  limitations: string[];
}
export interface TestArtifact {
  id: string;
  format: ArtifactFormat;
  commitSha: string;
  runner: string;
  recordedAt: string;
  importedAt: string;
  filename: string;
  source: string;
  contentHash: string;
  sourceRoot: string | null;
  parsed: ParsedArtifact;
}
export interface ExplicitTestMapping {
  id: string;
  featureId: string;
  artifactId: string;
  testIdentity: string;
  runner: string;
  rationale: string;
  actorLabel: string;
  createdAt: string;
}
export interface TestEvidenceInput {
  asOf: string;
  staleAfterDays: number;
  artifacts: TestArtifact[];
  mappings: ExplicitTestMapping[];
}
export interface RecommendationEvidence {
  artifactId: string;
  filename: string;
  contentHash: string;
  source: string;
  commitSha: string;
  recordedAt: string;
  ageDays: number;
  stale: boolean;
  commitMatch: boolean;
  path?: string;
  mappingId?: string;
  detail: string;
}
export interface RecommendedTest {
  identity: string;
  name: string;
  runner: string;
  featureId: string | null;
  featureName: string;
  kind: 'DIRECT' | 'INFERRED' | 'MANUAL' | 'WEAK';
  reason: string;
  evidence: RecommendationEvidence[];
}
export interface TestReview {
  recommendations: RecommendedTest[];
  gaps: {
    code:
      | 'NO_ARTIFACT'
      | 'NOT_EXERCISED'
      | 'NO_INDIVIDUAL_MAPPING'
      | 'STALE'
      | 'INCOMPLETE';
    path?: string;
    message: string;
  }[];
  broaderRun: string[];
  asOf: string;
}

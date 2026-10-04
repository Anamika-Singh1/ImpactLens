import type { Criticality, MappingTarget } from './features';
import type { GraphEdge, GraphNode, SnapshotGraph } from './graph';
import type { TestEvidenceInput, TestReview } from './test-evidence';

export interface ImpactFile {
  path: string;
  contentHash: string;
  contentText: string | null;
}
export interface ImpactSnapshot {
  id: string;
  commitSha: string;
  files: ImpactFile[];
  graph: SnapshotGraph;
  inventoryComplete: boolean;
}
export interface ImpactMapping {
  id: string;
  version: number;
  featureId: string;
  snapshotId: string;
  confirmedByLabel: string;
  confirmedAt: string;
  target: MappingTarget;
  base: { node: GraphNode | null; reason: string };
  head: { node: GraphNode | null; reason: string };
}
export const defaultReviewRubric = {
  criticality: { LOW: 5, MEDIUM: 15, HIGH: 25, CRITICAL: 35 },
  direct: 25,
  transitive: 15,
  unresolved: 10,
  sharedReachPerFile: 2,
  sharedReachCap: 15,
  noTests: 10,
  testsWithoutPassingRun: 5,
  uncertainty: 15,
};
export type ReviewRubric = typeof defaultReviewRubric;
export interface ImpactInput {
  testEvidence?: TestEvidenceInput;
  version: string;
  semantics: {
    kind: 'TWO_COMMIT_TREES' | 'PR_MERGE_BASE';
    repositoryId: string;
    baseSha: string;
    headSha: string;
    pullRequest?: number;
    pullBaseSha?: string;
    headRepositoryId?: string;
    description: string;
  };
  base: ImpactSnapshot;
  head: ImpactSnapshot;
  features: {
    id: string;
    name: string;
    version: number;
    criticality: Criticality;
  }[];
  mappings: ImpactMapping[];
  tests: { id: string; path: string; snapshotId: string; outcome: string }[];
  rubric: ReviewRubric;
}
export interface ChangedFile {
  status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  basePath: string | null;
  headPath: string | null;
  baseLines: [number, number][];
  headLines: [number, number][];
  baseSymbols: GraphNode[];
  headSymbols: GraphNode[];
  precision: 'LINES' | 'FILE';
}
export interface ImpactPath {
  side: 'base' | 'head';
  commitSha: string;
  changedPath: string;
  changedLines: [number, number][];
  symbols: GraphNode[];
  mappingId: string;
  mappingVersion: number;
  confirmedBy: string;
  mappingSnapshotId: string;
  target: MappingTarget;
  kind: 'DIRECT' | 'TRANSITIVE' | 'UNRESOLVED';
  edges: GraphEdge[];
  reason: string;
}
export interface FeatureImpact {
  featureId: string;
  name: string;
  criticality: Criticality;
  kind: ImpactPath['kind'];
  confidence: 'HIGH' | 'LIMITED';
  paths: ImpactPath[];
  tests: { path: string; outcomes: string[] }[];
  priority: {
    score: number;
    factors: { name: string; points: number; reason: string }[];
  };
}
export interface ImpactResult {
  testReview?: TestReview;
  version: string;
  changes: ChangedFile[];
  features: FeatureImpact[];
  unknowns: {
    code: string;
    message: string;
    side?: 'base' | 'head';
    filePath?: string;
  }[];
  broaderReview: string[];
  statement: string;
}

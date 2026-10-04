import type { GraphNode, GraphEdge } from './graph';
export const criticalities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Criticality = (typeof criticalities)[number];
export type MappingTarget = GraphNode & { analyzerVersion?: string };
export interface MappingResolution {
  status: 'RESOLVED' | 'STALE' | 'NEEDS_REVIEW';
  reason: string;
  node: GraphNode | null;
  candidates: GraphNode[];
}
export interface MappingView {
  id: string;
  snapshotId: string;
  fileId: string;
  nodeId: string;
  rationale: string;
  status: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED' | 'NEEDS_REVIEW';
  origin: string;
  version: number;
  target: MappingTarget | null;
  confirmedByLabel: string | null;
  confirmedAt: string | null;
  heuristic: {
    explanation: string;
    matched: string[];
    score: number;
    evidence: GraphNode['evidence'];
  } | null;
  file: { path: string };
  resolution: MappingResolution;
  history: {
    id: string;
    revision: number;
    action: string;
    actorLabel: string;
    snapshotId: string;
    createdAt: string;
    state: {
      status?: string;
      rationale?: string;
      target?: MappingTarget | null;
      confirmedByLabel?: string | null;
    };
  }[];
}
export interface FeatureSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  criticality: Criticality;
  responsibleTeam: string | null;
  customerWorkflow: string | null;
  version: number;
  mappingCounts: {
    confirmed: number;
    suggested: number;
    stale: number;
    needsReview: number;
    rejected: number;
  };
}
export interface FeatureDetail extends FeatureSummary {
  mappings: MappingView[];
  snapshot: { id: string; commitSha: string } | null;
  linkedTests: {
    path: string;
    basis: string;
    cases: { id: string; name: string; outcome: string }[];
  }[];
  dependencies: {
    mappingId: string;
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
    dependents: string[];
  }[];
  graphNodes: GraphNode[];
}

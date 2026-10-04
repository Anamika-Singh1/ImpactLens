export interface RepositoryEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
  nodeId?: string;
  label: string;
}
export interface RepositoryOverviewData {
  version: string;
  summary: string;
  purpose: string;
  sourceFileCount: number;
  retainedFileCount: number;
  directories: { name: string; files: number }[];
  languages: { name: string; files: number }[];
  technologies: {
    name: string;
    kind: string;
    reason: string;
    evidence: RepositoryEvidence[];
  }[];
  packageManagers: { name: string; evidence: RepositoryEvidence[] }[];
  dependencies: {
    name: string;
    declaredVersion: string;
    resolvedVersions: string[];
    scope: 'production' | 'development' | 'optional' | 'peer';
    manifest: string;
    lockfile: string | null;
  }[];
  routes: {
    method: string;
    path: string;
    handler: string[];
    middleware: string[];
    evidence: RepositoryEvidence;
    limitations: string[];
  }[];
  suggestions: {
    key: string;
    name: string;
    explanation: string;
    reason: string;
    evidence: RepositoryEvidence[];
  }[];
  limitations: string[];
}
export interface ImplementationMatch {
  filePath: string;
  nodeId?: string;
  label: string;
  kind: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  reasons: string[];
  status: 'CANDIDATE' | 'CONFIRMED_MAPPING';
}

export type NodeKind =
  | 'FILE'
  | 'FUNCTION'
  | 'CLASS'
  | 'SYMBOL'
  | 'COMPONENT'
  | 'ROUTE';
export type Relationship =
  | 'CONTAINS'
  | 'EXPORTS'
  | 'IMPORT'
  | 'REEXPORT'
  | 'DYNAMIC_IMPORT'
  | 'REQUIRE'
  | 'IMPORT_SYMBOL'
  | 'ROUTE_HANDLER'
  | 'MIDDLEWARE';
export interface GraphEvidence {
  commitSha: string;
  filePath: string;
  startLine: number;
  endLine: number;
  relationship: Relationship | 'DEFINITION' | 'LIMITATION';
}
export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  filePath: string;
  exported: boolean;
  evidence: GraphEvidence;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string | null;
  kind: Relationship;
  specifier: string;
  resolution: 'SYMBOL' | 'FILE' | 'UNKNOWN';
  limitation?: string;
  evidence: GraphEvidence;
}
export interface SnapshotGraph {
  version: string;
  commitSha: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  limitations: { code: string; message: string; evidence: GraphEvidence }[];
}
export const dependencyKinds: readonly Relationship[] = [
  'IMPORT',
  'REEXPORT',
  'DYNAMIC_IMPORT',
  'REQUIRE',
  'IMPORT_SYMBOL',
  'ROUTE_HANDLER',
  'MIDDLEWARE',
];
/** Reverse reachability excludes structural edges and the starting node, even in cycles. */
export function dependents(graph: SnapshotGraph, nodeId: string): string[] {
  const reverse = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!edge.to || !dependencyKinds.includes(edge.kind)) continue;
    const incoming = reverse.get(edge.to) ?? new Set<string>();
    incoming.add(edge.from);
    reverse.set(edge.to, incoming);
  }
  const seen = new Set([nodeId]),
    pending = [nodeId];
  for (let index = 0; index < pending.length; index++) {
    for (const id of reverse.get(pending[index]!) ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        pending.push(id);
      }
    }
  }
  return pending.slice(1).sort();
}

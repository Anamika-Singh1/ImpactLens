import { createHash } from 'node:crypto';
import type {
  GraphNode,
  MappingResolution,
  MappingTarget,
  SnapshotGraph,
} from '@impactlens/shared';
export interface MappingFile {
  id: string;
  path: string;
  contentText: string | null;
}
export const fingerprint = (
  node: GraphNode,
  file: MappingFile,
): string | null => {
  if (file.contentText === null) return null;
  const lines = file.contentText.split('\n');
  if (
    node.evidence.startLine < 1 ||
    node.evidence.endLine > lines.length ||
    node.evidence.endLine < node.evidence.startLine
  )
    return null;
  const text =
    node.kind === 'FILE'
      ? file.contentText
      : lines
          .slice(node.evidence.startLine - 1, node.evidence.endLine)
          .join('\n');
  return createHash('sha256').update(text).digest('hex');
};
export function fileNode(file: MappingFile, commitSha: string): GraphNode {
  return {
    id: 'file:' + file.path,
    kind: 'FILE',
    name: file.path,
    filePath: file.path,
    exported: false,
    evidence: {
      commitSha,
      filePath: file.path,
      startLine: 1,
      endLine: (file.contentText ?? '').split('\n').length,
      relationship: 'DEFINITION',
    },
  };
}
export function resolveMapping(
  target: MappingTarget | null,
  anchorHash: string | null,
  files: MappingFile[],
  graph: SnapshotGraph | null,
  commitSha: string,
): MappingResolution {
  const result = (
    status: MappingResolution['status'],
    reason: string,
    node: GraphNode | null = null,
    candidates: GraphNode[] = [],
  ): MappingResolution => ({
    status,
    reason,
    node,
    candidates: candidates.slice(0, 10),
  });
  if (!target || !anchorHash)
    return result(
      'NEEDS_REVIEW',
      'This mapping has no recorded source anchor or confirmer. Select its target and confirm it.',
    );
  const file = files.find((f) => f.path === target.filePath);
  if (!file) {
    const candidates =
      target.kind === 'FILE'
        ? files
            .filter(
              (f) => fingerprint(fileNode(f, commitSha), f) === anchorHash,
            )
            .map((f) => fileNode(f, commitSha))
        : (graph?.nodes.filter(
            (n) => n.kind === target.kind && n.name === target.name,
          ) ?? []);
    return result(
      'STALE',
      'The mapped file is absent or moved in this snapshot. Possible replacements require explicit review.',
      null,
      candidates,
    );
  }
  if (target.kind === 'FILE') {
    const node = fileNode(file, commitSha);
    return fingerprint(node, file) === anchorHash
      ? result(
          'RESOLVED',
          'Same file path and retained source as the confirmed/suggested anchor.',
          node,
        )
      : result(
          'NEEDS_REVIEW',
          'File content changed or is unavailable. Review before confirming this snapshot.',
          null,
          [node],
        );
  }
  if (!graph)
    return result(
      'NEEDS_REVIEW',
      'Analyze this snapshot before resolving symbols or routes.',
    );
  const matches = graph.nodes.filter(
    (n) =>
      n.filePath === target.filePath &&
      n.kind === target.kind &&
      n.name === target.name,
  );
  if (!matches.length)
    return result(
      'STALE',
      'The mapped symbol or route disappeared, moved or was renamed. Review a replacement.',
      null,
      graph.nodes.filter(
        (n) => n.kind === target.kind && n.name === target.name,
      ),
    );
  if (matches.length !== 1)
    return result(
      'NEEDS_REVIEW',
      'Multiple declarations match this name and kind; resolution is ambiguous.',
      null,
      matches,
    );
  if (
    graph.limitations.some(
      (l) => l.code === 'SYNTAX_ERROR' && l.evidence.filePath === file.path,
    )
  )
    return result(
      'NEEDS_REVIEW',
      'Source has syntax errors; symbol identity is uncertain.',
      null,
      matches,
    );
  if (target.analyzerVersion && target.analyzerVersion !== graph.version)
    return result(
      'NEEDS_REVIEW',
      'Analyzer version changed. Review the extracted target.',
      null,
      matches,
    );
  const node = matches[0]!;
  return fingerprint(node, file) === anchorHash
    ? result(
        'RESOLVED',
        'Unique name/kind in the same file with unchanged declaration source; line shifts are allowed.',
        node,
      )
    : result(
        'NEEDS_REVIEW',
        'Declaration source changed or is unavailable. Review the target.',
        null,
        matches,
      );
}
const stopwords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'user',
  'users',
  'customer',
  'customers',
  'feature',
  'workflow',
  'src',
  'test',
  'tests',
  'index',
  'return',
  'function',
]);
export function tokens(text: string) {
  return [
    ...new Set(
      text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !stopwords.has(word)),
    ),
  ];
}
export function suggestTargets(
  feature: {
    name: string;
    description: string | null;
    customerWorkflow: string | null;
  },
  graph: SnapshotGraph,
) {
  const words = tokens(
    [feature.name, feature.description, feature.customerWorkflow].join(' '),
  );
  return graph.nodes
    .map((node) => {
      const nameWords = tokens(node.name),
        pathWords = tokens(node.filePath);
      const matched = words.filter(
        (word) => nameWords.includes(word) || pathWords.includes(word),
      );
      const score = matched.reduce(
        (sum, word) => sum + (nameWords.includes(word) ? 2 : 1),
        0,
      );
      return {
        node,
        score,
        matched,
        explanation: `Unconfirmed name/path heuristic: ${matched.map((w) => '“' + w + '”').join(', ')} match ${node.kind === 'ROUTE' ? 'route' : node.kind.toLowerCase()} ${node.name} at ${node.filePath}:${node.evidence.startLine}. This is lexical overlap, not verified business behavior.`,
        evidence: node.evidence,
      };
    })
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .slice(0, 30);
}

import { createHash } from 'node:crypto';
import { recommendTests } from './recommend';
import {
  dependencyKinds,
  type ImpactInput,
  type ImpactResult,
  type ImpactFile,
  type ChangedFile,
  type GraphEdge,
  type ImpactPath,
  type FeatureImpact,
  type SnapshotGraph,
} from '@impactlens/shared';
export const IMPACT_VERSION = '7.0.0';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const impactHash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
function ranges(lines: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else out.push([line, line]);
  }
  return out;
}
// Bounded LCS line diff. Large edits use a labeled conservative changed envelope.
function lines(
  a?: ImpactFile,
  b?: ImpactFile,
): Pick<ChangedFile, 'baseLines' | 'headLines' | 'precision'> {
  const aa = a?.contentText?.split('\n'),
    bb = b?.contentText?.split('\n');
  if ((a && !aa) || (b && !bb))
    return {
      baseLines: a ? [[1, aa?.length ?? 1]] : [],
      headLines: b ? [[1, bb?.length ?? 1]] : [],
      precision: 'FILE',
    };
  const x = aa ?? [],
    y = bb ?? [];
  let start = 0,
    endX = x.length,
    endY = y.length;
  while (start < endX && start < endY && x[start] === y[start]) start++;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const n = endX - start,
    m = endY - start;
  if (!n || !m)
    return {
      baseLines: n ? [[start + 1, endX]] : [],
      headLines: m ? [[start + 1, endY]] : [],
      precision: 'LINES',
    };
  if (n * m > 1000000)
    return {
      baseLines: n ? [[start + 1, endX]] : [],
      headLines: m ? [[start + 1, endY]] : [],
      precision: 'FILE',
    };
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * (m + 1) + j] =
        x[start + i] === y[start + j]
          ? 1 + dp[(i + 1) * (m + 1) + j + 1]!
          : Math.max(dp[(i + 1) * (m + 1) + j]!, dp[i * (m + 1) + j + 1]!);
  let i = 0,
    j = 0;
  const removed: number[] = [],
    added: number[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && x[start + i] === y[start + j]) {
      i++;
      j++;
    } else if (
      i < n &&
      (j === m || dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!)
    )
      removed.push(start + ++i);
    else added.push(start + ++j);
  }
  return {
    baseLines: ranges(removed),
    headLines: ranges(added),
    precision: 'LINES',
  };
}
function symbols(
  graph: SnapshotGraph,
  path: string | null,
  changed: [number, number][],
) {
  return graph.nodes.filter(
    (n) =>
      n.kind !== 'FILE' &&
      n.filePath === path &&
      changed.some(
        ([a, b]) => a <= n.evidence.endLine && b >= n.evidence.startLine,
      ),
  );
}
export function diffSnapshots(
  input: Pick<ImpactInput, 'base' | 'head'>,
): ChangedFile[] {
  const a = new Map(input.base.files.map((f) => [f.path, f])),
    b = new Map(input.head.files.map((f) => [f.path, f]));
  const deleted = [...a.values()].filter((f) => !b.has(f.path)),
    added = [...b.values()].filter((f) => !a.has(f.path));
  const paired = new Set<string>();
  const changes: ChangedFile[] = [];
  const add = (
    status: ChangedFile['status'],
    old?: ImpactFile,
    next?: ImpactFile,
  ) => {
    const diff = lines(old, next);
    if (status === 'RENAMED') {
      diff.baseLines = [[1, old?.contentText?.split('\n').length ?? 1]];
      diff.headLines = [[1, next?.contentText?.split('\n').length ?? 1]];
    }
    changes.push({
      status,
      basePath: old?.path ?? null,
      headPath: next?.path ?? null,
      ...diff,
      baseSymbols: symbols(input.base.graph, old?.path ?? null, diff.baseLines),
      headSymbols: symbols(
        input.head.graph,
        next?.path ?? null,
        diff.headLines,
      ),
    });
  };
  for (const old of deleted) {
    const matches = added.filter((f) => f.contentHash === old.contentHash);
    if (
      matches.length === 1 &&
      deleted.filter((f) => f.contentHash === old.contentHash).length === 1
    ) {
      paired.add(matches[0]!.path);
      add('RENAMED', old, matches[0]);
    } else add('DELETED', old);
  }
  for (const next of added)
    if (!paired.has(next.path)) add('ADDED', undefined, next);
  for (const old of a.values()) {
    const next = b.get(old.path);
    if (next && next.contentHash !== old.contentHash)
      add('MODIFIED', old, next);
  }
  return changes.sort((a, b) =>
    (a.headPath ?? a.basePath!).localeCompare(b.headPath ?? b.basePath!, 'en'),
  );
}
function fileEdges(graph: SnapshotGraph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const reverse = new Map<string, { path: string; edge: GraphEdge }[]>();
  for (const edge of [...graph.edges].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  )) {
    if (!edge.to || !dependencyKinds.includes(edge.kind)) continue;
    const from = nodes.get(edge.from)?.filePath,
      to = nodes.get(edge.to)?.filePath;
    if (!from || !to || from === to) continue;
    const list = reverse.get(to) ?? [];
    list.push({ path: from, edge });
    reverse.set(to, list);
  }
  return reverse;
}
function traverse(reverse: ReturnType<typeof fileEdges>, path: string) {
  const found = new Map<string, GraphEdge[]>([[path, []]]);
  const pending = [path];
  for (let i = 0; i < pending.length; i++)
    for (const next of reverse.get(pending[i]!) ?? []) {
      if (found.has(next.path)) continue;
      found.set(next.path, [...found.get(pending[i]!)!, next.edge]);
      pending.push(next.path);
    }
  return found;
}
export function analyzeImpact(input: ImpactInput): ImpactResult {
  if (!['6.0.0', IMPACT_VERSION].includes(input.version))
    throw new Error('Unsupported impact engine version');
  const changes = diffSnapshots(input);
  const paths = new Map<string, ImpactPath[]>();
  const reaches = new Map<string, number>();
  const unknowns: ImpactResult['unknowns'] = [];
  const broaderReview: string[] = [];
  for (const change of changes) {
    const path = change.headPath ?? change.basePath!;
    if (
      /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|.*\.config\.[^/]+|tsconfig[^/]*\.json|Dockerfile|docker-compose[^/]*|\.github\/.*|.*\.(?:ya?ml|toml|ini|conf))$/i.test(
        path,
      )
    )
      broaderReview.push(
        `${path}: configuration or dependency changes can affect runtime behavior beyond static imports. Review build, deployment and regression tests across the repository.`,
      );
    if (change.precision === 'FILE')
      unknowns.push({
        code: 'FILE_DIFF_FALLBACK',
        filePath: path,
        message:
          'Source is unavailable or line diff exceeded its bound; review the whole changed file.',
      });
  }
  for (const side of ['base', 'head'] as const) {
    const snapshot = input[side],
      reverse = fileEdges(snapshot.graph);
    if (!snapshot.inventoryComplete)
      unknowns.push({
        code: 'PARTIAL_INVENTORY',
        side,
        message:
          'This older snapshot contains only retained source. Changes to excluded files cannot be enumerated.',
      });
    for (const limitation of snapshot.graph.limitations)
      if (limitation.code !== 'FILE_LEVEL_ANALYSIS')
        unknowns.push({
          code: limitation.code,
          message: limitation.message,
          side,
          filePath: limitation.evidence.filePath,
        });
    for (const change of changes) {
      const path = side === 'base' ? change.basePath : change.headPath;
      if (!path) continue;
      const found = traverse(reverse, path);
      const affectedLines =
        side === 'base' ? change.baseLines : change.headLines;
      for (const mapping of input.mappings) {
        const resolved = mapping[side].node;
        const target = resolved ?? mapping.target;
        const edges = found.get(target.filePath);
        if (!edges) continue;
        // Same-file symbol precision when available; importer propagation remains file-level.
        if (
          resolved &&
          !edges.length &&
          resolved.kind !== 'FILE' &&
          change.precision === 'LINES' &&
          change.status === 'MODIFIED' &&
          !affectedLines.some(
            ([a, b]) =>
              a <= resolved.evidence.endLine &&
              b >= resolved.evidence.startLine,
          )
        )
          continue;
        const kind = !resolved
          ? 'UNRESOLVED'
          : edges.length
            ? 'TRANSITIVE'
            : 'DIRECT';
        const list = paths.get(mapping.featureId) ?? [];
        list.push({
          side,
          commitSha: snapshot.commitSha,
          changedPath: path,
          changedLines: affectedLines,
          symbols: side === 'base' ? change.baseSymbols : change.headSymbols,
          mappingId: mapping.id,
          mappingVersion: mapping.version,
          confirmedBy: mapping.confirmedByLabel,
          mappingSnapshotId: mapping.snapshotId,
          target,
          kind,
          edges,
          reason: !resolved
            ? mapping[side].reason
            : edges.length
              ? 'Reverse dependency path projected to files; symbol-level usage and runtime execution are not proven.'
              : 'Changed code overlaps a confirmed mapping in this snapshot.',
        });
        paths.set(mapping.featureId, list);
        reaches.set(
          mapping.featureId,
          Math.max(reaches.get(mapping.featureId) ?? 0, found.size - 1),
        );
      }
    }
  }
  for (const mapping of input.mappings)
    for (const side of ['base', 'head'] as const)
      if (!mapping[side].node)
        unknowns.push({
          code: 'MAPPING_REVIEW',
          side,
          filePath: mapping.target.filePath,
          message: `Mapping ${mapping.id} v${mapping.version} cannot be resolved in this snapshot; review its association. ${mapping[side].reason}`,
        });
  const reached = new Set(
    [...paths.values()].flat().map((p) => p.side + ':' + p.changedPath),
  );
  for (const change of changes)
    if (
      !reached.has('base:' + change.basePath) &&
      !reached.has('head:' + change.headPath)
    )
      unknowns.push({
        code: 'UNMAPPED_CHANGE',
        filePath: change.headPath ?? change.basePath!,
        message:
          'No confirmed feature mapping was reached from this change. Review its business impact manually.',
      });
  const features: FeatureImpact[] = [];
  for (const feature of [...input.features].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  )) {
    const evidence = paths.get(feature.id);
    if (!evidence?.length) continue;
    const kind = evidence.some((p) => p.kind === 'DIRECT')
      ? 'DIRECT'
      : evidence.some((p) => p.kind === 'TRANSITIVE')
        ? 'TRANSITIVE'
        : 'UNRESOLVED';
    const confidence =
      evidence.every((p) => p.kind === 'DIRECT' && p.target.kind !== 'FILE') &&
      !unknowns.some((u) => u.code !== 'UNMAPPED_CHANGE')
        ? 'HIGH'
        : 'LIMITED';
    const testPaths = new Set<string>();
    for (const mapping of input.mappings.filter(
      (m) => m.featureId === feature.id,
    )) {
      const node = mapping.head.node;
      if (!node) continue;
      for (const path of traverse(
        fileEdges(input.head.graph),
        node.filePath,
      ).keys())
        if (/(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/.test(path))
          testPaths.add(path);
    }
    const tests = [...testPaths].sort().map((path) => ({
      path,
      outcomes: input.tests
        .filter((t) => t.snapshotId === input.head.id && t.path === path)
        .map((t) => t.outcome)
        .sort(),
    }));
    const rubric = input.rubric;
    const factors = [
      {
        name: 'Business criticality',
        points: rubric.criticality[feature.criticality],
        reason: feature.criticality,
      },
      {
        name: 'Relationship',
        points:
          rubric[
            kind === 'DIRECT'
              ? 'direct'
              : kind === 'TRANSITIVE'
                ? 'transitive'
                : 'unresolved'
          ],
        reason: kind,
      },
      {
        name: 'Shared dependency reach',
        points: Math.min(
          rubric.sharedReachCap,
          (reaches.get(feature.id) ?? 0) * rubric.sharedReachPerFile,
        ),
        reason: `${reaches.get(feature.id) ?? 0} reverse-reachable files (maximum across evidence paths)`,
      },
      {
        name: 'Testing evidence',
        points: !tests.length
          ? rubric.noTests
          : tests.every(
                (t) =>
                  t.outcomes.length && t.outcomes.every((o) => o === 'PASSED'),
              )
            ? 0
            : rubric.testsWithoutPassingRun,
        reason: !tests.length
          ? 'No statically linked test files'
          : 'Head snapshot test evidence only; passing tests do not prove coverage of this change',
      },
      {
        name: 'Analysis uncertainty',
        points: confidence === 'LIMITED' ? rubric.uncertainty : 0,
        reason:
          confidence === 'LIMITED'
            ? 'File-level dependency or unresolved mapping evidence'
            : 'Direct symbol overlap',
      },
    ];
    features.push({
      ...feature,
      featureId: feature.id,
      kind,
      confidence,
      paths: evidence,
      tests,
      priority: { score: factors.reduce((n, f) => n + f.points, 0), factors },
    });
  }
  features.sort(
    (a, b) =>
      b.priority.score - a.priority.score ||
      a.featureId.localeCompare(b.featureId, 'en'),
  );
  const result: ImpactResult = {
    version: input.version,
    changes,
    features,
    unknowns,
    broaderReview,
    statement:
      'Review priority is a ranking, not a probability of failure. Reachability indicates potential impact; it does not establish that a feature is broken.',
  };
  if (input.testEvidence) result.testReview = recommendTests(input, result);
  return result;
}

import type {
  ImpactInput,
  ImpactResult,
  TestArtifact,
  RecommendationEvidence,
  RecommendedTest,
  TestReview,
  TestCoverageTarget,
} from '@impactlens/shared';

const intersects = (a: number, b: number, ranges: [number, number][]) =>
  ranges.some(([x, y]) => a <= y && b >= x);
export function recommendTests(
  input: ImpactInput,
  result: ImpactResult,
): TestReview {
  const evidence = input.testEvidence!;
  const artifacts = evidence.artifacts;
  const age = (a: TestArtifact) =>
    Math.max(
      0,
      (Date.parse(evidence.asOf) - Date.parse(a.recordedAt)) / 86400000,
    );
  const fresh = (a: TestArtifact) => age(a) <= evidence.staleAfterDays;
  const exact = (a: TestArtifact) =>
    a.commitSha === input.head.commitSha && fresh(a);
  const reference = (
    a: TestArtifact,
    detail: string,
    path?: string,
  ): RecommendationEvidence => ({
    artifactId: a.id,
    filename: a.filename,
    contentHash: a.contentHash,
    source: a.source,
    commitSha: a.commitSha,
    recordedAt: a.recordedAt,
    ageDays: age(a),
    stale: !fresh(a),
    commitMatch: a.commitSha === input.head.commitSha,
    ...(path ? { path } : {}),
    detail,
  });
  const gaps: TestReview['gaps'] = [],
    broaderRun: string[] = [];
  const coverage = artifacts.filter((a) => a.format !== 'JUNIT');
  if (!coverage.length)
    gaps.push({
      code: 'NO_ARTIFACT',
      message:
        'No coverage artifact is available. JUnit outcomes do not establish source coverage.',
    });
  if (coverage.some((a) => !exact(a)))
    gaps.push({
      code: 'STALE',
      message: `Some coverage is older than ${evidence.staleAfterDays} days or belongs to a different commit. It is not exact head-commit coverage.`,
    });
  const current = coverage.filter(exact);
  // Changed-line gaps use only fresh aggregate line/statement evidence at the exact head SHA.
  // Per-test coverage can also supply positive line evidence, but absence is not proof of nonexecution.
  for (const change of result.changes) {
    const path = change.headPath;
    if (!path || change.precision !== 'LINES' || !change.headLines.length) {
      gaps.push({
        code: 'INCOMPLETE',
        path: path ?? change.basePath!,
        message:
          'Deleted code, unavailable source or a non-line diff requires broader regression review.',
      });
      continue;
    }
    if (!current.length) continue;
    const ranges: [number, number][] = [];
    for (const a of current) {
      for (const file of a.parsed.aggregate.filter((f) => f.path === path))
        for (const r of file.ranges)
          if (r.hits > 0) ranges.push([r.start, r.end]);
      for (const test of a.parsed.perTest)
        for (const t of test.targets.filter((t) => t.path === path)) {
          if (t.lines) for (const n of t.lines) ranges.push([n, n]);
          // A symbol/file hit does not establish coverage of every line in its declaration.
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const covered = change.headLines.every(([start, end]) => {
      let next = start;
      for (const [a, b] of ranges) {
        if (a > next) break;
        if (b >= next) next = b + 1;
        if (next > end) return true;
      }
      return false;
    });
    if (!covered)
      gaps.push({
        code: 'NOT_EXERCISED',
        path,
        message:
          'Available exact-head coverage does not demonstrate execution of all changed lines. Unmeasured lines and uncovered code both require review.',
      });
  }
  const selected = new Map<string, RecommendedTest>();
  const strength = { DIRECT: 0, MANUAL: 1, INFERRED: 2, WEAK: 3 };
  let truncated = false;
  const add = (r: RecommendedTest) => {
    const key = JSON.stringify([r.featureId, r.runner, r.identity]);
    const prior = selected.get(key);
    if (prior) {
      if (strength[r.kind] < strength[prior.kind]) selected.set(key, r);
      else if (
        r.kind === prior.kind &&
        !prior.evidence.some(
          (e) =>
            e.artifactId === r.evidence[0]!.artifactId &&
            e.detail === r.evidence[0]!.detail,
        )
      )
        prior.evidence.push(...r.evidence);
      return;
    }
    if (selected.size >= 1000) {
      truncated = true;
      return;
    }
    selected.set(key, r);
  };
  function targetMatch(a: TestArtifact, target: TestCoverageTarget) {
    // Never align line numbers from a different commit with the head tree.
    if (!exact(a))
      return result.changes.some(
        (c) => c.basePath === target.path || c.headPath === target.path,
      )
        ? 'INFERRED'
        : null;
    const change = result.changes.find((c) => c.headPath === target.path);
    if (!change) return null;
    if (
      target.lines &&
      target.lines.some((n) => intersects(n, n, change.headLines))
    )
      return 'DIRECT';
    if (
      target.symbol &&
      change.headSymbols.some(
        (s) =>
          s.name === target.symbol!.name &&
          s.evidence.startLine === target.symbol!.startLine &&
          s.evidence.endLine === target.symbol!.endLine,
      )
    )
      return 'DIRECT';
    if ((!target.lines && !target.symbol) || change.precision === 'FILE')
      return 'INFERRED';
    return null;
  }
  for (const artifact of coverage.filter((a) => a.format === 'PER_TEST'))
    for (const test of artifact.parsed.perTest) {
      const identity = artifact.parsed.tests.find(
        (t) => t.identity === test.identity,
      )!;
      for (const target of test.targets) {
        const match = targetMatch(artifact, target);
        const features = result.features.filter((f) =>
          f.paths.some((p) =>
            match
              ? p.changedPath === target.path ||
                p.target.filePath === target.path
              : p.kind === 'TRANSITIVE' &&
                p.target.filePath === target.path &&
                p.changedPath !== target.path,
          ),
        );
        if (!match && !features.length) continue;
        const kind = match ?? 'INFERRED';
        for (const f of features.length ? features : [null])
          add({
            identity: test.identity,
            name: identity.name,
            runner: artifact.runner,
            featureId: f?.featureId ?? null,
            featureName: f?.name ?? 'Unmapped changed code',
            kind,
            reason:
              kind === 'DIRECT'
                ? 'Per-test coverage intersects changed head lines or an identified changed symbol.'
                : 'Historical, file-level or feature-target coverage suggests this test; exact changed-head execution is not established.',
            evidence: [
              reference(
                artifact,
                target.symbol
                  ? `Symbol ${target.symbol.name}, lines ${target.symbol.startLine}–${target.symbol.endLine}`
                  : target.lines
                    ? `Covered lines: ${target.lines.join(', ')}`
                    : 'File-level per-test association',
                target.path,
              ),
            ],
          });
      }
    }
  for (const mapping of evidence.mappings) {
    const feature = result.features.find(
      (f) => f.featureId === mapping.featureId,
    );
    if (!feature) continue;
    const artifact = artifacts.find((a) => a.id === mapping.artifactId);
    const test = artifact?.parsed.tests.find(
      (t) => t.identity === mapping.testIdentity,
    );
    if (!artifact || !test) continue;
    add({
      identity: test.identity,
      name: test.name,
      runner: mapping.runner,
      featureId: feature.featureId,
      featureName: feature.name,
      kind: 'MANUAL',
      reason: mapping.rationale,
      evidence: [
        {
          ...reference(
            artifact,
            `Explicit mapping by ${mapping.actorLabel} at ${mapping.createdAt}. This association is not a coverage claim.`,
          ),
          mappingId: mapping.id,
        },
      ],
    });
  }
  // Names can suggest investigation only; neither JUnit nor aggregate data creates coverage attribution.
  const words = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (w) =>
          w.length >= 4 &&
          !['test', 'tests', 'spec', 'should', 'feature'].includes(w),
      );
  for (const feature of result.features)
    for (const artifact of artifacts)
      for (const test of artifact.parsed.tests) {
        const common = words(feature.name).filter((w) =>
          words(test.name + ' ' + test.identity).includes(w),
        );
        if (!common.length) continue;
        add({
          identity: test.identity,
          name: test.name,
          runner: artifact.runner,
          featureId: feature.featureId,
          featureName: feature.name,
          kind: 'WEAK',
          reason: `Weak name match (${[...new Set(common)].join(', ')}). No individual coverage or manual association supports this suggestion.`,
          evidence: [
            reference(
              artifact,
              'Test identity/name only; no coverage attribution.',
            ),
          ],
        });
      }
  const recommendations = [...selected.values()].sort(
    (a, b) =>
      strength[a.kind] - strength[b.kind] ||
      a.identity.localeCompare(b.identity, 'en') ||
      (a.featureId ?? '').localeCompare(b.featureId ?? '', 'en'),
  );
  if (
    result.changes.length &&
    (!recommendations.some((r) => r.kind !== 'WEAK') ||
      result.features.some(
        (f) =>
          !recommendations.some(
            (r) => r.featureId === f.featureId && r.kind !== 'WEAK',
          ),
      ))
  )
    gaps.push({
      code: 'NO_INDIVIDUAL_MAPPING',
      message:
        'No per-test coverage or explicit test mapping is available for one or more affected features/changes. Aggregate coverage cannot supply individual test identities.',
    });
  if (result.unknowns.length || result.broaderReview.length || truncated)
    gaps.push({
      code: 'INCOMPLETE',
      message: truncated
        ? 'Recommendations exceeded the 1,000-test limit; the list is incomplete.'
        : 'Static analysis reports unknowns, unmapped code or configuration changes; targeted recommendations are incomplete.',
    });
  if (
    result.changes.length &&
    (gaps.length ||
      recommendations.some(
        (r) =>
          r.kind !== 'DIRECT' ||
          r.evidence.some((e) => e.stale || !e.commitMatch),
      ))
  )
    broaderRun.push(
      'Run the broader affected suite or full regression suite in an authorized CI environment. Targeted selections are not a complete safety guarantee.',
    );
  return { recommendations, gaps, broaderRun, asOf: evidence.asOf };
}

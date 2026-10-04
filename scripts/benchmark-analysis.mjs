// This process parses owned source only. It never imports or executes the analyzed application.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import {
  analyzeSnapshot,
  analyzeImpact,
  impactHash,
  IMPACT_VERSION,
} from '@impactlens/analyzer';
import { defaultReviewRubric } from '@impactlens/shared';
const require = createRequire(import.meta.url);
const {
  resolveMapping,
  fingerprint,
} = require('../apps/api/dist/features/mapping.logic.js');
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const start = performance.now();
function snapshot(source, sha) {
  const files = Object.entries(source).map(([path, contentText]) => ({
    id: path,
    path,
    contentText,
    contentHash: impactHash(contentText),
  }));
  return {
    id: sha,
    commitSha: sha,
    files,
    graph: analyzeSnapshot({ commitSha: sha, files }),
    inventoryComplete: true,
  };
}
const base = snapshot(data.base, data.baseSha),
  head = snapshot(data.head, data.headSha);
const mappings = data.features.map((f) => {
  const target = base.graph.nodes.find(
    (n) => n.filePath === f.entry && n.kind === 'FUNCTION',
  );
  if (!target)
    throw new Error(`Missing manually declared feature entry ${f.entry}`);
  const anchor = fingerprint(
    target,
    base.files.find((file) => file.path === f.entry),
  );
  const resolve = (s) => {
    const r = resolveMapping(target, anchor, s.files, s.graph, s.commitSha);
    return { node: r.node, reason: r.reason };
  };
  return {
    id: `confirmed-${f.id}`,
    version: 1,
    featureId: f.id,
    snapshotId: base.id,
    confirmedByLabel: 'Fixture ground-truth author',
    confirmedAt: '2026-10-01T00:00:00Z',
    target,
    base: resolve(base),
    head: resolve(head),
  };
});
const result = analyzeImpact({
  version: IMPACT_VERSION,
  semantics: {
    kind: 'TWO_COMMIT_TREES',
    repositoryId: 'controlled-commerce',
    baseSha: base.commitSha,
    headSha: head.commitSha,
    description: 'Two controlled commit trees',
  },
  base,
  head,
  features: data.features.map((f) => ({
    id: f.id,
    name: f.name,
    version: 1,
    criticality: 'HIGH',
  })),
  mappings,
  tests: [],
  rubric: defaultReviewRubric,
});
const durationMs = performance.now() - start;
// External dependencies here are explicitly known fixture libraries, not arbitrary unresolved imports.
const knownExternal = new Set([
  'express',
  'react',
  'react-dom/server',
  'node:test',
  'node:assert/strict',
]);
const fallbackReasons = result.unknowns.filter(
  (u) =>
    u.code !== 'UNRESOLVED_IMPORT' ||
    !knownExternal.has(u.message.split(' ').at(-1)),
);
const fallback = result.broaderReview.length > 0 || fallbackReasons.length > 0;
process.stdout.write(
  JSON.stringify({
    engineVersion: IMPACT_VERSION,
    predicted: result.features.map((f) => f.featureId).sort(),
    durationMs,
    peakRssKiB: process.resourceUsage().maxRSS,
    resultHash: impactHash(result),
    fallback,
    fallbackReasons: [
      ...new Set([
        ...result.broaderReview,
        ...fallbackReasons.map((u) => u.code),
      ]),
    ],
    changes: result.changes.length,
    baseNodes: base.graph.nodes.length,
    headNodes: head.graph.nodes.length,
  }),
);

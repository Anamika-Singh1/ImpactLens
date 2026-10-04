import { analyzeSnapshot } from '@impactlens/analyzer';
import type { MappingTarget } from '@impactlens/shared';
import {
  fileNode,
  fingerprint,
  resolveMapping,
  suggestTargets,
} from '../src/features/mapping.logic';
const sha = 'a'.repeat(40);
const source = 'export function checkout() { return 1; }\n';
const original = { id: 'file-a', path: 'src/checkout.ts', contentText: source };
const graph = analyzeSnapshot({ commitSha: sha, files: [original] });
const symbol: MappingTarget = {
  ...graph.nodes.find((n) => n.kind === 'FUNCTION')!,
  analyzerVersion: graph.version,
};
describe('feature mapping resolution and suggestions', () => {
  it('keeps a same-path unchanged file resolved, but changed content needs review', () => {
    const node = fileNode(original, sha),
      hash = fingerprint(node, original);
    expect(resolveMapping(node, hash, [original], graph, sha).status).toBe(
      'RESOLVED',
    );
    expect(
      resolveMapping(
        node,
        hash,
        [{ ...original, contentText: source + '// change' }],
        graph,
        sha,
      ).status,
    ).toBe('NEEDS_REVIEW');
  });
  it('flags moved files as stale and offers exact-content candidates without remapping', () => {
    const node = fileNode(original, sha);
    const result = resolveMapping(
      node,
      fingerprint(node, original),
      [{ ...original, path: 'src/payment/checkout.ts' }],
      null,
      'b'.repeat(40),
    );
    expect(result.status).toBe('STALE');
    expect(result.node).toBeNull();
    expect(result.candidates[0]?.filePath).toBe('src/payment/checkout.ts');
  });
  it('resolves unique unchanged symbols across line shifts without using unstable node IDs', () => {
    const updated = { ...original, contentText: '\n\n' + source };
    const next = analyzeSnapshot({
      commitSha: 'b'.repeat(40),
      files: [updated],
    });
    const result = resolveMapping(
      symbol,
      fingerprint(symbol, original),
      [updated],
      next,
      next.commitSha,
    );
    expect(result.status).toBe('RESOLVED');
    expect(result.node!.id).not.toBe(symbol.id);
    expect(result.node!.evidence.startLine).toBe(3);
  });
  it('requires review for renamed, disappeared, ambiguous and changed symbols', () => {
    const hash = fingerprint(symbol, original);
    const renamed = analyzeSnapshot({
      commitSha: sha,
      files: [
        { ...original, contentText: source.replace('checkout', 'payment') },
      ],
    });
    expect(resolveMapping(symbol, hash, [original], renamed, sha).status).toBe(
      'STALE',
    );
    const ambiguous = {
      ...graph,
      nodes: [...graph.nodes, { ...symbol, id: 'ambiguous' }],
    };
    expect(
      resolveMapping(symbol, hash, [original], ambiguous, sha).status,
    ).toBe('NEEDS_REVIEW');
    const changed = {
      ...original,
      contentText: source.replace('return 1', 'return 2'),
    };
    expect(resolveMapping(symbol, hash, [changed], graph, sha).status).toBe(
      'NEEDS_REVIEW',
    );
    expect(resolveMapping(symbol, hash, [original], null, sha).status).toBe(
      'NEEDS_REVIEW',
    );
  });
  it('requires review for missing source, changed analyzer versions and legacy anchors', () => {
    expect(resolveMapping(null, null, [original], graph, sha).status).toBe(
      'NEEDS_REVIEW',
    );
    expect(
      resolveMapping(
        symbol,
        fingerprint(symbol, original),
        [{ ...original, contentText: null }],
        graph,
        sha,
      ).status,
    ).toBe('NEEDS_REVIEW');
    expect(
      resolveMapping(
        symbol,
        fingerprint(symbol, original),
        [original],
        { ...graph, version: 'future' },
        sha,
      ).status,
    ).toBe('NEEDS_REVIEW');
  });
  it('provides lexical evidence and no confirmation fields in suggestions', () => {
    const routes = analyzeSnapshot({
      commitSha: sha,
      files: [
        {
          path: 'server.ts',
          contentText:
            "import express from 'express'; const app = express(); app.post('/checkout', (req,res) => {});",
        },
        original,
      ],
    });
    const suggestions = suggestTargets(
      {
        name: 'Checkout',
        description: 'Complete checkout',
        customerWorkflow: null,
      },
      routes,
    );
    expect(suggestions.some((s) => s.node.kind === 'ROUTE')).toBe(true);
    expect(suggestions.some((s) => s.node.kind === 'FILE')).toBe(true);
    expect(suggestions.some((s) => s.node.kind === 'FUNCTION')).toBe(true);
    for (const suggestion of suggestions) {
      expect(suggestion.explanation).toContain('Unconfirmed');
      expect(suggestion.evidence.commitSha).toBe(sha);
      expect(suggestion.matched).toContain('checkout');
      expect(suggestion).not.toHaveProperty('confirmedById');
    }
    expect(
      suggestTargets(
        { name: 'Unrelated', description: '', customerWorkflow: '' },
        graph,
      ),
    ).toEqual([]);
  });
});

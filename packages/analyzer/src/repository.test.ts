import { describe, it, expect } from 'vitest';
import { analyzeSnapshot } from './analyze';
import { buildRepositoryOverview, searchImplementation } from './repository';
const commitSha = 'a'.repeat(40);
const files = [
  {
    path: 'package.json',
    contentText: JSON.stringify({
      packageManager: 'npm@10.9.0',
      dependencies: { express: '^5.0.0', react: '^19' },
      devDependencies: { vitest: '^4' },
    }),
  },
  {
    path: 'package-lock.json',
    contentText: JSON.stringify({
      packages: {
        'node_modules/express': { version: '5.1.0' },
        'node_modules/unused/node_modules/react': { version: '18.0.0' },
      },
    }),
  },
  {
    path: 'src/login.ts',
    contentText:
      'export function login(req: unknown, res: unknown) { return true; }\nexport function requireUser() { return true; }',
  },
  {
    path: 'src/server.ts',
    contentText:
      'import express from "express";\nimport { login, requireUser } from "./login";\nconst router = express.Router();\nrouter.post("/login", requireUser, login);\nconst prefix = "/api";\nrouter.get(prefix, login);',
  },
  {
    path: 'src/checkout.ts',
    contentText: 'export function checkout() { return "paid"; }',
  },
  { path: 'tools/helper.py', contentText: 'def helper():\n    return 1' },
  {
    path: 'test/upload.test.ts',
    contentText: 'export function uploadTest() { return true; }',
  },
];
const input = { commitSha, files };
const graph = analyzeSnapshot(input);
describe('evidence-based repository overview', () => {
  it('separates declarations from relevant locked versions and detects supported technology evidence', () => {
    const overview = buildRepositoryOverview(input, graph);
    expect(
      overview.dependencies.find((item) => item.name === 'express'),
    ).toMatchObject({
      declaredVersion: '^5.0.0',
      resolvedVersions: ['5.1.0'],
      scope: 'production',
      lockfile: 'package-lock.json',
    });
    expect(
      overview.dependencies.find((item) => item.name === 'react')
        ?.resolvedVersions,
    ).toEqual([]);
    expect(
      overview.dependencies.find((item) => item.name === 'vitest')?.scope,
    ).toBe('development');
    expect(
      overview.technologies.find((item) => item.name === 'Express')?.evidence[0]
        ?.filePath,
    ).toBe('package.json');
    expect(overview.packageManagers.map((item) => item.name)).toContain('npm');
    expect(overview.languages.map((item) => item.name)).toContain('Python');
    expect(overview.purpose).toContain('cannot be confidently determined');
    expect(overview.limitations.join(' ')).toContain(
      'vulnerability status was not checked',
    );
  });
  it('extracts Express route handlers and middleware without inventing mount prefixes or computed paths', () => {
    const overview = buildRepositoryOverview(input, graph);
    expect(overview.routes).toHaveLength(1);
    expect(overview.routes[0]).toMatchObject({
      method: 'POST',
      path: '/login',
      handler: ['login'],
      middleware: ['requireUser'],
      evidence: { filePath: 'src/server.ts', startLine: 4 },
    });
    expect(overview.routes[0]?.limitations.join(' ')).toContain(
      'prefixes are unresolved',
    );
    expect(overview.limitations.join(' ')).toContain('literal');
  });
  it('suggests source workflows with evidence while excluding test-only upload references', () => {
    const overview = buildRepositoryOverview(input, graph);
    expect(overview.suggestions.map((item) => item.key)).toEqual(
      expect.arrayContaining(['authentication', 'checkout']),
    );
    expect(
      overview.suggestions.some((item) => item.key === 'file-upload'),
    ).toBe(false);
    expect(overview.suggestions[0]?.evidence.length).toBeGreaterThan(0);
    expect(overview.suggestions[0]?.reason).toContain('requiring human review');
  });
});
describe('implementation evidence retrieval', () => {
  it('ranks a human-confirmed mapping and returns exact evidence and bounded excerpts', () => {
    const node = graph.nodes.find(
      (node) => node.name === 'login' && node.kind === 'FUNCTION',
    )!;
    const matches = searchImplementation(
      input,
      graph,
      'Where is login implemented?',
      [{ name: 'Login', node }],
    );
    expect(matches[0]).toMatchObject({
      filePath: 'src/login.ts',
      startLine: 1,
      status: 'CONFIRMED_MAPPING',
    });
    expect(matches[0]?.excerpt).toContain('function login');
    expect(matches.find((item) => item.kind === 'ROUTE')?.label).toBe(
      'POST /login',
    );
    expect(
      matches.filter((item) => item.status === 'CANDIDATE').length,
    ).toBeGreaterThan(0);
  });
  it('does not invent a location when nothing matches', () => {
    expect(
      searchImplementation(input, graph, 'Where is astrophysics implemented?'),
    ).toEqual([]);
    expect(
      searchImplementation(input, graph, 'Where is the implementation?'),
    ).toEqual([]);
  });
});

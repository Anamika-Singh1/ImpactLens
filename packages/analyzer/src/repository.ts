import { posix } from 'node:path';
import type {
  GraphEdge,
  GraphNode,
  SnapshotGraph,
  RepositoryOverviewData,
  RepositoryEvidence,
  ImplementationMatch,
} from '@impactlens/shared';
import type { AnalysisInput } from './analyze';

export const OVERVIEW_VERSION = '1.0.0';
const evidence = (node: GraphNode): RepositoryEvidence => ({
  ...node.evidence,
  nodeId: node.id,
  label: node.name,
});
const language = (path: string) =>
  /\.[cm]?tsx?$/i.test(path)
    ? 'TypeScript'
    : /\.[cm]?jsx?$/i.test(path)
      ? 'JavaScript'
      : /\.py$/i.test(path)
        ? 'Python'
        : /\.go$/i.test(path)
          ? 'Go'
          : /\.java$/i.test(path)
            ? 'Java'
            : /\.rs$/i.test(path)
              ? 'Rust'
              : /\.php$/i.test(path)
                ? 'PHP'
                : /\.rb$/i.test(path)
                  ? 'Ruby'
                  : /\.cs$/i.test(path)
                    ? 'C#'
                    : /\.vue$/i.test(path)
                      ? 'Vue'
                      : /\.svelte$/i.test(path)
                        ? 'Svelte'
                        : /\.css$/i.test(path)
                          ? 'CSS'
                          : /\.html?$/i.test(path)
                            ? 'HTML'
                            : null;
const featureRules = [
  {
    key: 'authentication',
    name: 'Authentication',
    words: [
      'login',
      'signin',
      'sign-in',
      'authenticate',
      'authentication',
      'logout',
      'password',
    ],
    explanation: 'Possible account sign-in or authentication workflow.',
  },
  {
    key: 'checkout',
    name: 'Checkout',
    words: ['checkout', 'cart', 'payment'],
    explanation: 'Possible shopping, checkout or payment workflow.',
  },
  {
    key: 'reporting',
    name: 'Reporting',
    words: ['report', 'reporting', 'analytics', 'dashboard'],
    explanation: 'Possible reporting or analytics workflow.',
  },
  {
    key: 'file-upload',
    name: 'File upload',
    words: ['upload', 'multipart', 'multer'],
    explanation: 'Possible file-upload handling.',
  },
  {
    key: 'orders',
    name: 'Order management',
    words: ['order', 'orders', 'orderhistory'],
    explanation: 'Possible order tracking or management workflow.',
  },
];
function words(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}
export function buildRepositoryOverview(
  input: AnalysisInput,
  graph: SnapshotGraph,
): RepositoryOverviewData {
  const files = new Map(
    input.files.map((file) => [file.path, file.contentText ?? '']),
  );
  const languages = new Map<string, number>(),
    directories = new Map<string, number>();
  const result: RepositoryOverviewData = {
    version: OVERVIEW_VERSION,
    summary: '',
    purpose:
      'The application’s purpose cannot be confidently determined from static source alone. Review the candidate features and source evidence.',
    sourceFileCount: 0,
    retainedFileCount: files.size,
    directories: [],
    languages: [],
    technologies: [],
    packageManagers: [],
    dependencies: [],
    routes: [],
    suggestions: [],
    limitations: [
      'Only retained source and manifests were inspected. Excluded output, dependency folders, binaries and likely secrets are absent.',
      'JavaScript/TypeScript static relationships and direct Express route registrations are supported. Other languages can be browsed but their routes and symbols are not indexed.',
      'Dependency versions are declarations unless a retained npm lockfile resolves them; dependencies were not installed and vulnerability status was not checked.',
      'Heuristic feature candidates are not verified application behavior.',
    ],
  };
  for (const [path] of files) {
    const name = language(path);
    if (name) {
      result.sourceFileCount++;
      languages.set(name, (languages.get(name) ?? 0) + 1);
    }
    const directory = path.includes('/') ? path.split('/')[0]! : '(root)';
    directories.set(directory, (directories.get(directory) ?? 0) + 1);
  }
  result.languages = [...languages]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  result.directories = [...directories]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  const fileEvidence = (path: string, label: string): RepositoryEvidence => ({
    filePath: path,
    startLine: 1,
    endLine: 1,
    label,
  });
  const frameworks: Record<string, string> = {
    react: 'React',
    next: 'Next.js',
    express: 'Express',
    '@nestjs/core': 'NestJS',
    fastify: 'Fastify',
    vue: 'Vue',
    nuxt: 'Nuxt',
    '@angular/core': 'Angular',
    svelte: 'Svelte',
    '@sveltejs/kit': 'SvelteKit',
    typescript: 'TypeScript',
    vite: 'Vite',
    jest: 'Jest',
    vitest: 'Vitest',
  };
  const addTech = (
    name: string,
    kind: string,
    reason: string,
    proof: RepositoryEvidence,
  ) => {
    const current = result.technologies.find((item) => item.name === name);
    if (current) {
      if (current.evidence.length < 10) current.evidence.push(proof);
    } else result.technologies.push({ name, kind, reason, evidence: [proof] });
  };
  const managers: Record<string, string> = {
    'package-lock.json': 'npm',
    'npm-shrinkwrap.json': 'npm',
    'yarn.lock': 'Yarn',
    'pnpm-lock.yaml': 'pnpm',
    'bun.lock': 'Bun',
    'bun.lockb': 'Bun',
    'poetry.lock': 'Poetry',
    'Cargo.lock': 'Cargo',
    'go.mod': 'Go modules',
    'composer.lock': 'Composer',
  };
  for (const [path, text] of files) {
    const manager = managers[posix.basename(path)];
    if (manager) {
      const existing = result.packageManagers.find(
        (item) => item.name === manager,
      );
      if (existing)
        existing.evidence.push(fileEvidence(path, posix.basename(path)));
      else
        result.packageManagers.push({
          name: manager,
          evidence: [fileEvidence(path, posix.basename(path))],
        });
    }
    if (/^(?:.*\/)?(?:vite|next|nuxt|svelte)\.config\.[cm]?[jt]s$/.test(path)) {
      const name = {
        vite: 'Vite',
        next: 'Next.js',
        nuxt: 'Nuxt',
        svelte: 'SvelteKit',
      }[posix.basename(path).split('.')[0]!];
      if (name)
        addTech(
          name,
          'configuration',
          'A framework/tool configuration file is present; this does not prove runtime use.',
          fileEvidence(path, 'Configuration file'),
        );
    }
    if (posix.basename(path) !== 'package.json') continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(text);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error();
    } catch {
      result.limitations.push(`Could not parse manifest ${path}.`);
      continue;
    }
    if (typeof manifest.packageManager === 'string') {
      const name = manifest.packageManager.split('@')[0]!;
      if (
        ['npm', 'yarn', 'pnpm', 'bun'].includes(name) &&
        !result.packageManagers.some((item) => item.name.toLowerCase() === name)
      )
        result.packageManagers.push({
          name,
          evidence: [fileEvidence(path, 'packageManager field')],
        });
    }
    const directory = posix.dirname(path);
    const candidates = [
      posix.join(directory, 'package-lock.json'),
      'package-lock.json',
      posix.join(directory, 'npm-shrinkwrap.json'),
    ];
    let lock: {
      path: string;
      packages?: Record<string, { version?: unknown }>;
      dependencies?: Record<string, { version?: unknown }>;
    } | null = null;
    for (const candidate of [...new Set(candidates)]) {
      if (!files.has(candidate)) continue;
      try {
        const parsed = JSON.parse(files.get(candidate)!);
        if (parsed && typeof parsed === 'object')
          lock = { ...parsed, path: candidate };
      } catch {
        result.limitations.push(`Could not parse lockfile ${candidate}.`);
      }
      if (lock) break;
    }
    for (const [field, scope] of [
      ['dependencies', 'production'],
      ['devDependencies', 'development'],
      ['optionalDependencies', 'optional'],
      ['peerDependencies', 'peer'],
    ] as const) {
      const declarations = manifest[field];
      if (
        !declarations ||
        typeof declarations !== 'object' ||
        Array.isArray(declarations)
      )
        continue;
      for (const [name, declaredVersion] of Object.entries(declarations)) {
        if (typeof declaredVersion !== 'string') continue;
        const resolvedVersions: string[] = [];
        if (lock) {
          // Follow npm's nearest ancestor resolution, rather than attributing unrelated nested versions.
          let cursor = directory;
          for (;;) {
            const lockDir = posix.dirname(lock.path);
            const absoluteKey = posix.join(cursor, 'node_modules', name);
            const key = posix.relative(lockDir, absoluteKey);
            const version = lock.packages?.[key]?.version;
            if (typeof version === 'string') {
              resolvedVersions.push(version);
              break;
            }
            if (cursor === '.') break;
            cursor = posix.dirname(cursor);
          }
          if (
            !resolvedVersions.length &&
            directory === posix.dirname(lock.path)
          ) {
            const version = lock.dependencies?.[name]?.version;
            if (typeof version === 'string') resolvedVersions.push(version);
          }
        }
        result.dependencies.push({
          name,
          declaredVersion,
          resolvedVersions,
          scope,
          manifest: path,
          lockfile: resolvedVersions.length ? (lock?.path ?? null) : null,
        });
        if (frameworks[name])
          addTech(
            frameworks[name]!,
            'declared package',
            `${name} is declared in ${field}; installation and runtime use are not verified.`,
            fileEvidence(path, name),
          );
      }
    }
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const routeEdges = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!['ROUTE_HANDLER', 'MIDDLEWARE'].includes(edge.kind)) continue;
    const edges = routeEdges.get(edge.from) ?? [];
    edges.push(edge);
    routeEdges.set(edge.from, edges);
  }
  for (const node of graph.nodes.filter((node) => node.kind === 'ROUTE')) {
    const index = node.name.indexOf(' ');
    const related = routeEdges.get(node.id) ?? [];
    result.routes.push({
      method: node.name.slice(0, index),
      path: node.name.slice(index + 1),
      handler: related
        .filter((edge) => edge.kind === 'ROUTE_HANDLER')
        .map(
          (edge) =>
            nodesById.get(edge.to ?? '')?.name ??
            `${edge.specifier} (unresolved)`,
        ),
      middleware: related
        .filter((edge) => edge.kind === 'MIDDLEWARE')
        .map(
          (edge) =>
            nodesById.get(edge.to ?? '')?.name ??
            `${edge.specifier} (unresolved)`,
        ),
      evidence: evidence(node),
      limitations: [
        'Router mount prefixes are unresolved; shown path is the local registration path.',
        ...related.flatMap((edge) =>
          edge.limitation ? [edge.limitation] : [],
        ),
      ],
    });
  }
  for (const rule of featureRules) {
    const matches = graph.nodes.filter(
      (node) =>
        !/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./i.test(
          node.filePath,
        ) &&
        words(`${node.filePath} ${node.name}`).some((word) =>
          rule.words.includes(word),
        ),
    );
    const proofs = matches.filter((node) => node.kind !== 'FILE');
    const selected = (proofs.length ? proofs : matches).slice(0, 8);
    if (selected.length)
      result.suggestions.push({
        ...rule,
        reason: `Names of retained files, symbols or route registrations match ${rule.words.join(', ')}. The connection is a candidate requiring human review.`,
        evidence: selected.map(evidence),
      });
  }
  result.limitations.push(
    ...graph.limitations
      .filter((item) =>
        ['ROUTE_UNSUPPORTED', 'SYNTAX_ERROR'].includes(item.code),
      )
      .slice(0, 20)
      .map(
        (item) =>
          `${item.evidence.filePath}:${item.evidence.startLine} — ${item.message}`,
      ),
  );
  const frameworksDetected = result.technologies
    .filter((item) => item.kind === 'declared package')
    .map((item) => item.name);
  result.summary = `The retained snapshot contains ${result.sourceFileCount} source files${result.languages.length ? ` using ${result.languages.map((item) => item.name).join(', ')}` : ''}. ${frameworksDetected.length ? `Manifests declare ${frameworksDetected.join(', ')}. ` : ''}${result.routes.length} direct Express route registrations were indexed. ${result.suggestions.length ? `Possible workflows include ${result.suggestions.map((item) => item.name).join(', ')}; these are unconfirmed name-based suggestions.` : 'No supported workflow could be suggested confidently.'}`;
  return result;
}

export function searchImplementation(
  input: AnalysisInput,
  graph: SnapshotGraph,
  query: string,
  confirmed: { name: string; node: GraphNode }[] = [],
): ImplementationMatch[] {
  const stop = new Set([
    'where',
    'is',
    'the',
    'a',
    'an',
    'implemented',
    'implementation',
    'which',
    'files',
    'file',
    'handle',
    'handles',
    'find',
    'feature',
    'or',
    'of',
    'in',
    'for',
    'api',
    'does',
    'how',
    'to',
  ]);
  const terms = [
    ...new Set(words(query).filter((word) => !stop.has(word))),
  ].slice(0, 16);
  if (!terms.length) return [];
  const synonyms: Record<string, string[]> = {
    login: ['signin', 'sign-in', 'authentication', 'authenticate'],
    upload: ['multipart', 'multer'],
    checkout: ['cart', 'payment'],
  };
  const expanded = [
    ...new Set(terms.flatMap((term) => [term, ...(synonyms[term] ?? [])])),
  ];
  const matches = new Map<string, ImplementationMatch>();
  const lineMap = new Map(
    input.files.map((file) => [
      file.path,
      (file.contentText ?? '').split('\n'),
    ]),
  );
  const nodesByFile = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === 'FILE') continue;
    const nodes = nodesByFile.get(node.filePath) ?? [];
    nodes.push(node);
    nodesByFile.set(node.filePath, nodes);
  }
  function score(text: string) {
    const tokens = words(text);
    return expanded.filter(
      (term) =>
        tokens.includes(term) ||
        (term.length >= 4 && tokens.some((token) => token.startsWith(term))),
    );
  }
  function add(
    node: GraphNode,
    points: number,
    reason: string,
    status: ImplementationMatch['status'] = 'CANDIDATE',
  ) {
    const key = `${node.filePath}:${node.evidence.startLine}:${node.id}`;
    const previous = matches.get(key);
    if (previous) {
      previous.score += points;
      previous.reasons.push(reason);
      if (status === 'CONFIRMED_MAPPING') previous.status = status;
      return;
    }
    const lines = lineMap.get(node.filePath) ?? [];
    const startLine = node.evidence.startLine,
      endLine = Math.min(node.evidence.endLine, startLine + 4);
    matches.set(key, {
      filePath: node.filePath,
      nodeId: node.id,
      label: node.name,
      kind: node.kind,
      startLine,
      endLine: Math.max(startLine, endLine),
      excerpt: lines
        .slice(startLine - 1, endLine)
        .join('\n')
        .slice(0, 800),
      score: points,
      reasons: [reason],
      status,
    });
  }
  for (const mapping of confirmed)
    if (score(mapping.name).length)
      add(
        mapping.node,
        30,
        `Human-confirmed feature mapping: ${mapping.name}`,
        'CONFIRMED_MAPPING',
      );
  for (const node of graph.nodes) {
    const nameMatches = score(node.name);
    if (nameMatches.length)
      add(
        node,
        node.kind === 'ROUTE' ? 16 : node.kind === 'FILE' ? 10 : 14,
        `${node.kind.toLowerCase()} name matches ${nameMatches.join(', ')}`,
      );
    if (node.kind !== 'FILE' && score(node.filePath).length)
      add(node, 4, 'Related file path matches query terms');
  }
  for (const file of input.files) {
    const lines = lineMap.get(file.path) ?? [];
    let hits = 0;
    for (let index = 0; index < lines.length && hits < 3; index++) {
      const found = score(lines[index]!);
      if (!found.length) continue;
      hits++;
      const node = nodesByFile
        .get(file.path)
        ?.find(
          (node) =>
            node.kind !== 'FILE' &&
            node.filePath === file.path &&
            node.evidence.startLine <= index + 1 &&
            node.evidence.endLine >= index + 1,
        );
      add(
        node ?? {
          id: `text:${file.path}:${index + 1}`,
          kind: 'FILE',
          name: file.path,
          filePath: file.path,
          exported: false,
          evidence: {
            commitSha: input.commitSha,
            filePath: file.path,
            startLine: index + 1,
            endLine: Math.min(lines.length, index + 3),
            relationship: 'DEFINITION',
          },
        },
        3,
        `Source text matches ${found.join(', ')}; comments and strings may also match`,
      );
    }
  }
  return [...matches.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.filePath.localeCompare(b.filePath) ||
        a.startLine - b.startLine,
    )
    .slice(0, 40);
}

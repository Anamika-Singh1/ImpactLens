import ts from 'typescript';
import { posix as path } from 'node:path';
import type {
  GraphNode,
  GraphEdge,
  GraphEvidence,
  SnapshotGraph,
  Relationship,
  NodeKind,
} from '@impactlens/shared';
export const ANALYZER_VERSION = '4.0.0';
export interface AnalysisInput {
  commitSha: string;
  files: { path: string; contentText: string | null }[];
}
const sourcePattern = /\.[cm]?[jt]sx?$/i;
const literal = (node: ts.Node | undefined): node is ts.StringLiteralLike =>
  !!node &&
  (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
const fileId = (name: string) => 'file:' + name;
const safePath = (name: string) =>
  !path.isAbsolute(name) &&
  name !== '..' &&
  !name.startsWith('../') &&
  !/[\\:\0]/.test(name);
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) &&
  !!ts.getModifiers(node)?.some((m) => m.kind === kind);

/** Snapshot-only compiler host: no emit, filesystem, configuration execution or network. */
export function analyzeSnapshot(input: AnalysisInput): SnapshotGraph {
  if (
    input.files.length > 5000 ||
    input.files.reduce(
      (n, f) => n + Buffer.byteLength(f.contentText ?? ''),
      0,
    ) >
      20 * 1024 * 1024
  )
    throw new Error('Snapshot exceeds analyzer limits (5,000 files / 20 MiB).');
  const graph: SnapshotGraph = {
    version: ANALYZER_VERSION,
    commitSha: input.commitSha,
    nodes: [],
    edges: [],
    limitations: [],
  };
  const files = new Map(input.files.map((f) => [f.path, f.contentText]));
  if (
    files.size !== input.files.length ||
    [...files.keys()].some((p) => !safePath(p) || path.normalize(p) !== p)
  )
    throw new Error('Snapshot contains duplicate or unsafe paths.');
  const parsed = new Map<string, ts.SourceFile>();
  for (const [name, text] of files)
    if (text !== null && sourcePattern.test(name))
      parsed.set(
        name,
        ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
      );
  const host: ts.CompilerHost = {
    getSourceFile: (name) => parsed.get(name),
    getDefaultLibFileName: () => '',
    writeFile: () => {
      throw new Error('Emit is disabled');
    },
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) => parsed.has(name),
    readFile: (name) => files.get(name) ?? undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(
    [...parsed.keys()],
    { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve },
    host,
  );
  const checker = program.getTypeChecker();
  const evidence = (
    sf: ts.SourceFile,
    node: ts.Node,
    relationship: GraphEvidence['relationship'],
  ): GraphEvidence => ({
    commitSha: input.commitSha,
    filePath: sf.fileName,
    startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    endLine:
      sf.getLineAndCharacterOfPosition(
        Math.max(node.getStart(sf), node.getEnd() - 1),
      ).line + 1,
    relationship,
  });
  const fileEvidence = (
    name: string,
    relationship: GraphEvidence['relationship'],
  ): GraphEvidence => ({
    commitSha: input.commitSha,
    filePath: name,
    startLine: 1,
    endLine: Math.max(1, (files.get(name) ?? '').split('\n').length),
    relationship,
  });
  function limit(code: string, message: string, ev: GraphEvidence) {
    if (graph.limitations.length >= 30000)
      throw new Error('Snapshot exceeds analyzer limitation limit.');
    graph.limitations.push({
      code,
      message,
      evidence: { ...ev, relationship: 'LIMITATION' },
    });
  }
  function edge(
    from: string,
    to: string | null,
    kind: Relationship,
    specifier: string,
    ev: GraphEvidence,
    resolution: GraphEdge['resolution'],
    limitation?: string,
  ) {
    if (graph.edges.length >= 60000)
      throw new Error('Snapshot exceeds analyzer edge limit.');
    graph.edges.push({
      id: `edge:${graph.edges.length}`,
      from,
      to,
      kind,
      specifier,
      resolution,
      evidence: { ...ev, relationship: kind },
      ...(limitation ? { limitation } : {}),
    });
  }
  const definitions = new Map<ts.Node, GraphNode>();
  const exportedSymbols = new Map<string, Map<string, GraphNode>>();
  const imports = new Map<ts.Node, { target?: string; imported: string }>();
  function symbol(
    sf: ts.SourceFile,
    node: ts.Node,
    name: string,
    kind: NodeKind,
    exported = false,
  ) {
    if (graph.nodes.length >= 30000)
      throw new Error('Snapshot exceeds analyzer node limit.');
    const result: GraphNode = {
      id: `symbol:${sf.fileName}:${node.getStart(sf)}:${kind}`,
      name,
      kind,
      filePath: sf.fileName,
      exported,
      evidence: evidence(sf, node, 'DEFINITION'),
    };
    graph.nodes.push(result);
    definitions.set(node, result);
    edge(
      fileId(sf.fileName),
      result.id,
      'CONTAINS',
      name,
      result.evidence,
      'SYMBOL',
    );
    if (exported)
      exportSymbol(
        sf,
        result,
        hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : name,
        node,
      );
    return result;
  }
  function exportSymbol(
    sf: ts.SourceFile,
    node: GraphNode,
    name: string,
    ast: ts.Node,
  ) {
    node.exported = true;
    const table =
      exportedSymbols.get(sf.fileName) ?? new Map<string, GraphNode>();
    table.set(name, node);
    exportedSymbols.set(sf.fileName, table);
    edge(
      fileId(sf.fileName),
      node.id,
      'EXPORTS',
      name,
      evidence(sf, ast, 'EXPORTS'),
      'SYMBOL',
    );
  }
  function declaration(node: ts.Node) {
    return checker.getSymbolAtLocation(node)?.declarations?.[0];
  }
  function hasJsx(node: ts.Node): boolean {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    )
      return true;
    return !!ts.forEachChild(node, (child) => hasJsx(child) || undefined);
  }
  for (const [name, text] of files) {
    graph.nodes.push({
      id: fileId(name),
      name,
      filePath: name,
      kind: 'FILE',
      exported: false,
      evidence: fileEvidence(name, 'DEFINITION'),
    });
    if (text === null)
      limit(
        'SOURCE_UNAVAILABLE',
        'Source text was not retained; this file cannot be analyzed.',
        fileEvidence(name, 'LIMITATION'),
      );
    else if (!sourcePattern.test(name) && !/\.json$/i.test(name))
      limit(
        'UNSUPPORTED_FILE',
        'Only JavaScript and TypeScript syntax is analyzed.',
        fileEvidence(name, 'LIMITATION'),
      );
  }
  // Parse JSONC only. Inherited config, plugins and project references are never loaded.
  const configs = new Map<
    string,
    { base: string; baseUrl: boolean; paths: Record<string, string[]> }
  >();
  for (const [name, text] of files) {
    if (path.basename(name) !== 'tsconfig.json' || text === null) continue;
    const result = ts.parseConfigFileTextToJson(name, text);
    if (result.error || !result.config || typeof result.config !== 'object') {
      limit(
        'CONFIG_INVALID',
        'Invalid tsconfig JSONC; aliases are unavailable.',
        fileEvidence(name, 'LIMITATION'),
      );
      continue;
    }
    const config = result.config;
    if (config.extends || config.references)
      limit(
        'CONFIG_UNSUPPORTED',
        'Config extends and project references are not followed. Only local compilerOptions.baseUrl/paths are used.',
        fileEvidence(name, 'LIMITATION'),
      );
    const options = config.compilerOptions ?? {};
    const base = path.normalize(
      path.join(
        path.dirname(name),
        typeof options.baseUrl === 'string' ? options.baseUrl : '.',
      ),
    );
    const aliases: Record<string, string[]> = Object.create(null);
    if (options.paths && typeof options.paths === 'object')
      for (const [key, targets] of Object.entries(options.paths)) {
        if (
          (key.match(/\*/g)?.length ?? 0) <= 1 &&
          Array.isArray(targets) &&
          targets.every(
            (t) => typeof t === 'string' && (t.match(/\*/g)?.length ?? 0) <= 1,
          )
        )
          aliases[key] = targets;
        else
          limit(
            'ALIAS_UNSUPPORTED',
            `Unsupported paths entry: ${key}`,
            fileEvidence(name, 'LIMITATION'),
          );
      }
    configs.set(path.dirname(name), {
      base,
      baseUrl: typeof options.baseUrl === 'string',
      paths: aliases,
    });
  }
  function candidate(name: string): string | undefined {
    name = path.normalize(name);
    if (!safePath(name)) return;
    const suffixes = [
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.json',
    ];
    const replacements: Record<string, string[]> = {
      '.js': ['.ts', '.tsx'],
      '.jsx': ['.tsx', '.ts'],
      '.mjs': ['.mts'],
      '.cjs': ['.cts'],
    };
    const extension = path.extname(name);
    const substituted = (replacements[extension] ?? []).map(
      (e) => name.slice(0, -extension.length) + e,
    );
    return [
      ...substituted,
      name,
      ...suffixes.map((e) => name + e),
      ...suffixes.map((e) => name + '/index' + e),
    ].find((p) => files.has(p));
  }
  function resolve(from: string, specifier: string): string | undefined {
    if (specifier.startsWith('.'))
      return candidate(path.join(path.dirname(from), specifier));
    let directory = path.dirname(from),
      config = configs.get(directory);
    while (!config && directory !== '.') {
      directory = path.dirname(directory);
      config = configs.get(directory);
    }
    if (!config) return;
    const keys = Object.keys(config.paths).sort(
      (a, b) =>
        Number(b === specifier) - Number(a === specifier) ||
        b.split('*')[0]!.length - a.split('*')[0]!.length,
    );
    for (const key of keys) {
      const [prefix, suffix] = key.split('*');
      if (
        suffix === undefined
          ? key !== specifier
          : !specifier.startsWith(prefix!) ||
            !specifier.endsWith(suffix) ||
            specifier.length < prefix!.length + suffix.length
      )
        continue;
      const wildcard =
        suffix === undefined
          ? ''
          : specifier.slice(
              prefix!.length,
              suffix ? -suffix.length : undefined,
            );
      for (const target of config.paths[key]!) {
        const found = candidate(
          path.join(config.base, target.replace('*', wildcard)),
        );
        if (found) return found;
      }
      return;
    }
    return config.baseUrl
      ? candidate(path.join(config.base, specifier))
      : undefined;
  }
  function moduleEdge(
    sf: ts.SourceFile,
    node: ts.Node,
    specifier: string | undefined,
    kind: Relationship,
  ) {
    const target =
      specifier === undefined ? undefined : resolve(sf.fileName, specifier);
    const reason = target
      ? undefined
      : specifier === undefined
        ? 'Non-literal dependency; target is unknown.'
        : 'Module is not resolvable inside this snapshot (external, missing or unsupported resolution).';
    edge(
      fileId(sf.fileName),
      target ? fileId(target) : null,
      kind,
      specifier ?? '<non-literal>',
      evidence(sf, node, kind),
      target ? 'FILE' : 'UNKNOWN',
      reason ?? 'File-level module dependency; symbol usage is not inferred.',
    );
    if (reason)
      limit(
        specifier === undefined ? 'UNKNOWN_DEPENDENCY' : 'UNRESOLVED_IMPORT',
        reason + (specifier ? ` ${specifier}` : ''),
        evidence(sf, node, 'LIMITATION'),
      );
    return target;
  }
  // Definitions are collected before relationships, including across cycles.
  for (const sf of parsed.values()) {
    for (const diagnostic of program.getSyntacticDiagnostics(sf)) {
      const line =
        sf.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
      limit(
        'SYNTAX_ERROR',
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        {
          ...fileEvidence(sf.fileName, 'LIMITATION'),
          startLine: line,
          endLine: line,
        },
      );
    }
    for (const node of sf.statements) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
        const name = node.name?.text ?? 'default';
        const component = /^[A-Z]/.test(name) && hasJsx(node);
        symbol(
          sf,
          node,
          name,
          component
            ? 'COMPONENT'
            : ts.isClassDeclaration(node)
              ? 'CLASS'
              : 'FUNCTION',
          exported,
        );
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) {
            limit(
              'SYMBOL_FALLBACK',
              'Destructured declaration is represented at file level.',
              evidence(sf, decl, 'LIMITATION'),
            );
            continue;
          }
          const callable =
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer));
          const component =
            callable &&
            /^[A-Z]/.test(decl.name.text) &&
            hasJsx(decl.initializer!);
          symbol(
            sf,
            decl,
            decl.name.text,
            component ? 'COMPONENT' : callable ? 'FUNCTION' : 'SYMBOL',
            exported,
          );
        }
      } else if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      )
        symbol(sf, node, node.name.text, 'SYMBOL', exported);
      else if (ts.isModuleDeclaration(node))
        limit(
          'SYNTAX_UNSUPPORTED',
          'Namespace/ambient module symbols are represented at file level.',
          evidence(sf, node, 'LIMITATION'),
        );
    }
    limit(
      'FILE_LEVEL_ANALYSIS',
      'Module dependencies are file-level. Nested declarations, call graphs, runtime injection and arbitrary React wrappers are not resolved; components are uppercase declarations containing JSX.',
      fileEvidence(sf.fileName, 'LIMITATION'),
    );
  }
  for (const sf of parsed.values()) {
    for (const node of sf.statements) {
      if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)) {
        const target = moduleEdge(
          sf,
          node,
          node.moduleSpecifier.text,
          'IMPORT',
        );
        const clause = node.importClause;
        if (clause?.name) imports.set(clause, { target, imported: 'default' });
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings))
            imports.set(clause.namedBindings, { target, imported: '*' });
          else
            for (const element of clause.namedBindings.elements)
              imports.set(element, {
                target,
                imported: element.propertyName?.text ?? element.name.text,
              });
        }
      } else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          moduleEdge(
            sf,
            node,
            literal(node.moduleSpecifier)
              ? node.moduleSpecifier.text
              : undefined,
            'REEXPORT',
          );
          limit(
            'SYMBOL_FALLBACK',
            'Re-export uses a file-level edge; barrel symbol provenance is not inferred.',
            evidence(sf, node, 'LIMITATION'),
          );
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            const local =
              checker.getExportSpecifierLocalTargetSymbol(element)
                ?.declarations?.[0];
            const found = local && definitions.get(local);
            if (found) exportSymbol(sf, found, element.name.text, node);
            else
              limit(
                'SYMBOL_FALLBACK',
                'Exported binding cannot be resolved to a local definition.',
                evidence(sf, node, 'LIMITATION'),
              );
          }
        }
      } else if (ts.isExportAssignment(node)) {
        const local = declaration(node.expression),
          found = local && definitions.get(local);
        if (found && !node.isExportEquals)
          exportSymbol(sf, found, 'default', node);
        else
          limit(
            'SYMBOL_FALLBACK',
            'Export expression is represented at file level.',
            evidence(sf, node, 'LIMITATION'),
          );
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (ts.isExternalModuleReference(node.moduleReference))
          moduleEdge(
            sf,
            node,
            literal(node.moduleReference.expression)
              ? node.moduleReference.expression.text
              : undefined,
            'REQUIRE',
          );
        else
          limit(
            'SYNTAX_UNSUPPORTED',
            'Import-equals namespace alias is not resolved.',
            evidence(sf, node, 'LIMITATION'),
          );
      }
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require' &&
            !declaration(node.expression)))
      )
        moduleEdge(
          sf,
          node,
          literal(node.arguments[0]) ? node.arguments[0].text : undefined,
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'DYNAMIC_IMPORT'
            : 'REQUIRE',
        );
      if (ts.isImportTypeNode(node))
        moduleEdge(
          sf,
          node,
          ts.isLiteralTypeNode(node.argument) && literal(node.argument.literal)
            ? node.argument.literal.text
            : undefined,
          'IMPORT',
        );
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        /^(module\.exports|exports\.)/.test(node.left.getText(sf))
      )
        limit(
          'SYNTAX_UNSUPPORTED',
          'CommonJS export assignment is represented at file level.',
          evidence(sf, node, 'LIMITATION'),
        );
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const [ast, binding] of imports) {
    if (!binding.target) continue;
    const target = exportedSymbols.get(binding.target)?.get(binding.imported);
    if (target)
      edge(
        fileId(ast.getSourceFile().fileName),
        target.id,
        'IMPORT_SYMBOL',
        binding.imported,
        evidence(ast.getSourceFile(), ast, 'IMPORT_SYMBOL'),
        'SYMBOL',
      );
    else
      limit(
        'SYMBOL_FALLBACK',
        `Imported ${binding.imported} uses a file-level dependency; namespace/barrel or unavailable symbol.`,
        evidence(ast.getSourceFile(), ast, 'LIMITATION'),
      );
  }
  // Express receivers must be bound to an imported express factory or Router.
  for (const sf of parsed.values()) {
    const factories = new Set<ts.Node>(),
      routers = new Set<ts.Node>(),
      receivers = new Set<ts.Node>();
    for (const node of sf.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !literal(node.moduleSpecifier) ||
        node.moduleSpecifier.text !== 'express' ||
        node.importClause?.isTypeOnly
      )
        continue;
      const clause = node.importClause;
      if (clause?.name) factories.add(clause);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) factories.add(bindings);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if (
            !element.isTypeOnly &&
            (element.propertyName?.text ?? element.name.text) === 'Router'
          )
            routers.add(element);
    }
    for (const node of sf.statements)
      if (ts.isVariableStatement(node))
        for (const decl of node.declarationList.declarations) {
          const call = decl.initializer;
          if (!call || !ts.isCallExpression(call)) continue;
          const isRequire =
            ts.isIdentifier(call.expression) &&
            call.expression.text === 'require' &&
            !declaration(call.expression) &&
            literal(call.arguments[0]) &&
            call.arguments[0].text === 'express';
          const factory = declaration(call.expression);
          const property = ts.isPropertyAccessExpression(call.expression)
            ? call.expression
            : undefined;
          const isReceiver =
            (factory && (factories.has(factory) || routers.has(factory))) ||
            (property?.name.text === 'Router' &&
              factories.has(declaration(property.expression)!));
          if (!isRequire && !isReceiver) continue;
          if (!(node.declarationList.flags & ts.NodeFlags.Const)) {
            limit(
              'ROUTE_UNSUPPORTED',
              'Mutable factory bindings are not used as Express receivers.',
              evidence(sf, decl, 'LIMITATION'),
            );
            continue;
          }
          if (isRequire) factories.add(decl);
          if (isReceiver) receivers.add(decl);
        }
    function reference(
      route: GraphNode,
      expression: ts.Expression,
      kind: 'ROUTE_HANDLER' | 'MIDDLEWARE',
    ) {
      const local = declaration(expression);
      let target = local && definitions.get(local)?.id;
      let resolution: GraphEdge['resolution'] = 'SYMBOL';
      const imported = local && imports.get(local);
      if (imported?.target) {
        target = exportedSymbols
          .get(imported.target)
          ?.get(imported.imported)?.id;
        if (!target) {
          target = fileId(imported.target);
          resolution = 'FILE';
        }
      }
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
        target = symbol(sf, expression, 'inline handler', 'FUNCTION').id;
      const reason = !target
        ? 'Handler expression is unsupported; dependency target is unknown.'
        : resolution === 'FILE'
          ? 'Handler binding is uncertain; falling back to its imported file.'
          : undefined;
      edge(
        route.id,
        target ?? null,
        kind,
        expression.getText(sf).slice(0, 200),
        evidence(sf, expression, kind),
        target ? resolution : 'UNKNOWN',
        reason,
      );
      if (reason)
        limit(
          'SYMBOL_FALLBACK',
          reason,
          evidence(sf, expression, 'LIMITATION'),
        );
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isElementAccessExpression(node.expression) &&
        receivers.has(declaration(node.expression.expression)!)
      )
        limit(
          'ROUTE_UNSUPPORTED',
          'Computed Express methods are not supported; use direct app/router.method calls.',
          evidence(sf, node, 'LIMITATION'),
        );
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const access = node.expression,
          receiver = declaration(access.expression),
          method = access.name.text;
        if (receiver && receivers.has(receiver)) {
          if (
            [
              'get',
              'post',
              'put',
              'patch',
              'delete',
              'options',
              'head',
              'all',
              'use',
            ].includes(method)
          ) {
            const routePath = node.arguments[0];
            if (method !== 'use' && !literal(routePath))
              limit(
                'ROUTE_UNSUPPORTED',
                'Route paths must be string literals. Regex, arrays and computed paths are not expanded.',
                evidence(sf, node, 'LIMITATION'),
              );
            else if (method !== 'use' && node.arguments.length < 2)
              limit(
                'ROUTE_UNSUPPORTED',
                'One-argument app.get is a settings lookup, not a route.',
                evidence(sf, node, 'LIMITATION'),
              );
            else {
              const route = symbol(
                sf,
                node,
                `${method.toUpperCase()} ${literal(routePath) ? routePath.text : '/'}`,
                'ROUTE',
              );
              edge(
                fileId(sf.fileName),
                route.id,
                'ROUTE_HANDLER',
                route.name,
                evidence(sf, node, 'ROUTE_HANDLER'),
                'SYMBOL',
              );
              const handlers = node.arguments.slice(literal(routePath) ? 1 : 0);
              handlers.forEach((handler, index) =>
                reference(
                  route,
                  handler,
                  method === 'use' || index < handlers.length - 1
                    ? 'MIDDLEWARE'
                    : 'ROUTE_HANDLER',
                ),
              );
            }
          } else if (method === 'route')
            limit(
              'ROUTE_UNSUPPORTED',
              'Chained router.route(path).get(...) is not supported.',
              evidence(sf, node, 'LIMITATION'),
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return graph;
}

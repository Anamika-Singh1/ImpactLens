# Phase 4: static repository explorer

The TypeScript 5.9 compiler API parses retained snapshot text with an in-memory compiler host. Repository code, package scripts, configuration plugins and configuration JavaScript are never executed. No repository filesystem reads, dependency installation, network resolution, emit or type checking take place.

## Run

Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, and `npm run build` after updating. Start the application with `npm run dev`. Open **Repositories**, select a repository, select an imported snapshot, and click **Analyze snapshot**. Owners and Engineers can analyze; Viewers can read existing graphs and source. Metadata-only repositories display an explicit no-snapshots state. The existing import API can provide real or demo snapshots; import and analysis are separate operations.

Analysis runs in a worker thread with a 45-second deadline, a 256 MiB old-generation heap limit and at most two concurrent analyses per API process. Inputs are capped at 5,000 files / 20 MiB of UTF-8 source, outputs at 30,000 nodes, 60,000 edges and 30,000 limitations. A failed or timed-out rerun preserves the previous stored graph. This is on-demand snapshot analysis, not the deferred release comparison/risk scoring pipeline.

## Graph and evidence

`StaticGraph` stores a versioned JSONB document per immutable repository snapshot. It contains file and symbol nodes, typed edges and limitations. The snapshot/repository/workspace composite foreign key enforces tenant ownership; graph replacement and its audit event commit atomically. The earlier `SourceSymbol` and `DependencyEdge` tables are reserved for future normalized indexing; the Phase 4 graph document is authoritative. Source previews read `SourceFile` independently, so graph responses do not duplicate source text.

Every node, edge and limitation retains commit SHA, repository-relative file path, inclusive 1-based line range, and relationship type. IDs are snapshot-local. Files use path IDs; symbol IDs include their declaration offset and kind. Never compare symbol IDs across commits as semantic identity.

Dependency edges point **from dependent to dependency**: an importer points to its imported file. `IMPORT`, `REEXPORT`, `DYNAMIC_IMPORT` and `REQUIRE` link files; `IMPORT_SYMBOL` links an importing file to a directly identifiable exported declaration. It describes a binding, not proof that the symbol executes. `ROUTE_HANDLER` and `MIDDLEWARE` link route registrations to handler definitions. File-to-route `ROUTE_HANDLER` edges retain the containing file's dependency on its registration. `CONTAINS` and `EXPORTS` are structural edges and excluded from reverse dependency traversal. Transitive traversal uses a visited set, terminates through cycles, excludes its starting node, and returns no dependents for disconnected nodes. Symbol call graphs are not inferred; file-level traversal is the conservative fallback.

Unresolved edges have `to: null` and `resolution: UNKNOWN`. Resolved module edges use `resolution: FILE`; supported binding/handler edges use `SYMBOL`. A file-level fallback carries a reason. Unknown dependencies are never converted into invented target nodes.

## Supported extraction

- All retained files become nodes. JS, JSX, TS, TSX, MJS, CJS, MTS and CTS are parsed. Top-level functions, classes, simple variable declarations, arrow/function-valued variables, interfaces, type aliases and enums become symbols. Export modifiers, local named exports and identifier default exports are recorded. Destructuring, namespaces, arbitrary export expressions and nested symbols fall back to file-level analysis.
- Static imports, side-effect imports, type imports, static re-exports, import-equals requires, literal dynamic imports and unshadowed `require(...)` calls become module edges. Non-literal `import(...)` and `require(...)` explicitly become unknown dependencies. CommonJS export assignments and parse errors produce limitations.
- Relative paths support source extensions, directory `index` files and `.js`→`.ts`/`.tsx`, `.jsx`→`.tsx`/`.ts`, `.mjs`→`.mts`, `.cjs`→`.cts` substitution. Resolution is case-sensitive and confined to retained snapshot paths. The nearest retained `tsconfig.json` is parsed as JSONC. Local `compilerOptions.baseUrl` and exact/single-wildcard `paths` entries are supported, with ordered fallback targets and longest-prefix matching. `extends`, project references, package exports, dependency packages, custom module resolvers and bundler configuration are not followed. Aliases without baseUrl are relative to their config directory; bare baseUrl resolution requires an explicit baseUrl. Missing/excluded sources stay unresolved.
- Direct imported symbol bindings resolve only to local exported definitions in their target file. Namespace imports and barrel symbol provenance remain file-level. Re-export edges still support file-level reverse traversal through barrels and cycles.
- React component identification is a heuristic: uppercase top-level function, arrow/function variable, or class declarations containing JSX. Wrappers such as `memo`, `forwardRef`, HOCs, anonymous default expressions and `createElement`-only definitions are not resolved as components. JSX presence does not prove React runtime behavior.

## Explicit Express rules

Supported receivers are top-level **const** bindings initialized with an imported Express factory or Router: default/namespace `import express from 'express'`, named `import { Router as makeRouter } from 'express'`, `const express = require('express')`, followed by `const app = express()`, `const router = express.Router()` or `const router = makeRouter()`. Type-only imports are excluded. Identifier bindings are checked against declarations, so a shadowing function parameter named `app` is not mistaken for the outer Express app.

Direct calls `app.get/post/put/patch/delete/options/head/all('/literal', ...handlers)` and `app.use([literalPrefix,] ...middleware)` create registration nodes. Non-substituted template literals are accepted. Direct local/imported handler identifiers and inline arrow/function handlers are supported. Earlier arguments in a route registration are middleware; its final argument is the handler. Inline functions get source-located symbol nodes. App/router variables mounted via `use` are retained as references; mounted prefixes are **not** composed into endpoint paths.

Computed/regex/array route paths, computed methods and `.route(path).get(...)` chains produce limitations for recognized receivers. One-argument `app.get` is treated as a settings lookup. Mutable factory bindings, arbitrary factories, receiver aliases, destructured CommonJS factories, arrays/spreads of handlers, middleware factory calls and namespace/property handler expressions are unsupported. Unsupported handler expressions keep unknown edges. Registrations under conditions describe syntax, not guaranteed runtime registrations. Object mutation or custom Express wrappers are not modeled.

## API and UI

Under `/api/workspaces/:workspaceId/repositories/:repositoryId/snapshots`:

- `GET /` lists snapshots and graph metadata.
- `GET /:snapshotId/files` lists retained files; `GET /:snapshotId/files/:fileId` reads source.
- `GET /:snapshotId/graph` returns the saved graph, or `graph: null` before analysis.
- `POST /:snapshotId/graph` computes and atomically saves the graph. Session, CSRF and `analyses:manage` permission are enforced; permission is checked again before persistence.

The explorer includes a collapsible directory tree, numbered source preview with symbol highlighting, searchable/filterable graph, keyboard-selectable nodes, incoming/outgoing evidence, transitive dependents and limitations. The drawing is bounded to 60 matching nodes / 240 edges, with explicit notices; all nodes remain available through the matching-node selector and all selected-node relationships remain in details. Unknown targets appear in dependency details. Snapshot selection keeps deleted files accessible in older snapshots.

## Acceptance

`fixtures/static-analysis/base.json`, `head.json` and `expected.json` cover aliases, relative paths, barrels, cycles, disconnected files, React, Express middleware, non-literal dynamic imports and a deleted file still imported in the head snapshot. These are owned fixture contents, not executable setup scripts.

Run `npm test` for exact graph/evidence/traversal assertions, `npm run test:integration` for real persistence, tenant foreign-key isolation and Viewer/Engineer permissions, and `npm run test:e2e` for source navigation, analysis, graph search and deleted-file snapshot switching. `npm run check:migrations` applies migrations twice to an isolated temporary PostgreSQL schema. The browser test saves `test-results/explorer.png`.

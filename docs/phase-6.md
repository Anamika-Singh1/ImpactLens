# Phase 6: saved change-impact comparisons

Open **Analyses**, choose a repository and select base and head snapshots. Both snapshots must already have a static graph from the repository explorer. Owners and Engineers can compare; Viewers can read saved results. Comparing a snapshot with itself is allowed and produces no file changes.

The comparison uses two imported commit trees in the selected direction. It does not compute a pull request merge base or import new commits. GitHub pull request selection remains deferred. Existing draft-analysis endpoints remain available, but drafts are not completed comparisons and are not listed here.

## Diff and potential impact

Content hashes identify changed, added and deleted files. A rename requires an exact-content match unique among both added and deleted files; ambiguous matches remain additions/deletions. A bounded line diff identifies overlapping static symbols. Missing retained source and large diffs fall back to whole-file review. New imports retain an inventory of regular archive files, including hashes for excluded content. Older snapshots explicitly report an incomplete inventory. Symlinks, submodules and external LFS objects are outside the regular-file inventory.

Both base and head graphs contribute cycle-safe reverse dependency paths. Deleted code can therefore retain base-side evidence. Cross-file traversal is conservative and operates at file granularity. Same-file direct symbol evidence requires changed-line overlap. Each evidence path records commit, changed lines, symbols, typed dependency edges, mapping ID/version, original snapshot and confirmer label.

Only currently confirmed mappings with recorded source anchors participate. Mapping resolution uses the same conservative rules as feature review. A changed, missing or ambiguous anchor remains unresolved and may contribute limited evidence at its historical path; it is never silently remapped or confirmed. Suggestions and rejected mappings do not contribute. Changes that reach no confirmed mappings explicitly request manual review. A lack of affected features is not evidence of safety.

## Review priority and test evidence

Priority is the sum of transparent factors: business criticality (5/15/25/35), direct/transitive/unresolved relationship (25/15/10), shared reverse dependency reach (2 per file, capped at 15), missing linked tests (10) or incomplete/nonpassing imported outcomes (5), and analysis uncertainty (15). The rubric is stored with every comparison. It is a fixed default in this release; there is no user-facing rubric editor. Scores are review rankings, not failure probabilities, and are not capped at 100.

Linked tests come from reverse dependencies of mappings resolved at head. Only results for exact test paths in the head snapshot count. Every linked file must have only passing imported outcomes to avoid the testing-evidence increment. Missing, failing, skipped and unknown results remain visible. Static test relevance and passing outcomes do not prove coverage. [Phase 7](phase-7.md) adds test-result ingestion and separate evidence-backed recommendations.

Configuration and dependency-manifest changes request broader regression review. Graph limitations, incomplete inventories, unresolved mappings and unavailable diffs are visible separately from feature findings.

## Persistence and resource limits

The API reads snapshots, graphs, features, confirmed mapping revisions and available tests in a repeatable-read transaction, then computes in a worker thread. Comparisons are limited to two concurrent computations per API process, 32 MiB of serialized input, 256 MiB worker old-generation memory and 45 seconds. The bounded diff uses at most one million LCS cells per file. Failed computations do not create partial saved results.

The completed `Analysis` stores immutable input/result JSON, engine version and canonical SHA-256 hashes. A database trigger rejects subsequent updates. Source is retained internally for reproduction but is omitted from comparison list/detail responses. Detail exposes source evidence, semantics and rubric. Later feature edits, mapping rejection, graph reanalysis and test imports do not rewrite saved comparisons; run a new comparison to refresh evidence. Creation and its audit event commit together, with membership rechecked before persistence. Workspace/repository/snapshot scope and CSRF protection apply to every route.

Routes beneath `/api/workspaces/:workspaceId/repositories/:repositoryId/comparisons`:

- `GET /`: up to 100 most recent completed comparison summaries, without inputs/results.
- `POST /`: `{ baseSnapshotId, headSnapshotId }`; returns saved detail.
- `GET /:analysisId`: saved detail with result, provenance, semantics and rubric.

Apply `npm run db:migrate`, run `npm run db:generate`, then build. On Windows, stop API/worker processes before regenerating Prisma if they hold the engine DLL open.

## Verification

Engine tests cover line insertion/deletion, exact and ambiguous renames, large/unavailable source fallback, cycles, transitive and deleted-code evidence, same-file symbol precision, unresolved anchors, head-only test outcomes, mixed results, configuration warnings and deterministic hashes. PostgreSQL integration verifies reproduction, immutability, retained results after mapping rejection, CSRF, role restrictions and cross-tenant access. The browser workflow compares snapshots and inspects priority, mapping provenance and saved results after reload; its artifact is `test-results/change-impact.png`.

Run `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run check:migrations`, `npm run build` and `npm run format:check`.

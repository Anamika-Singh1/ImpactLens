# Phase 10: measured fixture evaluation and operational hardening

The [preserved benchmark report](evaluation/report.md) contains actual five-run measurements and the [raw samples](evaluation/measurements.json). The [commerce fixture](../fixtures/commerce/README.md) documents independent ground truth, held-out cases and reproduction. This evaluation concerns one small synthetic application; it does not establish production savings or general accuracy. The analyzer was not tuned to its predictions.

See [verification results](evaluation/verification.md) for the completed unit, integration, browser and isolated migration checks and the exact rerun commands.

## Controlled evaluation

Ten reproducible commit scenarios cover shared authentication, checkout-only code, unrelated React component text, renamed cart code, deleted order modules, a dependency cycle, computed dynamic behavior and three deliberate implementation bugs. Five predeclared feature mappings and eight known test cases are retained in source. Four scenarios are held out. Precision/recall use scenario-feature pairs, with false positives and misses recorded by feature name. Named test failures demonstrate fault detection; process errors do not count as detection.

The benchmark builds both source graphs and resolves the original confirmed mapping anchors using the production mapping logic before computing impact. It measures graph/mapping/impact duration, process peak RSS, child wall time, and real selected/full test-suite wall time. All measured samples and commit identities are retained. The selection policy uses confirmed feature/test associations and conservative full-suite fallback for unknown behavior. It executes only owned fixture tests in a separate `controlled-fixture-benchmark` CI job. Imported source and its scripts remain unexecuted.

## Permission and deletion workflows

- `DELETE /api/workspaces/:workspaceId/repositories/:repositoryId`: Owner only, CSRF/origin protected. Removes snapshots, retained source, graphs, features/mappings, saved comparisons, review history, artifacts and import records through database cascades. Jobs are canceled before removal; old Redis payloads cannot recreate missing database jobs. Audit events retain the original repository UUID in immutable `repositoryRef`; the database clears only the live repository relation. Cached explanations for the workspace are cleared.
- `DELETE .../test-evidence/artifacts/:artifactId`: Owner/Engineer only, CSRF/origin protected. Removes the artifact, explicit test mappings and mirrored JUnit runs/cases. Legacy recommendation references to removed test cases are cleared. Immutable saved comparison inputs still contain their original evidence copies; repository deletion removes these copies.

Both screens require an explicit in-product confirmation naming the removal scope. Canceling the dialog changes nothing. Every deletion rechecks and locks current membership in its database transaction and looks up records through their full workspace/repository scope. Deletion and its audit record commit together. Concurrent data changes can return 409 rather than partially delete. Audit metadata and daily AI budget accounting remain; repository removal is not user-account or upstream GitHub deletion.

Apply the new audit-deletion migration before starting the API. It requires PostgreSQL 15+ column-specific `ON DELETE SET NULL`; Compose uses PostgreSQL 17. This keeps the required workspace field intact. Prisma cannot express selective-column nulling for composite relations, so this FK is managed by SQL migrations and documented in the schema. The audit trigger allows only the database's parent-removal FK cleanup; callers cannot clear a live relation or rewrite historical content.

## Job deadlines, cancellation, restarts and cleanup

Static graph and comparison jobs run in worker threads, with a 45-second deadline, a 256 MiB old-generation heap bound and two concurrent computations per API service/process. They do not retry malformed work automatically. Premature HTTP response close or request abort cancels the computation. The concurrency slot is held until the worker terminates; timers and listeners are removed on every exit. Cancellation is checked again before database publication. A transaction already committed before a disconnect remains a complete saved result.

Imports have a two-minute end-to-end abort signal (network and archive work), 500 ms cancellation polling, three persisted attempts per generation, bounded backoff (up to the provider's one-hour retry-after bound), and one BullMQ stalled recovery. DB operations also have finite connection/pool and transaction timeouts. Retry counts live in PostgreSQL, so losing Redis cannot reset the budget. Explicit user retry starts a new generation. Dispatcher reads queued and running outbox rows and uses deterministic Redis IDs. Cancellation/generation/status are checked under the import-job publication lock. Snapshot/file writes and completion/audit are one transaction; crashes cannot expose partially committed snapshots or rewrite saved comparisons.

Import archives are never extracted to disk. Compressed bytes are wiped and released in `finally`; temporary graph workers terminate after successful or failed work. Retained source strings and intermediate decoded buffers are reclaimed by the runtime, not guaranteed secure erasure. Import-worker graceful shutdown has a 15-second outer deadline; forced termination leaves a recoverable DB outbox row, not a partial snapshot. Benchmark children have a 60-second deadline and a 2 MiB output bound; only verified newly created temporary fixture directories are recursively removed.

Tests cover actual worker-thread crashes/replacement, canceled analysis with no published graph, immutable saved comparisons after replacement computations, reconstruction of a lost queue entry, idempotent imports, persisted attempt limits, aborting timeout, late-returning canceled imports, archive-buffer cleanup, scoped deletion, and viewer/outsider/CSRF rejection. Restart recovery is tested through controlled worker and outbox failure states; production multi-host failover latency and crash-at-every-instruction durability are not measured.

## Validation and logs

Archive tests reject traversal, absolute/backslash/reserved-name paths, symlinks, multiple roots, case collisions, duplicate entries, malformed compression, too many entries and over-limit downloads. Cancellation produces no retained result. Artifact tests reject malformed/deep XML, DTD/XXE/custom entities, invalid/unknown schemas, duplicate identities, invalid counts, CI-path traversal and decoded UTF-8 payloads above 2 MiB. The HTTP layer rejects dangerous filenames, future timestamps, missing permissions and mismatched record scopes. Provenance strings are labels, never fetched as URLs.

Request logs contain request ID, method, declared route template, status and elapsed time. They omit query values, raw paths/parameters, bodies, headers and raw errors. Unknown paths are logged as `[unmatched]`. A captured-log test injects credential markers in the path, query, headers, body and thrown error and verifies their absence in logs and error responses. Worker dependency errors also use fixed messages. Operators must configure reverse proxy/provider/platform logs separately; the application cannot guarantee their redaction.

## Verification

```powershell
npm.cmd run services:up
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run check:migrations
npm.cmd run format:check
npm.cmd run benchmark
```

Docker Desktop must be running and unpaused for HTTP/database/browser checks. Benchmark measurements require no Docker services. All benchmark dimensions that are not measured are listed in the report with reproduction or validation instructions; no simulated timing is reported.

# Phase 11 verification record

Local packaging verification completed on 2026-10-01 on Windows with Docker Desktop Linux containers (Engine 29.7.2). No image was pushed, public service published or paid resource created. The [Phase 10 benchmark](evaluation/report.md) remains unchanged.

## Source checks

| Command                    | Actual result                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run lint`         | Passed.                                                                                                                                                                 |
| `npm.cmd run typecheck`    | Passed.                                                                                                                                                                 |
| `npm.cmd run format:check` | Passed.                                                                                                                                                                 |
| `npm.cmd run check:env`    | Passed: API/worker reject missing required variables.                                                                                                                   |
| `npm.cmd test`             | API 27, analyzer 31, ingestion 19 and shared 5 tests passed. Web startup hit a sandbox filesystem denial; separate unrestricted web rerun passed both tests (84 total). |
| `npm.cmd run build`        | Shared, ingestion, analyzer, API and worker compiled. Web hit the same sandbox denial; `npm.cmd run build -w @impactlens/web` outside the sandbox passed.               |

The Windows sandbox denied esbuild access while resolving `apps/web/vite.config.ts` through parent directories. Both web commands passed outside the sandbox without source changes. This is an execution-environment limitation, rather than a successful sandboxed full-suite run.

## Local container checks

Docker Desktop was initially stopped and was started for these checks. Commands run from the repository root:

| Command                                                                                            | Actual result                                                                 |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docker compose -f compose.demo.yaml config --quiet`                                               | Passed, including after the Compose correction.                               |
| `docker compose -f compose.demo.yaml --profile setup build`                                        | All four image targets built: API, worker, web and migrate.                   |
| `docker compose -f compose.demo.yaml up -d --wait postgres-demo redis-demo`                        | Both dependencies healthy.                                                    |
| `docker compose -f compose.demo.yaml run --rm migrate`                                             | All 12 migrations applied successfully on retry after image export completed. |
| `docker compose -f compose.demo.yaml up -d --wait api worker web`                                  | All five services healthy after migrations.                                   |
| `docker compose -f compose.demo.yaml run --rm seed`                                                | Synthetic workspace and Viewer account seeded successfully.                   |
| `node scripts/verify-demo.mjs`                                                                     | Passed before and after API/worker restart.                                   |
| `npx.cmd playwright test --config playwright.smoke.config.ts`                                      | One browser smoke test passed before and after restart.                       |
| `docker compose -f compose.demo.yaml restart api worker` followed by `up -d --wait api worker web` | Both processes restarted and all services returned healthy.                   |

The API check returned the same saved result hash before and after restart: `93c5ee475022839895dd81a52028961eb6eaa7585ef731debb2f0a7fe61e2c80`. Checkout and Order history each retained two evidence paths, with one recommendation, two coverage gaps and the `CHANGES_REQUESTED` review. Browser smoke verified those findings, reload persistence, a visible expanded source path and HTTP 403 for a Viewer mutation.

Initial attempts exposed these issues, recorded here rather than counted as passes:

- Applications were started before migrations completed during heavy image export. Worker dispatch failed and migrations hit P1008 socket timeout. Applications were stopped; migration retry after export succeeded, followed by healthy startup.
- Compose built the identical migration target under both `migrate` and `seed`, exporting the same image tag twice. Docker reported a missing parent snapshot while creating the seed container. Removed the duplicate seed build declaration; seed now reuses the migration image. Build and seed were rerun successfully.
- Browser smoke navigated before sign-in completed and selected hidden explanation text for its source assertion. It now waits for the authenticated UI and expands the actual evidence path before checking the source link. Both subsequent smoke runs passed.

The demo remains running at **http://localhost:8080**, bound to loopback. Sign in as `viewer@example.test` with `Synthetic demo passphrase 123!`. Stop with `docker compose -f compose.demo.yaml down`; this retains its dedicated synthetic volumes.

## Remaining evidence

Public HTTPS deployment, remote CI execution, backup restore rehearsal, multi-host failover and production load testing have not been performed by this verification. Existing Phase 10 integration/browser evidence is recorded separately; it is not a fresh Phase 11 rerun.

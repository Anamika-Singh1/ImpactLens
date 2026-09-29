# Phase 1: foundation

## Decisions and implemented scope

- One modular NestJS API, a separate worker, and a React application. No microservices or provider integrations.
- The initial migration creates an empty Repository table, unique by owner/name. Import endpoints arrive later.
- The analyzer is a capability contract, not an analysis implementation. TypeScript compiler API is the planned parser.
- The worker connects to Redis through BullMQ and permanently rejects unexpected jobs as unsupported. It never executes repository code or installs repository dependencies.
- Server configuration is validated before listening or connecting. Frontend configuration is public; provider keys must never go there.
- Liveness stays available during dependency outages. Readiness queries actual dependencies and reports each result. Redis retries permit recovery.
- Each readiness dependency check has a three-second response deadline. PostgreSQL connection/query timeouts are also set in the example URL.
- Prisma CLI lives at the workspace root. The root override pins `deepmerge-ts` to 8.0.2 to address GHSA-ggr8-5vv4-36mx in Prisma 6's configuration dependency; client generation and migration commands were verified with the override. Revisit the override when upgrading Prisma.
- DTO validation rejects unexpected fields and invalid types. A test-only controller exercises validation because Phase 1 has no product mutation endpoint.
- JSON logs include bounded validated request IDs, method, path, status, and request duration; no request bodies, headers, or raw dependency exceptions.
- Feature pages describe planned capabilities. Missing imported evidence never implies that no tests exist. Potential impact is not confirmed breakage.

## Manual acceptance checklist

- Follow README setup with fresh Docker volumes. Confirm the initial migration applies and a second run has no pending migrations.
- Open Overview; verify API ready, PostgreSQL up, and Redis up.
- Navigate to Repositories, Features, Analyses, Test Evidence, and Settings. Confirm honest empty states and no fabricated metrics.
- Run `docker compose stop redis`, refresh Overview, and verify degraded readiness while liveness remains 200. Run `docker compose start redis` and refresh to verify recovery.
- Stop the API and refresh Overview. Verify the connection error and Retry control. Restart the API and retry.
- Run `npm.cmd run check:redis -w @impactlens/worker`; verify exit code 0 and the connection log.
- Temporarily remove a required variable from a server `.env`, restart that process, and verify an error naming the variable. Restore afterward. Shell environment variables override dotenv, so unset those too when testing missing configuration.
- Request an unknown API route and inspect the error envelope and matching `x-request-id` header.

## Limitations

This is a local development foundation without authentication or an internet deployment configuration. Compose provisions PostgreSQL and Redis; application containers and production deployment are deferred. React Flow, repository authorization/import, comparisons, evidence ingestion, and reports belong to later phases. Dynamic imports, runtime dependency injection, cross-service calls, and arbitrary framework patterns are outside the initial static-analysis scope. No business-savings, accuracy, or performance claims have been measured.

## Verification record

Verified locally on Windows PowerShell with Node 24.11.1 and Docker Desktop on 2026-09-29:

| Check                                                            | Result                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Clean dependency installation                                    | Passed; npm audit reported zero vulnerabilities at verification time                                  |
| `npm run services:up` equivalent (`docker compose up -d --wait`) | Both containers healthy; PostgreSQL uses host port 55432                                              |
| `npm run db:generate`                                            | Prisma client generated successfully                                                                  |
| `npm run db:migrate`                                             | Initial migration applied to the empty database; repeat run had no pending migrations                 |
| `npm run build`                                                  | All five workspaces built, including the production Vite bundle                                       |
| `npm test`                                                       | 9 passed: 4 Jest HTTP tests, 2 frontend Vitest tests, 3 environment-schema Vitest tests               |
| `npm run check:env`                                              | API and worker exited with status 1 and named missing required variables                              |
| Worker `check:redis`                                             | Connected to the real Redis instance and exited successfully                                          |
| `npm run test:e2e`                                               | All 3 Playwright tests passed: real healthy API/navigation, connection error, pending request/loading |
| `npm run dev`                                                    | Web, API, contract watcher, and BullMQ worker started; worker reported ready                          |
| Vite proxy health request                                        | HTTP 200, PostgreSQL up and Redis up                                                                  |
| Redis outage and recovery                                        | While stopped: readiness 503 and Redis down, liveness 200; after restart: readiness 200               |
| Lockfile                                                         | `npm ci --dry-run --ignore-scripts` accepted the resolved dependency lock                             |

The Overview screenshot was inspected for the application shell. Hosted GitHub Actions and Linux execution have not been run in this session. Application-container deployment, production hardening, and future analysis capabilities remain outside Phase 1.

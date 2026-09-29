# ImpactLens

Evidence-backed release review for JavaScript and TypeScript repositories. Phase 1 provides the foundation. Repository import, analysis, evidence ingestion, and reports are not implemented yet. There are no seeded metrics or customer records.

## Windows PowerShell setup

Prerequisites: Node.js 22.12+ (Node 22 LTS recommended), npm, Git, and Docker Desktop with Linux containers. Start Docker Desktop and wait for its engine. Run from the repository root:

```powershell
npm.cmd ci
npm.cmd run env:init
npm.cmd run services:up
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

Open http://localhost:5173. API: http://127.0.0.1:3000. Vite forwards `/api` requests to the backend. Ctrl+C stops the application processes. `npm.cmd run services:down` stops PostgreSQL and Redis, retaining volumes. On Linux/macOS, replace `npm.cmd` with `npm`. The scripts are cross-platform. Using `npm.cmd` avoids PowerShell execution-policy restrictions without changing your policy.

`env:init` creates missing environment files without overwriting existing ones. Root `.env` configures Compose. `apps/api/.env` configures Prisma and the API. `apps/worker/.env` configures the worker. `apps/web/.env` contains public browser/proxy configuration only. The example database password is a disposable local placeholder; keep root credentials and the API connection URL in sync. Changing credentials after a database volume exists also requires updating its database account. Both infrastructure ports bind to loopback.

## Checks

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run check:env
npm.cmd run check:redis -w @impactlens/worker
npx.cmd playwright install chromium
npm.cmd run test:e2e
Invoke-RestMethod http://127.0.0.1:3000/api/health/live
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
```

Run HTTP checks while the API is running. Playwright starts web/API after a build or reuses existing local servers. Its shell test requires healthy PostgreSQL and Redis; start Compose first. GitHub Actions runs setup, migrations, builds, unit/HTTP tests, and browser checks. PostgreSQL uses local port 55432 to reduce conflicts with existing installations; change root `POSTGRES_PORT` and the API database URL together if needed.

Liveness returns 200 when the process is serving. Readiness runs a PostgreSQL query and Redis PING, returning 200 only if both succeed, or 503 with dependency states. Missing required variables fail startup with named configuration errors. Other API errors use `{ error: { code, message, requestId, timestamp } }`. Responses expose `x-request-id`; structured JSON request logs omit bodies and headers.

## Files and architecture

| Path                       | Responsibility                                                      |
| -------------------------- | ------------------------------------------------------------------- |
| `apps/web`                 | React, Vite, Tailwind, navigation, live API health and empty states |
| `apps/api`                 | NestJS/Express, Prisma schema and migration, validation and logging |
| `apps/worker`              | Separate BullMQ process and Redis lifecycle                         |
| `packages/shared`          | API contracts and environment validation                            |
| `packages/analyzer`        | Explicit capability boundary for future deterministic analysis      |
| `fixtures`                 | Reserved for owned analysis fixtures                                |
| `docs`                     | Phase decisions and verification                                    |
| `.github/workflows/ci.yml` | Automated verification                                              |

Use the tracked `package-lock.json` with `npm ci` for reproducible installs. This initial backend uses NestJS 11, Prisma 6.19, and TypeScript 5.9. Compatibility references: [Prisma 6 requirements](https://docs.prisma.io/docs/orm/v6/reference/system-requirements) and [Vite setup](https://vite.dev/guide/).

See [Phase 1 notes](docs/phase-1.md) for decisions, limitations, and manual acceptance.

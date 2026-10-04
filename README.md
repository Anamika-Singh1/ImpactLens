# ImpactLens

Release reviewers need to know which customer workflows a code change could affect and what evidence supports testing them. A diff shows changed files; it rarely connects shared dependencies to business features or makes missing test evidence visible.

ImpactLens connects immutable JavaScript/TypeScript snapshots, dependency paths, human-confirmed business features, imported CI artifacts and recorded reviewer decisions. Static potential impact is not proof of failure, and recommendations are not test execution.

The workflow is: import authorized snapshots → inspect dependencies → confirm feature mappings → compare base/head trees → review recommended tests and coverage gaps → record a decision with rationale → export the saved review. Owner/Engineer/Viewer permissions protect each workspace. Optional AI explains existing evidence; the core synthetic workflow needs no GitHub or AI credentials.

## Try the isolated demo

Prerequisites: Git, Docker Engine/Desktop with Linux containers and Compose v2, disk space for builds, and internet access for initial base images/locked dependencies. Start Docker Desktop first. Run from this repository's root in PowerShell or a POSIX shell:

```sh
docker compose -f compose.demo.yaml --profile setup build
docker compose -f compose.demo.yaml up -d --wait postgres-demo redis-demo
docker compose -f compose.demo.yaml run --rm migrate
docker compose -f compose.demo.yaml up -d --wait api worker web
docker compose -f compose.demo.yaml run --rm seed
```

Open **http://localhost:8080**. Sign in as **viewer@example.test** with **Synthetic demo passphrase 123!**. Open Analyses and the saved `111111111111 → 222222222222` comparison. It shows a pricing change, dependency paths to Checkout/Order history, a recommended checkout test, missing current coverage and a recorded Request Changes decision. Source, commit labels, sample evidence and reviewer are synthetic. The Viewer cannot edit this workspace.

Stop with `docker compose -f compose.demo.yaml down`; dedicated demo volumes retain data. See [demo and five-minute script](docs/demo.md) for smoke checks and an explicitly scoped reset. Web binds loopback; this is not a public hosting configuration.

## Development setup

Use Node.js 22.12+, npm, Git and Docker Compose. Images/CI use Node 22. On PowerShell use `npm.cmd`/`npx.cmd` to avoid execution-policy changes; on Linux/macOS use `npm`/`npx`. These commands use the separate development database and web port 5173:

```sh
npm ci
npm run env:init
npm run services:up
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

Open **http://localhost:5173**, matching WEB_ORIGIN. Register to create an Owner workspace; use **Repositories** to connect GitHub, grant selected repository access and import a branch, or click **Import sample repository** without GitHub credentials. The [frontend repository access guide](docs/repository-access.md) covers user steps and one-time server App configuration. Vite proxies `/api` to the loopback API. Ctrl+C stops app processes. `npm run services:down` stops development PostgreSQL/Redis and retains volumes. `env:init` creates missing files without overwriting them. PostgreSQL defaults to port 55432, Redis 6379. Keep root credentials and API/worker URLs synchronized; disposable example credentials are for local use only.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run check:migrations
npm run check:env
npm run check:redis -w @impactlens/worker
npx playwright install chromium
npm run test:e2e
npm run format:check
```

Type checking follows the initial build because workspace imports resolve generated declarations. Integration/browser tests require migrated, healthy development services. Container smoke uses the separately seeded demo: `npx playwright test --config playwright.smoke.config.ts`.

GitHub Actions installs from the lockfile, lints/types/builds, runs unit/integration/browser checks, executes the controlled fixture benchmark separately, and builds containers plus a synthetic smoke check. Workflows never push images. [Phase 11 verification](docs/phase-11-verification.md) records actual local commands/results, unresolved issues and manual steps; remote CI execution is not implied.

## Architecture and portfolio

| Deliverable                                                      | Reference                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Architecture diagram and boundaries                              | [Architecture](docs/architecture.md)                                                                         |
| ER diagram and database constraints                              | [Data model](docs/data-model.md)                                                                             |
| Production packaging, HTTPS, migrations, backup/restore/rollback | [Deployment](docs/deployment.md)                                                                             |
| Environment and secrets                                          | [Environment reference](docs/environment.md), [retention and credentials](docs/retention-and-credentials.md) |
| API contracts and routes                                         | [API](docs/api.md), [route inventory](docs/api-routes.md)                                                    |
| Analysis methodology and limitations                             | [Methodology](docs/methodology.md)                                                                           |
| Actual measurements                                              | [Benchmark report](docs/evaluation/report.md), [verification](docs/evaluation/verification.md)               |
| Five-minute demonstration                                        | [Demo script](docs/demo.md)                                                                                  |
| Trade-offs and lessons                                           | [Case study](docs/case-study.md)                                                                             |
| Verified resume templates                                        | [Resume bullets](docs/resume-bullets.md)                                                                     |
| Completed features and future work                               | [Roadmap](docs/roadmap.md)                                                                                   |

The controlled commerce benchmark measured **100% precision and 93.8% recall** across ten synthetic scenarios (four held out), with five repeated runs. All three deliberate bug scenarios were detected. One dynamic-behavior impact was missed; broader testing detected its known failure. The report records per-scenario runtime/RSS and fallback rates. **Fixture results are not production-savings or general-accuracy claims.** Reproduce with `npm run benchmark` after building.

Source layout: `apps/web` (React), `apps/api` (NestJS/Prisma), `apps/worker` (BullMQ imports), `packages/analyzer` (bounded AST/impact computation), `packages/ingestion` (validated imports/artifacts), `packages/shared` (contracts/config). Historical decisions live in `docs/phase-*.md`. Imported customer code is never installed or executed. No public deployment has been performed.

# Five-minute synthetic demonstration

The local demo is an isolated, safely resettable environment. Its database is `impactlens_demo` on `postgres-demo`; its named volumes belong only to Compose project `impactlens-demo`. PostgreSQL/Redis and API/worker ports are private. Web binds loopback at http://localhost:8080. GitHub and AI are disabled. The provided account is a Viewer and cannot mutate the saved demo workspace; ordinary registration still exists, so this is not a public read-only hosting configuration.

Build and start from the repository root:

```sh
docker compose -f compose.demo.yaml --profile setup build
docker compose -f compose.demo.yaml up -d --wait postgres-demo redis-demo
docker compose -f compose.demo.yaml run --rm migrate
docker compose -f compose.demo.yaml up -d --wait api worker web
docker compose -f compose.demo.yaml run --rm seed
```

Login: `viewer@example.test` / `Synthetic demo passphrase 123!`. The synthetic reviewer account has a random undisclosed password and its bootstrap session is logged out. Seed refuses a production environment or any other database host/name. A partially failed seed must be reset; an already seeded Viewer is reported without duplicating data. The fixed SHAs are **synthetic labels**, not GitHub commits. Sample JUnit evidence is visibly labeled as synthetic, not a test execution claim.

| Time      | Show                                                                                   | Explain                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:40 | Login; open Analyses, select the saved comparison                                      | Release reviewers need to connect a code change to business workflows and verification evidence.                                                                                      |
| 0:40–1:25 | Base/head changed-file evidence; open pricing source in Repository explorer            | `total(quantity)` changed from `quantity * 2` to `quantity * 3`; no customer repository is involved.                                                                                  |
| 1:25–2:15 | Expand an impact path and open original mapped source                                  | Checkout and order history both depend on pricing. Commit/path/line evidence explains why those features need review. Static reachability is potential impact, not proof of failure.  |
| 2:15–3:20 | Recommended `knownCheckoutTotal`, artifact provenance, coverage gaps                   | The explicit checkout mapping recommends a known test. The sample belongs to the base commit; current execution and order-history coverage are missing. Broader testing is justified. |
| 3:20–4:20 | Release decision: Revision 1 Request Changes, reviewer rationale; download JSON report | The reviewer requests current checkout evidence and order-history coverage. The decision is recorded against this immutable result. Viewer controls prevent edits.                    |
| 4:20–5:00 | Reload; show the preserved decision; open benchmark report                             | Explain confirmed mappings, bounded workers and reproducible fixture measurements. State that no production savings were measured.                                                    |

Run the controlled smoke check after Chromium is installed:

```sh
npx playwright install chromium
npx playwright test --config playwright.smoke.config.ts
```

Stop while retaining demo data: `docker compose -f compose.demo.yaml down`. To reset **only this disposable demo**, run `docker compose -f compose.demo.yaml down --volumes --remove-orphans`, then repeat the start/seed commands. This removes both demo volumes and any demo-created accounts; never use this command with the production file or against valuable data. No reset endpoint exists. Public demonstration, external DNS/TLS, analytics and hosting require separate authorization/configuration.

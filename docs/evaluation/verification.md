# Phase 10 verification status

The preserved report and raw samples are a completed evaluation: all ten scenarios ran five times, with real full/selected test execution, named fault detection, duration and peak-memory measurements. The fixture ground-truth hash and source bytes match the preserved run. A subsequent measurement attempt was interrupted by host/Git timeout; it did not replace these completed samples. No unavailable timing is substituted with an estimate.

A final one-run-per-scenario runner check reproduced every original base/head Git commit, ground-truth hash, predicted feature set and deterministic analysis-result hash. Its timings do not replace the five-run measurements. Node processes and temporary repositories were cleaned up at completion.

Completed checks:

- Full application build, including API, worker and web.
- All 81 unit tests passed in the final full workspace run, including archive/artifact limits and rejection, encryption tampering, captured-log redaction, worker timeout/cancellation/crash/replacement and Redis-unavailable shutdown.
- All 41 integration tests passed in four suites, including all seven hardening PostgreSQL/HTTP scenarios: lost-queue recovery/idempotence, persisted retry budget, timeout, cancellation/generation fencing and buffer cleanup, analysis replacement/immutability, artifact permissions/deletion and saved-evidence retention, and repository deletion with immutable audit-reference preservation.
- Both browser comparison/review and test-evidence checks passed, including artifact deletion, repository deletion, confirmation dialogs and reload persistence.
- The corrective audit-deletion migration applied successfully to the local database and the API rebuilt. Formatting passed.
- All 12 migrations applied to an isolated empty schema; a second deployment found no pending migrations, confirming idempotence. The temporary schema was cleaned up.

No Phase 10 verification checks remain pending. Earlier runs encountered paused Docker services. On continuation, Docker Desktop and the services started successfully; the full integration and browser checks passed. The first migration check encountered a PostgreSQL connection-pool timeout during service startup; the retry passed once PostgreSQL was responsive. To reproduce these checks, keep Docker Desktop running and unpaused, then run from the repository root:

```powershell
npm.cmd run services:up
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run test:integration
npm.cmd run test:e2e -- tests/e2e/test-evidence.spec.ts tests/e2e/comparisons.spec.ts
npm.cmd run check:migrations
npm.cmd run format:check
```

No production dataset accuracy, savings, multi-host recovery latency, container memory or browser-fixture latency was measured. To extend evaluation, use a new owned or explicitly authorized fixture corpus with independently authored expectations and a new held-out split. For failover measurements, use isolated staging PostgreSQL/Redis, two worker processes and controlled import jobs; interrupt one worker during ingestion, time recovery and verify one complete snapshot and unchanged saved analyses. Container memory requires externally sampling that isolated benchmark container rather than interpreting Node RSS as container use. Browser interaction requires a dedicated fixture browser harness; current commerce tests use React server rendering and HTTP only. Imported customer test scripts remain unexecuted.

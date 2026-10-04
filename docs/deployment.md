# Deployment and recovery

This is a provider-neutral, single-host packaging procedure. No service was published and no paid resource was created. Official documentation was checked on 2026-10-01: [Docker production Compose](https://docs.docker.com/compose/how-tos/production/), [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/), [BullMQ connections](https://docs.bullmq.io/guide/connections), and [PostgreSQL 17 backup/restore](https://www.postgresql.org/docs/17/backup-dump.html). No cloud-provider-specific procedure is included. Recheck the chosen provider's official documentation before adding one.

## Images and dependencies

The root multi-stage Dockerfile builds `api`, `worker`, `web` and the one-shot `migrate` target. Builds use `npm ci`, generated Prisma clients and production compilation. API/worker run as `node`, Nginx runs as `nginx`; runtime Compose services have read-only filesystems, temporary `/tmp`, dropped capabilities and no public database, Redis, API or worker ports. The migration image intentionally includes the Prisma CLI and build dependencies. Base tags receive upstream updates; release operators should pin reviewed base digests and record image digests after rebuilding/scanning. CI builds locally and never pushes images.

Use PostgreSQL **17** (the verified version). The column-specific composite foreign-key deletion migration requires PostgreSQL 15 or newer, but other versions have not been acceptance-tested. Provision UTF-8, durable storage, private network access, backup capacity and a migration principal with schema/table/trigger DDL permissions. Use a separate runtime principal with the required table/sequence privileges where supported. Prisma migrations contain custom constraints and triggers: `db push` is not a deployment substitute. Connection URLs need finite connect/pool/socket timeouts; size each API and worker Prisma pool against the database connection budget.

Use Redis **7.4**, private connectivity and `maxmemory-policy noeviction`. BullMQ requires persistent connections and appropriate command access. Configure AOF/persistence and monitor storage/memory. Queue loss is recovered from PostgreSQL import outbox rows, within persisted retry limits, but Redis loss also resets ephemeral authentication rate limits and invalidates AI cache/budget counters. Do not treat Redis as an interchangeable eviction cache. Use authentication/ACLs and TLS (`rediss://`) when crossing untrusted networks. No multi-host failover latency or production load sizing is measured.

## Same origin, HTTPS and credentials

Point a single HTTPS origin at the web container's port 8080 through an operator-managed TLS edge. Nginx serves the SPA and forwards `/api/` without stripping its prefix. Browser builds use `/api`; no provider secrets enter Vite variables. `WEB_ORIGIN` must exactly match the public HTTPS origin, with no path/trailing slash. CORS accepts that single origin; CSRF protection also requires that origin and a session token on mutations. Production sessions use `__Host-impactlens_session`, Secure, HttpOnly, SameSite=Lax, path `/`, no Domain. HTTP production login cannot work with Secure cookies. The loopback HTTP demo intentionally uses development cookie settings and must stay local.

The TLS edge must redirect HTTP to HTTPS, provide valid certificates and set HSTS after HTTPS is verified. It must reach only web, never bypass web to reach API. Host port 8080 binds loopback by default; a remote edge needs a deliberately configured private binding/network. Keep API, worker health ports and backing services inaccessible to public clients.

`TRUSTED_PROXIES` defaults to no trust and accepts explicit IPv4 addresses/CIDRs, not `true`, hop counts or a blanket `/0`. Configure the exact private Nginx peer addresses/subnet only if forwarded client information is needed. Nginx replaces incoming forwarded headers and reports its directly observed peer. With an additional TLS edge, that peer is the edge: configure Nginx `set_real_ip_from` for the exact edge addresses and `real_ip_header` only after confirming the edge sanitizes forwarding headers. Then trust Nginx at the API. Never broadly trust an entire internet-facing network. Without that customization, IP rate limits can group clients behind the proxy. Cookie security depends on production configuration and browser HTTPS, rather than a client-supplied forwarded-protocol header.

Copy `deploy/production.env.example` to ignored `deploy/production.env`. Replace private URLs and origin, set real secrets through the deployment secret manager or restricted environment file, and keep it out of logs, images and exports. URL-encode credentials. GitHub/AI remain disabled until explicitly configured. See [environment reference](environment.md) and [credential retention](retention-and-credentials.md). Keep API/worker encryption keys identical and back them up separately from encrypted database credentials.

## Release procedure

Run from the checked-out release on the target Docker host. Choose a new unique `RELEASE_TAG`; never overwrite a tag used for rollback. The commands below are manual deployment steps, not executed against a public host.

```sh
docker compose -f compose.production.yaml --profile release build
docker compose -f compose.production.yaml run --rm migrate
docker compose -f compose.production.yaml up -d --wait api worker web
docker compose -f compose.production.yaml ps
```

Set `RELEASE_TAG` in your shell or a private Compose environment file before all four commands. First configure private PostgreSQL/Redis, credentials, DNS, TLS edge, firewall and backups. Take and verify a database backup before upgrading. For this single-host procedure, drain traffic and stop the old API/worker before deploying migrations that may affect running code; expect maintenance downtime. A failed migration blocks application startup: diagnose it, use Prisma's documented recovery procedure after inspecting the database, and never automatically mark it applied. Only one release job runs migrations. Do not run migrations from API/worker startup.

## Health, shutdown and restarts

API `/api/health/live` checks process serving; `/api/health/ready` checks PostgreSQL and Redis with finite deadlines. Worker `/live` and `/ready` on internal port 3001 check process/dependencies, worker state and recent successful outbox dispatch. Web `/health/live` checks Nginx; API readiness is separate. Container health checks report readiness. Compose's restart policy restarts exited processes, **not merely unhealthy containers**: monitoring/orchestration must alert or replace unhealthy instances. Nginx may return 502 temporarily while API restarts.

SIGTERM/SIGINT trigger API Nest cleanup with a 20-second outer deadline. Worker stops accepting health traffic, stops dispatch, drains workers and closes Prisma/Redis, with a 15-second outer deadline. Compose grants 25/20 seconds respectively and uses `init` for Node processes. Imports are generation-fenced, published atomically and reconstructed from QUEUED/RUNNING PostgreSQL jobs after restart. Crashed analysis threads never publish partial results. Deadline termination can interrupt active work; the persisted outbox/retry budget governs recovery. Re-run readiness and a synthetic smoke check after every restart/upgrade.

## Backup, restore and rollback

Use PostgreSQL 17 client tools. Supply credentials through a restricted `.pgpass`/`PGPASSFILE` and configure `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`; do not put passwords in shell history. Use plain PostgreSQL connection settings, excluding Prisma-only URL parameters such as `schema`. Save dumps to a protected, encrypted backup location:

```sh
pg_dump --format=custom --no-owner --no-acl --file=impactlens-release.dump
pg_restore --list impactlens-release.dump
createdb --template=template0 impactlens_restore_check
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=impactlens_restore_check impactlens-release.dump
psql --dbname=impactlens_restore_check --command='ANALYZE;'
```

`--file` avoids binary stdout redirection problems in PowerShell. The restore target must be a newly created, empty database; these instructions never overwrite the live database. Run application health checks and inspect saved comparisons, reviews, source and audit references against the restored database. Reapply runtime grants because owner/ACL metadata is intentionally omitted. Back up role/grant definitions and encryption keys separately. Agree on backup cadence, retention, off-host copies, access control, tested recovery objectives and optional WAL/PITR with the operator. Logical dumps provide a consistent database snapshot; they do not include Redis, keys, downloaded exports or cluster-wide roles.

Retain prior API/web/worker **image digests together** and the migration version. To roll application code back, set `RELEASE_TAG` to the retained compatible release and recreate all three application services; verify readiness and smoke tests. Forward migrations remain applied. Only roll back to code compatible with the current schema. There are no automatic down migrations. If incompatible, take the service offline and restore the verified pre-upgrade backup into a new database, point the old release at it and verify before reopening traffic. This loses post-backup writes unless reconciled; do not silently reverse schema changes or discard current data. Retain the old database for controlled reconciliation. A restore rehearsal and public HTTPS deployment remain operator tasks; see [verification](phase-11-verification.md).

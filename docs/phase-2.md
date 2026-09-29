# Phase 2: authentication, authorization, and core model

## Implemented behavior

Registration creates a user, default workspace, Owner membership, session, and workspace audit event atomically. Login rotates both session ID and CSRF token. Logout deletes the current server session and expires the cookie. The current-user response includes safe user fields, current memberships, CSRF token, and expiration; it never includes password hashes or session bearer tokens.

The browser restores sessions from the HttpOnly cookie, keeps the CSRF token only in memory, and has no localStorage authentication tokens. It includes sign-in/registration, workspace switching, sign-out, Owner workspace/member controls, role-aware repository metadata/feature forms, and existing loading/error/empty states. Membership changes take effect on the next backend request; browser membership labels refresh on focus.

## Session and request protections

- Argon2id: 19 MiB memory, 2 iterations, parallelism 1, independently generated salts. Passwords are 12–128 characters and are not trimmed or silently truncated.
- Sessions: 256-bit random IDs, SHA-256 hashes stored in PostgreSQL. Authenticated absolute TTL defaults to 24 hours, configurable from 1–168 hours with `SESSION_TTL_HOURS`. Anonymous CSRF-bootstrap sessions expire after 15 minutes. There is no sliding extension. Expiration is checked on every authenticated request; expired rows are pruned during anonymous-session creation.
- Cookies: HttpOnly, Path=/, no Domain, SameSite=Lax. Production adds Secure and uses the `__Host-impactlens_session` name. Production `WEB_ORIGIN` must be HTTPS. Development uses `impactlens_session`.
- Every mutation, including registration/login/logout, requires an exact matching `Origin` and session-bound `X-CSRF-Token`. CSRF token comparison is constant-time. First obtain the bootstrap cookie and token from `GET /api/auth/csrf`. CORS allows credentials only for the configured origin.
- Responses use Cache-Control: no-store. JSON logs omit headers/bodies; passwords, cookies, and CSRF tokens are not logged.
- Redis-backed fixed-window rate limits: CSRF bootstrap 60/IP/10 minutes; registration 10/IP/10 minutes; login 30/IP and 10/normalized account/10 minutes. Keys hash identities. A 429 has Retry-After: 600. A Redis failure refuses authentication attempts rather than disabling limits.
- Unknown accounts and incorrect passwords both return 401 “Invalid email or password”; unknown accounts also run Argon2 verification. Invalid input returns 400 through DTO validation.
- Express does not trust X-Forwarded-For. The local server binds to loopback. A future reverse-proxy deployment must configure and test trusted proxy addresses deliberately; otherwise rate limits see the proxy's IP and are shared by its users. The intended production topology is HTTPS with web/API under the same site; cross-site cookies are not supported.
- Email verification, password reset, MFA, session management across devices, ownership transfer, and invitation email delivery are not included.

These choices follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Backend permissions

| Capability                                                      | Owner | Engineer | Viewer |
| --------------------------------------------------------------- | ----- | -------- | ------ |
| Read workspace, members, repositories, features, analyses       | Yes   | Yes      | Yes    |
| Edit workspace and manage Engineer/Viewer memberships           | Yes   | No       | No     |
| Register repository metadata                                    | Yes   | Yes      | No     |
| Create features and explicit source mappings                    | Yes   | Yes      | No     |
| Create draft analyses for existing snapshots                    | Yes   | Yes      | No     |
| Read workspace audit log                                        | Yes   | No       | No     |
| Manage integrations (reserved permission; connections deferred) | Yes   | No       | No     |
| Record reviews (reserved permission; endpoint deferred)         | Yes   | Yes      | No     |

Every workspace route resolves membership from the authenticated user and URL workspace ID. Missing/foreign workspaces and mismatched repository IDs return 404; unauthenticated protected requests return 401; insufficient role or CSRF returns 403. Repository queries include workspace scope, and composite foreign keys reject cross-tenant/cross-repository associations. Frontend visibility is convenience only, not an authorization control. There is no PostgreSQL row-level security in this phase; SQL credentials remain trusted backend-only credentials.

## Endpoints

All paths below start with `/api`. POST/PATCH/DELETE require the cookie, matching Origin, and X-CSRF-Token.

| Method/path                                                                           | Behavior                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET /auth/csrf                                                                        | Anonymous or existing-session CSRF bootstrap                          |
| POST /auth/register                                                                   | Name/email/password; returns current user and default Owner workspace |
| POST /auth/login                                                                      | Email/password; rotates session and returns current user              |
| POST /auth/logout                                                                     | Revokes current session; 204                                          |
| GET /auth/me                                                                          | Authenticated current user and memberships                            |
| GET /workspaces                                                                       | Only this user's memberships                                          |
| GET, PATCH /workspaces/:workspaceId                                                   | Read workspace / Owner updates its name                               |
| GET, POST /workspaces/:workspaceId/members                                            | Read members / Owner adds an already registered account               |
| PATCH, DELETE /workspaces/:workspaceId/members/:userId                                | Owner changes Engineer/Viewer role or removes that membership         |
| GET, POST /workspaces/:workspaceId/repositories                                       | Read/register metadata; no GitHub access granted                      |
| GET /workspaces/:workspaceId/repositories/:repositoryId                               | Scoped repository lookup                                              |
| GET, POST /workspaces/:workspaceId/repositories/:repositoryId/features                | Read/create explicit business features                                |
| POST /workspaces/:workspaceId/repositories/:repositoryId/features/:featureId/mappings | Link a feature to an existing source file in a snapshot               |
| GET, POST /workspaces/:workspaceId/repositories/:repositoryId/analyses                | Read/create DRAFT records; no job is enqueued                         |
| GET /workspaces/:workspaceId/audit-events                                             | Owner reads latest 100 audit events                                   |

Phase 1 health endpoints remain unauthenticated and bypass session database lookups; liveness stays independent of auth dependencies.

## Setup and migrations (PowerShell)

```powershell
npm.cmd ci
npm.cmd run env:init
npm.cmd run services:up
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run dev
```

Use **http://localhost:5173**, matching the default `WEB_ORIGIN` exactly. Using 127.0.0.1 as the browser origin with localhost configured will correctly fail CSRF checks. Existing Phase 1 environment files remain valid; SESSION_TTL_HOURS defaults to 24. No signing secret is required for opaque, server-stored sessions. Stop an old API process and restart after migrating so it uses the new generated client.

## Files changed

- `apps/api/src/auth/*`: session service/controller, global guard, permission matrix, Redis rate limiting.
- `apps/api/src/database.module.ts`, `workspaces/workspaces.controller.ts`: database lifecycle and scoped workspace/member/repository/feature/draft-analysis endpoints.
- `apps/api/prisma/schema.prisma`, three Phase 2 migration folders: related model, keys, indexes, immutable SHA references, evidence constraints.
- `apps/api/src/app.module.ts`, `http.ts`, `health.controller.ts`: module wiring, cookie parsing, credentialed CORS, no-store responses, health exemption.
- `apps/web/src/session.tsx`, `AuthScreen.tsx`, `WorkspaceSettings.tsx`, `Repositories.tsx`, `CoreRecords.tsx`, application shell and styles: authenticated UI and real workspace data.
- `packages/shared/src/index.ts`, `env.ts`, API environment example: session contracts and configuration validation.
- API integration tests, browser fixtures/specs, test configuration, root/workspace manifests and lockfile, CI, README, and these docs.

See [the ER diagram and constraints](data-model.md).

## Verification

Verified locally on Windows PowerShell, Node 24.11.1, PostgreSQL 17, and Redis 7.4:

| Check                                    | Result                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma validation and client generation  | Passed                                                                                                                                         |
| Phase 1 database upgrade                 | All three Phase 2 migrations applied                                                                                                           |
| Empty-schema migration and repeat deploy | All four migrations applied; repeat run had no pending migrations; isolated schema removed                                                     |
| All workspace builds                     | Passed, including API and production web bundle                                                                                                |
| Unit/HTTP regression tests               | 10 passed (4 API, 2 frontend, 4 environment validation)                                                                                        |
| Real PostgreSQL/Redis integration suite  | 17 passed: authentication, CSRF, role and tenant isolation, revocation, expiry, rate limiting, immutable evidence, and database constraints    |
| Playwright browser tests                 | 6 passed: UI registration, session reload/logout/login, Owner settings and repository persistence, navigation, loading, and connection failure |
| Missing-variable startup checks          | API and worker both rejected missing required configuration                                                                                    |
| Formatting and lockfile checks           | Passed; npm ci dry run accepted the lockfile                                                                                                   |
| Production dependency audit              | Zero reported vulnerabilities at verification time                                                                                             |

Integration tests require PostgreSQL and Redis; they create uniquely named test accounts/workspaces and delete only those fixtures. They never reset or truncate the database. Browser tests do the same. Rate-limit test namespaces are unique per run and expire automatically. An earlier failed cleanup left four fixture accounts; these were explicitly removed after the cascade-order fix.

Hosted GitHub Actions and Linux execution have not been run in this session. Production cookie options and HTTPS-origin validation were tested, but a deployed HTTPS/reverse-proxy environment was not. GitHub integration connections, actual repository import, analysis execution, and test/evidence ingestion remain deferred; the schema and reserved permissions do not imply those workflows are implemented.

## Manual acceptance

1. Register in a fresh browser context. Confirm an Owner workspace and that reload preserves the session.
2. Sign out, then sign back in. Inspect DevTools: the session cookie is HttpOnly, no token exists in localStorage.
3. Register a second account in a separate browser profile. As Owner, add its email as Viewer in Settings.
4. In the second profile, select the shared workspace. Read repositories/features and confirm mutation controls are absent. A manually sent mutation with a valid CSRF token must still return 403.
5. Change the member to Engineer as Owner. Verify repository/feature metadata creation works and workspace settings remain Owner-only.
6. Send a request with a workspace/repository ID from the other profile's private workspace; verify 404 and no record disclosure.
7. Send a mutation without X-CSRF-Token or with a different Origin; verify 403.
8. Remove the shared membership. Its next backend request must fail even with the same login session.

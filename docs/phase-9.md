# Phase 9: human release decisions and reports

Each completed saved comparison has an independent release decision history. Owners and Engineers can record **Approve**, **Request Changes**, or **Needs More Evidence**. Viewers can read decisions and download the JSON report. Approval records a human judgment; it is never proof of runtime correctness or release safety.

## Evidence and rationale

The panel lists high-priority features (score 60 or above), limited or unresolved mappings, missing/nonpassing linked test results, analysis unknowns, broader review requests, whole-file precision, test-evidence coverage gaps and unmapped changes. These concerns use the immutable saved result, so later mapping edits and test imports do not refresh the evidence. Create another comparison to incorporate new evidence.

A rationale is mandatory for Request Changes, Needs More Evidence, approval with any concern, and changing an existing decision. Approval with complete recorded evidence and no concerns permits an optional rationale. Review priority is a deterministic attention rubric, not a safety score. Concerns are retained alongside each decision.

## Provenance and concurrency

Every new review retains the exact base/head commit pair, analysis result hash, reviewer ID and name at decision time, timestamp, sequential revision, outcome and rationale. Changing the prior outcome creates an override; repeating an outcome still appends a review. Historical records remain visible. Legacy reviews are labelled because their original concern snapshot was not captured.

Submissions carry the commit pair, result hash and expected latest revision. An analysis-row database lock serializes writers across API instances; stale requests return 409 and require reloading. Membership is rechecked and locked within the write transaction. Review and audit creation are atomic. A database trigger rejects updates/deletes while the parent analysis exists and rejects new reviews unbound to a completed comparison. Parent deletion may cascade history as part of normal workspace removal.

## Routes and export

- `GET /api/workspaces/:workspaceId/repositories/:repositoryId/comparisons/:analysisId/reviews?page=1`: latest decision, readiness concerns, and history, newest first; 20 records per page.
- `POST` to the same review route: CSRF protected, Owner/Engineer only. Body: `{ outcome, comment?, expectedRevision, baseSha, headSha, resultHash }`. Unknown fields are rejected; rationale is limited to 4,000 characters.
- `GET .../comparisons/:analysisId/report`: versioned JSON download with repository identity, commit pair, comparison semantics, engine and hashes, saved findings and evidence paths, test evidence, ordered review history, relevant audit events and explicit limitations.

Reports exclude snapshot source text, authentication data and AI explanations. Reviewer text and repository labels remain escaped text in the UI. Export reflects one consistent database snapshot. An explicit error replaces exports above 10,000 reviews; they are never silently truncated. Exporting and recording reviews do not alter analysis results or execute any tests or release actions. Audit actor names reflect current accounts; review records preserve names at decision time.

Apply migrations and regenerate Prisma before starting the API. Verification includes rationale policy unit tests, PostgreSQL/HTTP role/CSRF/scope checks, stale and concurrent writes, database immutability, pagination, export provenance and browser decision/override/reload/download checks.

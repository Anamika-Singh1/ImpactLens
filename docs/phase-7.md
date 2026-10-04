# Phase 7: CI test evidence

Open **Test Evidence**, choose a repository and import an artifact with its commit SHA, runner, run timestamp and CI provenance. Owners and Engineers can import and map tests; Viewers can inspect them. Run tests in your CI environment and upload the resulting files. ImpactLens does not execute repository code.

## Formats and provenance

- `JUNIT`: XML test outcomes, with testcase IDs or identities derived from suite, class and test names. Outcomes provide no source-coverage attribution.
- `ISTANBUL`: JSON suite-level statement coverage with matching statement, function and branch maps/counts. It does not identify individual tests.
- `LCOV`: suite-level line coverage. Named `TN` sections do not establish individual-test attribution.
- `PER_TEST`: version 1 JSON with explicit identities and covered paths, lines or symbols. See `fixtures/test-evidence/per-test.json` for the schema example. File-only associations remain inferred.

Artifacts are capped at 2 MiB of decoded UTF-8 content. Parsing rejects malformed formats, duplicate test identities, traversal paths, XML DTD/entity declarations and oversized structures. Absolute CI paths require a declared checkout root; normalization never reads server files. Producer-declared commits and timestamps are not CI attestations. Timestamps more than five minutes in the future are rejected.

Imports retain the original content, parsed representation, SHA-256, runner, commit, source, run time and importer label. The database rejects artifact updates. List/detail responses omit raw content. Audit records and artifacts commit atomically. JUnit imports for an existing snapshot also populate its test outcomes.

Choose a review commit to display mismatches. Evidence older than 30 days is stale, measured from the declared run time. Re-uploading does not reset its age. Lists show the most recent 200 imports.

## Test mappings and recommendations

An explicit feature-to-test mapping records a known imported identity, rationale and confirmer. It establishes an association, not coverage. Removing a mapping does not change saved comparisons.

New snapshot comparisons freeze available artifacts, mappings and the evaluation time. Recommendations distinguish direct per-test line/symbol evidence, inferred file or historical evidence, explicit manual associations and weak name matches. Each includes artifact provenance and commit/age status. Aggregate coverage never generates individual test identities.

Coverage gaps distinguish absent artifacts, changed lines without demonstrated execution, missing individual mappings, stale/mismatched evidence and incomplete analysis. Only fresh exact-head evidence contributes positive changed-line coverage. A symbol hit does not prove every line in its declaration ran. Uncertainty prompts broader CI regression review. Saved comparison results retain their original evidence and age evaluation; create a new comparison to refresh them.

The current comparison limit is 200 repository artifacts, 1,000 selected recommendations and the existing 32 MiB input/45-second worker limits. Artifact archival has no UI or API in this release; repositories over the artifact limit cannot create new comparisons. Existing saved comparisons remain readable.

## API and setup

Routes under `/api/workspaces/:workspaceId/repositories/:repositoryId/test-evidence`:

- `GET /artifacts` and `GET /artifacts/:artifactId`, optionally with `commitSha` for mismatch status.
- `POST /artifacts`: format, commitSha, runner, recordedAt, filename, source, optional sourceRoot and content.
- `GET /mappings`, `POST /mappings` (featureId, artifactId, testIdentity, rationale), and `DELETE /mappings/:mappingId`.

Workspace scope, role permissions and CSRF protections apply. Apply migrations and regenerate Prisma before building. Run `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run check:migrations` and `npm run build`. Integration/browser checks require PostgreSQL and Redis. Parser and recommendation tests cover malformed input, path normalization, evidence distinctions, stale/commit mismatches and frozen comparisons. HTTP regression tests cover ordinary JSON requests and the larger artifact upload limit; browser coverage exercises import, provenance and mapping persistence.

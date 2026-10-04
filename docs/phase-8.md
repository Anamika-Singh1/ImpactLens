# Phase 8: optional grounded explanations

Saved comparisons now include a separate plain-language explanation panel. Core imports, comparisons, deterministic findings and test evidence work without an LLM key. Reading a comparison never invokes a provider. A deterministic template explains recorded facts, conditional business consequences and proposed test scenarios by default.

## Consent and configuration

AI sharing is disabled for every workspace, including existing workspaces. Only an Owner can enable it in Settings. Consent is audited and enforced again when reserving a provider request. An Owner or Engineer must explicitly click **Generate AI explanation**; Viewers may read a previously cached explanation. Revocation clears cached explanations and discards the result of in-flight requests, but cannot recall data already sent.

Set these variables only in `apps/api/.env`:

```dotenv
AI_PROVIDER=openai
AI_API_KEY=your-server-side-key
AI_MODEL=your-structured-output-capable-model-identifier
AI_MAX_INPUT_TOKENS=12000
AI_MAX_OUTPUT_TOKENS=1500
AI_TIMEOUT_MS=15000
AI_DAILY_REQUEST_LIMIT=20
AI_DAILY_TOKEN_LIMIT=100000
```

The default provider is `disabled`; the key and model default to empty. Missing credentials or model cause local fallback, including after workspace opt-in. No keys are accepted from the browser or returned by settings endpoints. Model identifiers are operator-selected; use a pinned identifier when stable output behavior matters. Apply migrations, regenerate Prisma, and build before starting the application.

The backend `ExplanationProvider` interface permits other implementations through Nest dependency injection. The supplied OpenAI adapter uses the [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) with `store: false`, no tools and [strict structured output](https://developers.openai.com/api/docs/guides/structured-outputs). Provider retention policies still apply; disabling response storage is not a claim of zero retention. No live provider calls are needed for the test suite.

## Data minimization and grounding

The provider receives an allow-listed projection: opaque evidence aliases, counts, change status/precision, impact relationship/confidence, business criticality, linked-test counts and coverage-gap categories. No source text, comments, names, file paths, routes, test identities/results, commit identifiers, artifact provenance, reviewer identities, repository names or credentials are included. Strings from repository content are never interpreted as instructions. The system instruction also explicitly treats evidence as untrusted data.

Evidence aliases (`E-A`, `E-F-0`, `E-C-0`, `E-G-0`) resolve locally to JSON pointers in the immutable saved result. Feature evidence also exposes its existing feature/mapping IDs. These are scoped references to recorded findings, not new findings. Local labels are rendered as escaped text; no model HTML or Markdown is executed.

AI composition is deliberately constrained: it selects and orders supported statement types, conditional consequence types and proposed scenario types. The server renders these selections into approved plain-language sentences. Arbitrary model-authored factual prose is rejected, even when it cites a valid ID. This avoids presenting a syntactically valid but invented factual claim as grounded. The validator rejects unknown fields, nonexistent evidence aliases, duplicate items, unsupported statement types and type-incompatible references. The overview is mandatory. Limited-confidence claims require limited-confidence evidence.

The AI-assisted panel is labelled separately from recorded findings. Consequences are always conditional. Every scenario says **Suggestion — not executed**, does not claim an existing test, and requires a reviewer to define applicable inputs and expected behavior. Explanations have no mechanism to execute actions, change findings, recalculate priority or update review decisions.

## Limits, caching and failure isolation

At most 20 features, 20 changed files and 10 coverage gaps enter a request; truncation is displayed and the overview retains full counts. Input token limits use a conservative UTF-8 byte bound over the request plus 1,024 tokens reserved for message framing, rather than a character/token heuristic. The provider receives an explicit output-token limit. Responses are capped at 128 KiB, redirects are rejected, and provider calls have an aborting timeout with no automatic retries.

Daily UTC request counts and conservative input/output token reservations are stored in PostgreSQL. Workspace-row locking makes reservations atomic across API instances. Failed, rejected and timed-out calls retain their reservations, preventing retry storms from bypassing limits. These are conservative budgets, not actual billing totals. At most two provider calls run per API process; concurrent equivalent requests within a process share work. Separate instances may each reserve an equivalent request before a cache is populated, but remain subject to the shared daily budget.

Validated structured plans are cached per workspace by saved analysis result content, prompt/schema version, provider and configured model identifier. Cache reads are revalidated. No raw provider errors or invalid content are stored or exposed. Consent changes clear the workspace cache. Cache storage is separate from immutable analyses, so provider failures cannot invalidate or mutate an analysis. Failures, refusals, malformed responses, exhausted limits and missing configuration return a deterministic explanation with a visible fallback reason. Cache/usage persistence requires the normal database service.

## Routes and validation

- `GET /api/workspaces/:workspaceId/ai-settings`: consent, provider readiness and usage; no secrets.
- `PATCH /api/workspaces/:workspaceId/ai-settings`: `{ "enabled": true|false }`, Owner only, CSRF protected.
- `GET /api/workspaces/:workspaceId/repositories/:repositoryId/comparisons/:analysisId/explanation`: cached AI or deterministic template, no external call.
- `POST` to the same explanation route: explicit generation, Owner/Engineer only, CSRF protected.

Unit tests cover injection-bearing labels, redaction, invalid references and unsupported claims, deterministic templates, cache identities, response bounds/refusals and provider request settings. PostgreSQL/HTTP integration uses a fake provider to test consent, roles, isolation, caching, immutable analyses, limits, timeouts, failure fallback and in-flight revocation. Browser tests cover visible local fallback, evidence references and explicit consent/revocation. Run the normal build, unit, integration, browser, migration and formatting checks.

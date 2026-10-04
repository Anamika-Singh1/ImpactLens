# Environment reference

`npm run env:init` copies missing example files without overwriting current values. API configuration is validated at startup; worker validates its subset. Root `.env` is for development Compose. API/worker `.env` files are development conveniences; production receives runtime environment from `deploy/production.env` or a secret manager. Browser values are public. Docker excludes all real `.env` files.

| Variable                                      | Consumer                         | Default / requirement                                                                                    |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| NODE_ENV                                      | API/worker                       | development; production enables Secure host cookies and HTTPS origin validation                          |
| PORT / HOST                                   | API                              | 3000 / 127.0.0.1; containers set 0.0.0.0                                                                 |
| WEB_ORIGIN                                    | API                              | Required exact HTTP(S) origin, HTTPS in production; single CORS/CSRF allow-list entry                    |
| TRUSTED_PROXIES                               | API                              | Empty; comma-separated explicit IPv4 addresses/CIDRs; see deployment trust boundary                      |
| DATABASE_URL                                  | API/worker/migrate               | Required postgresql:// URL; production private network/TLS as appropriate                                |
| REDIS_URL                                     | API/worker                       | Required redis:// or rediss:// URL                                                                       |
| WORKER_HEALTH_PORT                            | Worker                           | 3001, internal only                                                                                      |
| LOG_LEVEL                                     | API/worker                       | info; fatal/error/warn/info/debug/trace/silent                                                           |
| SESSION_TTL_HOURS                             | API                              | 24; integer 1–168                                                                                        |
| AUTH_RATE_LIMIT_PREFIX                        | API                              | impactlens:auth; isolate test runs, never disable limits in production                                   |
| VITE_API_BASE_URL                             | Web build                        | /api in images; public path/HTTP(S) URL                                                                  |
| API_PROXY_TARGET                              | Vite development                 | http://127.0.0.1:3000; not a browser secret, Nginx handles image routing                                 |
| POSTGRES_USER / PASSWORD / DB / PORT          | Development Compose              | impactlens / disposable placeholder / impactlens / 55432; synchronize URLs                               |
| RELEASE_TAG                                   | Production Compose interpolation | local; use unique retained release tags for deployment                                                   |
| GITHUB_ENABLED                                | API/worker                       | false; core and demo require no provider credentials                                                     |
| GITHUB_APP_ID / PRIVATE_KEY_BASE64            | API/worker                       | Required numeric App ID and base64 PEM private key when enabled                                          |
| CREDENTIAL_ENCRYPTION_KEY                     | API/worker                       | Required random 32-byte base64 key when GitHub enabled; identical on both                                |
| GITHUB_APP_SLUG / CLIENT_ID / CLIENT_SECRET   | API                              | Required with GitHub enabled; server only                                                                |
| GITHUB_CALLBACK_URL                           | API                              | Required enabled callback ending /api/github/callback; HTTPS in production                               |
| AI_PROVIDER / AI_API_KEY / AI_MODEL           | API                              | disabled / empty / empty; optional openai provider requires configured key/model and workspace consent   |
| AI_MAX_INPUT_TOKENS / AI_MAX_OUTPUT_TOKENS    | API                              | 12000 / 1500; ranges 2048–32000 / 256–4000                                                               |
| AI_TIMEOUT_MS                                 | API                              | 15000; range 100–60000                                                                                   |
| AI_DAILY_REQUEST_LIMIT / AI_DAILY_TOKEN_LIMIT | API                              | 20 / 100000; workspace budgets; Redis loss resets counters                                               |
| BENCHMARK_REPEATS                             | Benchmark only                   | 5; controlled owned fixture only                                                                         |
| SMOKE_URL                                     | Container smoke only             | http://localhost:8080                                                                                    |
| DEMO_SEED_ALLOWED / DEMO_API_URL              | Demo seed only                   | synthetic-only / http://api:3000; script additionally verifies nonproduction and exact demo DB host/name |

Never store API keys, database URLs, encrypted credential keys, OAuth secrets or session tokens in `VITE_*`, screenshots, CI logs or source control. No production secret generation or provider provisioning is performed automatically. [Retention and credential handling](retention-and-credentials.md) documents key rotation and deletion limits.

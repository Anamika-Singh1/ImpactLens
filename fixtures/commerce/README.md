# Controlled commerce evaluation fixture

This is owned synthetic source, not imported customer code. Express endpoints implement fixture authentication, a public product catalog, a user cart, checkout totals and user order history. React components represent the five journeys; tests exercise HTTP contracts and React server rendering. Authentication uses a fixed fixture bearer value, prices are integers, and data is deliberately in memory. This is a benchmark, not a deployable commerce system.

`ground-truth.json` declares five route-entry feature mappings, feature-to-test-file associations and ten independent Git commit scenarios. Expected feature sets follow business contracts described in each scenario; they are never read from analyzer output. Six scenarios are development cases. Four are held out: deleting orders, authentication bypass, checkout arithmetic and invalid catalog pricing. Do not alter expectations or tune the analyzer after viewing held-out results; a future tuning cycle must use new held-out scenarios and a new dataset version.

Source, tests, package metadata and ground truth are intentionally frozen and excluded from formatting because scenario patches match reviewed text exactly and their byte identities are recorded. Git history is built in a new temporary child of `.runs`, with fixed author, timestamp, LF normalization, no hooks, and signed commits disabled. Each scenario forks from the frozen baseline; the dynamic case has a separate passing runtime-setup base. Commit SHA pairs and ground-truth hash are recorded. The temporary repository is removed after evaluation. `npm run benchmark` runs only tests under this fixture, with bounded child lifetimes and output; it never accepts a repository test command.

Run from the project root:

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run build
$env:BENCHMARK_REPEATS = '5'
npm.cmd run benchmark
```

No database, Redis, GitHub credentials or LLM credentials are needed for the benchmark. Express/React resolve from the root locked installation. Output is `benchmark-results/report.md` and `measurements.json`. Git and Node 22.12+ are required. The separate CI benchmark job uploads both files. The preserved local evaluation is in `docs/evaluation`; cross-platform runtimes and process memory measurements should not be compared without matching measurement conditions.

Selection uses manually confirmed feature-to-test-file associations, as supported by the application's explicit mapping workflow. Predictions are scored before fallback. Any unknown other than unresolved imports of the explicitly listed fixture libraries (`express`, `react`, `react-dom/server`, `node:test`, `node:assert/strict`) or a broader-review request triggers the full suite. This evaluation policy is deliberately conservative and is not an automatic production test executor.

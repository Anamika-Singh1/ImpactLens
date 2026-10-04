# Controlled commerce benchmark: actual measurements

Measured 2026-10-01T11:44:07.799Z. Engine 7.0.0; Node v24.11.1; win32 10.0.26200 x64.
Hardware reported by the host: Intel(R) Core(TM) i5-8265U CPU @ 1.60GHz; 8 logical CPUs; 7.88 GiB RAM.
Dataset: 22 baseline files / 6562 UTF-8 bytes, five features, five test files / 8 cases, ten commit scenarios. 5 measured runs per scenario; one discarded analysis warm-up; full and selected suite order alternates.
Ground truth SHA-256: `4011955c4d6b7603e0dd8ad5460e503a52f3e2c07f30497d20e2f557253b5ba2`. Baseline Git commit: `008b60c44e5f8996d69dcccffaebb5eff4727cec`. All commit pairs and individual samples are in measurements.json.

| Split       |  TP |  FP | Misses | Precision | Recall | Full-suite fallback | Known-failure scenarios detected by selected suite |
| ----------- | --: | --: | -----: | --------: | -----: | ------------------: | -------------------------------------------------: |
| development |   7 |   0 |      1 |    100.0% |  87.5% |                 3/6 |                                                1/1 |
| held-out    |   8 |   0 |      0 |    100.0% | 100.0% |                 1/4 |                                                4/4 |
| all         |  15 |   0 |      1 |    100.0% |  93.8% |                4/10 |                                                5/5 |

| Scenario                | Split       | Expected                               | Predicted                              | FP / missed     | Analysis median ms | Peak RSS median MiB | Selected / full median ms | Fallback                                 |
| ----------------------- | ----------- | -------------------------------------- | -------------------------------------- | --------------- | -----------------: | ------------------: | ------------------------: | ---------------------------------------- |
| shared-auth             | development | authentication, cart, checkout, orders | authentication, cart, checkout, orders | none / none     |             143.09 |               77.88 |         1749.14 / 2004.27 | no                                       |
| checkout-only           | development | checkout                               | checkout                               | none / none     |             165.13 |               77.89 |          598.70 / 2206.64 | no                                       |
| unrelated-component     | development | none                                   | none                                   | none / none     |             140.96 |               77.75 |         2058.79 / 1950.87 | yes: UNMAPPED_CHANGE                     |
| rename-cart             | development | cart                                   | cart                                   | none / none     |             137.85 |               77.95 |         2095.27 / 2054.48 | yes: UNMAPPED_CHANGE                     |
| pricing-cycle           | development | checkout                               | checkout                               | none / none     |             162.75 |               77.89 |          565.80 / 2225.02 | no                                       |
| dynamic-discount        | development | checkout                               | none                                   | none / checkout |             169.35 |               77.76 |         2632.69 / 2715.32 | yes: UNKNOWN_DEPENDENCY, UNMAPPED_CHANGE |
| delete-orders           | held-out    | orders                                 | orders                                 | none / none     |             154.06 |               77.89 |         2055.13 / 2003.86 | yes: MAPPING_REVIEW, UNMAPPED_CHANGE     |
| auth-bypass-bug         | held-out    | authentication, cart, checkout, orders | authentication, cart, checkout, orders | none / none     |             147.80 |               78.04 |         1836.63 / 2150.36 | no                                       |
| checkout-arithmetic-bug | held-out    | checkout                               | checkout                               | none / none     |             157.27 |               78.02 |          581.95 / 2313.38 | no                                       |
| catalog-price-bug       | held-out    | cart, catalog                          | cart, catalog                          | none / none     |             137.66 |               77.89 |          820.12 / 2180.43 | no                                       |

## Interpretation and limitations

Ground truth describes potentially affected business behavior, not which features actually fail. Expected sets are manually specified from fixture contracts and never derived from analyzer results. Four held-out scenarios are scored separately; the analyzer is not tuned to these results. Split assignment is frozen before this execution, but fixture authorship and single-repository evaluation are not independent external validation.

Precision and recall are micro-averages of scenario-feature pairs. Undefined per-scenario precision/recall has a zero denominator and is stored as null, not perfect accuracy. Predictions include unresolved impacts. Raw predictions are scored before broader-suite fallback, so fallback cannot conceal missed impacts. Detection counts require the specifically named known test to fail on every measured selected-suite run; process failures alone are insufficient.

Analysis duration includes both graph builds, mapping resolution and impact computation; it excludes module loading, Git operations and child startup. Analysis wall time includes child startup. Peak memory is Node process.resourceUsage().maxRSS, converted from KiB; it includes Node, TypeScript and module startup, not just incremental analyzer allocations. Suite wall time includes process startup, HTTP fixture servers and React server rendering. The fixture has no artificial sleeps and does not represent production workloads. Small runtimes are sensitive to host scheduling, filesystem cache, background services and antivirus. min/median/max/mean and all samples are retained.

The selected suite uses predeclared feature-to-test-file associations, not measured dynamic coverage or automatic test discovery. Broader fallback runs every fixture test. Missing mappings, unsupported dynamic behavior and other unknowns must be reviewed even when tests pass. This fixture performs no browser interaction, payment integration or durable database work. No production savings, reliability, or general accuracy claim follows from these numbers.

## Not measured

- Production repository accuracy or savings.
- Distributed production load and crash-recovery latency.
- Container-level memory and fixture-browser interaction latency.

Extension and operational verification instructions are in [verification status](verification.md). These dimensions need additional controlled staging or fixture harnesses; the current runner does not measure them.

Reproduce: `npm ci`, `npm run build`, `npm run benchmark`. Optional: `BENCHMARK_REPEATS=5`, `BENCHMARK_OUTPUT=benchmark-results` (PowerShell uses `$env:NAME="value"`). CI runs the same owned fixture in a separate job and uploads measurements and this report. Source trees are temporary, bounded children of fixtures/commerce/.runs and removed in a finally block. Imported repository tests are never executed.

The three explicitly named bug scenarios (authentication bypass, checkout arithmetic, invalid catalog pricing) were detected by their known tests on all five selected-suite runs. The five known-failure scenarios also include destructive order removal and incorrect dynamic discount behavior.

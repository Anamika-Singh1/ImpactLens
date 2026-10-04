# Fixtures

`test-evidence/` contains owned JUnit, Istanbul, LCOV and per-test coverage artifacts. Parser tests distinguish outcomes, aggregate coverage and individual attribution; browser tests use the JUnit fixture for uploads and manual mapping.

`feature-mapping/base.json` and `moved.json` cover checkout business mappings, an Express route, a test dependency and moved implementation. They drive Phase 5 stale-resolution and review tests.

`static-analysis/base.json` and `head.json` contain owned JavaScript/TypeScript source snapshots. `expected.json` specifies the complete resolved module graph for the base snapshot. They cover relative imports, aliases, re-exports, cycles, disconnected nodes, deleted files, unsupported dynamic imports, Express routes/middleware and React components. Tests parse these source strings without executing them. See [Phase 4 acceptance](../docs/phase-4.md).

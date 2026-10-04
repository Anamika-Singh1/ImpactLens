import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const fixture = path.join(project, 'fixtures/commerce');
const output = path.resolve(
  project,
  process.env.BENCHMARK_OUTPUT ?? 'benchmark-results',
);
assert(
  output.startsWith(project + path.sep),
  'Output must stay inside the project',
);
const repeats = Number(process.env.BENCHMARK_REPEATS ?? 5);
assert(
  Number.isInteger(repeats) && repeats >= 1 && repeats <= 20,
  'BENCHMARK_REPEATS must be 1..20',
);
const manifestText = await fs.readFile(
  path.join(fixture, 'ground-truth.json'),
  'utf8',
);
const manifest = JSON.parse(manifestText);
const runsRoot = path.join(fixture, '.runs');
await fs.mkdir(runsRoot, { recursive: true });
const run = await fs.mkdtemp(path.join(runsRoot, 'evaluation-'));
assert(path.resolve(run).startsWith(path.resolve(runsRoot) + path.sep));
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
};
const activeStops = new Set();
let canceled = false;
const interrupt = () => {
  canceled = true;
  for (const stop of activeStops) stop();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
async function execute(
  command,
  args,
  cwd = run,
  env = process.env,
  timeout = 60000,
) {
  if (canceled) throw new Error('Benchmark canceled.');
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      overflow = false,
      timedOut = false;
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid)
        return;
      // Kill only this newly spawned child's process tree, including Node's
      // owned test-file subprocesses. No unrelated processes are targeted.
      if (process.platform === 'win32') {
        const killer = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        killer.once('error', () => child.kill());
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill();
        }
      }
    };
    activeStops.add(terminate);
    const collect = (which) => (chunk) => {
      if (stdout.length + stderr.length > 2 * 1024 * 1024) {
        overflow = true;
        terminate();
        return;
      }
      if (which === 'out') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    child.once('error', (e) => {
      activeStops.delete(terminate);
      clearTimeout(timer);
      reject(e);
    });
    child.once('close', (code) => {
      activeStops.delete(terminate);
      clearTimeout(timer);
      if (timedOut || overflow) reject(new Error(`Bound exceeded: ${command}`));
      else resolve({ code, stdout, stderr, wallMs: performance.now() - start });
    });
  });
}
async function git(...args) {
  const r = await execute(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    run,
    gitEnv,
  );
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}
async function commit(message) {
  await git('add', '--', 'src', 'tests', 'package.json');
  await git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}
async function edits(list = []) {
  for (const e of list) {
    const target = path.join(run, e.path);
    const original = await fs.readFile(target, 'utf8');
    assert.equal(
      original.split(e.from).length,
      2,
      `Patch must match once: ${e.path}`,
    );
    await fs.writeFile(target, original.replace(e.from, e.to));
  }
}
async function source() {
  const names = (await git('ls-files', 'src', 'tests', 'package.json')).split(
    '\n',
  );
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        await fs.readFile(path.join(run, name), 'utf8'),
      ]),
    ),
  );
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted.at(-1),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
const results = [];
try {
  await fs.cp(path.join(fixture, 'src'), path.join(run, 'src'), {
    recursive: true,
  });
  await fs.cp(path.join(fixture, 'tests'), path.join(run, 'tests'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(fixture, 'package.json'),
    path.join(run, 'package.json'),
  );
  await git('init', '--initial-branch=fixture');
  const rootSha = await commit('Frozen synthetic commerce baseline');
  const fullTests = manifest.features.map((f) => f.test).sort();
  // Only this owned fixture can run. No repository import or user-controlled command is accepted.
  async function suite(tests) {
    for (const file of tests) assert(fullTests.includes(file));
    if (!tests.length)
      return { wallMs: 0, failedNames: [], code: 0, testCount: 0 };
    const r = await execute(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests],
      run,
      { ...process.env, NODE_ENV: 'test' },
    );
    const failedNames = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(
      (m) => m[1],
    );
    const testCount = Number(r.stdout.match(/^# tests (\d+)$/m)?.[1] ?? 0);
    if (!testCount || (r.code !== 0 && !failedNames.length))
      throw new Error(
        `Fixture suite could not execute: ${r.stderr}\n${r.stdout}`,
      );
    return { wallMs: r.wallMs, failedNames, code: r.code, testCount };
  }
  const baseline = await suite(fullTests);
  assert.equal(baseline.code, 0, 'Frozen baseline must pass');
  for (const scenario of manifest.scenarios) {
    await git('checkout', '--detach', rootSha);
    await edits(scenario.baseEdits);
    const baseSha = scenario.baseEdits
      ? await commit(`${scenario.id}: runtime setup`)
      : rootSha;
    const base = await source();
    assert.equal(
      (await suite(fullTests)).code,
      0,
      `Scenario ${scenario.id} baseline must pass`,
    );
    await edits(scenario.edits);
    if (scenario.rename)
      await fs.rename(
        path.join(run, scenario.rename.from),
        path.join(run, scenario.rename.to),
      );
    for (const name of scenario.delete ?? [])
      await fs.unlink(path.join(run, name));
    for (const [name, text] of Object.entries(scenario.add ?? {})) {
      await fs.mkdir(path.dirname(path.join(run, name)), { recursive: true });
      await fs.writeFile(path.join(run, name), text);
    }
    const headSha = await commit(`${scenario.id}: ${scenario.split} scenario`),
      head = await source();
    const inputFile = path.join(run, 'analysis-input.json');
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        base,
        head,
        baseSha,
        headSha,
        features: manifest.features,
      }),
    );
    async function analysis() {
      const r = await execute(process.execPath, [
        path.join(project, 'scripts/benchmark-analysis.mjs'),
        inputFile,
      ]);
      assert.equal(r.code, 0, r.stderr);
      return { ...JSON.parse(r.stdout), wallMs: r.wallMs };
    }
    await analysis(); // One discarded warm-up, a separate process just like measured runs.
    const samples = [];
    for (let iteration = 0; iteration < repeats; iteration++) {
      const measured = await analysis();
      const selectedTests = measured.fallback
        ? fullTests
        : manifest.features
            .filter((f) => measured.predicted.includes(f.id))
            .map((f) => f.test)
            .sort();
      // Alternate order to reduce warm filesystem/order bias; never simulate runtime from test counts.
      const [full, selected] =
        iteration % 2 === 0
          ? [await suite(fullTests), await suite(selectedTests)]
          : await (async () => {
              const selected = await suite(selectedTests),
                full = await suite(fullTests);
              return [full, selected];
            })();
      const known = scenario.knownFailures ?? [];
      for (const name of known)
        assert(
          full.failedNames.includes(name),
          `Known fixture test must detect ${scenario.id}: ${name}`,
        );
      if (!known.length)
        assert.equal(
          full.code,
          0,
          `Unexpected fixture failure for ${scenario.id}`,
        );
      samples.push({
        iteration: iteration + 1,
        analysis: measured,
        selectedTests,
        selected,
        full,
        knownDetectedBySelected: known.filter((name) =>
          selected.failedNames.includes(name),
        ),
      });
    }
    assert(
      samples.every(
        (s) => s.analysis.resultHash === samples[0].analysis.resultHash,
      ),
      'Analysis must be deterministic',
    );
    const predicted = samples[0].analysis.predicted,
      expected = [...scenario.expected].sort();
    const tp = predicted.filter((f) => expected.includes(f)),
      fp = predicted.filter((f) => !expected.includes(f)),
      fn = expected.filter((f) => !predicted.includes(f));
    results.push({
      id: scenario.id,
      split: scenario.split,
      reason: scenario.reason,
      baseSha,
      headSha,
      baseFiles: Object.keys(base).length,
      headFiles: Object.keys(head).length,
      sourceBytes: Object.values(head).reduce(
        (sum, text) => sum + Buffer.byteLength(text),
        0,
      ),
      baseSourceBytes: Object.values(base).reduce(
        (sum, text) => sum + Buffer.byteLength(text),
        0,
      ),
      expected,
      predicted,
      truePositives: tp,
      falsePositives: fp,
      missedImpacts: fn,
      precision:
        tp.length + fp.length ? tp.length / (tp.length + fp.length) : null,
      recall:
        tp.length + fn.length ? tp.length / (tp.length + fn.length) : null,
      knownFailures: scenario.knownFailures ?? [],
      analysisMs: stats(samples.map((s) => s.analysis.durationMs)),
      analysisWallMs: stats(samples.map((s) => s.analysis.wallMs)),
      peakRssMiB: stats(samples.map((s) => s.analysis.peakRssKiB / 1024)),
      selectedSuiteMs: stats(samples.map((s) => s.selected.wallMs)),
      fullSuiteMs: stats(samples.map((s) => s.full.wallMs)),
      fallback: samples[0].analysis.fallback,
      fallbackReasons: samples[0].analysis.fallbackReasons,
      samples,
    });
    process.stdout.write(
      `${scenario.id}: expected [${expected}], predicted [${predicted}], fallback ${samples[0].analysis.fallback}\n`,
    );
  }
  const aggregates = ['development', 'held-out', 'all'].map((split) => {
    const rows = results.filter((r) => split === 'all' || r.split === split),
      tp = rows.reduce((n, r) => n + r.truePositives.length, 0),
      fp = rows.reduce((n, r) => n + r.falsePositives.length, 0),
      fn = rows.reduce((n, r) => n + r.missedImpacts.length, 0);
    const faulty = rows.filter((r) => r.knownFailures.length),
      detected = faulty.filter((r) =>
        r.samples.every((s) =>
          r.knownFailures.every((f) => s.knownDetectedBySelected.includes(f)),
        ),
      );
    return {
      split,
      scenarios: rows.length,
      tp,
      fp,
      fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      fallbackScenarios: rows.filter((r) => r.fallback).length,
      deliberateFaultScenarios: faulty.length,
      detectedFaultScenarios: detected.length,
    };
  });
  const report = {
    version: 1,
    measuredAt: new Date().toISOString(),
    manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
    baselineSha: rootSha,
    repeats,
    warmupsPerScenario: 1,
    engineVersion: results[0].samples[0].analysis.engineVersion,
    hardware: {
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryGiB: os.totalmem() / 1024 ** 3,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      node: process.version,
    },
    dataset: {
      features: manifest.features.length,
      scenarios: results.length,
      baselineFiles: results[0].baseFiles,
      baselineSourceBytes: results[0].baseSourceBytes,
      baselineTestCases: baseline.testCount,
      fullSuiteFiles: fullTests.length,
    },
    selectionPolicy:
      'Confirmed feature-to-test-file catalog; unknowns except five explicitly allow-listed external modules or broaderReview trigger full fixture suite.',
    aggregates,
    results,
    notMeasured: [
      'Production repository accuracy or savings',
      'Distributed production load and crash-recovery latency',
      'Container-level memory and fixture-browser interaction latency',
    ],
  };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, 'measurements.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  const number = (n) => (n === null ? 'n/a' : n.toFixed(2)),
    percent = (n) => (n === null ? 'n/a' : (n * 100).toFixed(1) + '%');
  const lines = [
    '# Controlled commerce benchmark: actual measurements',
    '',
    `Measured ${report.measuredAt}. Engine ${report.engineVersion}; Node ${report.hardware.node}; ${report.hardware.platform} ${report.hardware.release} ${report.hardware.arch}.`,
    `Hardware reported by the host: ${report.hardware.cpu}; ${report.hardware.logicalCpus} logical CPUs; ${number(report.hardware.totalMemoryGiB)} GiB RAM.`,
    `Dataset: ${report.dataset.baselineFiles} baseline files / ${report.dataset.baselineSourceBytes} UTF-8 bytes, five features, five test files / ${baseline.testCount} cases, ten commit scenarios. ${repeats} measured runs per scenario; one discarded analysis warm-up; full and selected suite order alternates.`,
    `Ground truth SHA-256: \`${report.manifestSha256}\`. Baseline Git commit: \`${rootSha}\`. All commit pairs and individual samples are in measurements.json.`,
    '',
    '| Split | TP | FP | Misses | Precision | Recall | Full-suite fallback | Known-failure scenarios detected by selected suite |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...aggregates.map(
      (a) =>
        `| ${a.split} | ${a.tp} | ${a.fp} | ${a.fn} | ${percent(a.precision)} | ${percent(a.recall)} | ${a.fallbackScenarios}/${a.scenarios} | ${a.detectedFaultScenarios}/${a.deliberateFaultScenarios} |`,
    ),
    '',
    '| Scenario | Split | Expected | Predicted | FP / missed | Analysis median ms | Peak RSS median MiB | Selected / full median ms | Fallback |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.split} | ${r.expected.join(', ') || 'none'} | ${r.predicted.join(', ') || 'none'} | ${r.falsePositives.join(', ') || 'none'} / ${r.missedImpacts.join(', ') || 'none'} | ${number(r.analysisMs.median)} | ${number(r.peakRssMiB.median)} | ${number(r.selectedSuiteMs.median)} / ${number(r.fullSuiteMs.median)} | ${r.fallback ? 'yes: ' + r.fallbackReasons.join(', ') : 'no'} |`,
    ),
    '',
    '## Interpretation and limitations',
    '',
    'Three scenarios explicitly introduce implementation bugs: auth-bypass-bug, checkout-arithmetic-bug and catalog-price-bug. The other two named-failure scenarios exercise destructive order-history removal and an incorrect dynamically loaded discount. Fault detection is based on named test failures rather than merely a nonzero test-process exit.',
    '',
    'Ground truth describes potentially affected business behavior, not which features actually fail. Expected sets are manually specified from fixture contracts and never derived from analyzer results. Four held-out scenarios are scored separately; the analyzer is not tuned to these results. Split assignment is frozen before this execution, but fixture authorship and single-repository evaluation are not independent external validation.',
    '',
    'Precision and recall are micro-averages of scenario-feature pairs. Undefined per-scenario precision/recall has a zero denominator and is stored as null, not perfect accuracy. Predictions include unresolved impacts. Raw predictions are scored before broader-suite fallback, so fallback cannot conceal missed impacts. Detection counts require the specifically named known test to fail on every measured selected-suite run; process failures alone are insufficient.',
    '',
    'Analysis duration includes both graph builds, mapping resolution and impact computation; it excludes module loading, Git operations and child startup. Analysis wall time includes child startup. Peak memory is Node process.resourceUsage().maxRSS, converted from KiB; it includes Node, TypeScript and module startup, not just incremental analyzer allocations. Suite wall time includes process startup, HTTP fixture servers and React server rendering. The fixture has no artificial sleeps and does not represent production workloads. Small runtimes are sensitive to host scheduling, filesystem cache, background services and antivirus. min/median/max/mean and all samples are retained.',
    '',
    'The selected suite uses predeclared feature-to-test-file associations, not measured dynamic coverage or automatic test discovery. Broader fallback runs every fixture test. Missing mappings, unsupported dynamic behavior and other unknowns must be reviewed even when tests pass. This fixture performs no browser interaction, payment integration or durable database work. No production savings, reliability, or general accuracy claim follows from these numbers.',
    '',
    '## Not measured',
    '',
    ...report.notMeasured.map((v) => `- ${v}.`),
    '',
    'Reproduce: `npm ci`, `npm run build`, `npm run benchmark`. Optional: `BENCHMARK_REPEATS=5`, `BENCHMARK_OUTPUT=benchmark-results` (PowerShell uses `$env:NAME="value"`). CI runs the same owned fixture in a separate job and uploads measurements and this report. Source trees are temporary, bounded children of fixtures/commerce/.runs and removed in a finally block. Imported repository tests are never executed.',
  ];
  await fs.writeFile(path.join(output, 'report.md'), lines.join('\n') + '\n');
  process.stdout.write(
    `Actual measurements written to ${path.relative(project, output)}\n`,
  );
} finally {
  // Only the exact newly created, checked child directory can be removed.
  assert(path.resolve(run).startsWith(path.resolve(runsRoot) + path.sep));
  await fs.rm(run, { recursive: true, force: true });
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

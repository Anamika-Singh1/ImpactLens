import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  artifactFormats,
  type TestArtifact,
  type ExplicitTestMapping,
  type TestReview,
} from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
type Summary = Omit<TestArtifact, 'parsed'> & {
  ageDays: number;
  stale: boolean;
  commitMatch: boolean | null;
  testCount: number;
  coverageFileCount: number;
  perTestCount: number;
};
type Repo = { id: string; owner: string; name: string };
type Snapshot = { id: string; commitSha: string };
type Feature = { id: string; name: string };
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to load test evidence.';
export function TestEvidence() {
  const { workspace } = useAuth();
  const [query] = useSearchParams();
  const [repos, setRepos] = useState<Repo[]>([]),
    [repositoryId, setRepo] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [features, setFeatures] = useState<Feature[]>([]);
  const [commit, setCommit] = useState(query.get('commitSha') ?? '');
  const [artifacts, setArtifacts] = useState<Summary[]>([]),
    [mappings, setMappings] = useState<ExplicitTestMapping[]>([]);
  const [selected, setSelected] = useState(query.get('artifactId') ?? ''),
    [detail, setDetail] = useState<TestArtifact | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const root = `/workspaces/${workspace?.id}/repositories`;
  const base = `${root}/${repositoryId}/test-evidence`;
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Repo[]>(root, { signal: controller.signal })
      .then((data) => {
        setRepos(data);
        setRepo(
          data.find((r) => r.id === query.get('repositoryId'))?.id ??
            data[0]?.id ??
            '',
        );
        if (!data.length) setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [root, query]);
  useEffect(() => {
    if (!repositoryId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      apiRequest<Snapshot[]>(`${root}/${repositoryId}/snapshots`, {
        signal: controller.signal,
      }),
      apiRequest<Feature[]>(`${root}/${repositoryId}/features`, {
        signal: controller.signal,
      }),
      apiRequest<Summary[]>(
        base + '/artifacts' + (commit ? '?commitSha=' + commit : ''),
        { signal: controller.signal },
      ),
      apiRequest<ExplicitTestMapping[]>(base + '/mappings', {
        signal: controller.signal,
      }),
    ])
      .then(([s, f, a, m]) => {
        if (controller.signal.aborted) return;
        setSnapshots(s);
        setFeatures(f);
        setArtifacts(a);
        setMappings(m);
        setSelected((current) =>
          a.some((x) => x.id === current) ? current : (a[0]?.id ?? ''),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, repositoryId, base, commit, revision]);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const controller = new AbortController();
    apiRequest<TestArtifact>(base + '/artifacts/' + selected, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [base, selected, revision]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('artifact') as File;
    setError('');
    if (!file || file.size > 2 * 1024 * 1024) {
      setError('Choose an artifact no larger than 2 MiB.');
      return;
    }
    setBusy(true);
    try {
      const sourceRoot = String(data.get('sourceRoot') ?? '').trim();
      const artifact = await apiRequest<TestArtifact>(base + '/artifacts', {
        method: 'POST',
        body: JSON.stringify({
          format: data.get('format'),
          commitSha: data.get('commitSha'),
          runner: data.get('runner'),
          recordedAt: data.get('recordedAt'),
          source: data.get('source'),
          ...(sourceRoot ? { sourceRoot } : {}),
          filename: file.name,
          content: await file.text(),
        }),
      });
      setSelected(artifact.id);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function map(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await apiRequest(base + '/mappings', {
        method: 'POST',
        body: JSON.stringify({
          artifactId: detail.id,
          featureId: data.get('featureId'),
          testIdentity: data.get('testIdentity'),
          rationale: data.get('rationale'),
        }),
      });
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function unmap(id: string) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(base + '/mappings/' + id, { method: 'DELETE' });
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const canWrite = workspace?.role !== 'VIEWER';
  async function removeArtifact() {
    if (
      !detail ||
      !window.confirm(
        'Delete this artifact, its feature-test mappings and mirrored test results? Saved comparisons retain their original evidence. Delete the repository to remove those copies.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(base + '/artifacts/' + detail.id, { method: 'DELETE' });
      setSelected('');
      setDetail(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">WORKSPACE / TEST EVIDENCE</p>
      <h1>Test Evidence</h1>
      <p className="subtitle">
        Import CI results and coverage, then review their provenance and test
        associations.
      </p>
      <p className="note">
        Aggregate coverage describes suite execution. It never identifies an
        individual test. Tests run in your authorized CI environment; this
        application only imports artifacts.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Repository
        <select
          aria-label="Repository"
          value={repositoryId}
          disabled={busy}
          onChange={(e) => {
            setRepo(e.target.value);
            setSelected('');
            setDetail(null);
            setCommit('');
          }}
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.owner}/{r.name}
            </option>
          ))}
        </select>
      </label>
      {!repositoryId && !loading && (
        <p className="panel">
          Connect a repository in <Link to="/repositories">Repositories</Link>{' '}
          to import evidence.
        </p>
      )}
      {repositoryId && (
        <>
          <label>
            Review commit
            <select
              aria-label="Review commit"
              value={commit}
              disabled={busy}
              onChange={(e) => setCommit(e.target.value)}
            >
              <option value="">Select a commit to check mismatches</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.commitSha}>
                  {s.commitSha}
                </option>
              ))}
            </select>
          </label>
          {canWrite && (
            <form
              onSubmit={upload}
              className="panel evidence-form"
              key={repositoryId}
            >
              <h2>Import artifact</h2>
              <label>
                Format
                <select name="format" aria-label="Format">
                  {artifactFormats.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Artifact file (maximum 2 MiB)
                <input
                  name="artifact"
                  aria-label="Artifact file"
                  type="file"
                  required
                />
              </label>
              <label>
                Artifact commit SHA
                <input
                  name="commitSha"
                  aria-label="Artifact commit SHA"
                  required
                  pattern="[a-f0-9]{40}([a-f0-9]{24})?"
                  maxLength={64}
                  defaultValue={commit}
                />
              </label>
              <label>
                Test runner
                <input
                  name="runner"
                  aria-label="Test runner"
                  required
                  maxLength={100}
                  placeholder="vitest"
                />
              </label>
              <label>
                Run timestamp (ISO 8601 with timezone)
                <input
                  name="recordedAt"
                  aria-label="Run timestamp"
                  required
                  defaultValue={new Date().toISOString()}
                />
              </label>
              <label>
                Artifact provenance
                <input
                  name="source"
                  aria-label="Artifact provenance"
                  required
                  maxLength={1000}
                  placeholder="CI run URL or immutable build/artifact reference"
                />
              </label>
              <label>
                CI checkout root (for absolute paths)
                <input
                  name="sourceRoot"
                  aria-label="CI checkout root"
                  maxLength={2000}
                  placeholder="/home/runner/work/project/project"
                />
              </label>
              <button disabled={busy}>
                {busy ? 'Saving…' : 'Import artifact'}
              </button>
              <p className="small">
                Commit and run time are producer-declared metadata. Imports are
                not a CI attestation. New comparisons use the evidence available
                when created.
              </p>
            </form>
          )}
          <section className="panel">
            <h2>Imported artifacts</h2>
            {loading ? (
              <p role="status">Loading evidence…</p>
            ) : !artifacts.length ? (
              <p>No test or coverage artifacts imported.</p>
            ) : (
              <ul className="artifact-list">
                {artifacts.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setSelected(a.id)} disabled={busy}>
                      {a.filename}
                    </button>{' '}
                    {a.format} · {a.runner} · {a.testCount} tests ·{' '}
                    {a.coverageFileCount} aggregate files · {a.perTestCount}{' '}
                    per-test entries
                    <p>
                      {a.commitSha} · {Math.floor(a.ageDays)} days old{' '}
                      {a.stale && (
                        <strong className="warning">
                          {' '}
                          · Stale (over 30 days)
                        </strong>
                      )}{' '}
                      {a.commitMatch === false && (
                        <strong className="warning"> · Commit mismatch</strong>
                      )}{' '}
                      {a.commitMatch === true && (
                        <span> · Exact review commit</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {detail && (
            <section className="panel artifact-detail">
              {canWrite && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeArtifact()}
                >
                  Delete selected artifact
                </button>
              )}
              <h2>Artifact: {detail.filename}</h2>
              <p>
                {detail.format} · Runner: {detail.runner} · Commit:{' '}
                <code>{detail.commitSha}</code>
              </p>
              <p>
                Run: {detail.recordedAt} · Imported: {detail.importedAt}
              </p>
              <p>Provenance: {detail.source}</p>
              <p>
                SHA-256: <code>{detail.contentHash}</code>
              </p>
              {detail.parsed.limitations.map((l) => (
                <p className="note" key={l}>
                  {l}
                </p>
              ))}
              <details>
                <summary>Imported tests ({detail.parsed.tests.length})</summary>
                <ul>
                  {detail.parsed.tests.map((t) => (
                    <li key={t.identity}>
                      <strong>{t.name}</strong> — {t.outcome}
                      <p>
                        Identity: <code>{t.identity}</code>
                        {t.path && ` · ${t.path}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>Coverage records</summary>
                <ul>
                  {detail.parsed.aggregate.map((f) => (
                    <li key={f.path}>
                      {f.path}: {f.ranges.filter((r) => r.hits > 0).length}/
                      {f.ranges.length} measured line/statement ranges hit
                      (suite aggregate)
                    </li>
                  ))}
                </ul>
                {detail.parsed.perTest.map((t) => (
                  <p key={t.identity}>
                    {t.identity}:{' '}
                    {t.targets
                      .map(
                        (c) =>
                          `${c.path}${c.symbol ? ' — ' + c.symbol.name : c.lines ? ' — lines ' + c.lines.join(',') : ' — file only'}`,
                      )
                      .join('; ')}
                  </p>
                ))}
              </details>
              {canWrite &&
                detail.parsed.tests.length > 0 &&
                features.length > 0 && (
                  <form className="evidence-form" onSubmit={map}>
                    <h3>Map a test to a feature</h3>
                    <label>
                      Business feature
                      <select name="featureId" aria-label="Business feature">
                        {features.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Test identity
                      <select name="testIdentity" aria-label="Test identity">
                        {detail.parsed.tests.map((t) => (
                          <option key={t.identity} value={t.identity}>
                            {t.identity}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Mapping rationale
                      <input
                        name="rationale"
                        aria-label="Test mapping rationale"
                        required
                        maxLength={2000}
                      />
                    </label>
                    <button disabled={busy}>Confirm test mapping</button>
                  </form>
                )}
            </section>
          )}
          <section className="panel">
            <h2>Explicit feature-to-test mappings</h2>
            {!mappings.length ? (
              <p>No individual test mappings recorded.</p>
            ) : (
              <ul>
                {mappings.map((m) => (
                  <li key={m.id}>
                    {features.find((f) => f.id === m.featureId)?.name ??
                      m.featureId}{' '}
                    → {m.testIdentity} ({m.runner})
                    <p>
                      {m.rationale} · Confirmed by {m.actorLabel} at{' '}
                      {m.createdAt}
                    </p>
                    {canWrite && (
                      <button disabled={busy} onClick={() => void unmap(m.id)}>
                        Remove test mapping
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
const gapLabels = {
  NO_ARTIFACT: 'No coverage artifact available',
  NOT_EXERCISED: 'Changed code lacks demonstrated coverage',
  NO_INDIVIDUAL_MAPPING: 'No individual test mapping available',
  STALE: 'Coverage evidence is stale or mismatched',
  INCOMPLETE: 'Analysis or coverage is incomplete',
};
export function TestRecommendations({
  review,
  repositoryId,
  headSha,
}: {
  review: TestReview;
  repositoryId: string;
  headSha: string;
}) {
  return (
    <section className="panel test-recommendations">
      <h2>Test recommendations</h2>
      <p>
        Evidence age evaluated at {review.asOf}. Execute selected tests in
        authorized CI.
      </p>
      {review.broaderRun.map((r) => (
        <p key={r} className="warning">
          {r}
        </p>
      ))}
      <h3>Coverage gaps</h3>
      {review.gaps.length ? (
        <ul>
          {review.gaps.map((g, i) => (
            <li key={i}>
              <strong>{gapLabels[g.code]}</strong>
              {g.path && ` · ${g.path}`}
              <p>{g.message}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No additional gaps identified in the supplied evidence. This is not
          proof of complete coverage.
        </p>
      )}
      {!review.recommendations.length && (
        <p>No individual tests can be selected from the available evidence.</p>
      )}
      {review.recommendations.map((r, i) => (
        <article key={i} className="test-recommendation">
          <h3>{r.name}</h3>
          <p>
            <span className="tag">
              {r.kind === 'WEAK'
                ? 'WEAK SUGGESTION'
                : r.kind === 'MANUAL'
                  ? 'MANUALLY MAPPED'
                  : r.kind}
            </span>{' '}
            · Feature: {r.featureName} · Runner: {r.runner}
          </p>
          <p>
            Test identity: <code>{r.identity}</code>
          </p>
          <p>{r.reason}</p>
          <ul>
            {r.evidence.map((e, j) => (
              <li key={j}>
                <Link
                  to={`/test-evidence?repositoryId=${repositoryId}&artifactId=${e.artifactId}&commitSha=${headSha}`}
                >
                  {e.filename}
                </Link>{' '}
                · {Math.floor(e.ageDays)} days old ·{' '}
                {e.commitMatch ? 'Exact head commit' : 'Commit mismatch'}
                {e.stale ? ' · Stale' : ''}
                <p>
                  {e.detail}
                  {e.path && ` · ${e.path}`}
                </p>
                <p>
                  Commit {e.commitSha} · Run {e.recordedAt} · Provenance:{' '}
                  {e.source}
                </p>
                {e.mappingId && <p>Manual mapping: {e.mappingId}</p>}
                <details>
                  <summary>Artifact hash</summary>
                  <code>{e.contentHash}</code>
                </details>
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="small">
        Aggregate coverage never supplies individual-test attribution. Name
        matches are weak suggestions only.
      </p>
    </section>
  );
}

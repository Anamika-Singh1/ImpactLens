import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ImpactInput, ImpactResult } from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
import { TestRecommendations } from './TestEvidence';
import { ExplanationPanel } from './Explanations';
import { ReleaseReviewPanel } from './ReleaseReviews';

type Repo = { id: string; owner: string; name: string };
type Snapshot = {
  id: string;
  commitSha: string;
  staticGraph: { version: string } | null;
};
type Summary = {
  id: string;
  createdAt: string;
  baseSnapshotId: string;
  headSnapshotId: string;
  baseSnapshot: { commitSha: string };
  headSnapshot: { commitSha: string };
  engineVersion: string;
  inputHash: string;
  resultHash: string;
};
type Detail = Summary & {
  semantics: ImpactInput['semantics'];
  result: ImpactResult;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to load comparisons.';
export function Comparisons() {
  const { workspace } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]),
    [repositoryId, setRepositoryId] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [records, setRecords] = useState<Summary[]>([]);
  const [baseSnapshotId, setBase] = useState(''),
    [headSnapshotId, setHead] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const root = `/workspaces/${workspace?.id}/repositories`;
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Repo[]>(root, { signal: controller.signal })
      .then((data) => {
        setRepos(data);
        setRepositoryId(data[0]?.id ?? '');
        if (!data.length) setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [root]);
  useEffect(() => {
    if (!repositoryId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setRecords([]);
    setSnapshots([]);
    setBase('');
    setHead('');
    Promise.all([
      apiRequest<Snapshot[]>(`${root}/${repositoryId}/snapshots`, {
        signal: controller.signal,
      }),
      apiRequest<Summary[]>(`${root}/${repositoryId}/comparisons`, {
        signal: controller.signal,
      }),
    ])
      .then(([s, r]) => {
        if (controller.signal.aborted) return;
        setSnapshots(s);
        setRecords(r);
        setHead(s[0]?.id ?? '');
        setBase(s[1]?.id ?? s[0]?.id ?? '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, repositoryId]);
  async function compare(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const record = await apiRequest<Detail>(
        `${root}/${repositoryId}/comparisons`,
        {
          method: 'POST',
          body: JSON.stringify({ baseSnapshotId, headSnapshotId }),
        },
      );
      setRecords((current) => [record, ...current]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">WORKSPACE / ANALYSES</p>
      <h1>Change impact</h1>
      <p className="subtitle">
        Compare two imported snapshots and trace potential impact to confirmed
        business features.
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
          onChange={(e) => setRepositoryId(e.target.value)}
        >
          {repos.map((r) => (
            <option value={r.id} key={r.id}>
              {r.owner}/{r.name}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p role="status">Loading comparisons…</p>
      ) : !repositoryId ? (
        <p className="panel">
          Connect a repository in <Link to="/repositories">Repositories</Link>{' '}
          to begin.
        </p>
      ) : (
        <>
          <form className="panel comparison-form" onSubmit={compare}>
            <h2>Compare snapshots</h2>
            <p>
              Base → head compares two commit trees. Select the intended
              direction; this does not calculate a pull request merge base.
            </p>
            <label>
              Base snapshot
              <select
                aria-label="Base snapshot"
                value={baseSnapshotId}
                disabled={busy}
                onChange={(e) => setBase(e.target.value)}
                required
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.commitSha}
                    {s.staticGraph ? '' : ' (analysis required)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Head snapshot
              <select
                aria-label="Head snapshot"
                value={headSnapshotId}
                disabled={busy}
                onChange={(e) => setHead(e.target.value)}
                required
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.commitSha}
                    {s.staticGraph ? '' : ' (analysis required)'}
                  </option>
                ))}
              </select>
            </label>
            <p className="small">
              Analyze both snapshots in the{' '}
              <Link to={`/repositories/${repositoryId}`}>
                repository explorer
              </Link>{' '}
              first. Saved results preserve the mappings and evidence available
              when compared.
            </p>
            {workspace?.role !== 'VIEWER' ? (
              <button
                disabled={
                  busy ||
                  !baseSnapshotId ||
                  !headSnapshotId ||
                  !snapshots.find((s) => s.id === baseSnapshotId)
                    ?.staticGraph ||
                  !snapshots.find((s) => s.id === headSnapshotId)?.staticGraph
                }
              >
                {busy ? 'Comparing…' : 'Compare snapshots'}
              </button>
            ) : (
              <p>
                Owners and Engineers can create comparisons. You can review
                saved results below.
              </p>
            )}
          </form>
          <section className="panel">
            <h2>Saved comparisons</h2>
            {!records.length ? (
              <p>No comparisons yet.</p>
            ) : (
              <ul>
                {records.map((r) => (
                  <li key={r.id}>
                    <Link to={`/analyses/${repositoryId}/${r.id}`}>
                      {r.baseSnapshot.commitSha.slice(0, 12)} →{' '}
                      {r.headSnapshot.commitSha.slice(0, 12)}
                    </Link>{' '}
                    <span className="muted">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
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
export function ComparisonDetail() {
  const { workspace } = useAuth();
  const { repositoryId, analysisId } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError('');
    apiRequest<Detail>(
      `/workspaces/${workspace?.id}/repositories/${repositoryId}/comparisons/${analysisId}`,
      { signal: controller.signal },
    )
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [workspace?.id, repositoryId, analysisId]);
  const source = (side: 'base' | 'head', path: string) =>
    `/repositories/${repositoryId}?snapshotId=${side === 'base' ? detail?.baseSnapshotId : detail?.headSnapshotId}&filePath=${encodeURIComponent(path)}`;
  if (error)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (!detail) return <p role="status">Loading comparison…</p>;
  const { result } = detail;
  return (
    <>
      <Link to="/analyses">← All comparisons</Link>
      <h1>Change-impact review</h1>
      <ReleaseReviewPanel
        key={`${workspace?.id}/${analysisId}`}
        repositoryId={repositoryId!}
        analysisId={analysisId!}
      />
      <ExplanationPanel
        key={analysisId}
        repositoryId={repositoryId!}
        analysisId={analysisId!}
      />
      <div className="panel comparison-meta">
        <p>
          <strong>Base</strong> <code>{detail.semantics.baseSha}</code>
        </p>
        <p>
          <strong>Head</strong> <code>{detail.semantics.headSha}</code>
        </p>
        <p>{detail.semantics.description}</p>
        <p className="note">{result.statement}</p>
      </div>
      <section className="panel">
        <h2>Changed files ({result.changes.length})</h2>
        {!result.changes.length && (
          <p>No file changes were detected in the available inventory.</p>
        )}
        <ul>
          {result.changes.map((c, i) => (
            <li key={i}>
              <strong>{c.status}</strong>{' '}
              {c.basePath && (
                <Link to={source('base', c.basePath)}>{c.basePath} (base)</Link>
              )}{' '}
              {c.headPath && (
                <>
                  {' '}
                  →{' '}
                  <Link to={source('head', c.headPath)}>
                    {c.headPath} (head)
                  </Link>
                </>
              )}
              <p className="small">
                {c.precision === 'FILE'
                  ? 'Whole-file review: exact changed lines unavailable.'
                  : `Changed lines: base ${c.baseLines.map((r) => r.join('–')).join(', ') || 'none'}; head ${c.headLines.map((r) => r.join('–')).join(', ') || 'none'}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <h2>Potentially affected features ({result.features.length})</h2>
      {!result.features.length && (
        <p className="panel">
          No confirmed feature mappings were reached. This does not establish
          that the change is safe; review unmapped code and analysis
          limitations.
        </p>
      )}
      {result.features.map((f) => (
        <section className="panel impact-feature" key={f.featureId}>
          <h3>{f.name}</h3>
          <p>
            <span className="tag">{f.kind}</span> {f.criticality} criticality ·
            Evidence confidence: {f.confidence} ·{' '}
            <strong>Review priority {f.priority.score}</strong>
          </p>
          <details>
            <summary>Priority factors</summary>
            <ul>
              {f.priority.factors.map((factor) => (
                <li key={factor.name}>
                  {factor.name}: +{factor.points} — {factor.reason}
                </li>
              ))}
            </ul>
          </details>
          <h4>Evidence paths</h4>
          {f.paths.map((p, i) => (
            <details key={i} className="impact-path">
              <summary>
                {p.side}: {p.changedPath} → {p.target.name} ({p.kind})
              </summary>
              <p>{p.reason}</p>
              <p>
                <Link to={source(p.side, p.changedPath)}>
                  View changed source at {p.commitSha.slice(0, 12)}
                </Link>
              </p>
              <p>
                Mapping {p.mappingId}, revision {p.mappingVersion}; confirmed by{' '}
                {p.confirmedBy} in snapshot {p.mappingSnapshotId}.
              </p>
              <p>
                <Link
                  to={`/repositories/${repositoryId}?snapshotId=${p.mappingSnapshotId}&filePath=${encodeURIComponent(p.target.filePath)}`}
                >
                  View original mapped source
                </Link>
              </p>
              {p.symbols.length > 0 && (
                <p>
                  Overlapping symbols: {p.symbols.map((s) => s.name).join(', ')}
                </p>
              )}
              <ol>
                {p.edges.map((e) => (
                  <li key={e.id}>
                    <Link to={source(p.side, e.evidence.filePath)}>
                      {e.evidence.filePath}:{e.evidence.startLine}
                    </Link>{' '}
                    — {e.kind} {e.specifier}
                    {e.limitation ? ` (${e.limitation})` : ''}
                  </li>
                ))}
              </ol>
            </details>
          ))}
          <h4>Linked tests at head</h4>
          {!f.tests.length ? (
            <p>No statically linked test files were found.</p>
          ) : (
            <ul>
              {f.tests.map((t) => (
                <li key={t.path}>
                  <Link to={source('head', t.path)}>{t.path}</Link> —{' '}
                  {t.outcomes.length
                    ? t.outcomes.join(', ')
                    : 'No imported results'}
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            Static test links indicate relevance; they do not prove coverage of
            the change.
          </p>
        </section>
      ))}
      <section className="panel">
        <h2>Broader review and unknowns</h2>
        {result.broaderReview.map((r, i) => (
          <p className="warning" key={i}>
            {r}
          </p>
        ))}
        <ul>
          {result.unknowns.map((u, i) => (
            <li key={i}>
              <strong>{u.code}</strong> {u.side} {u.filePath}: {u.message}
            </li>
          ))}
        </ul>
        {!result.unknowns.length && (
          <p>
            No additional limitations were reported. Static analysis cannot
            establish runtime correctness.
          </p>
        )}
      </section>
      {result.testReview && (
        <TestRecommendations
          review={result.testReview}
          repositoryId={repositoryId!}
          headSha={detail.semantics.headSha}
        />
      )}
      <details className="panel comparison-meta">
        <summary>Saved result provenance</summary>
        <p>
          Engine {detail.engineVersion} ·{' '}
          {new Date(detail.createdAt).toLocaleString()}
        </p>
        <p>
          Input hash: <code>{detail.inputHash}</code>
        </p>
        <p>
          Result hash: <code>{detail.resultHash}</code>
        </p>
        <p>
          Later mapping edits and test imports do not change this saved
          comparison. Create another comparison to refresh the evidence.
        </p>
      </details>
    </>
  );
}

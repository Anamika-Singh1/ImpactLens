import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  criticalities,
  type FeatureSummary,
  type FeatureDetail,
  type MappingView,
  type GraphEdge,
} from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
type Repo = { id: string; owner: string; name: string };
type Snapshot = { id: string; commitSha: string; _count: { files: number } };
type File = { id: string; path: string };
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to save. Try again.';
function FeatureFields({ feature }: { feature?: FeatureSummary }) {
  return (
    <>
      <label>
        Feature name
        <input
          aria-label="Feature name"
          name="name"
          defaultValue={feature?.name ?? ''}
          required
          maxLength={150}
        />
      </label>
      <label>
        Description
        <textarea
          aria-label="Description"
          name="description"
          defaultValue={feature?.description ?? ''}
          maxLength={5000}
          rows={3}
        />
      </label>
      <label>
        Business criticality
        <select
          name="criticality"
          defaultValue={feature?.criticality ?? 'MEDIUM'}
          aria-label="Business criticality"
        >
          {criticalities.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Responsible team (optional)
        <input
          aria-label="Responsible team (optional)"
          name="responsibleTeam"
          defaultValue={feature?.responsibleTeam ?? ''}
          maxLength={150}
        />
      </label>
      <label>
        Customer workflow
        <textarea
          aria-label="Customer workflow"
          name="customerWorkflow"
          defaultValue={feature?.customerWorkflow ?? ''}
          maxLength={5000}
          rows={3}
          placeholder="What does the customer do, and what outcome matters?"
        />
      </label>
    </>
  );
}
export function FeatureCatalog() {
  const [query] = useSearchParams();
  const preferredRepository = query.get('repositoryId');
  const { workspace } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]),
    [repositoryId, setRepositoryId] = useState('');
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0),
    [search, setSearch] = useState(''),
    [criticality, setCriticality] = useState('ALL');
  const root = `/workspaces/${workspace?.id}/repositories`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiRequest<Repo[]>(root, { signal: controller.signal })
      .then((data) => {
        setRepos(data);
        setRepositoryId((current) =>
          data.some((r) => r.id === current)
            ? current
            : data.some((r) => r.id === preferredRepository)
              ? preferredRepository!
              : (data[0]?.id ?? ''),
        );
        if (!data.length) setLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [root, revision]);
  useEffect(() => {
    setFeatures([]);
    if (!repositoryId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiRequest<FeatureSummary[]>(`${root}/${repositoryId}/features`, {
      signal: controller.signal,
    })
      .then(setFeatures)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, repositoryId, revision]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`${root}/${repositoryId}/features`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      setRevision((n) => n + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const visible = features.filter(
    (feature) =>
      (criticality === 'ALL' || feature.criticality === criticality) &&
      [
        feature.name,
        feature.description,
        feature.responsibleTeam,
        feature.customerWorkflow,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <p className="eyebrow">WORKSPACE / FEATURES</p>
      <h1>Features</h1>
      <p className="subtitle">
        Connect customer workflows to source evidence. People confirm mappings;
        suggestions remain unconfirmed until reviewed.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}{' '}
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </div>
      )}
      {!!repos.length && (
        <section className="panel explorer-toolbar">
          <label>
            Repository
            <select
              aria-label="Feature repository"
              disabled={busy}
              value={repositoryId}
              onChange={(event) => setRepositoryId(event.target.value)}
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search features
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Criticality filter
            <select
              aria-label="Criticality filter"
              value={criticality}
              onChange={(event) => setCriticality(event.target.value)}
            >
              {['ALL', ...criticalities].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </section>
      )}
      {loading ? (
        <p role="status">Loading features…</p>
      ) : !repos.length ? (
        <section className="panel">
          <h2>Register a repository first</h2>
          <Link to="/repositories">Go to repositories</Link>
        </section>
      ) : (
        <section className="feature-catalog" aria-label="Feature catalog">
          {!visible.length && (
            <div className="panel">
              <h2>
                {features.length
                  ? 'No matching features'
                  : 'No features recorded'}
              </h2>
              <p>
                Describe a customer workflow to start mapping its
                implementation.
              </p>
            </div>
          )}
          {visible.map((feature) => (
            <article className="panel feature-card-detail" key={feature.id}>
              <div className="panel-heading">
                <h2>
                  <Link to={`/features/${repositoryId}/${feature.id}`}>
                    {feature.name}
                  </Link>
                </h2>
                <span
                  className={`criticality criticality-${feature.criticality.toLowerCase()}`}
                >
                  {feature.criticality}
                </span>
              </div>
              <p>{feature.description || 'No description yet.'}</p>
              <p className="small muted">
                {feature.responsibleTeam || 'No responsible team'} ·{' '}
                {feature.customerWorkflow || 'No customer workflow recorded'}
              </p>
              <div className="mapping-badges">
                <span className="mapping-badge confirmed">
                  {feature.mappingCounts.confirmed} confirmed
                </span>
                <span className="mapping-badge suggested">
                  {feature.mappingCounts.suggested} unconfirmed
                </span>
                {feature.mappingCounts.stale > 0 && (
                  <span className="mapping-badge stale">
                    {feature.mappingCounts.stale} stale
                  </span>
                )}
                {feature.mappingCounts.needsReview > 0 && (
                  <span className="mapping-badge stale">
                    {feature.mappingCounts.needsReview} require review
                  </span>
                )}
              </div>
              <p className="small muted">
                Resolution checked against the latest imported snapshot.
              </p>
              <Link
                className="feature-open"
                to={`/features/${repositoryId}/${feature.id}`}
              >
                View feature and mappings →
              </Link>
            </article>
          ))}
        </section>
      )}
      {repositoryId && workspace?.role !== 'VIEWER' && (
        <section className="panel">
          <h2>Add a business feature</h2>
          <form key={repositoryId} onSubmit={create} className="feature-form">
            <FeatureFields />
            <button disabled={busy || loading}>Create feature</button>
          </form>
        </section>
      )}
    </>
  );
}

export function FeatureDetailPage() {
  const { repositoryId, featureId } = useParams();
  const { workspace } = useAuth();
  const repoRoot = `/workspaces/${workspace?.id}/repositories/${repositoryId}`;
  const root = `${repoRoot}/features/${featureId}`;
  const editable = workspace?.role !== 'VIEWER';
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [snapshotId, setSnapshotId] = useState(''),
    [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<FeatureDetail | null>(null),
    [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [form, setForm] = useState({
    mappingId: '',
    expectedVersion: 0,
    nodeId: '',
    rationale: '',
  });
  const [targetSearch, setTargetSearch] = useState(''),
    [targetKind, setTargetKind] = useState('ALL');
  const mappingForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setDetail(null);
    setLoading(true);
    setError('');
    apiRequest<Snapshot[]>(`${repoRoot}/snapshots`, {
      signal: controller.signal,
    })
      .then((data) => {
        setSnapshots(data);
        setSnapshotId(data[0]?.id ?? '');
        setReady(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [repoRoot]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    setFiles([]);
    Promise.all([
      apiRequest<FeatureDetail>(
        root + (snapshotId ? '?snapshotId=' + snapshotId : ''),
        { signal: controller.signal },
      ),
      snapshotId
        ? apiRequest<File[]>(`${repoRoot}/snapshots/${snapshotId}/files`, {
            signal: controller.signal,
          })
        : Promise.resolve([]),
    ])
      .then(([feature, sourceFiles]) => {
        setDetail(feature);
        setFiles(sourceFiles);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, repoRoot, ready, snapshotId, revision]);
  const nodeMap = useMemo(
    () => new Map(detail?.graphNodes.map((n) => [n.id, n]) ?? []),
    [detail],
  );
  const targets =
    detail?.graphNodes.filter(
      (node) =>
        (targetKind === 'ALL' ||
          (targetKind === 'SYMBOL'
            ? !['FILE', 'ROUTE'].includes(node.kind)
            : node.kind === targetKind)) &&
        `${node.name} ${node.filePath}`
          .toLowerCase()
          .includes(targetSearch.toLowerCase()),
    ) ?? [];
  function resetForm() {
    setForm({ mappingId: '', expectedVersion: 0, nodeId: '', rationale: '' });
    setTargetSearch('');
    setTargetKind('ALL');
  }
  async function mutate(
    path: string,
    body: unknown,
    method = 'POST',
    success = 'Saved.',
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(root + path, { method, body: JSON.stringify(body) });
      setNotice(success);
      resetForm();
      setRevision((n) => n + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function saveFeature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (detail)
      void mutate(
        '',
        {
          ...Object.fromEntries(new FormData(event.currentTarget)),
          expectedVersion: detail.version,
        },
        'PATCH',
        'Feature updated. Existing mappings retain their own confirmation history.',
      );
  }
  function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const node = nodeMap.get(form.nodeId),
      file = files.find((f) => f.path === node?.filePath);
    if (!file || !node) {
      setError('Choose a target from the selected snapshot.');
      return;
    }
    const body = {
      snapshotId,
      fileId: file.id,
      nodeId: node.id,
      rationale: form.rationale,
      ...(form.mappingId ? { expectedVersion: form.expectedVersion } : {}),
    };
    void mutate(
      '/mappings' + (form.mappingId ? '/' + form.mappingId : ''),
      body,
      form.mappingId ? 'PATCH' : 'POST',
      form.mappingId
        ? 'Mapping edited and left unconfirmed. Review it and select Accept mapping to confirm.'
        : 'Manual mapping confirmed for the selected snapshot.',
    );
  }
  function editMapping(mapping: MappingView) {
    setForm({
      mappingId: mapping.id,
      expectedVersion: mapping.version,
      nodeId: '',
      rationale: mapping.rationale,
    });
    setTargetSearch('');
    setTargetKind('ALL');
    mappingForm.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }
  function sourceLink(
    path: string,
    nodeId?: string,
    selectedSnapshot = snapshotId,
  ) {
    return `/repositories/${repositoryId}?snapshotId=${encodeURIComponent(selectedSnapshot)}&filePath=${encodeURIComponent(path)}${nodeId ? '&nodeId=' + encodeURIComponent(nodeId) : ''}`;
  }
  function edgeList(edges: GraphEdge[], incoming: boolean) {
    return edges.length ? (
      <ul>
        {edges.map((edge) => (
          <li key={edge.id}>
            <strong>{edge.kind}</strong> ·{' '}
            {nodeMap.get(incoming ? edge.from : (edge.to ?? ''))?.name ??
              edge.specifier}{' '}
            <span className="small muted">({edge.resolution})</span>
            <p className="small muted">
              {edge.evidence.filePath}:{edge.evidence.startLine}–
              {edge.evidence.endLine} · {edge.evidence.commitSha.slice(0, 12)}
            </p>
          </li>
        ))}
      </ul>
    ) : (
      <p className="small muted">No static relationships recorded.</p>
    );
  }
  return (
    <>
      <Link to="/features">← Feature catalog</Link>
      <p className="eyebrow">FEATURE / IMPLEMENTATION</p>
      {error && (
        <div className="error" role="alert">
          {error}{' '}
          <button
            disabled={busy}
            onClick={() => {
              setRevision((n) => n + 1);
              if (!ready) window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      )}
      {notice && (
        <p className="feature-notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel explorer-toolbar">
        <label>
          Review snapshot
          <select
            aria-label="Review snapshot"
            value={snapshotId}
            disabled={busy}
            onChange={(event) => {
              setSnapshotId(event.target.value);
              setNotice('');
              resetForm();
            }}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.commitSha.slice(0, 12)} · {s._count.files} files
              </option>
            ))}
          </select>
        </label>
        <p className="small muted">
          Confirmation belongs to its original snapshot. Current resolution is
          checked separately.
        </p>
      </section>
      {loading && <p role="status">Loading feature…</p>}
      {detail && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h1>{detail.name}</h1>
              <span
                className={`criticality criticality-${detail.criticality.toLowerCase()}`}
              >
                {detail.criticality}
              </span>
            </div>
            <p className="feature-description">
              {detail.description || 'No description yet.'}
            </p>
            <dl className="feature-metadata">
              <dt>Responsible team</dt>
              <dd>{detail.responsibleTeam || 'Not assigned'}</dd>
              <dt>Customer workflow</dt>
              <dd>{detail.customerWorkflow || 'Not recorded'}</dd>
            </dl>
            {editable && (
              <details>
                <summary>Edit feature</summary>
                <form
                  key={detail.version}
                  onSubmit={saveFeature}
                  className="feature-form"
                >
                  <FeatureFields feature={detail} />
                  <button disabled={busy}>Save feature</button>
                </form>
              </details>
            )}
          </section>
          {!snapshotId && (
            <section className="panel">
              <h2>No repository snapshots</h2>
              <p>
                Feature descriptions can be managed now. Import a snapshot
                before mapping implementation.
              </p>
            </section>
          )}
          {editable && snapshotId && (
            <section className="panel">
              <h2>
                {form.mappingId
                  ? 'Review or remap implementation'
                  : 'Map implementation manually'}
              </h2>
              <p>
                {form.mappingId
                  ? 'Choose the target explicitly in this snapshot. Saving an edit leaves it unconfirmed until you accept it.'
                  : 'Choose a file, route or symbol and explain the connection to this feature. Confirming records your identity and this snapshot.'}
              </p>
              <form
                ref={mappingForm}
                onSubmit={saveMapping}
                className="feature-form"
              >
                <label>
                  Find implementation
                  <input
                    value={targetSearch}
                    onChange={(event) => setTargetSearch(event.target.value)}
                    placeholder="Path, route or symbol name"
                  />
                </label>
                <label>
                  Target kind
                  <select
                    aria-label="Target kind"
                    value={targetKind}
                    onChange={(event) => setTargetKind(event.target.value)}
                  >
                    {['ALL', 'FILE', 'ROUTE', 'SYMBOL'].map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Implementation target
                  <select
                    aria-label="Implementation target"
                    required
                    value={
                      targets.some((n) => n.id === form.nodeId)
                        ? form.nodeId
                        : ''
                    }
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        nodeId: event.target.value,
                      }))
                    }
                  >
                    <option value="">
                      Select a target ({targets.length} matches)
                    </option>
                    {targets.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.kind} · {node.name} · {node.filePath}:
                        {node.evidence.startLine}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mapping rationale
                  <textarea
                    aria-label="Mapping rationale"
                    required
                    maxLength={2000}
                    rows={3}
                    value={form.rationale}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        rationale: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="mapping-actions">
                  <button disabled={busy || !form.nodeId}>
                    {form.mappingId
                      ? 'Save edit for review'
                      : 'Confirm manual mapping'}
                  </button>
                  {form.mappingId && (
                    <button type="button" onClick={resetForm}>
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
              <div className="suggestion-callout">
                <h3>Heuristic suggestions</h3>
                <p>
                  Route names, symbol names and file paths can suggest
                  implementation. Every result is unconfirmed and includes its
                  evidence.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      '/suggestions',
                      { snapshotId },
                      'POST',
                      'Suggestions generated. Nothing was confirmed automatically; existing and rejected targets are not regenerated.',
                    )
                  }
                >
                  Find suggestions
                </button>
                <p className="small muted">
                  Analyze the selected snapshot in the{' '}
                  <Link to={sourceLink('')}>repository explorer</Link> to make
                  routes and symbols available.
                </p>
              </div>
            </section>
          )}
          <section className="panel">
            <h2>Mapped implementation</h2>
            <p className="small muted">
              {detail.mappingCounts.confirmed} confirmed historically ·{' '}
              {detail.mappingCounts.suggested} unconfirmed ·{' '}
              {detail.mappingCounts.stale} stale ·{' '}
              {detail.mappingCounts.needsReview} require review
            </p>
            {!detail.mappings.length && <p>No implementation mappings yet.</p>}
            {detail.mappings.map((mapping) => (
              <article
                key={mapping.id}
                data-testid={`mapping-${mapping.id}`}
                className={`mapping-record mapping-${mapping.status.toLowerCase()}`}
              >
                <div className="mapping-badges">
                  <span
                    className={`mapping-badge ${mapping.status.toLowerCase()}`}
                  >
                    {mapping.status === 'SUGGESTED'
                      ? 'Unconfirmed suggestion'
                      : mapping.status === 'CONFIRMED'
                        ? 'Confirmed mapping'
                        : mapping.status === 'REJECTED'
                          ? 'Rejected / retired'
                          : 'Unconfirmed legacy mapping'}
                  </span>
                  {mapping.status !== 'REJECTED' && (
                    <span
                      className={`mapping-badge ${mapping.resolution.status === 'RESOLVED' ? 'resolved' : 'stale'}`}
                    >
                      {mapping.resolution.status === 'RESOLVED'
                        ? 'Target resolved'
                        : mapping.resolution.status === 'STALE'
                          ? 'Stale — review required'
                          : 'Review required'}
                    </span>
                  )}
                </div>
                <h3>{mapping.target?.name ?? mapping.file.path}</h3>
                <p className="small muted">
                  {mapping.target?.kind ?? 'FILE'} ·{' '}
                  {mapping.target?.filePath ?? mapping.file.path} ·{' '}
                  {mapping.target
                    ? `lines ${mapping.target.evidence.startLine}–${mapping.target.evidence.endLine} · commit ${mapping.target.evidence.commitSha.slice(0, 12)}`
                    : `snapshot ${mapping.snapshotId}`}
                </p>
                <p>{mapping.rationale}</p>
                {mapping.heuristic && (
                  <details>
                    <summary>
                      Suggestion evidence (unconfirmed when generated)
                    </summary>
                    <p>{mapping.heuristic.explanation}</p>
                    <p className="small muted">
                      Heuristic score {mapping.heuristic.score}; not a
                      confidence probability. Evidence:{' '}
                      {mapping.heuristic.evidence.filePath}:
                      {mapping.heuristic.evidence.startLine} ·{' '}
                      {mapping.heuristic.evidence.commitSha}
                    </p>
                  </details>
                )}
                {mapping.confirmedByLabel && (
                  <p className="small">
                    Last confirmed by{' '}
                    <strong>{mapping.confirmedByLabel}</strong>{' '}
                    {mapping.confirmedAt &&
                      'on ' +
                        new Date(mapping.confirmedAt).toLocaleString()}{' '}
                    for the recorded snapshot.
                  </p>
                )}
                {mapping.status !== 'REJECTED' && (
                  <p
                    className={
                      mapping.resolution.status === 'RESOLVED'
                        ? 'small muted'
                        : 'mapping-review-reason'
                    }
                  >
                    {mapping.resolution.reason}
                  </p>
                )}
                {!!mapping.resolution.candidates.length &&
                  mapping.status !== 'REJECTED' && (
                    <p className="small">
                      Possible targets (not automatically mapped):{' '}
                      {mapping.resolution.candidates
                        .map(
                          (c) =>
                            `${c.filePath}:${c.evidence.startLine} ${c.name}`,
                        )
                        .join('; ')}
                    </p>
                  )}
                <div className="mapping-actions">
                  <Link
                    to={sourceLink(
                      mapping.target?.filePath ?? mapping.file.path,
                      mapping.nodeId,
                      mapping.snapshotId,
                    )}
                  >
                    View original source
                  </Link>
                  {editable && (
                    <>
                      <button
                        disabled={busy || !snapshotId}
                        onClick={() => editMapping(mapping)}
                      >
                        Edit / remap
                      </button>
                      {mapping.status !== 'CONFIRMED' &&
                        mapping.status !== 'REJECTED' && (
                          <button
                            disabled={
                              busy ||
                              mapping.resolution.status !== 'RESOLVED' ||
                              mapping.snapshotId !== snapshotId
                            }
                            onClick={() =>
                              void mutate(
                                `/mappings/${mapping.id}/review`,
                                {
                                  action: 'CONFIRM',
                                  expectedVersion: mapping.version,
                                  snapshotId,
                                },
                                'POST',
                                'Mapping explicitly confirmed. Confirmation and history have been recorded.',
                              )
                            }
                          >
                            Accept mapping
                          </button>
                        )}
                      {mapping.status !== 'REJECTED' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/mappings/${mapping.id}/review`,
                              {
                                action: 'REJECT',
                                expectedVersion: mapping.version,
                              },
                              'POST',
                              'Mapping rejected or retired. Its history is preserved.',
                            )
                          }
                        >
                          {mapping.status === 'CONFIRMED'
                            ? 'Retire mapping'
                            : 'Reject suggestion'}
                        </button>
                      )}
                    </>
                  )}
                </div>
                <details>
                  <summary>Mapping history ({mapping.history.length})</summary>
                  <ol className="mapping-history">
                    {mapping.history.map((event) => (
                      <li key={event.id}>
                        <strong>
                          Revision {event.revision}: {event.action}
                        </strong>{' '}
                        · {event.actorLabel} ·{' '}
                        {new Date(event.createdAt).toLocaleString()}
                        <p className="small">
                          {event.state.status} ·{' '}
                          {event.state.target?.name ?? 'Legacy file target'} ·
                          snapshot{' '}
                          {event.state.target?.evidence.commitSha ??
                            event.snapshotId}
                        </p>
                        <p>{event.state.rationale}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              </article>
            ))}
          </section>
          <section className="panel">
            <h2>Linked tests</h2>
            <p className="small muted">
              Only resolved, confirmed mappings contribute links. Static
              dependencies indicate relevance, not execution or coverage.
            </p>
            {!detail.linkedTests.length ? (
              <p>
                No linked test evidence is available for this snapshot. This
                does not mean the feature has no tests.
              </p>
            ) : (
              <ul>
                {detail.linkedTests.map((test) => (
                  <li key={test.path}>
                    <Link to={sourceLink(test.path)}>{test.path}</Link>
                    <p className="small muted">{test.basis}</p>
                    {test.cases.length ? (
                      <ul>
                        {test.cases.map((c) => (
                          <li key={c.id}>
                            {c.name} · {c.outcome}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small">
                        No execution results imported for this test source.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <h2>Dependency relationships</h2>
            <p className="small muted">
              Arrows point from dependent to dependency. Relationships below do
              not confirm suggested mappings.
            </p>
            {!detail.dependencies.length && (
              <p>No resolvable implementation relationships available.</p>
            )}
            {detail.dependencies.map((dependency) => {
              const mapping = detail.mappings.find(
                (m) => m.id === dependency.mappingId,
              )!;
              return (
                <details key={dependency.mappingId}>
                  <summary>
                    {mapping.target?.name ?? mapping.file.path} ·{' '}
                    {mapping.status === 'SUGGESTED'
                      ? 'Unconfirmed suggestion'
                      : mapping.status}
                  </summary>
                  <div className="explorer-details-grid">
                    <div>
                      <h3>Incoming dependents</h3>
                      {edgeList(dependency.incoming, true)}
                    </div>
                    <div>
                      <h3>Outgoing dependencies</h3>
                      {edgeList(dependency.outgoing, false)}
                    </div>
                  </div>
                  <p className="small">
                    Transitive dependents:{' '}
                    {dependency.dependents
                      .map((id) => nodeMap.get(id)?.name ?? id)
                      .join(', ') || 'None recorded'}
                  </p>
                </details>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}

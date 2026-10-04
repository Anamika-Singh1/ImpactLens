import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type {
  RepositoryOverviewData,
  ImplementationMatch,
  FeatureSummary,
} from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
import { RepositoryExplorer } from './RepositoryExplorer';
type Job = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  branch: string;
  commitSha: string;
  errorMessage: string | null;
};
type Detail = {
  repository: {
    id: string;
    owner: string;
    name: string;
    description: string | null;
    isPrivate: boolean | null;
    githubUrl: string | null;
  };
  snapshot: { id: string; commitSha: string; isDemo: boolean } | null;
  snapshots: { id: string; commitSha: string }[];
  job: Job | null;
  overview: RepositoryOverviewData | null;
  analyzedAt: string | null;
};
const steps = [
  'Queued',
  'Fetching repository',
  'Scanning files',
  'Analyzing code',
  'Preparing overview',
  'Completed',
];
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Unable to load repository. Try again.';
export function RepositoryDetails() {
  const searchController = useRef<AbortController | null>(null);
  const { repositoryId } = useParams();
  const { workspace } = useAuth();
  const [query, setQuery] = useSearchParams();
  const snapshotId = query.get('snapshotId'),
    jobId = query.get('jobId');
  const tab =
    query.get('tab') ??
    (query.has('filePath') || query.has('nodeId') ? 'structure' : 'overview');
  const root = `/workspaces/${workspace?.id}/repositories/${repositoryId}`;
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [revision, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''),
    [results, setResults] = useState<{
      matches: ImplementationMatch[];
      message: string;
    } | null>(null),
    [searchError, setSearchError] = useState(''),
    [searching, setSearching] = useState(false);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDetail(null);
    searchController.current?.abort();
    setSearching(false);
    setResults(null);
    setError('');
    setFeatures([]);
    async function load() {
      try {
        const parameters = new URLSearchParams();
        if (snapshotId) parameters.set('snapshotId', snapshotId);
        if (jobId) parameters.set('jobId', jobId);
        const data = await apiRequest<Detail>(`${root}/details?${parameters}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setDetail(data);
        setError('');
        if (data.job && ['QUEUED', 'RUNNING'].includes(data.job.status))
          timer = setTimeout(() => void load(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      }
    }
    void load();
    return () => {
      controller.abort();
      searchController.current?.abort();
      clearTimeout(timer);
    };
  }, [root, snapshotId, jobId, revision]);
  useEffect(() => {
    if (!detail?.snapshot) return;
    const controller = new AbortController();
    apiRequest<FeatureSummary[]>(`${root}/features`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setFeatures(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [root, detail?.snapshot?.id, revision]);
  function selectTab(value: string) {
    const next = new URLSearchParams(query);
    next.set('tab', value);
    setQuery(next);
  }
  function source(filePath: string, nodeId?: string) {
    const parameters = new URLSearchParams({
      tab: 'structure',
      snapshotId: detail!.snapshot!.id,
      filePath,
    });
    if (nodeId && !nodeId.startsWith('text:')) parameters.set('nodeId', nodeId);
    return `/repositories/${repositoryId}?${parameters}`;
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    if (!detail?.snapshot) return;
    setSearching(true);
    setSearchError('');
    setResults(null);
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    try {
      const result = await apiRequest<{
        matches: ImplementationMatch[];
        message: string;
      }>(
        `${root}/implementation-search?snapshotId=${detail.snapshot.id}&q=${encodeURIComponent(search.trim())}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setResults(result);
    } catch (error) {
      if (!controller.signal.aborted) setSearchError(message(error));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  async function retry() {
    if (!detail?.job) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        `/workspaces/${workspace?.id}/imports/${detail.job.id}/retry`,
        { method: 'POST' },
      );
      refresh((value) => value + 1);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const overview = detail?.overview;
  return (
    <>
      <Link to="/repositories">← Repositories</Link>
      <p className="eyebrow">REPOSITORY / IMPLEMENTATION</p>
      <h1>
        {detail
          ? `${detail.repository.owner}/${detail.repository.name}`
          : 'Repository details'}
      </h1>
      <p className="subtitle">
        Understand one repository snapshot. Change-impact comparisons are a
        separate workflow.
      </p>
      <div className="import-actions">
        <Link to="/analyses">Analyze Changes</Link>
        <button onClick={() => refresh((value) => value + 1)} disabled={busy}>
          Refresh repository
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!detail && !error && <p role="status">Loading repository…</p>}
      {detail?.job && (
        <section className="panel" aria-labelledby="analysis-progress-heading">
          <h2 id="analysis-progress-heading">Repository analysis</h2>
          <p>
            {detail.job.status} · {detail.job.stage}
          </p>
          <ol className="repository-steps">
            {steps.map((step) => (
              <li
                key={step}
                aria-current={
                  step ===
                  (detail.job!.status === 'QUEUED'
                    ? 'Queued'
                    : detail.job!.stage)
                    ? 'step'
                    : undefined
                }
              >
                {step}
              </li>
            ))}
          </ol>
          {['QUEUED', 'RUNNING'].includes(detail.job.status) && (
            <progress
              aria-label="Repository analysis progress"
              value={detail.job.progress}
              max={100}
            >
              {detail.job.progress}%
            </progress>
          )}
          {detail.job.errorMessage && (
            <p role="alert" className="error">
              {detail.job.errorMessage}
            </p>
          )}
          {['FAILED', 'CANCELED'].includes(detail.job.status) &&
            workspace?.role !== 'VIEWER' && (
              <button disabled={busy} onClick={() => void retry()}>
                Retry
              </button>
            )}
        </section>
      )}
      {detail && (
        <>
          {!!detail.snapshots?.length && (
            <label>
              Analyzed snapshot
              <select
                aria-label="Analyzed snapshot"
                value={detail.snapshot?.id ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(query);
                  next.set('snapshotId', event.target.value);
                  next.delete('jobId');
                  next.delete('filePath');
                  next.delete('nodeId');
                  setQuery(next);
                }}
              >
                <option value="" disabled>
                  Select a completed snapshot
                </option>
                {detail.snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.commitSha.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <nav aria-label="Repository sections" className="repository-tabs">
            {[
              ['overview', 'Overview'],
              ['structure', 'Structure'],
              ['dependencies', 'Dependencies'],
              ['routes', 'API Routes'],
              ['features', 'Features'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => selectTab(value!)}
              >
                {label}
              </button>
            ))}
          </nav>
          {detail.snapshot && (
            <section className="panel">
              <form onSubmit={(event) => void find(event)}>
                <label htmlFor="implementation-query">
                  Find a feature or implementation…
                </label>
                <input
                  id="implementation-query"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Where is login implemented?"
                  maxLength={200}
                  required
                />
                <button disabled={searching || !search.trim()}>
                  {searching ? 'Searching…' : 'Find implementation'}
                </button>
              </form>
              {searchError && (
                <p role="alert" className="error">
                  {searchError}
                </p>
              )}
              {results && (
                <>
                  <p role="status">{results.message}</p>
                  {results.matches.map((match, index) => (
                    <article
                      className="import-job"
                      key={`${match.filePath}:${match.startLine}:${index}`}
                    >
                      <h3>{match.label}</h3>
                      <p>
                        {match.status === 'CONFIRMED_MAPPING'
                          ? 'Confirmed feature mapping'
                          : 'Candidate'}{' '}
                        · {match.filePath}:{match.startLine}–{match.endLine}
                      </p>
                      <p>{match.reasons.join('; ')}</p>
                      <pre className="implementation-excerpt">
                        {match.excerpt}
                      </pre>
                      <Link to={source(match.filePath, match.nodeId)}>
                        Open file
                      </Link>
                    </article>
                  ))}
                </>
              )}
            </section>
          )}
          {tab === 'overview' && (
            <section className="panel">
              <h2>Overview</h2>
              <p>
                {detail.repository.description ||
                  'No repository description was provided.'}
              </p>
              {detail.repository.githubUrl && (
                <p>
                  <a
                    href={detail.repository.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on GitHub
                  </a>{' '}
                  ·{' '}
                  {detail.repository.isPrivate === null
                    ? 'Visibility unknown'
                    : detail.repository.isPrivate
                      ? 'Private'
                      : 'Public'}
                </p>
              )}
              {detail.snapshot?.isDemo && <p>Synthetic sample repository.</p>}
              <p>
                Branch: {detail.job?.branch ?? 'Not recorded'} · Commit:{' '}
                {detail.snapshot?.commitSha ??
                  detail.job?.commitSha ??
                  'Not analyzed'}
              </p>
              <p>
                Last analysis:{' '}
                {detail.analyzedAt
                  ? new Date(detail.analyzedAt).toLocaleString()
                  : 'Not completed'}
              </p>
              {overview ? (
                <>
                  <h3>Project summary</h3>
                  <p>{overview.summary}</p>
                  <p>{overview.purpose}</p>
                  <p>
                    {overview.sourceFileCount} source files ·{' '}
                    {overview.retainedFileCount} retained files
                  </p>
                  <h3>Languages</h3>
                  <ul>
                    {overview.languages.map((item) => (
                      <li key={item.name}>
                        {item.name}: {item.files} files
                      </li>
                    ))}
                  </ul>
                  <h3>Frameworks and tools</h3>
                  {!overview.technologies.length && (
                    <p>No supported framework evidence was found.</p>
                  )}
                  <ul>
                    {overview.technologies.map((item) => (
                      <li key={item.name}>
                        <strong>{item.name}</strong> — {item.reason}{' '}
                        {item.evidence.map((proof, index) => (
                          <Link key={index} to={source(proof.filePath)}>
                            {' '}
                            {proof.filePath}
                          </Link>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <h3>Package managers</h3>
                  {overview.packageManagers.length ? (
                    <ul>
                      {overview.packageManagers.map((item) => (
                        <li key={item.name}>
                          {item.name}:{' '}
                          {item.evidence
                            .map((proof) => proof.filePath)
                            .join(', ')}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No explicit package manager evidence found.</p>
                  )}
                  <h3>Main directories</h3>
                  <ul>
                    {overview.directories.map((item) => (
                      <li key={item.name}>
                        {item.name}: {item.files} retained files
                      </li>
                    ))}
                  </ul>
                  <details>
                    <summary>Analysis limits and exclusions</summary>
                    <ul>
                      {overview.limitations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p>
                  An overview is not available yet. Wait for queued analysis to
                  finish. Legacy snapshots remain available in Structure; add
                  their GitHub URL again to prepare an overview.
                </p>
              )}
            </section>
          )}
          {tab === 'structure' && <RepositoryExplorer />}
          {tab === 'dependencies' && (
            <section className="panel">
              <h2>Declared dependencies</h2>
              <p>
                Supported manifests: package.json, including workspace
                manifests. Resolved versions are shown only when a retained npm
                lockfile provides them. Packages are grouped by manifest
                declaration, with no assumed purpose or vulnerability claims.
              </p>
              {overview ? (
                ['production', 'development', 'optional', 'peer'].map(
                  (scope) => (
                    <section key={scope}>
                      <h3>
                        {scope === 'development'
                          ? 'Development dependencies'
                          : `${scope} dependencies`}
                      </h3>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Package</th>
                              <th>Declared range</th>
                              <th>Resolved version</th>
                              <th>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.dependencies
                              .filter((item) => item.scope === scope)
                              .map((item, index) => (
                                <tr key={index}>
                                  <td>{item.name}</td>
                                  <td>{item.declaredVersion}</td>
                                  <td>
                                    {item.resolvedVersions.join(', ') ||
                                      'Unresolved'}
                                  </td>
                                  <td>
                                    <Link to={source(item.manifest)}>
                                      {item.manifest}
                                    </Link>
                                    {item.lockfile && (
                                      <Link to={source(item.lockfile)}>
                                        {' '}
                                        · {item.lockfile}
                                      </Link>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ),
                )
              ) : (
                <p>Dependency overview is not ready.</p>
              )}
            </section>
          )}
          {tab === 'routes' && (
            <section className="panel">
              <h2>API Routes</h2>
              <p>
                Direct Express registrations are supported. Paths are local
                registration paths; router mount prefixes remain unresolved.
                Other backend patterns are not indexed.
              </p>
              {!overview?.routes.length && (
                <p>
                  No supported route registrations were found in this snapshot.
                </p>
              )}
              {overview?.routes.map((route, index) => (
                <article key={index} className="import-job">
                  <h3>
                    {route.method} {route.path}
                  </h3>
                  <p>Handler: {route.handler.join(', ') || 'Unresolved'}</p>
                  <p>
                    Middleware references:{' '}
                    {route.middleware.join(', ') ||
                      'None extracted; global middleware may still apply'}
                  </p>
                  <p>{route.limitations.join(' ')}</p>
                  <Link
                    to={source(route.evidence.filePath, route.evidence.nodeId)}
                  >
                    {route.evidence.filePath}:{route.evidence.startLine}
                  </Link>
                </article>
              ))}
              {overview && (
                <details>
                  <summary>Unsupported patterns and limitations</summary>
                  <ul>
                    {overview.limitations.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
          {tab === 'features' && (
            <section className="panel">
              <h2>Possible features and mappings</h2>
              <p>
                Suggestions are inferred from source names and remain unverified
                until a person reviews their mappings. Confirm, edit or reject
                each suggested mapping in its feature review.
              </p>
              {overview?.suggestions.map((suggestion) => {
                const feature = features.find(
                  (item) => item.key === `overview-${suggestion.key}`,
                );
                return (
                  <article key={suggestion.key} className="import-job">
                    <h3>{feature?.name ?? suggestion.name}</h3>
                    <p>{feature?.description ?? suggestion.explanation}</p>
                    <p>
                      {feature?.mappingCounts.confirmed
                        ? 'Confirmed mappings exist'
                        : feature?.mappingCounts.rejected &&
                            !feature.mappingCounts.suggested
                          ? 'Rejected mappings'
                          : 'Suggested — requires review'}
                    </p>
                    <p>{suggestion.reason}</p>
                    <ul>
                      {suggestion.evidence.map((proof, index) => (
                        <li key={index}>
                          <Link to={source(proof.filePath, proof.nodeId)}>
                            {proof.label} · {proof.filePath}:{proof.startLine}–
                            {proof.endLine}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {feature && (
                      <Link to={`/features/${repositoryId}/${feature.id}`}>
                        Review, confirm, edit or reject mappings
                      </Link>
                    )}
                  </article>
                );
              })}
              {!overview?.suggestions.length && (
                <p>
                  No supported feature candidate was found confidently. You can
                  add mappings manually.
                </p>
              )}
              <h3>Feature catalog</h3>
              <ul>
                {features.map((feature) => (
                  <li key={feature.id}>
                    <Link to={`/features/${repositoryId}/${feature.id}`}>
                      {feature.name}
                    </Link>{' '}
                    · {feature.mappingCounts.confirmed} confirmed ·{' '}
                    {feature.mappingCounts.suggested} suggested
                  </li>
                ))}
              </ul>
              {workspace?.role !== 'VIEWER' && (
                <Link to={`/features?repositoryId=${repositoryId}`}>
                  Add a feature or manual mapping
                </Link>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

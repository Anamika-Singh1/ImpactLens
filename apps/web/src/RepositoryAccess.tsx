import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, useAuth } from './session';

type Installation = {
  id: string;
  account: string;
  githubInstallationId: string;
};
type GitHubStatus = {
  enabled: boolean;
  authorization: { login: string; expiresAt: string } | null;
  installUrl: string | null;
  installations: Installation[];
};
type Available = { installationId: string; account: string };
type Repository = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
};
type Branch = { name: string; commitSha: string };
type Job = {
  id: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  progress: number;
  stage: string;
  errorMessage: string | null;
  repository: { owner: string; name: string; source: string };
  snapshot: { id: string } | null;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed. Try again.';
const active = (job: Job) => ['QUEUED', 'RUNNING'].includes(job.status);

function usePage<T>(path: string | null, field: string) {
  const [page, setPage] = useState(1);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{
    items: T[];
    hasNext: boolean;
    loading: boolean;
    error: string;
  }>({ items: [], hasNext: false, loading: false, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ items: [], hasNext: false, loading: !!path, error: '' });
    if (path)
      apiRequest<Record<string, T[]> & { hasNext: boolean }>(
        `${path}?page=${page}`,
        {
          signal: controller.signal,
        },
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setState({
              items: result[field] ?? [],
              hasNext: result.hasNext,
              loading: false,
              error: '',
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              items: [],
              hasNext: false,
              loading: false,
              error: message(error),
            });
        });
    return () => controller.abort();
  }, [path, page, field, revision]);
  return {
    ...state,
    page,
    setPage,
    refresh: () => refresh((value) => value + 1),
  };
}
function Pagination({
  label,
  page,
  hasNext,
  loading,
  change,
}: {
  label: string;
  page: number;
  hasNext: boolean;
  loading: boolean;
  change: (page: number) => void;
}) {
  return (
    <div className="import-actions">
      <button
        type="button"
        disabled={loading || page === 1}
        onClick={() => change(page - 1)}
      >
        Previous {label}
      </button>
      <span>Page {page}</span>
      <button
        type="button"
        disabled={loading || !hasNext || page === 100}
        onClick={() => change(page + 1)}
      >
        Next {label}
      </button>
    </div>
  );
}

export function RepositoryAccess({
  imports = false,
  onRegistered,
}: {
  imports?: boolean;
  onRegistered?: () => Promise<void>;
}) {
  const { workspace } = useAuth();
  const [query] = useSearchParams();
  const root = `/workspaces/${workspace?.id}`;
  const owner = workspace?.role === 'OWNER';
  const canImport = !!workspace && workspace.role !== 'VIEWER';
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [installationId, setInstallation] = useState('');
  const [availableId, setAvailable] = useState('');
  const [repositoryId, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(imports);
  const [jobsError, setJobsError] = useState('');
  const [jobRevision, refreshJobs] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    apiRequest<GitHubStatus>(`${root}/github`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setStatus(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [root, revision]);

  useEffect(() => {
    if (!imports) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const result = await apiRequest<Job[]>(`${root}/imports`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJobs(result);
        setJobsError('');
        if (result.some(active)) timer = setTimeout(() => void load(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) setJobsError(message(error));
      } finally {
        if (!controller.signal.aborted) setJobsLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [root, imports, jobRevision]);

  const connected = !!status?.enabled && !!status.authorization && canImport;
  const available = usePage<Available>(
    connected && owner ? `${root}/github/available-installations` : null,
    'installations',
  );
  const repositories = usePage<Repository>(
    connected && imports && installationId
      ? `${root}/github/installations/${installationId}/repositories`
      : null,
    'repositories',
  );
  const branches = usePage<Branch>(
    connected && imports && installationId && repositoryId
      ? `${root}/github/installations/${installationId}/repositories/${repositoryId}/branches`
      : null,
    'branches',
  );

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit(source: 'FIXTURE' | 'GITHUB') {
    await perform(async () => {
      const job = await apiRequest<Job>(`${root}/imports`, {
        method: 'POST',
        body: JSON.stringify(
          source === 'FIXTURE'
            ? { source }
            : { source, installationId, repositoryId, branch },
        ),
      });
      setJobs((previous) => [
        job,
        ...previous.filter((item) => item.id !== job.id),
      ]);
      refreshJobs((value) => value + 1);
      setNotice(
        job.status === 'COMPLETED'
          ? 'This snapshot is already imported. Open it below.'
          : 'Import submitted. Progress appears below.',
      );
      await onRegistered?.();
    });
  }

  return (
    <>
      <section className="panel" aria-labelledby="github-access-heading">
        <h2 id="github-access-heading">
          {imports ? 'Add a repository from GitHub' : 'GitHub access'}
        </h2>
        <p>
          Connect your account, choose which repositories the ImpactLens GitHub
          App can access, then import a branch snapshot.
        </p>
        {query.get('github') === 'connected' && (
          <p role="status">
            GitHub account connected. Choose repository access below.
          </p>
        )}
        {query.get('github') === 'failed' && (
          <p role="alert" className="error">
            GitHub authorization failed or expired. Connect your account again.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => refresh((value) => value + 1)}
        >
          Refresh GitHub access
        </button>
        {!status && !error && <p role="status">Loading GitHub access…</p>}
        {status && !status.enabled && (
          <p role="status">
            GitHub connection is unavailable until the server administrator
            configures the ImpactLens GitHub App. You can try the sample import
            below.
          </p>
        )}
        {status?.enabled && !canImport && (
          <p>
            Your Viewer role can read imported repositories. Ask an Owner or
            Engineer to import your repository.
          </p>
        )}
        {status?.enabled && canImport && (
          <>
            <p>
              {status.authorization
                ? `Connected as ${status.authorization.login}`
                : 'Connect your GitHub account to continue.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await apiRequest<{ url: string }>(
                    `${root}/github/authorize`,
                    { method: 'POST' },
                  );
                  const url = new URL(result.url);
                  if (
                    url.origin !== 'https://github.com' ||
                    url.pathname !== '/login/oauth/authorize'
                  )
                    throw new Error('Invalid GitHub authorization link.');
                  window.location.assign(url.toString());
                })
              }
            >
              {status.authorization ? 'Reconnect GitHub' : 'Connect GitHub'}
            </button>
            {owner && status.installUrl && (
              <p>
                <a
                  href={status.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Choose repository access on GitHub
                </a>{' '}
                — select only the repositories you want to import, then return
                here and refresh available accounts.
              </p>
            )}
            {!owner && (
              <p>
                A workspace Owner must link an authorized GitHub account before
                you can select its repositories.
              </p>
            )}
          </>
        )}
        {connected && owner && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await apiRequest(`${root}/github/installations`, {
                  method: 'POST',
                  body: JSON.stringify({ installationId: availableId }),
                });
                setAvailable('');
                refresh((value) => value + 1);
                setNotice('GitHub account linked to this workspace.');
              });
            }}
          >
            <h3>Link an authorized account to this workspace</h3>
            {available.error && (
              <p role="alert" className="error">
                {available.error}
              </p>
            )}
            <label>
              Available GitHub account
              <select
                value={availableId}
                onChange={(event) => setAvailable(event.target.value)}
                disabled={busy || available.loading}
                required
              >
                <option value="">Select an account</option>
                {available.items.map((item) => (
                  <option key={item.installationId} value={item.installationId}>
                    {item.account} · {item.installationId}
                  </option>
                ))}
              </select>
            </label>
            {!available.loading &&
              !available.error &&
              !available.items.length && (
                <p>
                  No authorized accounts found on this page. Choose repository
                  access on GitHub, then refresh.
                </p>
              )}
            <button
              type="button"
              disabled={busy || available.loading}
              onClick={() => available.refresh()}
            >
              Refresh available accounts
            </button>
            <Pagination
              label="accounts"
              {...available}
              change={(page) => {
                setAvailable('');
                available.setPage(page);
              }}
            />
            <button disabled={busy || !availableId}>Link GitHub account</button>
          </form>
        )}
        {connected && imports && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit('GITHUB');
            }}
          >
            <h3>Select a repository to import</h3>
            <label>
              Linked GitHub account
              <select
                value={installationId}
                required
                disabled={busy}
                onChange={(event) => {
                  setInstallation(event.target.value);
                  setRepository('');
                  setBranch('');
                  repositories.setPage(1);
                  branches.setPage(1);
                }}
              >
                <option value="">Select a linked account</option>
                {status.installations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.account} · {item.githubInstallationId}
                  </option>
                ))}
              </select>
            </label>
            {!status.installations.length && (
              <p>
                No GitHub accounts are linked yet. An Owner can link one above
                or in Settings.
              </p>
            )}
            {installationId && (
              <>
                {repositories.error && (
                  <p role="alert" className="error">
                    {repositories.error}
                  </p>
                )}
                <label>
                  GitHub repository
                  <select
                    value={repositoryId}
                    required
                    disabled={busy || repositories.loading}
                    onChange={(event) => {
                      setRepository(event.target.value);
                      setBranch('');
                      branches.setPage(1);
                    }}
                  >
                    <option value="">
                      {repositories.loading
                        ? 'Loading repositories…'
                        : 'Select a repository'}
                    </option>
                    {repositories.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.owner}/{item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!repositories.loading &&
                  !repositories.error &&
                  !repositories.items.length && (
                    <p>
                      No repositories available on this page. Check the App’s
                      repository access on GitHub.
                    </p>
                  )}
                <button
                  type="button"
                  disabled={busy || repositories.loading}
                  onClick={() => {
                    setRepository('');
                    setBranch('');
                    repositories.refresh();
                  }}
                >
                  Refresh repositories
                </button>
                <Pagination
                  label="repositories"
                  {...repositories}
                  change={(page) => {
                    setRepository('');
                    setBranch('');
                    repositories.setPage(page);
                  }}
                />
              </>
            )}
            {repositoryId && (
              <>
                {branches.error && (
                  <p role="alert" className="error">
                    {branches.error}
                  </p>
                )}
                <label>
                  Branch
                  <select
                    value={branch}
                    required
                    disabled={busy || branches.loading}
                    onChange={(event) => setBranch(event.target.value)}
                  >
                    <option value="">
                      {branches.loading
                        ? 'Loading branches…'
                        : 'Select a branch'}
                    </option>
                    {branches.items.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} · {item.commitSha.slice(0, 12)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || branches.loading}
                  onClick={() => {
                    setBranch('');
                    branches.refresh();
                  }}
                >
                  Refresh branches
                </button>
                <Pagination
                  label="branches"
                  {...branches}
                  change={(page) => {
                    setBranch('');
                    branches.setPage(page);
                  }}
                />
              </>
            )}
            <p className="small muted">
              Import saves the selected branch’s current commit. Repository code
              and scripts are never executed.
            </p>
            <button
              disabled={
                busy ||
                !installationId ||
                !repositoryId ||
                !branch ||
                repositories.loading ||
                branches.loading
              }
            >
              Import repository snapshot
            </button>
          </form>
        )}
        {!imports && (
          <p>
            <Link to="/repositories">
              Go to Repositories to import and view code
            </Link>
          </p>
        )}
      </section>
      {imports && (
        <>
          {canImport && (
            <section className="panel">
              <h2>Try a sample repository</h2>
              <p>
                Import the owned synthetic checkout fixture to explore the
                workflow without GitHub access.
              </p>
              <button disabled={busy} onClick={() => void submit('FIXTURE')}>
                Import sample repository
              </button>
            </section>
          )}
          <section className="panel" aria-labelledby="import-progress-heading">
            <h2 id="import-progress-heading">Repository imports</h2>
            <button
              disabled={busy}
              onClick={() => refreshJobs((value) => value + 1)}
            >
              Refresh imports
            </button>
            {jobsError && (
              <p role="alert" className="error">
                {jobsError}
              </p>
            )}
            {jobsLoading && <p role="status">Loading imports…</p>}
            {!jobsLoading && !jobs.length && (
              <p>No repository snapshots have been imported yet.</p>
            )}
            {jobs.map((job) => (
              <article key={job.id} className="import-job">
                <h3>
                  {job.repository.owner}/{job.repository.name}
                </h3>
                <p>
                  {job.repository.source === 'FIXTURE'
                    ? 'Synthetic sample · '
                    : ''}
                  {job.branch} · {job.commitSha.slice(0, 12)} ·{' '}
                  <strong>{job.status}</strong>
                </p>
                <p>{job.stage}</p>
                {active(job) && (
                  <progress
                    aria-label={`Import progress for ${job.repository.owner}/${job.repository.name}`}
                    value={job.progress}
                    max={100}
                  >
                    {job.progress}%
                  </progress>
                )}
                {job.errorMessage && (
                  <p className="error">{job.errorMessage}</p>
                )}
                {job.status === 'COMPLETED' && job.snapshot && (
                  <Link
                    to={`/repositories/${job.repositoryId}?snapshotId=${job.snapshot.id}`}
                  >
                    View imported code
                  </Link>
                )}
                {canImport &&
                  (active(job) ||
                    ['FAILED', 'CANCELED'].includes(job.status)) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await apiRequest(
                            `${root}/imports/${job.id}/${active(job) ? 'cancel' : 'retry'}`,
                            { method: 'POST' },
                          );
                          refreshJobs((value) => value + 1);
                        })
                      }
                    >
                      {active(job) ? 'Cancel import' : 'Retry import'}
                    </button>
                  )}
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}

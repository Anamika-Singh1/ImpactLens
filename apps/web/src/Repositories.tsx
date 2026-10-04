import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, useAuth } from './session';
import { Link } from 'react-router-dom';
import { RepositoryAccess } from './RepositoryAccess';
import { AddRepository } from './AddRepository';
type Repository = { id: string; owner: string; name: string };
export function Repositories() {
  const { workspace } = useAuth();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    if (!workspace) return;
    setLoading(true);
    setError('');
    try {
      setRepos(
        await apiRequest<Repository[]>(
          '/workspaces/' + workspace.id + '/repositories',
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to load repositories',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setRepos([]);
    void load();
  }, [workspace?.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/workspaces/' + workspace.id + '/repositories', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      await load();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to register repository',
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(repo: Repository) {
    if (
      !workspace ||
      !window.confirm(
        `Delete ${repo.owner}/${repo.name} and all its snapshots, saved comparisons, reviews and test artifacts? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/workspaces/${workspace.id}/repositories/${repo.id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete repository');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">WORKSPACE / REPOSITORIES</p>
      <h1>Repositories</h1>
      <p className="subtitle">
        Import your repository from GitHub, then explore its source and static
        dependencies.
      </p>
      <AddRepository key={workspace?.id} />
      {workspace && (
        <details className="panel">
          <summary>GitHub access, sample imports and import history</summary>
          <RepositoryAccess key={workspace.id} imports onRegistered={load} />
        </details>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading repositories…</p>
      ) : repos.length ? (
        <div className="panel">
          <ul>
            {repos.map((repo) => (
              <li key={repo.id}>
                <Link to={`/repositories/${repo.id}`}>
                  <strong>
                    {repo.owner}/{repo.name}
                  </strong>
                </Link>
                <p className="small muted">
                  Open repository to view snapshot availability.
                </p>
                {workspace?.role === 'OWNER' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(repo)}
                  >
                    Delete {repo.owner}/{repo.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <section className="empty panel">
          <h2>No repositories registered</h2>
          <p>
            Repository metadata and imported snapshots are scoped to this
            workspace.
          </p>
        </section>
      )}
      {workspace && workspace.role !== 'VIEWER' && (
        <section className="panel">
          <h2>Register repository metadata only</h2>
          <p className="small muted">
            This creates a listing without importing code. Use GitHub import
            above to view a repository.
          </p>
          <form onSubmit={submit}>
            <label>
              GitHub owner
              <input
                name="owner"
                required
                maxLength={100}
                pattern="[a-zA-Z0-9_.\-]+"
              />
            </label>
            <label>
              Repository name
              <input
                name="name"
                required
                maxLength={100}
                pattern="[a-zA-Z0-9_.\-]+"
              />
            </label>
            <button disabled={busy}>Register metadata</button>
          </form>
        </section>
      )}
    </>
  );
}

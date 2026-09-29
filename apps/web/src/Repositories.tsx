import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, useAuth } from './session';
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
  return (
    <>
      <p className="eyebrow">WORKSPACE / REPOSITORIES</p>
      <h1>Repositories</h1>
      <p className="subtitle">
        Register repository metadata. No code is fetched, and this does not
        grant GitHub access.
      </p>
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
                <strong>
                  {repo.owner}/{repo.name}
                </strong>
                <p className="small muted">Metadata only · Not imported</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <section className="empty panel">
          <h2>No repositories registered</h2>
          <p>
            Repository metadata is scoped to this workspace. GitHub import
            arrives in a later phase.
          </p>
        </section>
      )}
      {workspace && workspace.role !== 'VIEWER' && (
        <section className="panel">
          <h2>Register repository metadata</h2>
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

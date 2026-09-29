import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, useAuth } from './session';
type Repo = { id: string; owner: string; name: string };
type Item = {
  id: string;
  name?: string;
  key?: string;
  status?: string;
  createdAt?: string;
  mappings?: unknown[];
};
export function CoreRecords({ kind }: { kind: 'features' | 'analyses' }) {
  const { workspace } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    apiRequest<Repo[]>('/workspaces/' + workspace.id + '/repositories')
      .then((data) => {
        if (active) {
          setRepos(data);
          setRepositoryId((current) =>
            data.some((r) => r.id === current) ? current : (data[0]?.id ?? ''),
          );
          if (!data.length) setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspace?.id, attempt]);
  useEffect(() => {
    let active = true;
    setItems([]);
    if (!workspace || !repositoryId) return;
    setLoading(true);
    setError('');
    apiRequest<Item[]>(
      '/workspaces/' +
        workspace.id +
        '/repositories/' +
        repositoryId +
        '/' +
        kind,
    )
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace?.id, repositoryId, kind, attempt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        '/workspaces/' +
          workspace.id +
          '/repositories/' +
          repositoryId +
          '/features',
        {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        },
      );
      form.reset();
      setAttempt((value) => value + 1);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to save feature',
      );
    } finally {
      setBusy(false);
    }
  }
  const title = kind === 'features' ? 'Features' : 'Analyses';
  return (
    <>
      <p className="eyebrow">WORKSPACE / {title.toUpperCase()}</p>
      <h1>{title}</h1>
      <p className="subtitle">
        {kind === 'features'
          ? 'Define customer-facing features. Source mappings require imported snapshots, which arrive in a later phase.'
          : 'Draft records reference immutable snapshots. Analysis execution is not implemented in this phase.'}
      </p>
      {repos.length > 0 && (
        <label>
          Repository
          <select
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
          >
            {repos.map((repo) => (
              <option value={repo.id} key={repo.id}>
                {repo.owner}/{repo.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading {kind}…</p>
      ) : items.length ? (
        <section className="panel">
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {kind === 'features' ? (
                  <>
                    <strong>{item.name}</strong>
                    <p className="small muted">
                      {item.key} · {item.mappings?.length ?? 0} explicit source
                      mappings
                    </p>
                  </>
                ) : (
                  <>
                    <strong>{item.status}</strong>
                    <p className="small muted">
                      Analysis {item.id} ·{' '}
                      {item.createdAt &&
                        new Date(item.createdAt).toLocaleString()}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel empty">
          <h2>
            {repos.length
              ? 'No ' + kind + ' recorded'
              : 'Register a repository first'}
          </h2>
          <p>
            Only records from the selected workspace and repository appear here.
          </p>
        </section>
      )}
      {kind === 'features' && repositoryId && workspace?.role !== 'VIEWER' && (
        <section className="panel">
          <h2>Add a business feature</h2>
          <form onSubmit={submit}>
            <label>
              Feature key
              <input name="key" required maxLength={100} />
            </label>
            <label>
              Feature name
              <input name="name" required maxLength={150} />
            </label>
            <button disabled={busy}>Add feature</button>
          </form>
        </section>
      )}
    </>
  );
}

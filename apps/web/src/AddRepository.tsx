import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, useAuth } from './session';
export function AddRepository() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !workspace) return;
    setError('');
    try {
      const parsed = new URL(url.trim());
      const parts = parsed.pathname
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean);
      if (
        parsed.protocol !== 'https:' ||
        parsed.hostname !== 'github.com' ||
        parsed.port ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parts.length !== 2 ||
        !parts.every(
          (part) =>
            /^[a-zA-Z0-9_.-]{1,100}$/.test(part) && !['.', '..'].includes(part),
        )
      )
        throw new Error();
    } catch {
      setError(
        'Enter https://github.com/owner/project without credentials, query parameters or a branch path.',
      );
      return;
    }
    if (branch.trim() && /[\x00-\x20\\]/.test(branch.trim())) {
      setError('Enter a branch name without spaces or backslashes.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const job = await apiRequest<{ id: string; repositoryId: string }>(
        `/workspaces/${workspace.id}/repositories/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            url: url.trim(),
            ...(branch.trim() ? { branch: branch.trim() } : {}),
          }),
        },
      );
      navigate(`/repositories/${job.repositoryId}?jobId=${job.id}`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to add the repository. Try again.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!workspace || workspace.role === 'VIEWER') return null;
  return (
    <section className="panel" aria-labelledby="add-repository-heading">
      <h2 id="add-repository-heading">Understand your repository</h2>
      <p>
        Add a public GitHub repository to analyze its current source and see an
        evidence-based overview. No pull request, second commit or test upload
        is required.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          setError('');
        }}
        aria-expanded={open}
        aria-controls="add-repository-form"
      >
        Add Repository
      </button>
      {open && (
        <form
          id="add-repository-form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <label htmlFor="repository-url">GitHub repository URL</label>
          <input
            id="repository-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/username/project-name"
            required
            maxLength={2048}
            disabled={busy}
          />
          <label htmlFor="repository-branch">Branch (optional)</label>
          <input
            id="repository-branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="Use the default branch"
            maxLength={255}
            disabled={busy}
          />
          <p className="small muted">
            Public repositories need no GitHub connection. Private repositories
            require your connected account and a linked App installation with
            repository access. Grant access through GitHub; do not paste
            credentials into this URL.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy ? 'Checking repository…' : 'Analyze Repository'}
          </button>
        </form>
      )}
    </section>
  );
}

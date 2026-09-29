import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, useAuth } from './session';
type Member = {
  role: string;
  user: { id: string; email: string; name: string };
};
export function WorkspaceSettings() {
  const { workspace, refresh } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const owner = workspace?.role === 'OWNER';
  async function load() {
    if (!workspace) return;
    setLoading(true);
    setError('');
    try {
      setMembers(
        await apiRequest<Member[]>('/workspaces/' + workspace.id + '/members'),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to load members',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setMembers([]);
    setMessage('');
    void load();
  }, [workspace?.id]);
  async function save(event: FormEvent<HTMLFormElement>, member: boolean) {
    event.preventDefault();
    if (!workspace) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest(
        '/workspaces/' + workspace.id + (member ? '/members' : ''),
        { method: member ? 'POST' : 'PATCH', body: JSON.stringify(data) },
      );
      if (member) {
        form.reset();
        await load();
      } else await refresh();
      setMessage(member ? 'Member added.' : 'Workspace updated.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save');
    } finally {
      setBusy(false);
    }
  }
  async function changeMember(member: Member, role?: string) {
    if (!workspace) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest(
        '/workspaces/' + workspace.id + '/members/' + member.user.id,
        {
          method: role ? 'PATCH' : 'DELETE',
          ...(role ? { body: JSON.stringify({ role }) } : {}),
        },
      );
      await load();
      setMessage('Membership updated.');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to update membership',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!workspace) return <p>No workspace memberships are available.</p>;
  return (
    <>
      <p className="eyebrow">WORKSPACE / SETTINGS</p>
      <h1>Settings</h1>
      <p className="subtitle">
        Your role: {workspace.role}. Permissions are enforced by the API.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <section className="panel">
        <h2>Workspace details</h2>
        {owner ? (
          <form
            key={workspace.id + workspace.name}
            onSubmit={(event) => void save(event, false)}
          >
            <label>
              Workspace name
              <input
                name="name"
                defaultValue={workspace.name}
                required
                maxLength={100}
              />
            </label>
            <button disabled={busy}>Save workspace</button>
          </form>
        ) : (
          <p>{workspace.name} · Only an Owner can change workspace settings.</p>
        )}
      </section>
      <section className="panel">
        <h2>Members</h2>
        {loading ? (
          <p role="status">Loading members…</p>
        ) : (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.user.id}>
                <div>
                  <strong>{member.user.name}</strong>
                  <p className="small muted">{member.user.email}</p>
                </div>
                {owner && member.role !== 'OWNER' ? (
                  <div>
                    <select
                      aria-label={'Role for ' + member.user.email}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) =>
                        void changeMember(member, event.target.value)
                      }
                    >
                      <option value="ENGINEER">Engineer</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <button
                      disabled={busy}
                      onClick={() => void changeMember(member)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="tag">{member.role}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {owner && (
          <form onSubmit={(event) => void save(event, true)}>
            <h3>Add a registered teammate</h3>
            <p className="small muted">
              The teammate must create their own account first. No email
              invitation is sent.
            </p>
            <label>
              Member email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="VIEWER">
                <option value="VIEWER">Viewer — read only</option>
                <option value="ENGINEER">
                  Engineer — repository and analysis management
                </option>
              </select>
            </label>
            <button disabled={busy}>Add member</button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>Integrations</h2>
        <p className="muted">
          GitHub authorization is planned for a later phase. Integration
          management is reserved for workspace Owners.
        </p>
      </section>
    </>
  );
}

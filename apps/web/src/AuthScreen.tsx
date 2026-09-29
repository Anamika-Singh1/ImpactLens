import { useState, type FormEvent } from 'react';
import { useAuth } from './session';
export function AuthScreen() {
  const { authenticate } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await authenticate(mode, {
        email: String(data.get('email')),
        password: String(data.get('password')),
        ...(mode === 'register' ? { name: String(data.get('name')) } : {}),
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Authentication failed',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="panel auth-panel">
        <p className="brand">◈ ImpactLens</p>
        <p className="eyebrow">EVIDENCE-BACKED RELEASE REVIEW</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1>
        <p className="subtitle">
          {mode === 'login'
            ? 'Sign in to your team’s release review workspace.'
            : 'Create an account and a private workspace. You will be its Owner.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Your name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          {mode === 'register' && (
            <p className="small muted">
              Use 12–128 characters. Long passphrases are welcome.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login'
            ? 'Create an account'
            : 'Already have an account? Sign in'}
        </button>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import type { HealthResponse } from '@impactlens/shared';
import { fetchHealth } from './api';
const pages = [
  {
    path: '/repositories',
    title: 'Repositories',
    symbol: '⌘',
    empty: 'No repositories connected',
    detail:
      'Repository import will be available in a later phase. Only authorized repositories will be analyzed.',
  },
  {
    path: '/features',
    title: 'Features',
    symbol: '◇',
    empty: 'No business features mapped',
    detail:
      'Explicit feature mappings will connect source files to customer-facing behavior.',
  },
  {
    path: '/analyses',
    title: 'Analyses',
    symbol: '◎',
    empty: 'No analyses available',
    detail:
      'Commit and pull request comparisons will appear here when analysis is implemented.',
  },
  {
    path: '/test-evidence',
    title: 'Test Evidence',
    symbol: '☑',
    empty: 'No test evidence imported',
    detail:
      'No test results or coverage have been imported. This does not mean that no tests exist.',
  },
];
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: HealthResponse };
function Health() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let active = true;
    setState({ kind: 'loading' });
    fetchHealth(controller.signal)
      .then((data) => {
        if (active) setState({ kind: 'ready', data });
      })
      .catch(() => {
        if (active)
          setState({
            kind: 'error',
            message:
              'Unable to reach the API. Check that the API is running and the proxy is configured.',
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);
  return (
    <section className="panel" aria-labelledby="health-heading">
      <div className="panel-heading">
        <h2 id="health-heading">System connection</h2>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          disabled={state.kind === 'loading'}
        >
          Refresh
        </button>
      </div>
      {state.kind === 'loading' && (
        <p role="status" className="muted pulse">
          Checking API and dependencies…
        </p>
      )}
      {state.kind === 'error' && (
        <div role="alert" className="error">
          <strong>Connection unavailable</strong>
          <p>{state.message}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>
            Retry connection
          </button>
        </div>
      )}
      {state.kind === 'ready' && (
        <div role="status">
          <p className={state.data.status === 'ok' ? 'healthy' : 'warning'}>
            <span className="dot" />
            {state.data.status === 'ok'
              ? 'API ready'
              : 'API reachable · dependencies unavailable'}
          </p>
          <div className="dependencies">
            <span>
              PostgreSQL <b>{state.data.dependencies?.postgres ?? 'Unknown'}</b>
            </span>
            <span>
              Redis <b>{state.data.dependencies?.redis ?? 'Unknown'}</b>
            </span>
          </div>
          <p className="small muted">
            Last checked {new Date(state.data.timestamp).toLocaleTimeString()} ·
            Live API response
          </p>
        </div>
      )}
    </section>
  );
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty panel">
      <div className="empty-icon" aria-hidden="true">
        ◇
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
      <span className="tag">Planned capability</span>
    </div>
  );
}
function Overview() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / OVERVIEW</p>
          <h1>Release confidence starts with evidence.</h1>
          <p className="subtitle">
            Understand potential change impact, then focus your review.
          </p>
        </div>
        <span className="phase">Phase 1 · Foundation</span>
      </div>
      <Health />
      <div className="section-heading">
        <h2>Your release review workspace</h2>
        <span className="small muted">Ready for the next phase</span>
      </div>
      <div className="card-grid">
        {pages.map((page, index) => (
          <Link className="feature-card" to={page.path} key={page.path}>
            <div className="card-top">
              <span className="card-icon">{page.symbol}</span>
              <span className="small muted">0{index + 1}</span>
            </div>
            <h3>
              {page.title} <span aria-hidden="true">↗</span>
            </h3>
            <p>{page.detail}</p>
            <span className="small card-link">View workspace →</span>
          </Link>
        ))}
      </div>
      <div className="note">
        <strong>Evidence before conclusions.</strong>
        <p>
          Potential impact is not confirmed breakage. Future findings will cite
          evidence, and incomplete coverage will be reported with its
          limitations.
        </p>
      </div>
    </>
  );
}
export function App() {
  return (
    <div className="layout">
      <aside>
        <Link className="brand" to="/">
          <span className="logo">◈</span>ImpactLens
        </Link>
        <p className="workspace-label">ENGINEERING WORKSPACE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <span aria-hidden="true">▦</span>Overview
          </NavLink>
          {pages.map((page) => (
            <NavLink to={page.path} key={page.path}>
              <span aria-hidden="true">{page.symbol}</span>
              {page.title}
            </NavLink>
          ))}
          <NavLink to="/settings">
            <span aria-hidden="true">⚙</span>Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <span className="dot" /> Local development<p>Foundation workspace</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> ImpactLens
          </span>
          <span className="tag">LOCAL</span>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            {pages.map((page) => (
              <Route
                key={page.path}
                path={page.path}
                element={
                  <>
                    <p className="eyebrow">
                      WORKSPACE / {page.title.toUpperCase()}
                    </p>
                    <h1>{page.title}</h1>
                    <p className="subtitle">
                      Build a review grounded in repository evidence.
                    </p>
                    <Empty title={page.empty} detail={page.detail} />
                  </>
                }
              />
            ))}
            <Route
              path="/settings"
              element={
                <>
                  <p className="eyebrow">WORKSPACE / SETTINGS</p>
                  <h1>Settings</h1>
                  <p className="subtitle">Local workspace configuration.</p>
                  <section className="panel">
                    <h2>Connection</h2>
                    <p>
                      API path: <code>{import.meta.env.VITE_API_BASE_URL}</code>
                    </p>
                    <p className="muted">
                      Server configuration is managed through local environment
                      files. Provider integrations are not configured in this
                      phase.
                    </p>
                  </section>
                  <Health />
                </>
              }
            />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <Link to="/">Return to Overview</Link>
                </>
              }
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}

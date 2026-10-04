import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import type { HealthResponse } from '@impactlens/shared';
import { fetchHealth } from './api';
import { useAuth } from './session';
import { AuthScreen } from './AuthScreen';
import { WorkspaceSettings } from './WorkspaceSettings';
import { Repositories } from './Repositories';
import { RepositoryDetails } from './RepositoryDetails';
import { Comparisons, ComparisonDetail } from './Comparisons';
import { FeatureCatalog, FeatureDetailPage } from './Features';
import { TestEvidence } from './TestEvidence';
const pages = [
  {
    path: '/repositories',
    title: 'Repositories',
    symbol: '⌘',
    empty: 'No repositories connected',
    detail:
      'Explore imported source snapshots, static dependencies, and analysis limitations.',
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
      'Compare imported commit snapshots and review potential feature impact with source evidence.',
  },
  {
    path: '/test-evidence',
    title: 'Test Evidence',
    symbol: '☑',
    empty: 'No test evidence imported',
    detail:
      'Import CI test results and coverage, inspect provenance, and map individual tests to features.',
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
        <span className="phase">Team workspace</span>
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
  const { current, workspace, selectWorkspace, logout } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  if (!current) return <AuthScreen />;
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
          <p>{current.user.name}</p>
          <span className="tag">{workspace?.role}</span>
          <button
            onClick={() =>
              void logout().catch((error) => setLogoutError(error.message))
            }
          >
            Sign out
          </button>
          {logoutError && <p role="alert">{logoutError}</p>}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>
            <select
              aria-label="Active workspace"
              value={workspace?.id ?? ''}
              onChange={(event) => selectWorkspace(event.target.value)}
            >
              {current.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </span>
          <span className="tag">LOCAL</span>
        </header>
        <div className="content">
          <Routes key={workspace?.id}>
            <Route path="/" element={<Overview />} />
            <Route path="/repositories" element={<Repositories />} />
            <Route
              path="/repositories/:repositoryId"
              element={<RepositoryDetails key={workspace?.id} />}
            />
            <Route path="/features" element={<FeatureCatalog />} />
            <Route
              path="/features/:repositoryId/:featureId"
              element={<FeatureDetailPage />}
            />
            <Route path="/analyses" element={<Comparisons />} />
            <Route
              path="/analyses/:repositoryId/:analysisId"
              element={<ComparisonDetail />}
            />
            <Route path="/test-evidence" element={<TestEvidence />} />
            <Route path="/settings" element={<WorkspaceSettings />} />
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

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  dependents,
  dependencyKinds,
  type GraphNode,
  type GraphEdge,
  type SnapshotGraph,
} from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
type Snapshot = {
  id: string;
  commitSha: string;
  isDemo: boolean;
  _count: { files: number };
};
type File = { id: string; path: string; language: string };
type Result = { graph: SnapshotGraph | null; analyzedAt: string | null };
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed. Try again.';

function FileTree({
  files,
  selected,
  select,
  prefix = '',
}: {
  files: File[];
  selected: string;
  select: (path: string) => void;
  prefix?: string;
}) {
  const directories = [
    ...new Set(
      files
        .map((f) => f.path.slice(prefix.length).split('/'))
        .filter((p) => p.length > 1)
        .map((p) => p[0]!),
    ),
  ].sort();
  return (
    <ul className="explorer-tree">
      {directories.map((directory) => (
        <li key={directory}>
          <details open>
            <summary>{directory}/</summary>
            <FileTree
              files={files.filter((f) =>
                f.path.startsWith(prefix + directory + '/'),
              )}
              prefix={prefix + directory + '/'}
              selected={selected}
              select={select}
            />
          </details>
        </li>
      ))}
      {files
        .filter((f) => !f.path.slice(prefix.length).includes('/'))
        .map((file) => (
          <li key={file.id}>
            <button
              className={selected === file.path ? 'selected' : ''}
              aria-pressed={selected === file.path}
              onClick={() => select(file.path)}
            >
              {file.path.slice(prefix.length)}
            </button>
          </li>
        ))}
    </ul>
  );
}
function GraphView({
  nodes,
  edges,
  selected,
  select,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string;
  select: (id: string) => void;
}) {
  // Bounded drawing; search/list and dependency details retain access to every node.
  const visible = nodes.slice(0, 60);
  const width = 900,
    height = Math.max(240, Math.ceil(visible.length / 3) * 86);
  const positions = new Map(
    visible.map((node, index) => [
      node.id,
      { x: 20 + (index % 3) * 300, y: 25 + Math.floor(index / 3) * 86 },
    ]),
  );
  return (
    <>
      <p className="small muted">
        Arrows point from dependent to dependency. Showing {visible.length} of{' '}
        {nodes.length} matching nodes; narrow the filters for large graphs.
      </p>
      <div className="graph-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Dependency graph; select a node to inspect its relationships"
        >
          <defs>
            <marker
              id="dependency-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8" fill="#708e85" />
            </marker>
          </defs>
          {edges
            .filter((e) => e.to && positions.has(e.from) && positions.has(e.to))
            .slice(0, 240)
            .map((edge) => {
              const from = positions.get(edge.from)!,
                to = positions.get(edge.to!)!;
              return (
                <path
                  key={edge.id}
                  d={`M${from.x + 126},${from.y + 42} Q${(from.x + to.x) / 2 + 145},${(from.y + to.y) / 2 + 66} ${to.x + 126},${to.y}`}
                  fill="none"
                  stroke={
                    edge.from === selected || edge.to === selected
                      ? '#216a51'
                      : '#b6cbc1'
                  }
                  strokeWidth="1.5"
                  markerEnd="url(#dependency-arrow)"
                >
                  <title>
                    {edge.kind}: {edge.specifier}
                  </title>
                </path>
              );
            })}
          {visible.map((node) => {
            const position = positions.get(node.id)!;
            return (
              <g
                key={node.id}
                transform={`translate(${position.x},${position.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${node.kind} ${node.name}`}
                onClick={() => select(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(node.id);
                  }
                }}
              >
                <rect
                  width="252"
                  height="42"
                  rx="6"
                  fill={node.id === selected ? '#d0eddf' : '#fff'}
                  stroke={node.id === selected ? '#216a51' : '#b6cbc1'}
                  strokeWidth="2"
                />
                <text x="10" y="15" fontSize="9" fill="#62766d">
                  {node.kind}
                </text>
                <text x="10" y="31" fontSize="12" fill="#193b36">
                  {node.name.length > 32
                    ? '…' + node.name.slice(-31)
                    : node.name}
                </text>
                <title>
                  {node.filePath}:{node.evidence.startLine}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
      {edges.length > 240 && (
        <p className="small muted">
          The drawing is limited to 240 edges. Full relationships are listed
          below.
        </p>
      )}
    </>
  );
}
export function RepositoryExplorer() {
  const { repositoryId } = useParams();
  const [query] = useSearchParams();
  const requestedSnapshot = query.get('snapshotId');
  const requestedNode = query.get('nodeId');
  const requestedPath = query.get('filePath');
  const { workspace } = useAuth();
  const root = `/workspaces/${workspace?.id}/repositories/${repositoryId}/snapshots`;
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotId, setSnapshotId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<Result>({
    graph: null,
    analyzedAt: null,
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState(''),
    [filePath, setFilePath] = useState('');
  const [source, setSource] = useState<string | null>(null),
    [sourceError, setSourceError] = useState(''),
    [sourceLoading, setSourceLoading] = useState(false);
  const [search, setSearch] = useState(''),
    [kind, setKind] = useState('FILE'),
    [relationship, setRelationship] = useState('ALL'),
    [exported, setExported] = useState(false);
  const [revision, setRevision] = useState(0);
  const [fileSearch, setFileSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSnapshots([]);
    setSnapshotId('');
    setFiles([]);
    setResult({ graph: null, analyzedAt: null });
    apiRequest<Snapshot[]>(root, { signal: controller.signal })
      .then((data) => {
        setSnapshots(data);
        setSnapshotId(
          data.some((s) => s.id === requestedSnapshot)
            ? requestedSnapshot!
            : (data[0]?.id ?? ''),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, revision, requestedSnapshot]);
  useEffect(() => {
    setFiles([]);
    setResult({ graph: null, analyzedAt: null });
    setSelected('');
    setFilePath('');
    setSource(null);
    if (!snapshotId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      apiRequest<File[]>(`${root}/${snapshotId}/files`, {
        signal: controller.signal,
      }),
      apiRequest<Result>(`${root}/${snapshotId}/graph`, {
        signal: controller.signal,
      }),
    ])
      .then(([data, graph]) => {
        setFiles(data);
        setResult(graph);
        const requested = graph.graph?.nodes.find(
          (n) => n.id === requestedNode,
        );
        const targetPath = requested?.filePath ?? requestedPath;
        const file = targetPath
          ? data.find((f) => f.path === targetPath)
          : data[0];
        setFilePath(file?.path ?? targetPath ?? '');
        setSelected(requested?.id ?? (file ? 'file:' + file.path : ''));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [root, snapshotId, requestedNode, requestedPath]);
  useEffect(() => {
    const file = files.find((f) => f.path === filePath);
    setSource(null);
    setSourceError('');
    if (!file) {
      setSourceLoading(false);
      return;
    }
    const controller = new AbortController();
    setSourceLoading(true);
    apiRequest<{ contentText: string | null }>(
      `${root}/${snapshotId}/files/${file.id}`,
      { signal: controller.signal },
    )
      .then((data) => setSource(data.contentText))
      .catch((e) => {
        if (!controller.signal.aborted) setSourceError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSourceLoading(false);
      });
    return () => controller.abort();
  }, [root, snapshotId, files, filePath]);
  const graph = result.graph;
  const nodeMap = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []),
    [graph],
  );
  const node = nodeMap.get(selected);
  const visible = useMemo(
    () =>
      graph?.nodes.filter(
        (n) =>
          (kind === 'ALL' || n.kind === kind) &&
          (!exported || n.exported) &&
          `${n.name} ${n.filePath}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) ?? [],
    [graph, kind, exported, search],
  );
  const edges =
    graph?.edges.filter((e) =>
      relationship === 'ALL'
        ? dependencyKinds.includes(e.kind)
        : e.kind === relationship,
    ) ?? [];
  const reverse = useMemo(
    () => (graph ? dependents(graph, selected) : []),
    [graph, selected],
  );
  function select(id: string) {
    setSelected(id);
    const found = nodeMap.get(id);
    if (found) setFilePath(found.filePath);
  }
  async function analyze() {
    setBusy(true);
    setError('');
    try {
      setResult(
        await apiRequest<Result>(`${root}/${snapshotId}/graph`, {
          method: 'POST',
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function details(items: GraphEdge[], incoming: boolean) {
    return items.length ? (
      <ul className="edge-details">
        {items.map((edge) => (
          <li key={edge.id}>
            <strong>{edge.kind}</strong> ·{' '}
            {edge.resolution === 'FILE'
              ? 'File-level'
              : edge.resolution === 'UNKNOWN'
                ? 'Unknown dependency'
                : 'Symbol-level'}
            <br />
            {edge.to ? (
              <button onClick={() => select(incoming ? edge.from : edge.to!)}>
                {nodeMap.get(incoming ? edge.from : edge.to)?.name ??
                  edge.specifier}
              </button>
            ) : (
              <span>{edge.specifier}</span>
            )}
            <p className="small muted">
              {edge.evidence.filePath}:{edge.evidence.startLine}–
              {edge.evidence.endLine} · {edge.evidence.commitSha.slice(0, 12)}
            </p>
            {edge.limitation && <p className="small">{edge.limitation}</p>}
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">No matching relationships.</p>
    );
  }
  return (
    <>
      <Link to="/repositories">← Repositories</Link>
      <p className="eyebrow">REPOSITORY / SOURCE EXPLORER</p>
      <h1>Repository explorer</h1>
      <p className="subtitle">
        Inspect static dependencies and their source evidence. A dependency
        indicates potential impact, not confirmed breakage.
      </p>
      {error && (
        <div role="alert" className="error">
          {error}{' '}
          <button onClick={() => setRevision((n) => n + 1)}>
            Reload explorer
          </button>
        </div>
      )}
      <section className="panel explorer-toolbar">
        <label>
          Snapshot{' '}
          <select
            aria-label="Snapshot"
            disabled={busy}
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.commitSha.slice(0, 12)} · {s._count.files} files
                {s.isDemo ? ' · Demo' : ''}
              </option>
            ))}
          </select>
        </label>
        {workspace?.role !== 'VIEWER' && (
          <button
            disabled={!snapshotId || busy || loading}
            onClick={() => void analyze()}
          >
            {busy
              ? 'Analyzing…'
              : graph
                ? 'Re-analyze snapshot'
                : 'Analyze snapshot'}
          </button>
        )}
        {result.analyzedAt && (
          <span className="small muted">
            Analyzed {new Date(result.analyzedAt).toLocaleString()} · v
            {graph?.version}
          </span>
        )}
      </section>
      {loading && <p role="status">Loading snapshot…</p>}
      {busy && (
        <p role="status">
          Extracting static relationships. This can take up to 45 seconds.
        </p>
      )}
      {!loading && !snapshots.length && (
        <div className="panel">
          <h2>No snapshots imported</h2>
          <p>
            Import a repository snapshot before exploring its source and
            dependencies.
          </p>
        </div>
      )}
      {!!snapshotId && !loading && (
        <>
          <div className="explorer-source-grid">
            <section className="panel explorer-files">
              <h2>Files ({files.length})</h2>
              <label>
                Search files
                <input
                  aria-label="Search files"
                  value={fileSearch}
                  onChange={(event) => setFileSearch(event.target.value)}
                  placeholder="Filename or path"
                />
              </label>
              <FileTree
                files={files.filter((file) =>
                  file.path.toLowerCase().includes(fileSearch.toLowerCase()),
                )}
                selected={filePath}
                select={(path) => {
                  setFilePath(path);
                  setSelected('file:' + path);
                }}
              />
            </section>
            <section className="panel explorer-preview">
              <h2>Source preview</h2>
              <p className="small">
                {filePath} ·{' '}
                {snapshots.find((s) => s.id === snapshotId)?.commitSha}
              </p>
              {sourceError ? (
                <p role="alert" className="error">
                  {sourceError}
                </p>
              ) : sourceLoading ? (
                <p role="status">Loading source…</p>
              ) : source === null ? (
                <p className="muted">Source text is unavailable.</p>
              ) : (
                <pre aria-label="Source preview">
                  {source.split('\n').map((line, index) => (
                    <span
                      key={index}
                      className={
                        node &&
                        node.kind !== 'FILE' &&
                        index + 1 >= node.evidence.startLine &&
                        index + 1 <= node.evidence.endLine
                          ? 'source-line highlighted'
                          : 'source-line'
                      }
                    >
                      <span className="line-number">{index + 1}</span>
                      {line || ' '}
                    </span>
                  ))}
                </pre>
              )}
            </section>
          </div>
          {!graph ? (
            <section className="panel">
              <h2>Snapshot has not been analyzed</h2>
              <p>
                {workspace?.role === 'VIEWER'
                  ? 'Ask an Owner or Engineer to analyze this snapshot.'
                  : 'Select Analyze snapshot to build its dependency graph.'}
              </p>
            </section>
          ) : (
            <>
              <section className="panel">
                <h2>Dependency graph</h2>
                <div className="explorer-toolbar">
                  <label>
                    Search nodes{' '}
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="File path or symbol name"
                    />
                  </label>
                  <label>
                    Node type{' '}
                    <select
                      aria-label="Node type"
                      value={kind}
                      onChange={(event) => setKind(event.target.value)}
                    >
                      {[
                        'ALL',
                        'FILE',
                        'FUNCTION',
                        'CLASS',
                        'SYMBOL',
                        'COMPONENT',
                        'ROUTE',
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Relationship{' '}
                    <select
                      aria-label="Relationship"
                      value={relationship}
                      onChange={(event) => setRelationship(event.target.value)}
                    >
                      {['ALL', ...dependencyKinds, 'CONTAINS', 'EXPORTS'].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={exported}
                      onChange={(event) => setExported(event.target.checked)}
                    />{' '}
                    Exported only
                  </label>
                </div>
                <GraphView
                  nodes={visible}
                  edges={edges}
                  selected={selected}
                  select={select}
                />
                <label>
                  All matching nodes{' '}
                  <select
                    aria-label="Matching nodes"
                    value={
                      visible.some((n) => n.id === selected) ? selected : ''
                    }
                    onChange={(event) => select(event.target.value)}
                  >
                    <option value="">
                      Select a node ({visible.length} matches)
                    </option>
                    {visible.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} · {n.kind} · {n.filePath}:
                        {n.evidence.startLine}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="panel">
                <h2>{node ? node.name : 'Select a node'}</h2>
                {node && (
                  <>
                    <p className="small">
                      {node.kind} · {node.evidence.filePath}:
                      {node.evidence.startLine}–{node.evidence.endLine} ·{' '}
                      {node.evidence.commitSha}
                    </p>
                    <div className="explorer-details-grid">
                      <div>
                        <h3>Incoming dependents</h3>
                        {details(
                          edges.filter((e) => e.to === selected),
                          true,
                        )}
                      </div>
                      <div>
                        <h3>Outgoing dependencies</h3>
                        {details(
                          edges.filter((e) => e.from === selected),
                          false,
                        )}
                      </div>
                    </div>
                    <details>
                      <summary>
                        Transitive dependents ({reverse.length}) — all
                        dependency types
                      </summary>
                      {reverse.length ? (
                        <ul>
                          {reverse.map((id) => (
                            <li key={id}>
                              <button onClick={() => select(id)}>
                                {nodeMap.get(id)?.name ?? id}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No transitive dependents found.</p>
                      )}
                    </details>
                  </>
                )}
              </section>
              <section className="panel">
                <h2>Analysis limitations ({graph.limitations.length})</h2>
                <p className="small muted">
                  External packages and runtime behavior are not analyzed.
                  Import exclusions also limit this graph. Express routes use
                  direct, bound app/router calls with literal paths; mounted
                  prefixes are not composed. Components are identified
                  heuristically from JSX.
                </p>
                <div className="limitations-list">
                  {graph.limitations.map((limitation, index) => (
                    <details key={index}>
                      <summary>
                        {limitation.code} · {limitation.evidence.filePath}:
                        {limitation.evidence.startLine}
                      </summary>
                      <p>{limitation.message}</p>
                      <p className="small">
                        Commit {limitation.evidence.commitSha} · lines{' '}
                        {limitation.evidence.startLine}–
                        {limitation.evidence.endLine}
                      </p>
                      <button
                        onClick={() => {
                          setFilePath(limitation.evidence.filePath);
                          setSelected('file:' + limitation.evidence.filePath);
                        }}
                      >
                        View file
                      </button>
                    </details>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

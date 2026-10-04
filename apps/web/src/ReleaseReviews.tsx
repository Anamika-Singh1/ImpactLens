import { useEffect, useState, type FormEvent } from 'react';
import {
  reviewLabels,
  reviewNeedsNote,
  reviewOutcomes,
  type ReleaseReport,
  type ReviewOutcome,
  type ReviewState,
} from '@impactlens/shared';
import { apiRequest, useAuth } from './session';

export function ReleaseReviewPanel({
  repositoryId,
  analysisId,
}: {
  repositoryId: string;
  analysisId: string;
}) {
  const { workspace } = useAuth();
  const root = `/workspaces/${workspace?.id}/repositories/${repositoryId}/comparisons/${analysisId}`;
  const [state, setState] = useState<ReviewState | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome>('NEEDS_MORE_EVIDENCE'),
    [comment, setComment] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError('');
    apiRequest<ReviewState>(`${root}/reviews?page=${page}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setState(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [root, page]);
  const needsNote = state
    ? reviewNeedsNote(outcome, state.readiness, state.latest?.outcome)
    : true;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`${root}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          comment,
          expectedRevision: state.latest?.revision ?? 0,
          baseSha: state.baseSha,
          headSha: state.headSha,
          resultHash: state.resultHash,
        }),
      });
      setComment('');
      if (page !== 1) setPage(1);
      else setState(await apiRequest<ReviewState>(`${root}/reviews`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to record review.');
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError('');
    try {
      setState(await apiRequest<ReviewState>(`${root}/reviews?page=${page}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reload review.');
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError('');
    try {
      const report = await apiRequest<ReleaseReport>(`${root}/report`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: 'application/json',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `impactlens-review-${analysisId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to export report.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel release-review"
      aria-labelledby="release-review-title"
    >
      <h2 id="release-review-title">Release decision</h2>
      <p>
        Approval records a human judgment of this saved evidence. It does not
        prove release safety or runtime correctness.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!state ? (
        <>
          <p role="status">Loading release review…</p>
          {error && (
            <button type="button" onClick={reload} disabled={busy}>
              Reload review
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            <strong>Latest decision:</strong>{' '}
            {state.latest
              ? `${reviewLabels[state.latest.outcome] ?? state.latest.outcome} · revision ${state.latest.revision}`
              : 'No decision recorded'}
          </p>
          <p>
            Evidence:{' '}
            {state.readiness.state === 'PARTIAL' ? 'Partial' : 'Recorded'} ·{' '}
            {state.readiness.concerns.length} review concerns
          </p>
          {state.readiness.concerns.length > 0 && (
            <details>
              <summary>Evidence requiring consideration</summary>
              <ul>
                {state.readiness.concerns.map((c, i) => (
                  <li key={i}>
                    <strong>{c.code}</strong>: {c.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {workspace?.role !== 'VIEWER' ? (
            <form onSubmit={submit}>
              <label>
                Review outcome
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as ReviewOutcome)}
                  disabled={busy}
                >
                  {reviewOutcomes.map((o) => (
                    <option key={o} value={o}>
                      {reviewLabels[o]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review rationale{needsNote ? ' (required)' : ' (optional)'}
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={4000}
                  required={needsNote}
                  disabled={busy}
                  rows={3}
                />
              </label>
              <p className="small">
                Changing a previous decision appends an override and requires a
                rationale. Existing reviews and analysis findings remain in
                history.
              </p>
              <button disabled={busy || (needsNote && !comment.trim())}>
                Record review
              </button>
            </form>
          ) : (
            <p>
              Owners and Engineers can record decisions. You can read history
              and export the report.
            </p>
          )}
          <div className="actions">
            <button type="button" onClick={reload} disabled={busy}>
              Reload review
            </button>
            <button type="button" onClick={download} disabled={busy}>
              Download review report (JSON)
            </button>
          </div>
          <h3>Review history ({state.total})</h3>
          {!state.items.length && <p>No reviews on this page.</p>}
          <ol>
            {state.items.map((r) => (
              <li key={r.id}>
                <p>
                  <strong>
                    Revision {r.revision}:{' '}
                    {reviewLabels[r.outcome] ?? r.outcome}
                  </strong>
                  {r.isOverride ? ' · Override' : ''} ·{' '}
                  {r.reviewerLabel ?? 'Historical reviewer'} ·{' '}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
                {r.comment && <p className="review-rationale">{r.comment}</p>}
                <p className="small">
                  {r.recordVersion === 0
                    ? 'Legacy record; original evidence concerns were not captured.'
                    : `${r.concerns?.length ?? 0} concerns captured at decision time.`}
                </p>
                <details>
                  <summary>Decision provenance</summary>
                  <p>
                    Base: <code>{r.baseSha ?? 'Unavailable'}</code>
                  </p>
                  <p>
                    Head: <code>{r.headSha ?? 'Unavailable'}</code>
                  </p>
                  <p>
                    Result: <code>{r.analysisResultHash ?? 'Unavailable'}</code>
                  </p>
                  {r.concerns && (
                    <ul>
                      {r.concerns.map((c, i) => (
                        <li key={i}>
                          {c.code}: {c.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button
              type="button"
              disabled={busy || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous reviews
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              disabled={busy || page * state.pageSize >= state.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next reviews
            </button>
          </div>
        </>
      )}
    </section>
  );
}

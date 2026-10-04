import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AiSettings, AnalysisExplanation } from '@impactlens/shared';
import { apiRequest, useAuth } from './session';
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to load explanations.';
export function AiWorkspaceSettings() {
  const { workspace } = useAuth();
  const [settings, setSettings] = useState<AiSettings | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const root = `/workspaces/${workspace?.id}/ai-settings`;
  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setError('');
    apiRequest<AiSettings>(root, { signal: controller.signal })
      .then((s) => {
        if (!controller.signal.aborted) setSettings(s);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => controller.abort();
  }, [root]);
  async function consent(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      setSettings(
        await apiRequest<AiSettings>(root, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Optional AI explanations</h2>
      <p>
        Explanations use local templates by default. Enabling AI permits Owners
        and Engineers to request explanations from OpenAI using redacted,
        repository-derived facts: counts, change types, impact relationships,
        criticality and coverage-gap categories.
      </p>
      <p>
        Source code, comments, file and feature names, test identities and
        reviewer identities stay on this server. Provider data policies still
        apply. Disabling AI clears cached explanations and stops new requests;
        it cannot recall data already sent.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {settings && (
        <>
          <p>
            Workspace AI:{' '}
            <strong>{settings.enabled ? 'Enabled' : 'Disabled'}</strong>.
            Provider: OpenAI.{' '}
            {settings.configured
              ? `Configured model: ${settings.model}.`
              : 'No provider is configured; local explanations remain available.'}
          </p>
          <p className="small">
            Today (UTC): {settings.requestsUsed}/{settings.dailyRequestLimit}{' '}
            provider requests; {settings.tokensReserved}/
            {settings.dailyTokenLimit} reserved tokens. Failed requests count
            toward these limits.
          </p>
          {workspace?.role === 'OWNER' ? (
            <button
              disabled={busy}
              onClick={() => void consent(!settings.enabled)}
            >
              {settings.enabled
                ? 'Disable AI explanations'
                : 'Enable AI and allow redacted evidence sharing'}
            </button>
          ) : (
            <p>Only a workspace Owner can enable external AI sharing.</p>
          )}
        </>
      )}
    </section>
  );
}
const reasons: Record<NonNullable<AnalysisExplanation['reason']>, string> = {
  DISABLED: 'AI sharing is disabled for this workspace.',
  UNCONFIGURED: 'No AI provider is configured.',
  NOT_REQUESTED: 'An AI explanation has not been requested.',
  UNAVAILABLE:
    'The AI provider is unavailable. The saved analysis is unaffected.',
  LIMIT: 'An AI usage or input limit was reached.',
  INVALID_RESPONSE:
    'The provider response was rejected because it did not match supported evidence and claims.',
  CONSENT_CHANGED: 'AI sharing settings changed while the request was running.',
};
export function ExplanationPanel({
  repositoryId,
  analysisId,
}: {
  repositoryId: string;
  analysisId: string;
}) {
  const { workspace } = useAuth();
  const [explanation, setExplanation] = useState<AnalysisExplanation | null>(
      null,
    ),
    [settings, setSettings] = useState<AiSettings | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const root = `/workspaces/${workspace?.id}`;
  const url = `${root}/repositories/${repositoryId}/comparisons/${analysisId}/explanation`;
  useEffect(() => {
    const controller = new AbortController();
    setExplanation(null);
    setSettings(null);
    setError('');
    Promise.all([
      apiRequest<AnalysisExplanation>(url, { signal: controller.signal }),
      apiRequest<AiSettings>(root + '/ai-settings', {
        signal: controller.signal,
      }),
    ])
      .then(([e, s]) => {
        if (!controller.signal.aborted) {
          setExplanation(e);
          setSettings(s);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => controller.abort();
  }, [url, root]);
  async function generate() {
    setBusy(true);
    setError('');
    try {
      setExplanation(
        await apiRequest<AnalysisExplanation>(url, {
          method: 'POST',
          body: '{}',
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel explanation-panel">
      <h2>Plain-language explanation</h2>
      <p className="note">
        Recorded findings below are authoritative. Explanations are read-only
        review aids and cannot change a decision or run a test.
      </p>
      {error && (
        <p role="alert">{error} Recorded findings remain available below.</p>
      )}
      {explanation && (
        <>
          <p>
            <strong>
              {explanation.mode === 'AI'
                ? 'AI-assisted explanation — validated statement types'
                : 'Deterministic template explanation'}
            </strong>
            {explanation.cached ? ' (cached)' : ''}
            {explanation.model ? ` · ${explanation.model}` : ''}
          </p>
          {explanation.reason && (
            <p role="status">{reasons[explanation.reason]}</p>
          )}
          {(['summary', 'consequences', 'scenarios'] as const).map(
            (section) => (
              <div key={section}>
                <h3>
                  {
                    {
                      summary: 'Summary of recorded findings',
                      consequences: 'Conditional business consequences',
                      scenarios: 'Suggested test scenarios — not executed',
                    }[section]
                  }
                </h3>
                {!explanation[section].length ? (
                  <p>
                    No additional{' '}
                    {section === 'scenarios' ? 'scenarios' : 'statements'}{' '}
                    proposed from the supplied evidence.
                  </p>
                ) : (
                  <ul>
                    {explanation[section].map((item, i) => (
                      <li key={i}>
                        <p>{item.text}</p>
                        <p className="small">
                          Evidence:{' '}
                          {item.evidenceIds.map((id) => (
                            <a key={id} href={`#explanation-${id}`}>
                              {id}{' '}
                            </a>
                          ))}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
          <details>
            <summary>Explanation evidence references</summary>
            <ul>
              {explanation.evidence.map((e) => (
                <li key={e.id} id={`explanation-${e.id}`}>
                  <strong>{e.id}</strong>: {e.label} · saved result{' '}
                  <code>{e.pointer || '/'}</code>
                  {e.recordedIds.length > 0 && (
                    <p>
                      Recorded feature/mapping IDs: {e.recordedIds.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </details>
          {explanation.limitations.map((l) => (
            <p className="small" key={l}>
              {l}
            </p>
          ))}
        </>
      )}
      {settings?.enabled &&
        settings.configured &&
        workspace?.role !== 'VIEWER' && (
          <button disabled={busy} onClick={() => void generate()}>
            {busy ? 'Preparing explanation…' : 'Generate AI explanation'}
          </button>
        )}
      <p className="small">
        AI sharing is controlled in{' '}
        <Link to="/settings">workspace Settings</Link>.
      </p>
    </section>
  );
}

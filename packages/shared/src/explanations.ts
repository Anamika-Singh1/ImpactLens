export interface ExplanationEvidence {
  id: string;
  pointer: string;
  label: string;
  recordedIds: string[];
}
export interface ExplanationSection {
  text: string;
  evidenceIds: string[];
}
export interface AnalysisExplanation {
  mode: 'TEMPLATE' | 'AI';
  reason:
    | 'DISABLED'
    | 'UNCONFIGURED'
    | 'NOT_REQUESTED'
    | 'UNAVAILABLE'
    | 'LIMIT'
    | 'INVALID_RESPONSE'
    | 'CONSENT_CHANGED'
    | null;
  promptVersion: string;
  model: string | null;
  cached: boolean;
  summary: ExplanationSection[];
  consequences: ExplanationSection[];
  scenarios: ExplanationSection[];
  evidence: ExplanationEvidence[];
  limitations: string[];
}
export interface AiSettings {
  enabled: boolean;
  provider: 'openai';
  configured: boolean;
  model: string | null;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  requestsUsed: number;
  tokensReserved: number;
}

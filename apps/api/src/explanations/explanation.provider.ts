import { INSTRUCTIONS, PLAN_SCHEMA, type Fact } from './explanation.logic';

export const EXPLANATION_PROVIDER = Symbol('EXPLANATION_PROVIDER');
export interface ProviderRequest {
  model: string;
  facts: Fact[];
  maxOutputTokens: number;
  signal: AbortSignal;
}
export interface ExplanationProvider {
  generate(request: ProviderRequest): Promise<unknown>;
}
export function providerBody(request: Omit<ProviderRequest, 'signal'>) {
  return {
    model: request.model,
    store: false,
    instructions: INSTRUCTIONS,
    input: JSON.stringify({ untrustedEvidence: request.facts }),
    max_output_tokens: request.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: 'impact_explanation',
        strict: true,
        schema: PLAN_SCHEMA,
      },
    },
    tools: [],
  };
}
export class OpenAiExplanationProvider implements ExplanationProvider {
  constructor(private readonly key: string) {}
  async generate(request: ProviderRequest): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(providerBody(request)),
      signal: request.signal,
    });
    if (!response.ok || !response.body) throw new Error('Provider unavailable');
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) throw new Error('Provider response too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body.status !== 'completed' || !Array.isArray(body.output))
      throw new Error('Incomplete provider response');
    const messages = body.output.filter(
      (m: { type?: string }) => m.type === 'message',
    );
    if (
      messages.length !== 1 ||
      messages[0].role !== 'assistant' ||
      !Array.isArray(messages[0].content) ||
      messages[0].content.length !== 1 ||
      messages[0].content[0].type !== 'output_text'
    )
      throw new Error('Unsupported provider response');
    return JSON.parse(messages[0].content[0].text);
  }
}

import { healthSchema, type HealthResponse } from '@impactlens/shared';
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(
    import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') + '/health/ready',
    { signal },
  );
  if (!response.ok && response.status !== 503)
    throw new Error('API request failed (' + response.status + ').');
  const result = healthSchema.safeParse(await response.json());
  if (!result.success)
    throw new Error('The API returned an unexpected health response.');
  return result.data;
}

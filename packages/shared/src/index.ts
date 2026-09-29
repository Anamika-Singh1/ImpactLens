import { z } from 'zod';
export const healthSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  service: z.literal('impactlens-api'),
  timestamp: z.string().datetime(),
  dependencies: z
    .object({ postgres: z.enum(['up', 'down']), redis: z.enum(['up', 'down']) })
    .optional(),
});
export type HealthResponse = z.infer<typeof healthSchema>;
export interface ApiError {
  error: {
    code: string;
    message: string | string[];
    requestId: string;
    timestamp: string;
  };
}
export const ANALYSIS_QUEUE = 'impactlens-analysis';

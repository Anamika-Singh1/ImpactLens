import { z } from 'zod';
export * from './graph';
export * from './features';
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

export type WorkspaceRole = 'OWNER' | 'ENGINEER' | 'VIEWER';
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}
export interface CurrentUserResponse {
  user: { id: string; email: string; name: string };
  workspaces: WorkspaceSummary[];
  csrfToken: string;
  expiresAt: string;
}
export * from './impact';
export * from './test-evidence';
export * from './explanations';
export * from './reviews';
export * from './repository';

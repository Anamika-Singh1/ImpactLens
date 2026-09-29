import { z } from 'zod';
const redisUrl = z
  .string()
  .url()
  .refine((v) => /^rediss?:\/\//.test(v), 'must use redis:// or rediss://');
const common = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  REDIS_URL: redisUrl,
};
export const apiEnvSchema = z
  .object({
    ...common,
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    AUTH_RATE_LIMIT_PREFIX: z
      .string()
      .min(1)
      .max(100)
      .default('impactlens:auth'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must use postgresql://'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    WEB_ORIGIN: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v), 'must use http:// or https://'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://'))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEB_ORIGIN'],
        message: 'must use HTTPS in production',
      });
    try {
      if (new URL(env.WEB_ORIGIN).origin !== env.WEB_ORIGIN)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEB_ORIGIN'],
          message: 'must be an origin without a path or trailing slash',
        });
    } catch {
      /* URL validator reports malformed values. */
    }
  });
export const workerEnvSchema = z.object(common);
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
): z.infer<T> {
  const result = schema.safeParse(values);
  if (!result.success) {
    throw new Error(
      'Invalid environment configuration: ' +
        result.error.issues
          .map((i) => i.path.join('.') + ': ' + i.message)
          .join('; '),
    );
  }
  return result.data;
}

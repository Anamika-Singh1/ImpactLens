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
const databaseUrl = z
  .string()
  .url()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must use postgresql://');
const github = {
  GITHUB_ENABLED: z.enum(['true', 'false']).default('false'),
  GITHUB_APP_ID: z.string().default(''),
  GITHUB_APP_SLUG: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GITHUB_PRIVATE_KEY_BASE64: z.string().default(''),
  GITHUB_CALLBACK_URL: z.string().default(''),
  CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
};
function validateGitHub(
  env: z.infer<z.ZodObject<typeof github>> & { NODE_ENV: string },
  context: z.RefinementCtx,
  api: boolean,
) {
  if (env.GITHUB_ENABLED !== 'true') return;
  const required = [
    'GITHUB_APP_ID',
    'GITHUB_PRIVATE_KEY_BASE64',
    'CREDENTIAL_ENCRYPTION_KEY',
    ...(api
      ? [
          'GITHUB_APP_SLUG',
          'GITHUB_CLIENT_ID',
          'GITHUB_CLIENT_SECRET',
          'GITHUB_CALLBACK_URL',
        ]
      : []),
  ] as (keyof typeof github)[];
  for (const key of required)
    if (!env[key] || /^(replace|your)[_-]/i.test(env[key]))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'required when GitHub is enabled; configure on the server',
      });
  if (!/^\d+$/.test(env.GITHUB_APP_ID))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GITHUB_APP_ID'],
      message: 'must be a numeric App ID',
    });
  if (!/^[A-Za-z0-9+/]{43}=$/.test(env.CREDENTIAL_ENCRYPTION_KEY))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CREDENTIAL_ENCRYPTION_KEY'],
      message: 'must be a random 32-byte base64 key',
    });
  if (api) {
    if (!/^[a-z0-9-]+$/.test(env.GITHUB_APP_SLUG))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_APP_SLUG'],
        message: 'must be the GitHub App slug',
      });
    try {
      const url = new URL(env.GITHUB_CALLBACK_URL);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/api/github/callback' ||
        !['http:', 'https:'].includes(url.protocol) ||
        (env.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        throw new Error();
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_CALLBACK_URL'],
        message:
          'must be the API callback URL ending /api/github/callback (HTTPS in production)',
      });
    }
  }
}
export const apiEnvSchema = z
  .object({
    ...common,
    ...github,
    AI_PROVIDER: z.enum(['disabled', 'openai']).default('disabled'),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z
      .string()
      .max(120)
      .regex(/^[a-zA-Z0-9._:-]*$/)
      .default(''),
    AI_MAX_INPUT_TOKENS: z.coerce
      .number()
      .int()
      .min(2048)
      .max(32000)
      .default(12000),
    AI_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .min(256)
      .max(4000)
      .default(1500),
    AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(15000),
    AI_DAILY_REQUEST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(20),
    AI_DAILY_TOKEN_LIMIT: z.coerce
      .number()
      .int()
      .min(1000)
      .max(10000000)
      .default(100000),
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
    HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    // Explicit addresses/subnets only; never trust every client or a hop count.
    TRUSTED_PROXIES: z
      .string()
      .default('')
      .superRefine((value, context) => {
        for (const entry of value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)) {
          if (
            !/^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/.test(
              entry,
            ) ||
            entry
              .split('/')[0]!
              .split('.')
              .some((part) => Number(part) > 255) ||
            entry === '0.0.0.0/0'
          )
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                'must contain explicit IPv4 proxy addresses/CIDRs, excluding 0.0.0.0/0',
            });
        }
      }),
    WEB_ORIGIN: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v), 'must use http:// or https://'),
  })
  .superRefine((env, context) => {
    validateGitHub(env, context, true);
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
export const workerEnvSchema = z
  .object({
    ...common,
    ...github,
    DATABASE_URL: databaseUrl,
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  })
  .superRefine((env, context) => validateGitHub(env, context, false));
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

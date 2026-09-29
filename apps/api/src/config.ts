import 'dotenv/config';
import { apiEnvSchema, parseEnv } from '@impactlens/shared/dist/env';
export const readConfig = () => parseEnv(apiEnvSchema, process.env);

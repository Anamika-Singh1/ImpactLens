import 'dotenv/config';
import { Worker, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { ANALYSIS_QUEUE } from '@impactlens/shared';
import { parseEnv, workerEnvSchema } from '@impactlens/shared/dist/env';
async function main() {
  const config = parseEnv(workerEnvSchema, process.env);
  const logger = pino({ level: config.LOG_LEVEL });
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  connection.on('error', () => logger.error('Redis connection error'));
  const timeout = setTimeout(() => {
    logger.fatal('Redis startup connection timed out');
    connection.disconnect();
    process.exit(1);
  }, 10000);
  try {
    await connection.connect();
    await connection.ping();
  } catch (error) {
    connection.disconnect();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  logger.info('Worker connected to Redis');
  if (process.argv.includes('--check')) {
    await connection.quit();
    return;
  }
  const worker = new Worker(
    ANALYSIS_QUEUE,
    async () => {
      // Never execute repository code. No analysis jobs are accepted in Phase 1.
      throw new UnrecoverableError(
        'Analysis processing is not implemented in Phase 1',
      );
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', () => logger.error('Worker dependency error'));
  worker.on('failed', (job) =>
    logger.warn({ jobId: job?.id }, 'Unsupported job rejected'),
  );
  await worker.waitUntilReady();
  logger.info({ queue: ANALYSIS_QUEUE }, 'Worker ready');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    await connection.quit();
    logger.info('Worker stopped');
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      message:
        error instanceof Error &&
        error.message.startsWith('Invalid environment')
          ? error.message
          : 'Worker startup failed; verify Redis configuration.',
    }),
  );
  process.exitCode = 1;
});

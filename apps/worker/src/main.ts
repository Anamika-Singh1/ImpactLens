import 'dotenv/config';
import { createServer } from 'node:http';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import {
  createImportWorker,
  enqueuePending,
  IMPORT_QUEUE,
} from '@impactlens/ingestion';
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
      // Graph/comparison work runs in bounded API worker threads. Legacy queue
      // payloads remain unsupported and must never execute repository code.
      throw new UnrecoverableError(
        'Queued analysis payloads are unsupported; use the snapshot/comparison API.',
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
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.$connect();
  const importQueue = new Queue(IMPORT_QUEUE, { connection });
  const importWorker = createImportWorker(db, connection, config);
  importQueue.on('error', () => logger.error('Import queue dependency error'));
  importWorker.on('error', () =>
    logger.error('Import worker dependency error'),
  );
  await importWorker.waitUntilReady();
  let dispatching: Promise<void> | undefined;
  let lastDispatch = 0;
  const dispatch = () => {
    if (dispatching) return;
    dispatching = enqueuePending(db, importQueue)
      .then(() => {
        lastDispatch = Date.now();
      })
      .catch(() => {
        logger.error('Import dispatch failed; will retry');
      })
      .finally(() => {
        dispatching = undefined;
      });
  };
  dispatch();
  const dispatcher = setInterval(dispatch, 5000);
  logger.info({ queue: IMPORT_QUEUE }, 'Import worker ready');
  let stopping = false;
  const health = createServer(async (req, res) => {
    if (req.url !== '/live' && req.url !== '/ready') {
      res.writeHead(404).end();
      return;
    }
    let ok = !stopping;
    if (req.url === '/ready') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([db.$queryRaw`SELECT 1`, connection.ping()]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), 3000);
          }),
        ]);
        ok &&=
          importWorker.isRunning() &&
          worker.isRunning() &&
          Date.now() - lastDispatch < 30000;
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
      }
    }
    res.writeHead(ok ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        status: ok ? 'ok' : 'unavailable',
        service: 'impactlens-worker',
      }),
    );
  });
  health.headersTimeout = 5000;
  health.requestTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject);
    health.listen(config.WORKER_HEALTH_PORT, '0.0.0.0', resolve);
  });
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    // A wedged dependency must not hold shutdown forever. Database transactions
    // roll back on disconnect; RUNNING outbox rows are recovered on restart.
    const deadline = setTimeout(() => {
      logger.warn('Worker shutdown deadline reached');
      process.exit(1);
    }, 15000);
    deadline.unref();
    clearInterval(dispatcher);
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await dispatching;
    await importWorker.close();
    await importQueue.close();
    await worker.close();
    await db.$disconnect();
    await connection.quit();
    logger.info('Worker stopped');
    clearTimeout(deadline);
  };
  const shutdown = () =>
    void stop().catch(() => {
      logger.error('Worker shutdown failed');
      process.exitCode = 1;
    });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      message:
        error instanceof Error &&
        error.message.startsWith('Invalid environment')
          ? error.message
          : 'Worker startup failed; verify database and Redis configuration.',
    }),
  );
  process.exit(1);
});

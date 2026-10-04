import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import pino from 'pino';
import { readConfig } from './config';
import { configureHttp } from './http';
async function bootstrap() {
  const config = readConfig();
  // Validate before Prisma is imported: its generated client can load .env files.
  const { AppModule } = await import('./app.module');
  const logger = pino({ level: config.LOG_LEVEL });
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  configureHttp(app, logger, config.WEB_ORIGIN, config.TRUSTED_PROXIES);
  app.enableShutdownHooks();
  // Bound shutdown even if an external dependency stops responding.
  let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
  const boundShutdown = () => {
    shutdownDeadline ??= setTimeout(() => process.exit(1), 20000);
    shutdownDeadline.unref();
  };
  process.once('SIGTERM', boundShutdown);
  process.once('SIGINT', boundShutdown);
  await app.listen(config.PORT, config.HOST);
  const server = app.getHttpServer();
  server.headersTimeout = 15000;
  server.requestTimeout = 60000;
  logger.info({ port: config.PORT }, 'API listening');
}
bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      message:
        error instanceof Error &&
        error.message.startsWith('Invalid environment')
          ? error.message
          : 'API startup failed; verify dependencies and configuration.',
    }),
  );
  process.exit(1);
});

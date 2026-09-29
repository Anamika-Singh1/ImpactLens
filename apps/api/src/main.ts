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
  configureHttp(app, logger, config.WEB_ORIGIN);
  app.enableShutdownHooks();
  await app.listen(config.PORT, '127.0.0.1');
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
  process.exitCode = 1;
});

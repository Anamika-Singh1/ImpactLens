import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
import type { Logger } from 'pino';
import cookieParser from 'cookie-parser';
import { ImportFailure } from '@impactlens/ingestion';
@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ImportFailure) {
      const status = exception.code === 'RATE_LIMITED' ? 429 : 424;
      if (status === 429)
        response.setHeader(
          'Retry-After',
          String(Math.ceil(exception.retryAfterMs / 1000)),
        );
      response.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          requestId: response.locals.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    const parseError = exception as { type?: string } | null;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : parseError?.type === 'entity.too.large'
          ? 413
          : parseError?.type === 'entity.parse.failed'
            ? 400
            : 500;
    if (status === 429) response.setHeader('Retry-After', '600');
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      status >= 500
        ? 'Internal server error'
        : typeof body === 'object' && body && 'message' in body
          ? body.message
          : status === 413
            ? 'Request exceeds the artifact upload size limit.'
            : status === 400
              ? 'Malformed JSON request.'
              : 'Request failed';
    // Do not log raw exceptions: dependency errors can contain credentials or repository content.
    if (status >= 500)
      this.logger.error(
        { requestId: response.locals.requestId, status },
        'Request failed',
      );
    response.status(status).json({
      error: {
        code: 'HTTP_' + status,
        message,
        requestId: response.locals.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
export function configureHttp(
  app: INestApplication,
  logger: Logger,
  origin: string,
  trustedProxies = '',
) {
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      trustedProxies
        ? trustedProxies
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : false,
    );
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('x-request-id');
    const requestId =
      supplied && /^[a-zA-Z0-9_-]{1,64}$/.test(supplied)
        ? supplied
        : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const start = performance.now();
    res.on('finish', () =>
      logger.info(
        {
          requestId,
          method: req.method,
          // Route templates contain no user-controlled path segments, OAuth
          // codes or repository names. Unknown paths are never logged verbatim.
          route:
            typeof req.route?.path === 'string'
              ? req.route.path
              : '[unmatched]',
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'Request completed',
      ),
    );
    next();
  });
  // Register both parsers explicitly: Nest skips its default JSON parser when
  // it detects the route-specific jsonParser middleware.
  // JSON escapes can take six bytes per source character; decoded artifacts are capped at 2 MiB.
  app.use(
    '/api/workspaces/:workspaceId/repositories/:repositoryId/test-evidence/artifacts',
    json({ limit: '13mb', inflate: false }),
  );
  app.use(json({ limit: '100kb', inflate: false }));
  app.enableCors({
    origin,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter(logger));
  app.setGlobalPrefix('api');
}

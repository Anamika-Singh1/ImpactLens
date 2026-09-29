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
import type { Logger } from 'pino';
import cookieParser from 'cookie-parser';
@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status === 429) response.setHeader('Retry-After', '600');
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      status >= 500
        ? 'Internal server error'
        : typeof body === 'object' && body && 'message' in body
          ? body.message
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
) {
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
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'Request completed',
      ),
    );
    next();
  });
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

import { BadRequestException } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import type { Request, Response } from 'express';

export function requestCancellation(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const closed = () => {
    if (!res.writableEnded) abort();
  };
  req.once('aborted', abort);
  res.once('close', closed);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort);
      res.off('close', closed);
    },
  };
}

export function runAnalysisWorker<T>(
  filename: string,
  input: unknown,
  key: 'graph' | 'result' | 'matches',
  signal?: AbortSignal,
  timeoutMs = 45000,
): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new BadRequestException('Analysis canceled.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(filename, {
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let finished = false;
    const abort = () => finish(new BadRequestException('Analysis canceled.'));
    const finish = (error?: Error, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Wait for termination before releasing the service's concurrency slot.
      void worker.terminate().then(
        () => {
          if (error) reject(error);
          else resolve(value!);
        },
        () =>
          reject(new BadRequestException('Analysis worker cleanup failed.')),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          new BadRequestException(
            'Analysis exceeded its time limit. Use a smaller snapshot.',
          ),
        ),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message) =>
      message?.[key]
        ? finish(undefined, message[key])
        : finish(new BadRequestException('Analysis failed.')),
    );
    worker.once('error', () =>
      finish(new BadRequestException('Analysis exceeded its resource limits.')),
    );
    worker.once('exit', () => {
      if (!finished)
        finish(
          new BadRequestException(
            'Analysis worker stopped before returning results.',
          ),
        );
    });
    if (signal?.aborted) abort();
  });
}

import { Worker } from 'node:worker_threads';
import type { SnapshotGraph, RepositoryOverviewData } from '@impactlens/shared';
import { ImportFailure } from './errors';
export function runRepositoryAnalysis(
  files: { path: string; contentText: string | null }[],
  commitSha: string,
  signal: AbortSignal,
  progress: (stage: string, value: number) => Promise<unknown>,
) {
  return new Promise<{
    graph: SnapshotGraph;
    overview: RepositoryOverviewData;
  }>((resolve, reject) => {
    const worker = new Worker(
      require.resolve('@impactlens/analyzer/dist/repository-worker.js'),
      {
        workerData: { files, commitSha },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    let finished = false;
    let updates = Promise.resolve();
    const abort = () =>
      finish(
        new ImportFailure(
          'ANALYSIS_CANCELED',
          'Repository analysis was canceled.',
        ),
      );
    const finish = (
      error?: Error,
      result?: { graph: SnapshotGraph; overview: RepositoryOverviewData },
    ) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void Promise.all([worker.terminate(), updates]).then(
        () => (error ? reject(error) : resolve(result!)),
        () =>
          reject(
            new ImportFailure(
              'ANALYSIS_FAILED',
              'Repository analysis could not finish. Retry.',
            ),
          ),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          new ImportFailure(
            'ANALYSIS_TIMEOUT',
            'Static analysis exceeded 45 seconds. Try a smaller repository.',
          ),
        ),
      45000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.on('message', (message) => {
      if (finished) return;
      if (message.stage === 'Preparing overview')
        updates = updates
          .then(() => progress(message.stage, message.progress))
          .then(() => undefined)
          .catch(() =>
            finish(
              new ImportFailure(
                'ANALYSIS_PROGRESS_FAILED',
                'Could not save analysis progress. Retry the job.',
              ),
            ),
          );
      else if (message.result) finish(undefined, message.result);
      else
        finish(
          new ImportFailure(
            'ANALYSIS_FAILED',
            'Static repository analysis failed. Retry the job.',
          ),
        );
    });
    worker.once('error', () =>
      finish(
        new ImportFailure(
          'ANALYSIS_LIMIT',
          'Static analysis exceeded its resource limits. Try a smaller repository.',
        ),
      ),
    );
    worker.once('exit', () => {
      if (!finished)
        finish(
          new ImportFailure(
            'ANALYSIS_FAILED',
            'Analysis stopped before returning results. Retry.',
          ),
        );
    });
    if (signal.aborted) abort();
  });
}

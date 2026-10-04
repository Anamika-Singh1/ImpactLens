import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSnapshot, type AnalysisInput } from './analyze';
// This worker only loads our analyzer. Snapshot contents remain compiler input.
try {
  parentPort?.postMessage({
    graph: analyzeSnapshot(workerData as AnalysisInput),
  });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : 'Static analysis failed',
  });
}

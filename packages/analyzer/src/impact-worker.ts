import { parentPort, workerData } from 'node:worker_threads';
import { analyzeImpact } from './impact';
try {
  parentPort?.postMessage({ result: analyzeImpact(workerData) });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : 'Impact analysis failed',
  });
}

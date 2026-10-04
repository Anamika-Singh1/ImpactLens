import { parentPort, workerData } from 'node:worker_threads';
import { searchImplementation } from './repository';
try {
  parentPort?.postMessage({
    matches: searchImplementation(
      workerData.input,
      workerData.graph,
      workerData.query,
      workerData.confirmed,
    ),
  });
} catch {
  parentPort?.postMessage({ error: 'Implementation search failed.' });
}

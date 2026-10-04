import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSnapshot, type AnalysisInput } from './analyze';
import { buildRepositoryOverview } from './repository';
try {
  const graph = analyzeSnapshot(workerData as AnalysisInput);
  parentPort?.postMessage({ stage: 'Preparing overview', progress: 85 });
  const overview = buildRepositoryOverview(workerData as AnalysisInput, graph);
  parentPort?.postMessage({ result: { graph, overview } });
} catch {
  parentPort?.postMessage({ error: 'Repository analysis failed.' });
}

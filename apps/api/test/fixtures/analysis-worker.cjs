const { parentPort, workerData } = require('node:worker_threads');
if (workerData.mode === 'crash') process.exit(7);
if (workerData.mode === 'hang') setInterval(() => {}, 1000);
else parentPort.postMessage({ result: { recorded: true } });

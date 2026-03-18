// Worker entry: listens for a message { id, uri, text } and responds with { id, symbols }
const { parentPort } = require('worker_threads');
const { parseFile } = require('./fileSymbolParser');

if (!parentPort) {
  throw new Error('workerTask must be run as a worker_thread');
}

parentPort.on('message', (msg) => {
  try {
    const { id, uri, text } = msg;
    const filePath = uri || 'unknown';
    const symbols = parseFile(text || '', filePath);
    parentPort.postMessage({ id, symbols, uri });
  } catch (err) {
    parentPort.postMessage({ id: msg && msg.id, error: String(err) });
  }
});

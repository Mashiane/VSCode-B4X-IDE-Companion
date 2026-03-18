const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

class WorkerPool {
  constructor(size) {
    this.size = size || Math.max(1, Math.min(2, os.cpus().length - 1));
    this.workers = [];
    this.nextWorker = 0;
    this.requests = new Map();
    for (let i = 0; i < this.size; i++) this._createWorker(i);
  }

  _createWorker(index) {
    const worker = new Worker(path.join(__dirname, 'workerTask.js'));
    worker.on('message', (msg) => this._onMessage(msg));
    worker.on('error', (err) => console.error('Worker error', err));
    worker.on('exit', (code) => {
      if (code !== 0) console.warn('Worker exited with', code);
      // recreate
      this._createWorker(index);
    });
    this.workers[index] = worker;
  }

  _onMessage(msg) {
    const { id, symbols, uri, error } = msg || {};
    const cb = this.requests.get(id);
    if (!cb) return;
    this.requests.delete(id);
    try { cb(error ? { error } : { symbols, uri }); } catch (e) { console.error('callback error', e); }
  }

  queueParse(uri, text) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    return new Promise((resolve) => {
      this.requests.set(id, resolve);
      worker.postMessage({ id, uri, text });
    });
  }

  dispose() {
    for (const w of this.workers) {
      try { w.terminate(); } catch (e) { /* ignore */ }
    }
    this.workers = [];
  }
}

module.exports = { WorkerPool };

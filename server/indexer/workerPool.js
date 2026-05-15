const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

const PARSE_TIMEOUT_MS = 30000; // reject if worker doesn't respond within 30s

class WorkerPool {
  constructor(size) {
    this.size = size || Math.max(1, Math.min(2, os.cpus().length - 1));
    this.workers = [];
    this.nextWorker = 0;
    this.requests = new Map(); // id -> { resolve, reject, workerIndex, uri }
    this.failedFiles = new Set(); // uri of files that caused worker crashes
    this.disposed = false;
    for (let i = 0; i < this.size; i++) this._createWorker(i);
  }

  _createWorker(index) {
    const worker = new Worker(path.join(__dirname, 'workerTask.js'));
    worker.on('message', (msg) => this._onMessage(msg));
    worker.on('error', (err) => {
      // Worker error - silently handle
    });
    worker.on('exit', (code) => {
      if (this.disposed) return;
      if (code !== 0) {
        // Worker exited with error code - silently continue
      }
      // Only reject requests that were assigned to THIS specific worker
      const toReject = [];
      for (const [id, entry] of this.requests.entries()) {
        if (entry.workerIndex === index) {
          // If worker crashed, mark the file as failed to prevent crash loops
          if (entry.uri) this.failedFiles.add(entry.uri);
          toReject.push({ id, entry });
        }
      }
      for (const { id, entry } of toReject) {
        this.requests.delete(id);
        entry.reject(new Error(`Worker ${index} crashed while processing request ${id}`));
      }
      // Recreate the worker
      this._createWorker(index);
    });
    this.workers[index] = worker;
  }

  _onMessage(msg) {
    const { id, symbols, uri, error } = msg || {};
    const entry = this.requests.get(id);
    if (!entry) return;
    this.requests.delete(id);
    if (error) {
      entry.reject(new Error(typeof error === 'string' ? error : 'Worker parse error'));
    } else {
      // A successful parse means the file is safe — remove from blacklist
      if (entry.uri) this.failedFiles.delete(entry.uri);
      entry.resolve({ symbols, uri });
    }
  }

  queueParse(uri, text) {
    if (this.disposed) {
      return Promise.reject(new Error('WorkerPool has been disposed'));
    }
    if (this.failedFiles.has(uri)) {
      return Promise.reject(new Error(`File ${uri} is blacklisted due to previous worker crashes`));
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const workerIndex = this.nextWorker;
    const worker = this.workers[workerIndex];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`Parse request ${id} timed out after ${PARSE_TIMEOUT_MS}ms`));
      }, PARSE_TIMEOUT_MS);
      const entry = { resolve, reject, workerIndex, uri };
      this.requests.set(id, entry);
      // Clean up timeout on resolution/rejection
      const originalResolve = entry.resolve;
      const originalReject = entry.reject;
      entry.resolve = (val) => { clearTimeout(timeout); originalResolve(val); };
      entry.reject = (err) => { clearTimeout(timeout); originalReject(err); };
      worker.postMessage({ id, uri, text });
    });
  }

  dispose() {
    this.disposed = true;
    // Reject all pending requests so callers don't hang forever
    for (const [id, entry] of this.requests.entries()) {
      try { entry.reject(new Error('WorkerPool disposed')); } catch (_) { /* ignore */ }
    }
    this.requests.clear();
    for (const w of this.workers) {
      try { w.terminate(); } catch (e) { /* ignore */ }
    }
    this.workers = [];
  }
}

module.exports = { WorkerPool };

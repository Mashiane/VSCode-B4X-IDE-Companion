const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const logger = require('../logger');

const PARSE_TIMEOUT_MS = 30000; // reject if worker doesn't respond within 30s

class WorkerPool {
  constructor(size) {
    this.size = size || Math.max(1, Math.min(2, os.cpus().length - 1));
    this.workers = [];
    this.nextWorker = 0;
    this.requests = new Map(); // id -> { resolve, reject, workerIndex, uri }
    this.failedFiles = new Set(); // uri of files that caused worker crashes
    this.disposed = false;
    this._workerAvailable = false; // tracks whether any workers can process requests
    for (let i = 0; i < this.size; i++) this._createWorker(i);
    this._updateAvailability();
    if (!this._workerAvailable) {
      logger.warn('workerPool.noWorkers', { message: 'No worker threads could be created — indexing will be unavailable. This may indicate a sandboxed or restricted environment.' });
    }
  }

  /** Recalculate _workerAvailable based on current workers array. */
  _updateAvailability() {
    this._workerAvailable = this.workers.some(w => w !== null && w !== undefined);
  }

  _createWorker(index) {
    // When bundled by esbuild, both server.js and workerTask.js end up in dist/.
    // __dirname in the bundle resolves to the dist/ directory at runtime.
    const workerPath = path.join(__dirname, 'workerTask.js');
    let worker;
    try {
      worker = new Worker(workerPath);
    } catch (err) {
      // Worker creation can fail in sandboxed environments where worker_threads
      // are restricted. Log the error and leave the slot empty — the pool
      // gracefully degrades when no workers are available.
      logger.error('workerPool.createWorker.failed', {
        index,
        error: err && (err.stack || err.message || String(err)),
        workerPath,
      });
      this.workers[index] = null;
      this._updateAvailability();
      return;
    }
    worker.on('message', (msg) => this._onMessage(msg));
    worker.on('error', (err) => {
      // Worker error — log for diagnostics instead of silently swallowing
      try { logger.error('worker.error', { index, error: err && (err.stack || err.message || String(err)) }); } catch (_) {}
    });
    worker.on('exit', (code) => {
      if (this.disposed) return;
      if (code !== 0) {
        // Worker exited with error code - log for diagnostics
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
      // Only recreate the worker if we had workers before (not in a fully
      // sandboxed environment where recreation would fail and loop forever).
      if (this._workerAvailable) {
        this._createWorker(index);
      } else {
        this.workers[index] = null;
        this._updateAvailability();
      }
    });
    this.workers[index] = worker;
    this._updateAvailability();
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

  /** Find the next available (non-null) worker index, or -1 if none. */
  _nextAvailableWorker() {
    const len = this.workers.length;
    if (len === 0) return -1;
    // Start from nextWorker and search for a non-null slot
    for (let i = 0; i < len; i++) {
      const idx = (this.nextWorker + i) % len;
      if (this.workers[idx] !== null && this.workers[idx] !== undefined) {
        this.nextWorker = (idx + 1) % len;
        return idx;
      }
    }
    return -1;
  }

  queueParse(uri, text) {
    if (this.disposed) {
      return Promise.reject(new Error('WorkerPool has been disposed'));
    }
    if (this.failedFiles.has(uri)) {
      return Promise.reject(new Error(`File ${uri} is blacklisted due to previous worker crashes`));
    }
    const workerIndex = this._nextAvailableWorker();
    if (workerIndex === -1) {
      // No workers available — reject gracefully so callers fall back to
      // single-threaded parsing or skip indexing rather than hanging forever.
      return Promise.reject(new Error('No worker threads available — indexing is unavailable in this environment.'));
    }
    const worker = this.workers[workerIndex];
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  /**
   * Remove a URI from the failed-files blacklist. Called when a document
   * changes so the file can be retried on the next save/parse cycle instead
   * of being permanently blocked for the session.
   */
  clearFailedFile(uri) {
    return this.failedFiles.delete(uri);
  }

  dispose() {
    this.disposed = true;
    // Reject all pending requests so callers don't hang forever
    for (const [id, entry] of this.requests.entries()) {
      try { entry.reject(new Error('WorkerPool disposed')); } catch (_) { /* ignore */ }
    }
    this.requests.clear();
    for (const w of this.workers) {
      if (w) { try { w.terminate(); } catch (e) { /* ignore */ } }
    }
    this.workers = [];
  }
}

module.exports = { WorkerPool };
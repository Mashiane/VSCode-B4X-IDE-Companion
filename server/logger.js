const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
const logFile = path.join(logDir, 'server.log');

// Async write queue with bounded size to avoid memory leaks
const MAX_QUEUE_SIZE = 5000; // drop oldest entries if queue exceeds this
let writeQueue = [];
let isWriting = false;

async function drainQueue() {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  while (writeQueue.length > 0) {
    const entry = writeQueue.shift();
    try {
      await fs.promises.appendFile(logFile, entry, { encoding: 'utf8' });
    } catch (e) {
      console.error('Logger failed to write', e && e.stack ? e.stack : e);
    }
  }
  isWriting = false;
}

function write(obj) {
  // Serialize with circular reference protection
  let line;
  try {
    line = JSON.stringify(obj) + '\n';
  } catch (e) {
    // Fallback: stringify without meta if circular
    try {
      const safe = { ts: obj.ts, level: obj.level, message: obj.message, meta: '[circular reference omitted]', pid: obj.pid };
      line = JSON.stringify(safe) + '\n';
    } catch (_) {
      line = `[${obj.ts || '?'}] ERROR: failed to serialize log entry\n`;
    }
  }

  // Bounded queue: drop oldest entries if full
  if (writeQueue.length >= MAX_QUEUE_SIZE) {
    writeQueue.splice(0, writeQueue.length - MAX_QUEUE_SIZE + 1);
  }
  writeQueue.push(line);
  // Drain asynchronously without blocking the caller
  drainQueue().catch(() => { /* ignore drain errors */ });
}

function timestamp() { return new Date().toISOString(); }

function log(level, message, meta) {
  const entry = { ts: timestamp(), level, message, meta: meta || null, pid: process.pid };
  try { console.log(`[${entry.ts}] ${level.toUpperCase()}: ${message}`, meta || ''); } catch (_) {}
  write(entry);
}

module.exports = {
  log,
  info:  (message, meta) => log('info',  message, meta),
  warn:  (message, meta) => log('warn',  message, meta),
  error: (message, meta) => log('error', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};

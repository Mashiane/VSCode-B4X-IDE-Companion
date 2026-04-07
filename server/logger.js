const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
const logFile = path.join(logDir, 'server.log');

function timestamp() { return new Date().toISOString(); }

function write(obj) {
  try {
    fs.appendFileSync(logFile, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
  } catch (e) {
    // fallback to console
    console.error('Logger failed to write', e && e.stack ? e.stack : e);
  }
}

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

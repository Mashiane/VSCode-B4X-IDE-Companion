import * as fs from 'node:fs';
import * as path from 'node:path';

let logEnabled = false;
let logFilePath: string | undefined;

function loadVSCode(): typeof import('vscode') | undefined {
  try { return require('vscode'); } catch { return undefined; }
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function formatDateTime(d: Date) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export function initLogger(context?: any): void {
  try {
    const vscode = loadVSCode();

    // Respect the extension's debug setting — only log when user enables it.
    if (vscode) {
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      logEnabled = cfg.get<boolean>('debug', false) === true;
    } else {
      logEnabled = false;
    }

    if (!logEnabled) return;

    // Prefer workspace root for the log file when available
    const folders = vscode?.workspace?.workspaceFolders ?? context?.workspaceFolders;
    const stamp = (() => {
      const d = new Date();
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    })();

    if (folders && folders.length > 0) {
      const root = folders[0]!.uri.fsPath;
      try { fs.mkdirSync(root, { recursive: true }); } catch {}
      logFilePath = path.join(root, `b4x-log-${stamp}.txt`);
    } else if (context?.globalStorageUri?.fsPath) {
      const base = context.globalStorageUri.fsPath;
      try { fs.mkdirSync(base, { recursive: true }); } catch {}
      logFilePath = path.join(base, `b4x-log-${stamp}.txt`);
    } else {
      // fallback to temp
      logFilePath = path.join(require('os').tmpdir(), `b4x-log-${stamp}.txt`);
    }

    // ensure file exists
    try { fs.appendFileSync(logFilePath, `--- Log started ${formatDateTime(new Date())} ---\n`, 'utf8'); } catch { logEnabled = false; }
  } catch {
    logEnabled = false;
  }
}

export function log(message: string): void {
  try {
    if (!logEnabled || !logFilePath) return;
    const line = `${formatDateTime(new Date())} ${message.replace(/\r?\n/g, ' ')}\n`;
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // swallow logging errors
  }
}

export function traceEntry(fnName: string): void {
  log(`enter ${fnName}`);
}

export function getLogPath(): string | undefined { return logFilePath; }

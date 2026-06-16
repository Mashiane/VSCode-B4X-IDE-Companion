import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { getB4xBooleanSetting, getB4xStringSetting } from './b4xSettings';

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ONLY_RE = /^[A-Za-z]:$/;

function expandHomeDir(input: string): string {
  if (!input.startsWith('~')) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function getConfiguredWinePrefix(): string | undefined {
  const fromSetting = getB4xStringSetting('wine.prefix', '').trim();
  const raw = fromSetting || process.env.WINEPREFIX || path.join(os.homedir(), '.wine');
  if (!raw) return undefined;
  return path.resolve(expandHomeDir(raw));
}

export function isWineEnabled(): boolean {
  if (process.platform === 'win32') return false;
  const enabled = getB4xBooleanSetting('wine.enabled', false);
  if (enabled) return true;
  const explicitPrefix = getB4xStringSetting('wine.prefix', '').trim();
  return Boolean(explicitPrefix || process.env.WINEPREFIX);
}

export function isWindowsLikePath(input: string | undefined): boolean {
  if (!input) return false;
  const value = input.trim();
  return WINDOWS_DRIVE_RE.test(value) || WINDOWS_DRIVE_ONLY_RE.test(value);
}

function getWineDriveRoot(prefix: string, driveLetter: string): string | undefined {
  const drive = `${driveLetter.toLowerCase()}:`;
  const linkPath = path.join(prefix, 'dosdevices', drive);
  try {
    if (fs.existsSync(linkPath)) {
      return fs.realpathSync.native(linkPath);
    }
  } catch {
    // ignore and fall back
  }

  if (drive === 'c:') {
    const fallback = path.join(prefix, 'drive_c');
    if (fs.existsSync(fallback)) return fallback;
  }
  if (drive === 'z:') {
    return path.parse(process.cwd()).root;
  }
  return undefined;
}

function splitWindowsPathSegments(input: string): string[] {
  return input
    .replace(/^[A-Za-z]:[\\/]?/, '')
    .split(/[\\/]+/)
    .filter(Boolean);
}

export function translateWinePathToHost(input: string | undefined, baseDir?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = expandHomeDir(input.trim());
  if (!trimmed) return undefined;

  if (process.platform === 'win32') {
    return path.normalize(trimmed);
  }

  if (trimmed.startsWith('/')) {
    return path.normalize(trimmed);
  }

  if (isWindowsLikePath(trimmed) && isWineEnabled()) {
    const prefix = getConfiguredWinePrefix();
    if (!prefix) return undefined;
    const driveRoot = getWineDriveRoot(prefix, trimmed[0]!);
    if (!driveRoot) return undefined;
    const segments = splitWindowsPathSegments(trimmed);
    return path.resolve(driveRoot, ...segments);
  }

  const relativeParts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (baseDir) {
    return path.resolve(baseDir, ...relativeParts);
  }

  return path.normalize(trimmed);
}

export function resolveB4xRelativePath(baseDir: string, b4xPath: string): string {
  const relativeParts = b4xPath.split(/[\\/]+/).filter(Boolean);
  return path.resolve(baseDir, ...relativeParts);
}

export function getWineBinary(): string {
  return getB4xStringSetting('wine.binary', '').trim() || 'wine';
}

export function getWinePathBinary(): string {
  return getB4xStringSetting('winepath.binary', '').trim() || 'winepath';
}

export function hostPathToWinePath(hostPath: string): string {
  const normalizedHostPath = path.resolve(expandHomeDir(hostPath));
  const prefix = getConfiguredWinePrefix();
  const winePathBin = getWinePathBinary();

  try {
    const output = execFileSync(winePathBin, ['-w', normalizedHostPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(prefix ? { WINEPREFIX: prefix } : {}),
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (output) return output;
  } catch {
    // fall back to deterministic mapping below
  }

  if (prefix) {
    const driveC = path.join(prefix, 'drive_c');
    const normalizedDriveC = path.resolve(driveC);
    if (normalizedHostPath === normalizedDriveC || normalizedHostPath.startsWith(`${normalizedDriveC}${path.sep}`)) {
      const relative = path.relative(normalizedDriveC, normalizedHostPath).split(path.sep).join('\\');
      return relative ? `C:\\${relative}` : 'C:\\';
    }
  }

  const posix = normalizedHostPath.split(path.sep).join('\\');
  return `Z:${posix.startsWith('\\') ? posix : `\\${posix}`}`;
}

export function findWineIniPath(platformDirs: string[]): string | undefined {
  const prefix = getConfiguredWinePrefix();
  if (!prefix) return undefined;

  const usersRoot = path.join(prefix, 'drive_c', 'users');
  if (!fs.existsSync(usersRoot)) return undefined;

  try {
    const userDirs = fs.readdirSync(usersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const userDir of userDirs) {
      for (const platformDir of platformDirs) {
        const candidate = path.join(usersRoot, userDir, 'AppData', 'Roaming', 'Anywhere Software', platformDir, 'b4xV5.ini');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

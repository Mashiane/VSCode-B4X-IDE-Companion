import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import * as vscode from 'vscode';

const appDataFolder = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');

export type B4xPlatformName = 'b4a' | 'b4i' | 'b4j' | 'b4r';

/**
 * Maps each B4X platform to its %APPDATA%\Anywhere Software subfolder name(s).
 * The first entry is the preferred folder; additional entries are fallbacks.
 */
const platformAppDataDirs: Record<B4xPlatformName, string[]> = {
  b4a: ['B4A', 'Basic4android'],
  b4j: ['B4J'],
  b4i: ['B4i'],
  b4r: ['B4R'],
};

export interface B4xPlatformPathSetting {
  platform: B4xPlatformName;
  iniPath: string;
}

export interface B4xPlatformSettings {
  configuredPlatforms: B4xPlatformPathSetting[];
}

/** Module-level cache for registry-based install dirs — shared across all calls. */
let regDirsCache: Record<string, string> | undefined;

/** Invalidate the platform registry cache so next call re-discovers installations. */
export function invalidatePlatformCache(): void {
  regDirsCache = undefined;
}

/**
 * Discovers B4X platform install directories from the Windows Registry.
 * Returns a map of platform key (b4a/b4j/b4r/b4i) -> full install directory path.
 * e.g. { b4a: 'C:\\Program Files\\Anywhere Software\\Basic4android',
 *         b4i: 'C:\\Program Files (x86)\\Anywhere Software\\B4i' }
 * Returns an empty object on non-Windows or if nothing is found.
 *
 * Uses execFileSync as synchronous fallback (only when cache hasn't been warmed).
 * Call warmPlatformCache() during activation to pre-populate the cache asynchronously.
 */
export function findPlatformInstallDirs(): Record<string, string> {
  // Return cached result if available (populated by warmPlatformCache or a previous call)
  if (regDirsCache) return regDirsCache;

  // Synchronous fallback — only runs if cache hasn't been warmed yet.
  // This should rarely happen if warmPlatformCache is called at activation.
  if (process.platform !== 'win32') return {};
  try {
    const ps =
      `Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',` +
      `'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |` +
      ` ForEach-Object {` +
      ` $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;` +
      ` if ($p.DisplayName -match '^(B4A|B4J|B4R|B4I) ' -and $p.InstallLocation) {` +
      ` $key = $Matches[1].ToLower(); Write-Output "$key=$($p.InstallLocation.TrimEnd('\\'))"` +
      ` } }`;
    // Use execFileSync to avoid shell injection — the script is a hardcoded string.
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const output = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const result: Record<string, string> = {};
    for (const line of output.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    regDirsCache = result;
    return result;
  } catch {
    regDirsCache = {};
    return {};
  }
}

/**
 * Pre-warm the platform registry cache asynchronously.
 * Call this during extension activation to avoid blocking the UI later.
 * Uses execFile (no shell) for safety.
 */
export function warmPlatformCache(): Promise<void> {
  if (process.platform !== 'win32') {
    regDirsCache = {};
    return Promise.resolve();
  }

  const ps =
    `Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',` +
    `'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |` +
    ` ForEach-Object {` +
    ` $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;` +
    ` if ($p.DisplayName -match '^(B4A|B4J|B4R|B4I) ' -and $p.InstallLocation) {` +
    ` $key = $Matches[1].ToLower(); Write-Output "$key=$($p.InstallLocation.TrimEnd('\\'))"` +
    ` } }`;

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) { regDirsCache = {}; resolve(); return; }
        const result: Record<string, string> = {};
        for (const line of (stdout ?? '').split(/\r?\n/)) {
          const eq = line.indexOf('=');
          if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
        regDirsCache = result;
        resolve();
      },
    );
  });
}

export function getPlatformSettings(platformFilter?: B4xPlatformName): B4xPlatformSettings {
  const configuration = vscode.workspace.getConfiguration('b4xIntellisense');

  const settingKeys: Record<B4xPlatformName, string> = {
    b4a: 'b4aIniPath',
    b4i: 'b4iIniPath',
    b4j: 'b4jIniPath',
    b4r: 'b4rIniPath',
  };

  // Lazily resolved at module level — shared across all calls.
  function getRegDirs(): Record<string, string> {
    if (!regDirsCache) { regDirsCache = findPlatformInstallDirs(); }
    return regDirsCache;
  }

  const configuredPlatforms: B4xPlatformPathSetting[] = [];

  // Only process the requested platform — do not load all platform INIs.
  const platformsToCheck = platformFilter ? [platformFilter] : (['b4a', 'b4i', 'b4j', 'b4r'] as B4xPlatformName[]);

  for (const platform of platformsToCheck) {
    let iniPath = (configuration.get<string>(settingKeys[platform], '') ?? '').trim();

    // Auto-discover if the user hasn't configured an explicit path (or the configured path doesn't exist)
    if (!iniPath || !fs.existsSync(iniPath)) {
      // 1. Try %APPDATA%\Anywhere Software\<PlatformDir>\b4xV5.ini
      const dirs = platformAppDataDirs[platform] ?? [];
      for (const dir of dirs) {
        const candidate = path.join(appDataFolder, 'Anywhere Software', dir, 'b4xV5.ini');
        if (fs.existsSync(candidate)) {
          iniPath = candidate;
          break;
        }
      }

      // 2. Try registry-based install directory
      if (!iniPath || !fs.existsSync(iniPath)) {
        const regDir = getRegDirs()[platform];
        if (regDir) {
          const candidate = path.join(regDir, 'b4xV5.ini');
          if (fs.existsSync(candidate)) {
            iniPath = candidate;
          }
        }
      }

      if (!iniPath || !fs.existsSync(iniPath)) {
        // Platform INI not found — skip silently
        continue;
      }
    }

    configuredPlatforms.push({ platform, iniPath: iniPath.trim() });
  }

  return {
    configuredPlatforms,
  };
}
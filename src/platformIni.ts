import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { B4xPlatformName, B4xPlatformPathSetting } from './platformConfig';
import { translateWinePathToHost } from './winePaths';

export interface PlatformIniFolders {
  librariesFolder?: string;
  additionalLibrariesFolder?: string;
  sharedModulesFolder?: string;
  /**
   * Optional full path to the platform folder (e.g. C:\b4a\sdk\platforms\android-36)
   * which can be used to infer a default libraries location when the INI does not
   * specify one.
   */
  platformFolder?: string;
  /** Full path to the javac.exe executable configured in the IDE */
  javacPath?: string;
}

export interface PlatformIniSettings {
  fontName2?: string;
  fontSize2?: number;
  ideTheme2?: string;
  codeTheme?: string;
}

export interface DiscoveredPlatformAssets {
  xmlFiles: string[];
  b4xlibFiles: string[];
  jarFiles: string[];
}

export interface LoadedPlatformConfig {
  platform: B4xPlatformName;
  iniPath: string;
  folders: PlatformIniFolders;
  assets: DiscoveredPlatformAssets;
  settings?: PlatformIniSettings;
}

export async function loadConfiguredPlatforms(
  configuredPlatforms: B4xPlatformPathSetting[],
): Promise<LoadedPlatformConfig[]> {
  const results = await Promise.all(configuredPlatforms.map((item) => loadPlatformIni(item)));
  return results.filter((item): item is LoadedPlatformConfig => item !== undefined);
}

export async function loadPlatformIni(
  platformSetting: B4xPlatformPathSetting,
): Promise<LoadedPlatformConfig | undefined> {
  try {
    const raw = await fs.readFile(platformSetting.iniPath, 'utf8');
    const entries = parseIniEntries(raw);
    const folders = entriesToFolders(entries);
    const settings = entriesToSettings(entries);

    const assets: DiscoveredPlatformAssets = {
      xmlFiles: [],
      b4xlibFiles: [],
      jarFiles: [],
    };

    return {
      platform: platformSetting.platform,
      iniPath: platformSetting.iniPath,
      folders,
      settings,
      assets,
    };
  } catch (error) {
    console.warn(`Failed to load ${platformSetting.platform.toUpperCase()} ini file from ${platformSetting.iniPath}`, error);
    return undefined;
  }
}

/** Shared INI line parser — extracts key/value pairs from raw INI text. */
function parseIniEntries(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    // Strip surrounding quotes from INI values (e.g. "C:\path" → C:\path)
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (!value) continue; // skip empty values
    entries.set(key.toLowerCase(), value);
  }
  return entries;
}

function entriesToFolders(entries: Map<string, string>): PlatformIniFolders {
  const translate = (value?: string): string | undefined => {
    if (!value) return undefined;
    return translateWinePathToHost(value) ?? value;
  };

  return {
    librariesFolder: translate(entries.get('librariesfolder')),
    additionalLibrariesFolder: translate(entries.get('additionallibrariesfolder')),
    sharedModulesFolder: translate(entries.get('sharedmodulesfolder')),
    platformFolder: translate(entries.get('platformfolder')),
    javacPath: translate(entries.get('javacpath')),
  };
}

function entriesToSettings(entries: Map<string, string>): PlatformIniSettings {
  const fontName2 = entries.get('fontname2');
  const fontSizeRaw = entries.get('fontsize2');
  const ideTheme2 = entries.get('idetheme2');
  const codeTheme = entries.get('codetheme');
  const fontSize2 = fontSizeRaw ? Number.parseInt(fontSizeRaw, 10) : undefined;

  return {
    fontName2: fontName2 ?? undefined,
    fontSize2: Number.isNaN(fontSize2 as number) ? undefined : fontSize2,
    ideTheme2: ideTheme2 ?? undefined,
    codeTheme: codeTheme ?? undefined,
  };
}

// Backwards-compatible wrappers (deprecated but kept for any external callers)
/** @deprecated Use parseIniEntries + entriesToFolders instead. */
export function parsePlatformIni(source: string): PlatformIniFolders {
  return entriesToFolders(parseIniEntries(source));
}

/** @deprecated Use parseIniEntries + entriesToSettings instead. */
export function parsePlatformSettings(source: string): PlatformIniSettings {
  return entriesToSettings(parseIniEntries(source));
}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { B4xPlatformName, B4xPlatformPathSetting } from './platformConfig';

export interface PlatformIniFolders {
  librariesFolder?: string;
  additionalLibrariesFolder?: string;
  sharedModulesFolder?: string;
}

export interface PlatformIniSettings {
  fontName2?: string;
  fontSize2?: number;
  ideTheme2?: string;
  codeTheme?: string;
}

export interface DiscoveredPlatformAssets {
  sourceModuleFiles: string[];
  xmlFiles: string[];
  b4xlibFiles: string[];
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
    const folders = parsePlatformIni(raw);
    const settings = parsePlatformSettings(raw);
    // Only discover assets from AdditionalLibrariesFolder and SharedModulesFolder here.
    // The main `librariesFolder` (install libraries) is discovered explicitly by the
    // extension when needed via `discoverInstallLibraryAssets`.
    const assets = await discoverPlatformAssets(folders);

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

export function parsePlatformIni(source: string): PlatformIniFolders {
  const entries = new Map<string, string>();

  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    entries.set(key.toLowerCase(), value);
  }

  return {
    librariesFolder: entries.get('librariesfolder'),
    additionalLibrariesFolder: entries.get('additionallibrariesfolder'),
    sharedModulesFolder: entries.get('sharedmodulesfolder'),
  };
}

export function parsePlatformSettings(source: string): PlatformIniSettings {
  const entries = new Map<string, string>();

  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    entries.set(key.toLowerCase(), value);
  }

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

export async function discoverPlatformAssets(folders: PlatformIniFolders): Promise<DiscoveredPlatformAssets> {
  // Only scan AdditionalLibrariesFolder and SharedModulesFolder here. The
  // install `librariesFolder` (typically under Program Files) is handled
  // separately to avoid loading the entire install by default.
  const configuredFolders = [
    folders.additionalLibrariesFolder,
    folders.sharedModulesFolder,
  ].filter((item): item is string => Boolean(item));

  const sourceModuleFiles = configuredFolders.length > 0
    ? dedupePaths((await Promise.all(
      configuredFolders.map((item) => collectFiles(item, new Set(['.bas', '.b4x']))),
    )).flat())
    : [];

  const xmlFiles = configuredFolders.length > 0
    ? dedupePaths((await Promise.all(
      configuredFolders.map((item) => collectFiles(item, new Set(['.xml']))),
    )).flat())
    : [];

  const b4xlibFiles = configuredFolders.length > 0
    ? dedupePaths((await Promise.all(
      configuredFolders.map((item) => collectFiles(item, new Set(['.b4xlib']))),
    )).flat())
    : [];

  return {
    sourceModuleFiles,
    xmlFiles,
    b4xlibFiles,
  };
}

// Note: discovery of the entire install `Libraries` tree was intentionally
// removed. The extension should perform targeted, lightweight checks for
// specific library files (e.g. Core.xml/XUI.xml or project-referenced
// libraries) rather than scanning the full install tree.

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => item.toLowerCase()))];
}

async function collectFiles(rootFolder: string, extensions: Set<string>): Promise<string[]> {
  try {
    const stat = await fs.stat(rootFolder);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files: string[] = [];
  await walkDirectory(rootFolder, extensions, files);
  return files;
}

async function walkDirectory(rootFolder: string, extensions: Set<string>, output: string[]): Promise<void> {
  const entries = await fs.readdir(rootFolder, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootFolder, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, extensions, output);
      return;
    }

    if (extensions.has(path.extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }));
}
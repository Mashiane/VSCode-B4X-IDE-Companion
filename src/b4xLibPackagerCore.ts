/**
 * Core functions for packaging B4X projects into distributable .b4xlib archives.
 * Grounded in BXPP's buildB4XLib and B4X standard library specifications:
 * Scans .bas modules, collects Files/ assets, formats manifest.txt, and builds
 * standard zip archives with the .b4xlib extension.
 */

import AdmZip from 'adm-zip';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface B4xLibMetadata {
  version: string;
  author: string;
  b4x: boolean;
  supportedPlatforms?: string;
}

export interface PackageResult {
  success: boolean;
  outputPath?: string;
  filesIncluded: string[];
  message: string;
}

/**
 * Extracts metadata (#Version, #Author, #SupportedPlatforms) from B4X code comments.
 */
export function extractModuleMetadata(content: string): Partial<B4xLibMetadata> {
  const meta: Partial<B4xLibMetadata> = {};

  const vMatch = /^\s*(?:'|Rem\s+)?#(?:Version|B4XLibVersion):\s*([0-9.]+)/im.exec(content);
  if (vMatch && vMatch[1]) meta.version = vMatch[1];

  const aMatch = /^\s*(?:'|Rem\s+)?#(?:Author|B4XLibAuthor):\s*([^\r\n]+)/im.exec(content);
  if (aMatch && aMatch[1]) meta.author = aMatch[1].trim();

  const pMatch = /^\s*(?:'|Rem\s+)?#(?:SupportedPlatforms|B4XLibPlatforms):\s*([^\r\n]+)/im.exec(content);
  if (pMatch && pMatch[1]) meta.supportedPlatforms = pMatch[1].trim();

  return meta;
}

/**
 * Packages .bas files and Files/ assets into a valid .b4xlib archive.
 */
export function packageB4xLib(
  sourceDir: string,
  outputB4xLibPath: string,
  customMeta?: Partial<B4xLibMetadata>
): PackageResult {
  if (!fs.existsSync(sourceDir)) {
    return {
      success: false,
      filesIncluded: [],
      message: `Source directory does not exist: ${sourceDir}`,
    };
  }

  const zip = new AdmZip();
  const filesIncluded: string[] = [];

  let detectedVersion = customMeta?.version || '1.00';
  let detectedAuthor = customMeta?.author || 'B4X Developer';
  let detectedPlatforms = customMeta?.supportedPlatforms || 'B4A, B4J, B4i';

  // 1. Scan for .bas files in sourceDir
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.bas')) {
      const fullPath = path.join(sourceDir, e.name);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Try to discover metadata from primary module if not provided
      const mMeta = extractModuleMetadata(content);
      if (!customMeta?.version && mMeta.version) detectedVersion = mMeta.version;
      if (!customMeta?.author && mMeta.author) detectedAuthor = mMeta.author;
      if (!customMeta?.supportedPlatforms && mMeta.supportedPlatforms) detectedPlatforms = mMeta.supportedPlatforms;

      zip.addLocalFile(fullPath);
      filesIncluded.push(e.name);
    }
  }

  if (filesIncluded.length === 0) {
    return {
      success: false,
      filesIncluded: [],
      message: 'No .bas modules found in source directory to package.',
    };
  }

  // 2. Scan for Files/ asset directory
  const filesSubdir = path.join(sourceDir, 'Files');
  if (fs.existsSync(filesSubdir) && fs.statSync(filesSubdir).isDirectory()) {
    zip.addLocalFolder(filesSubdir, 'Files');
    const assetEntries = fs.readdirSync(filesSubdir);
    for (const a of assetEntries) {
      filesIncluded.push(`Files/${a}`);
    }
  }

  // 3. Generate or preserve manifest.txt
  const manifestPath = path.join(sourceDir, 'manifest.txt');
  let manifestContent = '';
  if (fs.existsSync(manifestPath)) {
    manifestContent = fs.readFileSync(manifestPath, 'utf8');
  } else {
    manifestContent = `Version=${detectedVersion}\nAuthor=${detectedAuthor}\nB4X=true\nSupportedPlatforms=${detectedPlatforms}\n`;
  }

  zip.addFile('manifest.txt', Buffer.from(manifestContent, 'utf8'));
  filesIncluded.push('manifest.txt');

  // Ensure target folder exists
  const outDir = path.dirname(outputB4xLibPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    zip.writeZip(outputB4xLibPath);
    return {
      success: true,
      outputPath: outputB4xLibPath,
      filesIncluded,
      message: `Successfully packaged ${filesIncluded.length} items into '${path.basename(outputB4xLibPath)}'.`,
    };
  } catch (err: any) {
    return {
      success: false,
      filesIncluded,
      message: `Failed to write .b4xlib archive: ${err?.message || err}`,
    };
  }
}

export type B4xPlatformKey = 'b4a' | 'b4j' | 'b4i' | 'b4r';

/**
 * Detects project platform from file extensions in the directory (.b4a -> b4a, etc.).
 */
export function detectProjectPlatform(projectDir: string): B4xPlatformKey | undefined {
  if (!fs.existsSync(projectDir)) return undefined;
  try {
    const entries = fs.readdirSync(projectDir);
    for (const e of entries) {
      const ext = path.extname(e).toLowerCase();
      if (ext === '.b4a') return 'b4a';
      if (ext === '.b4j') return 'b4j';
      if (ext === '.b4i') return 'b4i';
      if (ext === '.b4r') return 'b4r';
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Detects the project/library name from project files or falls back to folder name.
 */
export function detectProjectName(projectDir: string): string {
  if (fs.existsSync(projectDir)) {
    try {
      const entries = fs.readdirSync(projectDir);
      for (const e of entries) {
        const ext = path.extname(e).toLowerCase();
        if (['.b4a', '.b4j', '.b4i', '.b4r'].includes(ext)) {
          return path.basename(e, ext);
        }
      }
    } catch {
      // ignore
    }
  }
  return path.basename(projectDir);
}

export interface ResolveLibrariesOptions {
  projectDir?: string;
  platform?: B4xPlatformKey;
  getSetting?: (key: string) => string | undefined;
  getIniAdditionalFolder?: (platform: B4xPlatformKey) => string | undefined;
}

/**
 * Resolves the Additional Libraries folder based on settings, platform INI, and fallbacks.
 */
export function resolveAdditionalLibrariesFolder(options: ResolveLibrariesOptions): string | undefined {
  const { projectDir, platform: explicitPlatform, getSetting, getIniAdditionalFolder } = options;
  const platform = explicitPlatform || (projectDir ? detectProjectPlatform(projectDir) : undefined) || 'b4a';

  const platformSettingKeys: Record<B4xPlatformKey, string> = {
    b4a: 'b4aAdditionalLibrariesFolder',
    b4j: 'b4jAdditionalLibrariesFolder',
    b4i: 'b4iAdditionalLibrariesFolder',
    b4r: 'b4rAdditionalLibrariesFolder',
  };

  // 1. Check platform-specific setting
  if (getSetting) {
    const settingVal = getSetting(platformSettingKeys[platform])?.trim();
    if (settingVal) return settingVal;

    // 2. Check generic additional libraries setting
    const genericVal = (getSetting('additionalLibrariesFolder') || getSetting('additionalLibsFolder'))?.trim();
    if (genericVal) return genericVal;
  }

  // 3. Check platform INI file
  if (getIniAdditionalFolder) {
    const iniVal = getIniAdditionalFolder(platform)?.trim();
    if (iniVal) return iniVal;
  }

  // 4. Cross-platform fallback check
  const allPlatforms: B4xPlatformKey[] = ['b4a', 'b4j', 'b4i', 'b4r'];
  for (const p of allPlatforms) {
    if (p === platform) continue;
    if (getSetting) {
      const fallbackSetting = getSetting(platformSettingKeys[p])?.trim();
      if (fallbackSetting) return fallbackSetting;
    }
    if (getIniAdditionalFolder) {
      const fallbackIni = getIniAdditionalFolder(p)?.trim();
      if (fallbackIni) return fallbackIni;
    }
  }

  return undefined;
}

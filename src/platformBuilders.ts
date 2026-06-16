import * as path from 'node:path';

/**
 * B4X Platform Builder Configuration
 * 
 * Maps each B4X platform to its:
 * - Builder executable name
 * - Default installation path on Windows
 * - Project file extension
 * - Build artifact extension
 * - Required tools (adb, etc.)
 */

export interface B4xPlatformConfig {
  /** Platform display name */
  displayName: string;
  /** Folder name in workspace (e.g., "B4A") */
  folder: string;
  /** Project file extension (e.g., ".b4a") */
  ext: string;
  /** Builder executable name */
  builder: string;
  /** Default Windows install path */
  defaultInstall: string;
  /** VS Code setting key for custom install path */
  settingKey: string;
  /** Build artifact extension (e.g., ".apk", ".jar") */
  artifactExt: string;
  /** Whether ADB is needed for installation */
  needsAdb: boolean;
  /** Build command arguments */
  buildArgs: (platformFolder: string, projectFile: string) => string[];
}

/**
 * Platform builder mappings with default Windows installation paths.
 * These can be overridden via VS Code settings: b4xIntellisense.{settingKey}
 * 
 * NOTE: B4i and B4R do NOT have Windows-based builders. They are excluded
 * from the build/install command. Only B4A and B4J are supported.
 */
export const B4X_PLATFORMS: Record<string, B4xPlatformConfig> = {
  B4A: {
    displayName: 'B4A',
    folder: 'B4A',
    ext: '.b4a',
    builder: 'B4ABuilder.exe',
    defaultInstall: 'C:\\Program Files\\Anywhere Software\\B4A',
    settingKey: 'b4aInstallPath',
    artifactExt: '.apk',
    needsAdb: true,
    buildArgs: (platformFolder: string, projectFile: string) => [
      '-task=Build',
      `-BaseFolder=${platformFolder}`,
      `-Project=${projectFile}`,
    ],
  },
  B4J: {
    displayName: 'B4J',
    folder: 'B4J',
    ext: '.b4j',
    builder: 'B4JBuilder.exe',
    defaultInstall: 'C:\\Program Files\\Anywhere Software\\B4J',
    settingKey: 'b4jInstallPath',
    artifactExt: '.jar',
    needsAdb: false,
    buildArgs: (platformFolder: string, projectFile: string) => [
      '-task=Build',
      `-Project=${projectFile}`,
    ],
  },
};

/**
 * Get builder executable path for a platform
 */
export function getBuilderPath(platformKey: string, installDir: string): string {
  const platform = B4X_PLATFORMS[platformKey.toUpperCase()];
  if (!platform) {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }
  return path.join(installDir, platform.builder);
}

/**
 * Get default install path for a platform
 */
export function getDefaultInstallPath(platformKey: string): string {
  const platform = B4X_PLATFORMS[platformKey.toUpperCase()];
  if (!platform) {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }
  return platform.defaultInstall;
}

/**
 * Get build arguments for a platform
 */
export function getBuildArgs(platformKey: string, platformFolder: string, projectFile: string): string[] {
  const platform = B4X_PLATFORMS[platformKey.toUpperCase()];
  if (!platform) {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }
  return platform.buildArgs(platformFolder, projectFile);
}

/**
 * Check if a platform needs ADB for installation
 */
export function needsAdb(platformKey: string): boolean {
  const platform = B4X_PLATFORMS[platformKey.toUpperCase()];
  return platform?.needsAdb ?? false;
}

/**
 * Get artifact extension for a platform
 */
export function getArtifactExt(platformKey: string): string {
  const platform = B4X_PLATFORMS[platformKey.toUpperCase()];
  return platform?.artifactExt ?? '';
}

/**
 * Get all supported platform keys
 */
export function getSupportedPlatforms(): string[] {
  return Object.keys(B4X_PLATFORMS);
}

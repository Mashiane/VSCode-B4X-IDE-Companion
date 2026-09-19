/**
 * Core functions for B4X environment health checks ("B4X Doctor").
 * Grounded in MCP-B4J's b4j_doctor and B4XMcpServer's BuilderLocator / AdbLocator:
 * Verifies Java JDK, B4ABuilder, B4JBuilder, Android SDK (adb), and library directory health.
 *
 * Reads configuration directly from Anywhere Software INI files (e.g. b4xV5.ini)
 * which serve as the single source of truth for standalone B4A / B4J environments.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ComponentHealth {
  name: string;
  status: 'ok' | 'warning' | 'error';
  path?: string;
  details?: string;
  recommendation?: string;
}

export interface DoctorReport {
  timestamp: string;
  overallHealthy: boolean;
  components: ComponentHealth[];
  markdown: string;
}

export interface DoctorPaths {
  javaHome?: string;
  b4aBuilderPath?: string;
  b4jBuilderPath?: string;
  adbPath?: string;
  platformFolder?: string;
  toolsFolder?: string;
  internalLibsFolder?: string;
  additionalLibsFolder?: string;
  iniPath?: string;
}

interface DiscoveredIniSettings {
  javaBin?: string;
  platformFolder?: string;
  toolsFolder?: string;
  additionalLibrariesFolder?: string;
  sharedModulesFolder?: string;
}

/**
 * Parses key/value pairs from B4A / B4X INI files (e.g. b4xV5.ini)
 */
export function loadB4aIniSettings(customIniPath?: string): DiscoveredIniSettings {
  const result: DiscoveredIniSettings = {};
  if (process.platform !== 'win32') return result;

  const appData = process.env.APPDATA || '';
  const candidates: string[] = [];

  if (customIniPath && customIniPath.trim()) {
    candidates.push(customIniPath.trim());
  }
  if (appData) {
    candidates.push(path.join(appData, 'Anywhere Software', 'Basic4android', 'b4xV5.ini'));
    candidates.push(path.join(appData, 'Anywhere Software', 'B4A', 'b4xV5.ini'));
  }

  for (const iniFile of candidates) {
    if (fs.existsSync(iniFile)) {
      try {
        const content = fs.readFileSync(iniFile, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const idx = line.indexOf('=');
          if (idx > 0) {
            const key = line.slice(0, idx).trim().toLowerCase();
            let val = line.slice(idx + 1).trim();
            if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
              val = val.slice(1, -1);
            }
            if (key === 'javabin') result.javaBin = val;
            else if (key === 'platformfolder') result.platformFolder = val;
            else if (key === 'toolsfolder') result.toolsFolder = val;
            else if (key === 'additionallibrariesfolder') result.additionalLibrariesFolder = val;
            else if (key === 'sharedmodulesfolder') result.sharedModulesFolder = val;
          }
        }
        break;
      } catch {
        // Ignore directory read errors
      }
    }
  }

  return result;
}

/**
 * Known default locations for Anywhere Software tools on Windows.
 * Prioritizes modern B4A installation paths over legacy directory names.
 */
const DEFAULT_B4A_LOCATIONS = [
  'C:\\Program Files\\Anywhere Software\\B4A\\B4ABuilder.exe',
  'C:\\Program Files (x86)\\Anywhere Software\\B4A\\B4ABuilder.exe',
  'C:\\Program Files\\Anywhere Software\\Basic4android\\B4ABuilder.exe',
  'C:\\Program Files (x86)\\Anywhere Software\\Basic4android\\B4ABuilder.exe',
];

const DEFAULT_B4J_LOCATIONS = [
  'C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe',
  'C:\\Program Files (x86)\\Anywhere Software\\B4J\\B4JBuilder.exe',
];

const DEFAULT_JAVA_LOCATIONS = [
  'C:\\b4a\\jdk19\\bin\\javac.exe',
  'C:\\Program Files\\Java\\jdk-11\\bin\\javac.exe',
  'C:\\Program Files\\Java\\jdk-17\\bin\\javac.exe',
  'C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe',
  'C:\\Program Files\\Java\\jdk-8\\bin\\javac.exe',
  'C:\\Java\\jdk-11\\bin\\javac.exe',
  'C:\\Java\\jdk-17\\bin\\javac.exe',
];

/**
 * Default ADB locations.
 * Prioritizes Anywhere Software B4A standalone SDK packages before Android Studio defaults.
 */
const DEFAULT_ADB_LOCATIONS = [
  'C:\\b4a\\sdk\\platform-tools\\adb.exe',
  'C:\\Program Files\\Anywhere Software\\B4A\\Platforms\\android-sdk\\platform-tools\\adb.exe',
  'C:\\Android\\android-sdk\\platform-tools\\adb.exe',
  'C:\\Android\\sdk\\platform-tools\\adb.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
];

export function countLibraryFiles(dirPath?: string): { xmlCount: number; b4xlibCount: number } {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { xmlCount: 0, b4xlibCount: 0 };
  }

  let xmlCount = 0;
  let b4xlibCount = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === '.xml') xmlCount++;
        else if (ext === '.b4xlib') b4xlibCount++;
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return { xmlCount, b4xlibCount };
}

export function runB4xDoctor(paths: DoctorPaths = {}): DoctorReport {
  const components: ComponentHealth[] = [];

  // Load configuration from B4A INI as primary source of truth if paths not provided
  const ini = loadB4aIniSettings(paths.iniPath);
  const effectivePlatformFolder = paths.platformFolder || ini.platformFolder;
  const effectiveToolsFolder = paths.toolsFolder || ini.toolsFolder;
  const effectiveJavaBin = paths.javaHome || ini.javaBin;
  const effectiveAdditionalLibs = paths.additionalLibsFolder || ini.additionalLibrariesFolder;

  // 1. Java JDK Check
  let javaResolved: string | undefined;
  if (effectiveJavaBin && fs.existsSync(effectiveJavaBin)) {
    try {
      if (fs.statSync(effectiveJavaBin).isDirectory()) {
        const javacCandidate = path.join(effectiveJavaBin, process.platform === 'win32' ? 'javac.exe' : 'javac');
        if (fs.existsSync(javacCandidate)) {
          javaResolved = javacCandidate;
        } else {
          javaResolved = effectiveJavaBin;
        }
      } else {
        javaResolved = effectiveJavaBin;
      }
    } catch {
      javaResolved = effectiveJavaBin;
    }
  }

  if (!javaResolved) {
    for (const loc of DEFAULT_JAVA_LOCATIONS) {
      if (fs.existsSync(loc)) {
        javaResolved = loc;
        break;
      }
    }
  }

  if (javaResolved) {
    components.push({
      name: 'Java Development Kit (JDK)',
      status: 'ok',
      path: javaResolved,
      details: 'JDK compiler found.',
    });
  } else {
    components.push({
      name: 'Java Development Kit (JDK)',
      status: 'warning',
      details: 'No JDK found in default directories or config.',
      recommendation: 'Configure java_home or install Java 11/17 for B4J/B4A compilation.',
    });
  }

  // 2. B4A Builder Check
  let b4aResolved: string | undefined;
  if (paths.b4aBuilderPath && fs.existsSync(paths.b4aBuilderPath)) {
    try {
      if (fs.statSync(paths.b4aBuilderPath).isDirectory()) {
        const candidate = path.join(paths.b4aBuilderPath, 'B4ABuilder.exe');
        if (fs.existsSync(candidate)) b4aResolved = candidate;
      } else {
        b4aResolved = paths.b4aBuilderPath;
      }
    } catch {
      b4aResolved = paths.b4aBuilderPath;
    }
  }

  // Derive B4ABuilder from internalLibsFolder if available
  if (!b4aResolved && paths.internalLibsFolder && fs.existsSync(paths.internalLibsFolder)) {
    const candidate = path.resolve(paths.internalLibsFolder, '..', 'B4ABuilder.exe');
    if (fs.existsSync(candidate)) {
      b4aResolved = candidate;
    }
  }

  if (!b4aResolved) {
    for (const loc of DEFAULT_B4A_LOCATIONS) {
      if (fs.existsSync(loc)) {
        b4aResolved = loc;
        break;
      }
    }
  }

  if (b4aResolved) {
    components.push({
      name: 'B4A Builder (B4ABuilder.exe)',
      status: 'ok',
      path: b4aResolved,
      details: 'Command-line builder ready for Android compilation.',
    });
  } else {
    components.push({
      name: 'B4A Builder (B4ABuilder.exe)',
      status: 'warning',
      details: 'B4ABuilder.exe not found at standard paths.',
      recommendation: 'Specify the full path to B4ABuilder.exe in B4X Companion settings if targeting Android.',
    });
  }

  // 3. B4J Builder Check
  let b4jResolved: string | undefined;
  if (paths.b4jBuilderPath && fs.existsSync(paths.b4jBuilderPath)) {
    b4jResolved = paths.b4jBuilderPath;
  } else {
    for (const loc of DEFAULT_B4J_LOCATIONS) {
      if (fs.existsSync(loc)) {
        b4jResolved = loc;
        break;
      }
    }
  }

  if (b4jResolved) {
    components.push({
      name: 'B4J Builder (B4JBuilder.exe)',
      status: 'ok',
      path: b4jResolved,
      details: 'Command-line builder ready for Desktop/Server compilation.',
    });
  } else {
    components.push({
      name: 'B4J Builder (B4JBuilder.exe)',
      status: 'info' as any,
      details: 'B4JBuilder.exe not found at standard paths (optional if only targeting B4A).',
    });
  }

  // 4. Android SDK & ADB Check
  let adbResolved: string | undefined;
  if (paths.adbPath && fs.existsSync(paths.adbPath)) {
    try {
      if (fs.statSync(paths.adbPath).isDirectory()) {
        const candidate = path.join(paths.adbPath, process.platform === 'win32' ? 'adb.exe' : 'adb');
        if (fs.existsSync(candidate)) adbResolved = candidate;
      } else {
        adbResolved = paths.adbPath;
      }
    } catch {
      adbResolved = paths.adbPath;
    }
  }

  // Derive ADB from INI PlatformFolder (e.g. C:\b4a\sdk\platforms\android-35 -> ..\..\platform-tools\adb.exe)
  if (!adbResolved && effectivePlatformFolder && fs.existsSync(effectivePlatformFolder)) {
    const candidate = path.resolve(effectivePlatformFolder, '..', '..', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (fs.existsSync(candidate)) {
      adbResolved = candidate;
    }
  }

  // Derive ADB from INI ToolsFolder or Platform-Tools folder
  if (!adbResolved && effectiveToolsFolder && fs.existsSync(effectiveToolsFolder)) {
    const directCandidate = path.join(effectiveToolsFolder, process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (fs.existsSync(directCandidate)) {
      adbResolved = directCandidate;
    } else {
      const candidate = path.resolve(effectiveToolsFolder, '..', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
      if (fs.existsSync(candidate)) {
        adbResolved = candidate;
      }
    }
  }

  if (!adbResolved) {
    for (const loc of DEFAULT_ADB_LOCATIONS) {
      if (fs.existsSync(loc)) {
        adbResolved = loc;
        break;
      }
    }
  }

  if (adbResolved) {
    components.push({
      name: 'Android Debug Bridge (adb.exe)',
      status: 'ok',
      path: adbResolved,
      details: 'ADB tool ready for device inspection and APK installation.',
    });
  } else {
    components.push({
      name: 'Android Debug Bridge (adb.exe)',
      status: 'warning',
      details: 'adb.exe not found. Android device testing and logcat will be unavailable.',
      recommendation: 'Install Android platform-tools or set path to adb.exe.',
    });
  }

  // 5. Internal Libraries Check
  let internalResolved = paths.internalLibsFolder;
  if ((!internalResolved || !fs.existsSync(internalResolved)) && b4aResolved) {
    const candidate = path.join(path.dirname(b4aResolved), 'Libraries');
    if (fs.existsSync(candidate)) {
      internalResolved = candidate;
    }
  }

  if (internalResolved && fs.existsSync(internalResolved)) {
    const counts = countLibraryFiles(internalResolved);
    components.push({
      name: 'Internal Libraries (LibrariesFolder)',
      status: 'ok',
      path: internalResolved,
      details: `Found ${counts.xmlCount} XML libraries and ${counts.b4xlibCount} .b4xlib archives.`,
    });
  } else {
    components.push({
      name: 'Internal Libraries (LibrariesFolder)',
      status: 'warning',
      details: 'Internal Libraries folder path not configured or not found.',
      recommendation: 'Configure your B4A/B4J install path to index Core, SQL, XUI, and system libraries.',
    });
  }

  // 6. Additional Libraries Check
  if (effectiveAdditionalLibs && fs.existsSync(effectiveAdditionalLibs)) {
    const counts = countLibraryFiles(effectiveAdditionalLibs);
    components.push({
      name: 'Additional Libraries (AdditionalLibrariesFolder)',
      status: 'ok',
      path: effectiveAdditionalLibs,
      details: `Found ${counts.xmlCount} XML libraries and ${counts.b4xlibCount} .b4xlib archives.`,
    });
  } else {
    components.push({
      name: 'Additional Libraries (AdditionalLibrariesFolder)',
      status: 'warning',
      details: 'Additional Libraries folder not configured or empty.',
      recommendation: 'Configure your user libraries directory to access external packages.',
    });
  }

  // Build Markdown Summary
  const lines: string[] = [];
  lines.push('# 🩺 B4X Environment Health Report (B4X Doctor)');
  lines.push(`Generated: ${new Date().toLocaleString()}\n`);

  for (const c of components) {
    const icon = c.status === 'ok' ? '✅' : c.status === 'warning' ? '⚠️' : '❌';
    lines.push(`### ${icon} ${c.name}`);
    if (c.path) lines.push(`- **Path:** \`${c.path}\``);
    if (c.details) lines.push(`- **Status:** ${c.details}`);
    if (c.recommendation) lines.push(`- **Recommendation:** ${c.recommendation}`);
    lines.push('');
  }

  const overallHealthy = components.every((c) => c.status !== 'error');

  return {
    timestamp: new Date().toISOString(),
    overallHealthy,
    components,
    markdown: lines.join('\n'),
  };
}

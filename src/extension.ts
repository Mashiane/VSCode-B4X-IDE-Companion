/**
 * # B4X IntelliSense Extension — Architecture & Flow
 *
 * ## Purpose
 * Provides IntelliSense (completion, hover, go-to-definition, signature help, etc.)
 * for B4X platform languages (B4A, B4J, B4i, B4R) in VS Code.
 *
 * ## Core Principle
 * **Nothing is assumed. Everything is factual.**
 * Only files confirmed to exist on disk are loaded into IntelliSense.
 * Only libraries explicitly declared in the project file's `LibraryN=` entries are loaded.
 * No cross-platform contamination — a .b4a project loads only B4A libraries, never B4J/B4i/B4R.
 *
 * ## Platform Flow (Step by Step)
 *
 * ```
 * 1. USER OPENS PROJECT
 *    └─ User selects a .b4a / .b4i / .b4j / .b4r file via "Open B4X Project"
 *    └─ Platform detected from file extension:
 *         .b4a → "b4a"  |  .b4j → "b4j"  |  .b4i → "b4i"  |  .b4r → "b4r"
 *
 * 2. LOAD PLATFORM INI (single platform only)
 *    └─ getPlatformSettings("b4a") — loads ONLY the detected platform's INI
 *    └─ INI path discovery order:
 *         a) VS Code setting: b4xIntellisense.b4aIniPath
 *         b) %APPDATA%\Anywhere Software\Basic4android\b4xV5.ini  (or B4J/B4i/B4R equivalent)
 *         c) Windows Registry → InstallLocation → <path>\b4xV5.ini
 *    └─ loadConfiguredPlatforms() extracts four folder paths:
 *         • LibrariesFolder         — platform's internal libraries
 *         • AdditionalLibrariesFolder — user's extra libraries
 *         • SharedModuleFolder      — shared .bas modules across projects
 *         • PlatformFolder          — SDK platform path (e.g. android-36)
 *
 * 3. PARSE PROJECT FILE
 *    └─ Scan lines BEFORE @EndOfDesignText@ for:
 *         • LibraryN=Core        → allowedLibraries = {"core", "b4xpages", ...}
 *         • ModuleN=|Relative|Main.bas  → allowedModuleBasePaths = {"/path/to/Main"}
 *    └─ Strips |relative|, |absolute|, |shared| prefixes from ModuleN values
 *    └─ Generates .vscode/b4x-main/<Project>_Main.b4x from code after @EndOfDesignText@
 *
 * 4. RESOLVE ALLOWED LIBRARIES
 *    └─ For each library in allowedLibraries:
 *         a) Search: LibrariesFolder/<lib>.xml  OR  LibrariesFolder/<lib>/<lib>.xml
 *         b) Search: AdditionalLibrariesFolder/<lib>.xml  (if configured)
 *         c) Search: <lib>.b4xlib  (if no XML found — mutually exclusive)
 *         d) fs.stat() confirms file exists — missing files logged and SKIPPED
 *    └─ Result: activePlatform.assets = { xmlFiles: [...], b4xlibFiles: [...], jarFiles: [] }
 *
 * 5. RESOLVE MODULE PATHS
 *    └─ For each ModuleN entry:
 *         a) Project-local: resolve path relative to .b4a's directory → confirm exists
 *         b) Shared fallback: resolve from SharedModuleFolder → confirm exists
 *         c) Missing modules silently skipped
 *    └─ Also collects "external" modules from libraries outside the workspace
 *
 * 6. EXTRACT b4xlib MODULES
 *    └─ For each .b4xlib in assets.b4xlibFiles:
 *         a) Extract .bas files from ZIP to cache directory
 *         b) Register extracted paths as reference modules
 *
 * 7. LOAD INTO INTELLISENSE STORES
 *    └─ xmlLibraries.replaceXmlFiles(xmlFiles)     — parse <class>/<method>/<property>
 *    └─ workspaceClasses.replaceReferenceModules() — parse .bas Subs, Globals, Types
 *    └─ commonClass.syncFrom(xmlLibraries)         — extract Common class (Log, Msgbox, etc.)
 *    └─ primitiveTypes.syncFrom(xmlLibraries)      — type mappings (String→String2, etc.)
 *
 * 8. REGISTER LANGUAGE PROVIDERS
 *    └─ Completion, Hover, Definition, SignatureHelp, References, Folding, Formatting,
 *         Rename, CodeLens, DocumentLink, SemanticTokens, etc.
 *    └─ All providers query: WorkspaceClassStore + XmlLibraryStore + CommonClassStore
 * ```
 *
 * ## What Gets Loaded (Source Map)
 *
 * | Data | Source | Condition |
 * |------|--------|-----------|
 * | Classes, Methods, Properties | XML files (Core.xml, SQL.xml, etc.) | Only if declared in LibraryN= AND exists on disk |
 * | Cross-platform modules | b4xlib files (B4XPages.b4xlib, etc.) | Only if declared in LibraryN= AND exists on disk |
 * | User Subs, Globals, Types | .bas files from ModuleN= | Only if path resolves AND file exists |
 * | Shared code | .bas from SharedModuleFolder | Only if ModuleN path not found locally AND exists in shared |
 * | Common globals (Log, Msgbox) | `Common` class inside Core.xml | Only if Core.xml was loaded |
 * | Primitive types | Type mappings in XML | Only if XML loaded |
 * | B4X keywords (If, Sub, Dim) | Hardcoded in extension | Always available |
 * | Directives (#If, #Region) | Hardcoded in extension | Always available |
 *
 * ## Graceful Degradation
 *
 * - Missing LibrariesFolder → fallback chain (registry → Program Files) → if all fail, zero libraries
 * - Missing AdditionalLibrariesFolder → only LibrariesFolder searched
 * - Missing SharedModuleFolder → only project-local modules resolved
 * - Missing library files → logged as ERROR, skipped
 * - Missing module files → silently skipped
 * - No LibraryN= entries → no libraries loaded (Core NOT auto-injected — platform-specific)
 * - No ModuleN= entries → no workspace modules indexed
 *
 * ## What This Extension Does NOT Do
 *
 * - Does NOT scan entire library folders — only declared libraries are loaded
 * - Does NOT load libraries from other platforms — strict isolation
 * - Does NOT process JAR files — no XML generation from bytecode
 * - Does NOT parse .bal (Designer layout) files — no designer view IntelliSense
 * - Does NOT assume file existence — every path is validated before loading
 *
 * ## Key Files
 *
 * | File | Role |
 * |------|------|
 * | `extension.ts` | Main entry, orchestrates flow, registers providers |
 * | `projectFile.ts` | Parses .b4a/.b4j/.b4i/.b4r for LibraryN= and ModuleN= |
 * | `platformConfig.ts` | Discovers platform INI paths (settings, auto-discovery, registry) |
 * | `platformIni.ts` | Parses b4xV5.ini for folder paths and settings |
 * | `xmlLibraryIndex.ts` | Parses XML library documents into class/method/property data |
 * | `workspaceClassIndex.ts` | Parses .bas modules into Subs, Globals, Types |
 * | `commonClassStore.ts` | Extracts Common class globals from XML (Log, Msgbox, etc.) |
 * | `primitiveTypeStore.ts` | Type mappings (String→String2, Int→Int, etc.) |
 * | `b4xTypeInference.ts` | Infers variable types from Dim declarations |
 *
 * ## Platform INI Locations (Windows)
 *
 * | Platform | Default INI Path |
 * |----------|-----------------|
 * | B4A | %APPDATA%\Anywhere Software\Basic4android\b4xV5.ini |
 * | B4J | %APPDATA%\Anywhere Software\B4J\b4xV5.ini |
 * | B4i | %APPDATA%\Anywhere Software\B4i\b4xV5.ini |
 * | B4R | %APPDATA%\Anywhere Software\B4R\b4xV5.ini |
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as cp from 'child_process';
import StreamZip from 'node-stream-zip';

import { B4xClass, B4xEventDef, B4xMethod, B4xProperty } from './types';
import { PrimitiveClassDef } from './primitiveTypeStore';

type B4xMemberEntry =
  | { kind: 'method'; item: B4xMethod }
  | { kind: 'property'; item: B4xProperty };

interface B4xMethodEntry {
  ownerClass: B4xClass;
  method: B4xMethod;
}

interface B4xPropertyEntry {
  ownerClass: B4xClass;
  property: B4xProperty;
}

import {
  getCallContext,
  getLinePrefix,
  getMemberAccessInfo,
  getMemberReferenceAtPosition,
  isCommentPosition,
  parseTypedNameList,
  getPostDesignStartLine,
} from './b4xDocParser';
import {
  inferCompletionOwnerClass,
  inferVariableTypes,
  resolveExpressionType,
} from './b4xTypeInference';
import {
  B4xLocalSymbol,
  B4xLocalTypeDefinition,
  collectLocalSymbols,
  getLocalTypeDefinition,
} from './b4xLocalSymbols';
import { getPlatformSettings, findPlatformInstallDirs } from './platformConfig';
import { loadConfiguredPlatforms, LoadedPlatformConfig, loadPlatformIni } from './platformIni';
import { getProjectRootFromProjectFile, loadWorkspaceProjectConfig, isInsideWorkspace, clearProjectConfigCache, detectPlatformFromPath, parseManifestDependsOn, getB4xProjectRoot } from './projectFile';
import { B4xPlatformName } from './platformConfig';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import { PrimitiveTypeStore } from './primitiveTypeStore';
import { CommonClassStore } from './commonClassStore';
import { libraryIndex } from './storage/libraryIndexSqlite';
import importVsSettingsFile, { tryImportThemeFromPlatformInstall } from './vssettingsImporter';
import { registerTypeDiagnostics } from './typeDiagnostics';
import { registerCallSubDiagnostics } from './callSubDiagnostics';
import TypeCodeActionProvider from './typeCodeAction';
import ExtractMethodCodeActionProvider from './extractMethodCodeAction';
import { startLanguageClient } from './lspClient';
import { sendRequest } from './lspClient';
import { registerAutoCloseKeywords } from './b4xAutoclose';
import { CommandsProvider } from './providers/commandsProvider';
import { B4xReferenceProvider } from './b4xReferenceProvider';
import { B4xFoldingRangeProvider } from './b4xFoldingRangeProvider';
import { B4xDocumentSymbolProvider } from './b4xDocumentSymbolProvider';
import { B4xWorkspaceSymbolProvider } from './b4xWorkspaceSymbolProvider';
import { B4xDocumentFormattingProvider } from './b4xDocumentFormattingProvider';
import { B4xDocumentRangeFormattingProvider } from './b4xDocumentRangeFormattingProvider';
import { B4xDocumentHighlightProvider } from './b4xDocumentHighlightProvider';
import { B4xDocumentLinkProvider } from './b4xDocumentLinkProvider';
import { B4xOnTypeFormattingProvider } from './b4xOnTypeFormattingProvider';
import { B4xSelectionRangeProvider } from './b4xSelectionRangeProvider';
import { B4xImplementationProvider } from './b4xImplementationProvider';
import { B4xTypeDefinitionProvider } from './b4xTypeDefinitionProvider';
import { B4xInlineCompletionItemProvider } from './b4xInlineCompletionProvider';
import { B4xRenameProvider } from './b4xRenameProvider';
import { B4xCodeLensProvider } from './b4xCodeLensProvider';
import { B4X_PLATFORMS, getBuilderPath, getDefaultInstallPath, getBuildArgs, needsAdb, getArtifactExt, getSupportedPlatforms } from './platformBuilders';
import { getConfiguredWinePrefix, getWineBinary, hostPathToWinePath, translateWinePathToHost } from './winePaths';
import { pathKey } from './pathUtils';
import { getB4xBooleanSetting, getB4xStringSetting } from './b4xSettings';

let pendingSuggestRequest: NodeJS.Timeout | undefined;
// Disposable handle for the running language client (if started)
let lspClientDisposable: vscode.Disposable | undefined;

// Magic string constants for globalState keys
const GLOBAL_STATE_LAST_PROJECT_FILE = 'b4x.lastOpenedProjectFile';
const GLOBAL_STATE_LAST_PROJECT_PLATFORM = 'b4x.lastOpenedProjectPlatform';
const GLOBAL_STATE_HAS_BUILDABLE = 'b4x.hasBuildableProject';
const GLOBAL_STATE_SYSTEM_INI = 'b4x.systemIni';
const GLOBAL_STATE_LAST_STATUS = 'b4x.lastStatus';

// Extension context reference (set during activate) — used for persisting UI state.
let extContext: vscode.ExtensionContext | undefined;

/**
 * Prompts the user to pick a workspace folder when multiple are open.
 * Returns undefined if no workspace is open or user cancels.
 */
async function pickWorkspaceFolder(placeholder: string): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('No workspace folder is open. Open a B4X workspace and try again.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const pick = await vscode.window.showQuickPick(folders.map((f) => f.name), { placeHolder: placeholder });
  if (!pick) return undefined;
  return folders.find((f) => f.name === pick) ?? folders[0];
}

/**
 * Resolve the ffmpeg executable path.
 * Resolution order:
 *  1. Extension setting b4xIntellisense.ffmpegPath
 *  2. Common install locations (WinGet, C:\ffmpeg\bin, Program Files)
 *  3. Prompt the user to select it and persist to workspace setting
 * Returns the resolved path, or an empty string if the user cancels.
 */
async function resolveFfmpegPath(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
  const fromSetting = cfg.get<string>('ffmpegPath', '') ?? '';
  if (fromSetting && fs.existsSync(fromSetting)) return fromSetting;

  const ffCandidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  for (const c of ffCandidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  const filters: Record<string, string[]> = process.platform === 'win32'
    ? { 'Executables': ['exe'] }
    : { 'All Files': [''] };
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Select ffmpeg executable',
    filters,
  });
  if (pick?.[0]) {
    const chosen = pick[0].fsPath;
    await cfg.update('ffmpegPath', chosen, vscode.ConfigurationTarget.Workspace);
    return chosen;
  }
  return '';
}

/**
 * Resolve the adb executable path.
 * Resolution order:
 *  1. Android SDK platform-tools derived from the active platform INI (PlatformFolder key)
 *  2. Extension setting b4xIntellisense.adbPath
 *  3. Prompt the user to select it and persist to workspace setting
 * Returns the resolved path, or an empty string if the user cancels.
 */
async function resolveAdbPath(context: vscode.ExtensionContext): Promise<string> {
  // 1. Derive from the last opened project's platform INI
  try {
    const lastPlatform = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_PLATFORM);
    if (lastPlatform) {
      const platformSettings = getPlatformSettings(lastPlatform as any);
      const loaded = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
      const preferred = loaded[0];
      if (preferred?.iniPath) {
        const iniRaw = fs.readFileSync(preferred.iniPath, 'utf8');
        const m = iniRaw.match(/^[ \t]*PlatformFolder[ \t]*=[ \t]*(.+)$/im);
        if (m?.[1]) {
          const sdkRoot = path.normalize(path.join(m[1].trim(), '..', '..'));
          const candidate = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  } catch { /* ignore */ }

  // 2. Extension setting
  const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
  const fromSetting = cfg.get<string>('adbPath', '') ?? '';
  if (fromSetting && fs.existsSync(fromSetting)) return fromSetting;

  // 3. Prompt user
  const filters: Record<string, string[]> = process.platform === 'win32'
    ? { 'Executables': ['exe'] }
    : { 'All Files': [''] };
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Select adb executable',
    filters,
  });
  if (pick?.[0]) {
    const chosen = pick[0].fsPath;
    await cfg.update('adbPath', chosen, vscode.ConfigurationTarget.Workspace);
    return chosen;
  }
  return '';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function buildAndRunB4JWithWine(
  installDir: string,
  projectFilePath: string,
): Promise<void> {
  const builderHostPath = getBuilderPath('B4J', installDir);
  if (!fs.existsSync(builderHostPath)) {
    throw new Error(`B4JBuilder.exe not found at ${builderHostPath}`);
  }

  const prefix = getConfiguredWinePrefix();
  if (!prefix || !fs.existsSync(prefix)) {
    throw new Error('Wine prefix not found. Configure b4xIntellisense.wine.prefix first.');
  }

  const projectDir = path.dirname(projectFilePath);
  const projectFileWin = hostPathToWinePath(projectFilePath);
  const projectDirWin = hostPathToWinePath(projectDir);
  const wineBinary = getWineBinary();
  const javaCommand = getB4xStringSetting('b4jJavaPath', '').trim() || 'java';
  const jarName = `${path.basename(projectFilePath, path.extname(projectFilePath))}.jar`;
  const jarPath = path.join(projectDir, 'Objects', jarName);
  const runAfterBuild = getB4xBooleanSetting('b4jRunAfterBuild', true);

  const term = vscode.window.createTerminal({ name: 'B4X Build (B4J Wine)', cwd: installDir });
  term.show(true);

  const lines = [
    `export WINEPREFIX=${shellQuote(prefix)}`,
    `cd ${shellQuote(installDir)}`,
    `${shellQuote(wineBinary)} ${shellQuote(builderHostPath)} -Task=Build -BaseFolder=${shellQuote(projectDirWin)} -Project=${shellQuote(projectFileWin)}`,
  ];

  if (runAfterBuild) {
    lines.push(
      `if [ -f ${shellQuote(jarPath)} ]; then ${shellQuote(javaCommand)} -jar ${shellQuote(jarPath)}; else echo 'B4X: jar not found after build: ${jarName}'; fi`,
    );
  }

  term.sendText(lines.join('\n'), true);
}
// Track current project scope so workspace scanner only runs for the opened project
let currentProjectDirectory: string | undefined;
let currentAllowedModuleBasePaths: ReadonlySet<string> | undefined;
let currentAllowedLibraries: ReadonlySet<string> | undefined;
// Tracks the last set of b4xlib files discovered/loaded for the opened project
let lastLoadedB4xlibFiles: string[] = [];

// Pre-scanned .b4xtemplate files discovered at activation time.
// Populated once during activate(), read instantly when "New B4X Project from Template" runs.
let cachedTemplates: { path: string; name: string; platform: string }[] = [];

// Promise that resolves when template scanning completes, so callers can await it.
let templateScanComplete: Promise<void>;
let templateScanResolve: () => void = () => {};

// Initialize the promise
templateScanComplete = new Promise<void>((resolve) => {
  templateScanResolve = resolve;
});

// Output channel for debugging and command success/failure tracing
const outputChannel = vscode.window.createOutputChannel('B4X IntelliSense');

// Persistent status bar item — shows numbered step progress during project-open,
// then a steady summary when idle.
const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
statusBarItem.name = 'B4X IntelliSense';
statusBarItem.text = '$(symbol-misc) B4X';
statusBarItem.tooltip = 'B4X IntelliSense';
statusBarItem.show();

/**
 * Updates the GLOBAL_STATE_HAS_BUILDABLE context key based on workspace contents.
 * This controls whether the Build & Install command is visible/enabled.
 */
function updateBuildCommandContext(): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.commands.executeCommand('setContext', GLOBAL_STATE_HAS_BUILDABLE, false);
    return;
  }

  // Check for B4A/B4J project files in workspace
  const buildableExts = ['.b4a', '.b4j'];
  let hasBuildable = false;

  for (const folder of folders) {
    try {
      const files = fs.readdirSync(folder.uri.fsPath);
      
      // Check root for .b4a/.b4j files
      if (files.some(f => buildableExts.some(ext => f.toLowerCase().endsWith(ext)))) {
        hasBuildable = true;
        break;
      }
      
      // Check for B4A/B4J subfolders with project files
      const supportedPlatforms = getSupportedPlatforms();
      for (const platformKey of supportedPlatforms) {
        const platformConfig = B4X_PLATFORMS[platformKey];
        if (!platformConfig) continue;
        
        const platformFolder = path.join(folder.uri.fsPath, platformConfig.folder);
        if (fs.existsSync(platformFolder)) {
          const platformFiles = fs.readdirSync(platformFolder);
          if (platformFiles.some(f => f.toLowerCase().endsWith(platformConfig.ext))) {
            hasBuildable = true;
            break;
          }
        }
      }
      
      if (hasBuildable) break;
    } catch {
      // Ignore folder read errors
    }
  }

  void vscode.commands.executeCommand('setContext', GLOBAL_STATE_HAS_BUILDABLE, hasBuildable);
}

// Generation counter to prevent stale step trackers from updating the status bar.
// Each createStepTracker() captures the current generation — if a newer tracker is
// created (e.g. user invokes openB4xProject while activation reload is running),
// the older tracker's writes become no-ops.
let statusBarGeneration = 0;

/** Lightweight step tracker for numbered status-bar progress.
 *  Each tracker captures a generation — if a newer tracker is created the older
 *  one silently stops writing to the status bar so two concurrent flows don't
 *  stomp on each other. */
function createStepTracker(totalSteps: number) {
  const myGen = ++statusBarGeneration;
  let current = 0;
  const isActive = () => myGen === statusBarGeneration;
  return {
    /** Advance to the next step and update the status bar with a spinner. */
    step(message: string): void {
      current = Math.min(current + 1, totalSteps);
      trace(`statusBar ${current}/${totalSteps}: ${message}`);
      if (!isActive()) { return; }
      statusBarItem.text = `$(sync~spin) B4X ${current}/${totalSteps}: ${message}`;
      statusBarItem.tooltip = `B4X IntelliSense — ${message} (step ${current} of ${totalSteps})`;
      try {
        void extContext?.globalState.update(GLOBAL_STATE_LAST_STATUS, { text: statusBarItem.text, tooltip: statusBarItem.tooltip, step: current, total: totalSteps, gen: myGen });
      } catch { /* best-effort persistence */ }
    },
    /** Show a successful completion state (no spinner). */
    done(message: string): void {
      trace(`statusBar done: ${message}`);
      if (!isActive()) { return; }
      statusBarItem.text = `$(check) B4X: ${message}`;
      statusBarItem.tooltip = `B4X IntelliSense — ${message}`;
      try {
        void extContext?.globalState.update(GLOBAL_STATE_LAST_STATUS, { text: statusBarItem.text, tooltip: statusBarItem.tooltip, step: totalSteps, total: totalSteps, gen: myGen });
      } catch { /* best-effort persistence */ }
    },
    /** Show an error state. */
    error(message: string): void {
      trace(`statusBar error: ${message}`);
      if (!isActive()) { return; }
      statusBarItem.text = `$(error) B4X: ${message}`;
      statusBarItem.tooltip = `B4X IntelliSense — Error: ${message}`;
      try {
        void extContext?.globalState.update(GLOBAL_STATE_LAST_STATUS, { text: statusBarItem.text, tooltip: statusBarItem.tooltip, step: current, total: totalSteps, gen: myGen, error: true });
      } catch { /* best-effort persistence */ }
    },
  };
}

// Trace helper: writes timestamped entries to the extension output channel and console.
function trace(...args: unknown[]): void {
  try {
    const prefix = `[B4X DEBUG ${new Date().toISOString()}]`;
    outputChannel.appendLine(`${prefix} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    console.log(prefix, ...args);
  } catch {
    // ignore
  }
}

/**
 * Run an async function and show a status-bar spinner if it takes longer than `showAfterMs`.
 * Restores the previous status text after completion. Best-effort UI updates only.
 */
async function runWithStatus<T>(
  label: string,
  fn: () => Promise<T>,
  steps?: ReturnType<typeof createStepTracker>,
  showAfterMs = 300,
): Promise<T> {
  const prev = statusBarItem?.text ?? '$(symbol-misc) B4X';
  let shown = false;
  let stepStarted = false;
  let timer: NodeJS.Timeout | undefined;

  // If a step tracker was provided, advance it immediately so the status bar
  // shows deterministic step counts (1/10, 2/10, ...). When no tracker is
  // provided, fall back to the previous delayed spinner behavior.
  if (steps) {
    try {
      steps.step(label);
      stepStarted = true;
    } catch {
      /* best-effort */
    }
  } else {
    timer = setTimeout(() => {
      try {
        statusBarItem.text = `$(sync~spin) B4X: ${label}`;
        statusBarItem.show();
        shown = true;
      } catch {
        /* best-effort */
      }
    }, showAfterMs);
  }

  const start = Date.now();
  try {
    const res = await fn();
    const dur = Date.now() - start;
    if (timer) clearTimeout(timer);
    try {
      // If a step tracker is active, the tracker manages the status bar.
      // Only restore the previous text if we were using the standalone spinner.
      if (shown && !steps) statusBarItem.text = prev;
    } catch {}
    if (dur > 2000) {
      trace('longOp', { label, duration: dur });
      try {
        outputChannel.appendLine(`[B4X LONGOP ${new Date().toISOString()}] ${label} took ${dur}ms`);
        const stack = new Error().stack;
        if (stack) outputChannel.appendLine(stack);
      } catch { /* ignore */ }
    }
    return res;
  } catch (err) {
    if (timer) clearTimeout(timer);
    try {
      if (stepStarted) steps?.error(label);
      if (shown && !steps) statusBarItem.text = prev;
    } catch {}
    throw err;
  }
}

// Extract .bas module files from a .b4xlib archive using node-stream-zip.
// PowerShell Expand-Archive rejects non-.zip extensions, so we use the same
// library that B4xLibStore uses.  Returns absolute paths to extracted module files.
async function extractModulesFromB4xlib(archivePath: string): Promise<string[]> {
  const cacheBase = libraryIndex.getCacheDir();
  const nameSafe = path.basename(archivePath).replace(/[^a-z0-9\.\-_]/gi, '_');
  // Async stat — used both for the cache-dir name and later for DB registration.
  const archiveStat = await fs.promises.stat(archivePath).catch(() => undefined);
  const outDir = path.join(cacheBase, `${nameSafe}_${Math.floor(archiveStat ? archiveStat.mtimeMs : Date.now())}`);
  try {
    await fs.promises.mkdir(outDir, { recursive: true });
  } catch {
    return [];
  }

  // Use node-stream-zip to extract .bas entries (works regardless of file extension).
  const zip = new StreamZip({ file: archivePath, storeEntries: true });
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('ready', () => resolve());
      zip.on('error', (err: Error) => reject(err));
    });

    const entries = zip.entries();
    for (const entryName of Object.keys(entries)) {
      const entry = entries[entryName];
      if (!entry || entry.isDirectory) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.bas') continue;
      const outPath = path.join(outDir, entry.name.replace(/\\/g, '/'));
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      const data = zip.entryDataSync(entry.name);
      await fs.promises.writeFile(outPath, data);
    }
  } finally {
    await new Promise<void>((resolve) => zip.close(resolve));
  }

  // Recursively find .bas and .b4x files in the extracted folder
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[] = [] as unknown as fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry: any) => {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
        return;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.bas') {
        result.push(p);
      }
    }));
  }

  await walk(outDir);
  // Guard against zip entries that may have written files outside outDir (defense-in-depth).
  const resolvedOutDir = path.resolve(outDir);
  const safeResult = result.filter(p => path.resolve(p).startsWith(resolvedOutDir + path.sep));

  // Register extracted files in DB for this archive — reuse the already-fetched archiveStat.
  try {
    const inner = [] as any[];
    for (const p of safeResult) {
      const rel = path.relative(outDir, p);
      const s = await fs.promises.stat(p).catch(() => undefined);
      if (s) inner.push({ relPath: rel, absPath: p, mtime: Math.floor(s.mtimeMs), size: s.size });
    }
    await (async () => {
      try {
        libraryIndex.upsertB4xlibArchive(archivePath, archiveStat ? Math.floor(archiveStat.mtimeMs) : Date.now(), outDir, inner);
      } catch (err) {
        console.warn('B4X: failed to upsert b4xlib archive info', archivePath, err);
      }
    })();
  } catch { /* ignore */ }

  return safeResult;
}
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  trace('activate.enter');
  // Capture extension context for helpers that need persistent storage
  extContext = context;
  // Create workspace class store without performing an initial full refresh at activation.
  // The store will be populated later on-demand via `refresh()` or `replaceReferenceModules()`.
  const workspaceClasses = new WorkspaceClassStore();
  const xmlLibraries = new XmlLibraryStore();
  const primitiveTypes = new PrimitiveTypeStore();
  const commonClass = new CommonClassStore();

  // Ensure the persistent status bar item is disposed when the extension deactivates.
  context.subscriptions.push(statusBarItem, outputChannel);

  // Restore last known status text (best-effort) so user sees persisted UI across restarts
  try {
    const last = context.globalState.get<any>(GLOBAL_STATE_LAST_STATUS);
    if (last && last.text) {
      // If the persisted status looks like an in-progress/loading message
      // (spinner or 'Loading' text), treat it as stale on activation and
      // replace with a Ready state so users don't see an unfinished spinner
      // after the extension host restarts.
      const looksInProgress = /sync~spin|loading|scanning|loading xml/i.test(last.text);
      if (looksInProgress) {
        statusBarItem.text = '$(check) B4X: Ready';
        statusBarItem.tooltip = 'B4X IntelliSense — Ready';
        try { void extContext?.globalState.update(GLOBAL_STATE_LAST_STATUS, { text: statusBarItem.text, tooltip: statusBarItem.tooltip }); } catch {}
      } else {
        statusBarItem.text = last.text;
        if (last.tooltip) statusBarItem.tooltip = last.tooltip;
      }
      statusBarItem.show();
    }
  } catch { /* ignore */ }

  // Status click handler is registered later (showStatusSummary)

  // Initialize the global library index database in the extension global storage.
  try {
    const storageBase = context.globalStorageUri?.fsPath;
    if (storageBase) {
      libraryIndex.init(storageBase);
      console.log('B4X: initialized libraryIndex at', storageBase);
    } else {
      libraryIndex.init();
      console.log('B4X: initialized libraryIndex at default location');
    }
  } catch (err) {
    console.warn('B4X: failed to initialize libraryIndex', err);
  }
  // Do not assume a project is "opened" at activation time. We must wait for the
  // user to explicitly select/open a B4X project via the command before performing
  // heavy initialization (watchers, full platform reload, LSP) or applying INI/theme.
  const lastProjectFile = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE);

  if (lastProjectFile && fs.existsSync(lastProjectFile)) {
    const folders = vscode.workspace.workspaceFolders;
    const isWorkspaceEmpty = !folders || folders.length === 0;
    const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
    const autoRestore = cfg.get<boolean>('autoRestoreWorkspace', true);

    if (isWorkspaceEmpty && autoRestore) {
      console.log('B4X: Auto-restoring workspace for', lastProjectFile);
      void (async () => {
        try {
          const workspaceRoot = await determineWorkspaceRoot(lastProjectFile, []);
          ensureWorkspaceFolder(vscode.Uri.file(workspaceRoot));
        } catch (err) {
          console.error('B4X: Failed to auto-restore workspace', err);
        }
      })();
      // Don't return early — continue with activation so commands and views
      // are registered even in an empty window. The auto-restore will trigger
      // a workspace folder change which may restart the extension host, but
      // we still need to register everything in case that restart doesn't happen.
    }
  }

  // Use globalState (survives workspace-folder changes that restart the extension
  // host).  Guard with fs.existsSync *and* verify the file is actually inside
  // one of the current workspace folders.  Without the workspace-folder check
  // the extension would fully load IntelliSense (libraries, LSP, theme, etc.)
  // every time VS Code opens — even in empty/unrelated workspaces — because
  // globalState persists across all windows.
  const isProjectInWorkspace = (() => {
    if (!lastProjectFile) return false;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return false;
    const normProject = pathKey(lastProjectFile);
    return folders.some(f => normProject.startsWith(`${pathKey(f.uri.fsPath)}/`));
  })();
  const hasOpenedProject = isProjectInWorkspace && fs.existsSync(lastProjectFile!);
  // Sync generated Main .b4x edits back to the B4X project file (content after @EndOfDesignText@)
  const syncGeneratedMainBack = async (document: vscode.TextDocument): Promise<void> => {
    try {
      const genPath = document.uri.fsPath;
      if (!genPath.toLowerCase().includes(`${path.sep}.vscode${path.sep}b4x-main${path.sep}`)) return;

      const genDir = path.dirname(genPath);
      const projectDir = path.resolve(path.join(genDir, '..', '..'));

      // Look for B4X project files in platform subfolders
      let candidates: string[] = [];
      try {
        for (const platform of ['B4A', 'B4i', 'B4J', 'B4R']) {
          const platformFolder = path.join(projectDir, platform);
          const entries = await fs.promises.readdir(platformFolder).catch(() => [] as string[]);
          const found = entries
            .filter((n: string) => /\.(b4a|b4i|b4j|b4r)$/i.test(n))
            .map((n: string) => path.join(platformFolder, n));
          candidates.push(...found);
        }
      } catch {
        candidates = [];
      }

      if (candidates.length === 0) {
        // Do not perform workspace-wide search; assume project file lives in a platform subfolder.
        candidates = [];
      }

      if (candidates.length === 0) {
        return;
      }

      const target = candidates[0];
      const marker = '@EndOfDesignText@';
      const orig = await fs.promises.readFile(target!, 'utf8');
      const idx = orig.indexOf(marker);
      const newMain = document.getText();
      let outText: string;
      if (idx === -1) {
        outText = orig + '\r\n' + marker + '\r\n' + newMain;
      } else {
        outText = orig.substring(0, idx + marker.length) + '\r\n' + newMain;
      }

      // create a timestamped backup of the project file before overwriting
      try {
        const now = new Date();
        const stamp = now.toISOString().replace(/[:]/g, '-').replace(/T/, '_').split('.')[0];
        const backupPath = `${target}.bak-${stamp}`;
        await fs.promises.copyFile(target!, backupPath);
      } catch (err) {
        // If backup fails, do NOT overwrite the project file to avoid data loss
        console.warn('B4X: failed to create project file backup, skipping sync', err);
        return;
      }

      await fs.promises.writeFile(target!, outText, 'utf8');
      void vscode.window.showInformationMessage(`B4X: Synced Main content back to ${path.basename(target!)} (backup created)`);
    } catch (err) {
      console.warn('B4X: failed to sync generated Main back to project file', err);
    }
  };

  // Apply persisted system INI values (auto-save, format hints, fonts).
  // This was extracted from `reloadPlatformAssets` so callers can invoke
  // INI/theme application independently of the full platform reload.
  const applyPersistedSystemIniSettings = async (): Promise<void> => {
    // trace('applyPersistedSystemIniSettings.enter');
    try {
      const systemSettings = context.globalState.get<any>(GLOBAL_STATE_SYSTEM_INI);
      const hasOpenedProject = Boolean(context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE));
      if (!systemSettings || !hasOpenedProject) {
        // trace('applyPersistedSystemIniSettings.exit.noop');
        return;
      }
      try {
        const hasWorkspaceFolder = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
        if (!hasWorkspaceFolder) {
          // console.log('B4X: skipping AutoSave/AutoFormat apply — no workspace folder registered yet');
        } else {
          if (systemSettings.autoSave) {
            const filesCfg = vscode.workspace.getConfiguration('files');
            await filesCfg.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Workspace);
            // console.log('B4X: enabled workspace files.autoSave=afterDelay per system INI');
          }

          if (systemSettings.autoFormat) {
            const editorCfg = vscode.workspace.getConfiguration('editor');
            await editorCfg.update('formatOnSave', true, vscode.ConfigurationTarget.Workspace);
            // console.log('B4X: enabled workspace editor.formatOnSave per system INI');
          }
        }
      } catch (err) {
        console.warn('B4X: failed to apply AutoSave/AutoFormat from system INI', err);
      }

      try {
        const doApplyFont = async () => {
          const editorCfg = vscode.workspace.getConfiguration('editor');
          if (systemSettings.fontName2) {
            await editorCfg.update('fontFamily', systemSettings.fontName2, vscode.ConfigurationTarget.Workspace);
          }
          if (typeof systemSettings.fontSize2 === 'number') {
            await editorCfg.update('fontSize', systemSettings.fontSize2, vscode.ConfigurationTarget.Workspace);
          }
          trace('applyPersistedSystemIniSettings.fontApplied', { fontName2: systemSettings.fontName2, fontSize2: systemSettings.fontSize2 });
        };

        if (systemSettings.fontName2 || typeof systemSettings.fontSize2 === 'number') {
          // Always apply font hints silently — this function is only called during
          // project-open or activation-reload flows where the user has already
          // committed to loading a B4A project.
          await doApplyFont();
        }
      } catch (err) {
        console.warn('B4X: failed to apply font hints from system INI during reload', err);
      }
    } catch (err) {
      console.warn('B4X: error applying system INI during platform reload', err);
    }
    // trace('applyPersistedSystemIniSettings.exit');
  };

  // Apply platform INI-derived theme/font hints (prefer the opened project's platform). Extracted
  // from `reloadPlatformAssets` to allow explicit invocation when desired.
  const applyPlatformIniHints = async (loadedPlatforms: Awaited<ReturnType<typeof loadConfiguredPlatforms>>): Promise<void> => {
    // trace('applyPlatformIniHints.enter');
    try {
      // Prefer the opened project's platform, fall back to first loaded platform
      const lastPlatform = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_PLATFORM);
      const preferredPlatform = loadedPlatforms.find((p) => p.platform === lastPlatform) ?? loadedPlatforms[0];
      const settings = preferredPlatform?.settings;
      if (settings) {
        const doApply = async () => {
          const editorCfg = vscode.workspace.getConfiguration('editor');
          if (settings.fontName2) {
            await editorCfg.update('fontFamily', settings.fontName2, vscode.ConfigurationTarget.Workspace);
          }
          if (settings.fontSize2 !== undefined) {
            await editorCfg.update('fontSize', settings.fontSize2, vscode.ConfigurationTarget.Workspace);
          }

          const themeName = settings.codeTheme ?? settings.ideTheme2;
          if (themeName) {
            try {
              const workbenchCfg = vscode.workspace.getConfiguration();
              await workbenchCfg.update('workbench.colorTheme', themeName, vscode.ConfigurationTarget.Workspace);
              trace('applyPlatformIniHints.themeApplied', themeName);
            } catch (err) {
              console.warn('B4X: failed to apply workbench.theme from INI', err);
            }
          }
        };

        // Apply platform INI font/theme hints silently — this function is only
        // called during project-open or activation-reload flows.
        await doApply();
        try {
          // Use the preferred platform's install path setting
          const platformKey = preferredPlatform?.platform ?? 'b4a';
          const installPathSetting = `${platformKey}InstallPath`;
          const installPath = vscode.workspace.getConfiguration('b4xIntellisense').get<string>(installPathSetting);
          const themeHint = settings.codeTheme ?? settings.ideTheme2 ?? '';
          if (installPath && themeHint) {
            const found = await tryImportThemeFromPlatformInstall(installPath, themeHint);
            if (found) {
              try {
                await importVsSettingsFile(vscode.Uri.file(found), true);
              } catch (impErr) {
                console.warn('B4X: failed to auto-import theme', impErr);
              }
            }
          }
        } catch (err) {
          console.warn('B4X: theme import attempt failed', err);
        }
      }
    } catch (err) {
      console.warn('B4X: failed to apply font/theme from platform INI', err);
    }
    // trace('applyPlatformIniHints.exit');
  };

  /**
   * Reload all platform assets for the currently opened project.
   * Reads the project file, resolves libraries and modules, loads XML/b4xlib
   * files, extracts b4xlib modules, syncs common classes and primitive types,
   * and refreshes the workspace class index.
   *
   * @param opts Options — if `{ applyIniOnly: true }`, returns after INI/theme
   *   application (used by the activation reload path).
   * @param steps Optional step tracker for status bar updates.
   */
  async function reloadPlatformAssets(
    opts?: { applyIniOnly?: boolean },
    steps?: ReturnType<typeof createStepTracker>,
  ): Promise<void> {
    trace('reloadPlatformAssets.enter', { applyIniOnly: opts?.applyIniOnly });
    steps?.step('Discovering platforms...');

    // If caller requested only INI/theme application, stop here.
    if (opts?.applyIniOnly) {
      return;
    }

    // ── Step 1: Which platform? — detect from project file extension ──
    const activeDocumentUri = (() => {
      const lastOpened = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE);
      if (lastOpened) return vscode.Uri.file(lastOpened);
      return vscode.window.activeTextEditor?.document.uri;
    })();

    const firstPass = await loadWorkspaceProjectConfig([], activeDocumentUri);
    const activePlatformName = firstPass.platform;
    if (!activePlatformName) {
      console.error('[B4X ERROR] No platform detected from project file');
      trace('reloadPlatformAssets.noActivePlatform — no platform name from project file');
      steps?.error('No platform detected');
      return;
    }

    // ── Step 2: Find install folder from registry → define internal libraries folder ──
    const platformDirCandidates: Record<string, string[]> = {
      b4a: ['B4A', 'Basic4android'],
      b4j: ['B4J'],
      b4i: ['B4i'],
      b4r: ['B4R'],
    };

    let internalLibrariesFolder: string | undefined;
    const regDirs = findPlatformInstallDirs();
    const regPlatformDir = regDirs[activePlatformName];
    if (regPlatformDir) {
      internalLibrariesFolder = path.join(regPlatformDir, 'Libraries');
    } else {
      const installPathSetting = `${activePlatformName}InstallPath`;
      const cfgInstallRaw = getB4xStringSetting(installPathSetting, '');
      const cfgInstall = translateWinePathToHost(cfgInstallRaw) ?? cfgInstallRaw;
      const programFilesBases = [
        cfgInstall.trim(),
        translateWinePathToHost('C:\\Program Files\\Anywhere Software') ?? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anywhere Software'),
        translateWinePathToHost('C:\\Program Files (x86)\\Anywhere Software') ?? path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Anywhere Software'),
      ].filter(Boolean);
      const dirs = platformDirCandidates[activePlatformName] ?? [activePlatformName];
      for (const base of programFilesBases) {
        const candidates = [
          path.join(base, 'Libraries'),
          ...dirs.map((dirName) => path.join(base, dirName, 'Libraries')),
        ];
        for (const candidate of candidates) {
          try {
            if (fs.existsSync(candidate)) { internalLibrariesFolder = candidate; break; }
          } catch { /* ignore */ }
        }
        if (internalLibrariesFolder) break;
      }
      if (!internalLibrariesFolder) {
        const fallbackBase = translateWinePathToHost('C:\\Program Files\\Anywhere Software')
          ?? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anywhere Software');
        internalLibrariesFolder = path.join(fallbackBase, dirs[0] ?? activePlatformName, 'Libraries');
      }
    }

    // ── Step 3: Find INI file ──
    steps?.step('Loading platform INI...');
    const platformSettings = getPlatformSettings(activePlatformName);
    trace('reloadPlatformAssets.configuredPlatforms', platformSettings.configuredPlatforms.map(p => `${p.platform}=${p.iniPath}`));
    const loadedPlatforms = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
    
    steps?.step('Applying INI settings...');
    try {
      // Apply persisted system INI settings (auto-save, fonts)
      await applyPersistedSystemIniSettings();
      // Apply platform INI theme/font hints
      await applyPlatformIniHints(loadedPlatforms);
    } catch (iniErr) {
      console.warn('B4X: failed to apply INI settings during reload', iniErr);
    }

    let activePlatform: LoadedPlatformConfig;
    if (!loadedPlatforms || loadedPlatforms.length === 0) {
      // If the platform INI cannot be found, fall back to a minimal platform
      // configuration using the inferred internal libraries folder so we can
      // continue scanning workspace modules and any libraries that exist on disk.
      console.warn(`[B4X WARN] Platform INI not found for '${activePlatformName}', falling back to defaults.`);
      trace('reloadPlatformAssets.noPlatforms — INI failed to load; using fallback');
      activePlatform = {
        platform: activePlatformName,
        iniPath: '',
        folders: {
          librariesFolder: internalLibrariesFolder,
          additionalLibrariesFolder: undefined,
          sharedModulesFolder: undefined,
          platformFolder: undefined,
        },
        assets: { xmlFiles: [], b4xlibFiles: [], jarFiles: [] },
      };
    } else {
      activePlatform = loadedPlatforms[0]!;
    }

    if (activePlatform.folders.librariesFolder) {
      internalLibrariesFolder = activePlatform.folders.librariesFolder;
    }

    // ── Step 4: Parse INI → additional libraries, shared modules, platform folder ──
    const additionalLibrariesFolder = activePlatform.folders.additionalLibrariesFolder;
    const sharedModulesFolder = activePlatform.folders.sharedModulesFolder;
    const platformFolder = activePlatform.folders.platformFolder;

    trace('reloadPlatformAssets.folders', {
      internalLibrariesFolder,
      additionalLibrariesFolder,
      sharedModulesFolder,
      platformFolder,
    });

    // ── Resolve project config using shared modules folder from INI ──
    const sharedModuleFolders = sharedModulesFolder ? [sharedModulesFolder] : [];
    console.log(`[B4X DEBUG] reloadPlatformAssets: calling loadWorkspaceProjectConfig with sharedModuleFolders:`, sharedModuleFolders);
    
    steps?.step('Resolving project config...');
    const projectConfig = await loadWorkspaceProjectConfig(sharedModuleFolders, activeDocumentUri);
    let allowedLibraries = projectConfig.allowedLibraries;
    const allowedModules = projectConfig.allowedModuleBasePaths;
    
    // Explorer filtering is opt-in. Always clear stale per-file exclusions first
    // so Linux/Wine users can still see and edit project files even when module
    // resolution is incomplete.
    if (projectConfig.projectFilePath) {
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const filterExplorerFiles = cfg.get<boolean>('filterExplorerFiles', false);
      if (filterExplorerFiles && projectConfig.allowedModuleFiles && projectConfig.allowedModuleFiles.length > 0) {
        void applyExplorerFilter(projectConfig.projectFilePath, projectConfig.allowedModuleFiles);
      } else {
        void resetExplorerFilter(projectConfig.projectFilePath);
      }
    }
    
    console.log(`[B4X DEBUG] reloadPlatformAssets: projectConfig loaded`, {
      allowedLibraries: allowedLibraries ? Array.from(allowedLibraries) : [],
      allowedModules: allowedModules ? Array.from(allowedModules) : [],
      projectDirectory: projectConfig.projectDirectory,
    });

    // Resolve b4xlib dependencies
    if (allowedLibraries && allowedLibraries.size > 0) {
      steps?.step('Resolving b4xlib dependencies...');
      allowedLibraries = await resolveB4xlibDependencies(allowedLibraries, activePlatformName, activePlatform);
    }

    // Store current project scope for watcher handlers
    currentAllowedModuleBasePaths = allowedModules;
    currentAllowedLibraries = allowedLibraries;
    currentProjectDirectory = projectConfig.projectDirectory;

    // ── Scan workspace modules ──
    steps?.step('Scanning workspace modules...');
    await runWithStatus(
      'Scanning workspace modules',
      async () => await workspaceClasses.refresh(currentAllowedModuleBasePaths, projectConfig.allowedModuleFiles),
      steps,
    );

    // ── Scan library folders for declared libraries ──
    const searchFolders = [internalLibrariesFolder, ...(additionalLibrariesFolder ? [additionalLibrariesFolder] : [])];

    if (allowedLibraries && allowedLibraries.size > 0) {
      const libs = Array.from(allowedLibraries);
      const matchedXml: string[] = [];
      const matchedB4xlib: string[] = [];

      for (const lib of libs) {
        let foundXml = false;
        let foundB4xlib = false;

        for (const folder of searchFolders) {
          const resolved = await resolveLibraryAssetPath(folder, lib, '.xml');
          if (resolved) {
            matchedXml.push(resolved);
            foundXml = true;
            break;
          }
        }

        for (const folder of searchFolders) {
          const resolved = await resolveLibraryAssetPath(folder, lib, '.b4xlib');
          if (resolved) {
            matchedB4xlib.push(resolved);
            foundB4xlib = true;
            break;
          }
        }

        if (!foundXml && !foundB4xlib) {
          console.error(`[B4X ERROR] library '${lib}' -> NOT FOUND (searched: ${searchFolders.join(', ')})`);
        }
      }

      activePlatform.assets.xmlFiles = dedupePaths(matchedXml);
      activePlatform.assets.b4xlibFiles = dedupePaths(matchedB4xlib);
      activePlatform.assets.jarFiles = [];
    } else {
      console.log(`[B4X TRACE] platform=${activePlatformName} -> skipped library scan (no allowedLibraries)`);
    }

    steps?.step('Scanning library folders...');

    // Read asset lists directly from the single active platform.
    const platformXmlFiles = activePlatform.assets.xmlFiles;
    const platformB4xlibFiles = activePlatform.assets.b4xlibFiles;

    // Validate file existence before attempting to load — skip anything that doesn't exist.
    const existingXml = platformXmlFiles.filter(f => fs.existsSync(f));
    const missingXml = platformXmlFiles.filter(f => !fs.existsSync(f));
    const existingB4xlib = platformB4xlibFiles.filter(f => fs.existsSync(f));
    const missingB4xlib = platformB4xlibFiles.filter(f => !fs.existsSync(f));
    
    steps?.step('Extracting b4xlib modules...');
    if (missingXml.length > 0) {
      console.error(`[B4X ERROR] ${missingXml.length} XML files not found on disk, skipped:`, missingXml.map(f => `${path.basename(f)} at ${f}`));
    }
    if (missingB4xlib.length > 0) {
      console.error(`[B4X ERROR] ${missingB4xlib.length} b4xlib files not found on disk, skipped:`, missingB4xlib.map(f => `${path.basename(f)} at ${f}`));
    }

    const allXmlFiles = [...existingXml];

    // Extract .bas modules from .b4xlib archives
    const extractedExternalModules: string[] = [];
    await runWithStatus(`Extracting modules from ${existingB4xlib.length} b4xlib(s)`, async () => {
      for (const f of existingB4xlib) {
        try {
          const mods = await extractModulesFromB4xlib(f);
          if (mods && mods.length > 0) {
            extractedExternalModules.push(...mods);
          }
        } catch (e) {
          console.warn('B4X: failed to extract modules from b4xlib', f, e);
        }
      }
    }, steps);
    // Notify user that b4xlib processing completed
    try {
      const processedLibs = existingB4xlib.length;
      const extractedMods = extractedExternalModules.length;
      void vscode.window.showInformationMessage(`B4X: Processed ${processedLibs} b4xlib(s) — extracted ${extractedMods} module(s)`);
    } catch { /* best-effort UI update */ }

    // Merge allowedModules candidates with b4xlib-extracted modules
    steps?.step('Loading reference modules...');
    const externalCandidates = projectConfig.externalModuleFiles ?? [];
    const existingExternalCandidates = externalCandidates.filter(f => fs.existsSync(f));
    const missingExternalCandidates = externalCandidates.filter(f => !fs.existsSync(f));
    if (missingExternalCandidates.length > 0) {
      console.error(`[B4X ERROR] ${missingExternalCandidates.length} external module files not found on disk, skipped:`, missingExternalCandidates.map(f => path.basename(f)));
    }

    const allReferenceModules = dedupePaths([...existingExternalCandidates, ...extractedExternalModules]);
    await runWithStatus('Indexing reference modules', async () => await workspaceClasses.replaceReferenceModules(allReferenceModules), steps);
    // Notify user that modules/reference files were loaded
    try {
      const modulesCount = allReferenceModules.length;
      void vscode.window.showInformationMessage(`B4X: Loaded ${modulesCount} reference module(s)`);
    } catch { /* best-effort UI update */ }

    steps?.step('Loading XML libraries...');
    await runWithStatus('Loading XML libraries', async () => await xmlLibraries.replaceXmlFiles(dedupePaths(allXmlFiles)), steps);

    // Sync the Common class store (global functions from Core.xml)
    commonClass.syncFrom(xmlLibraries);

    // Sync primitive type mappings
    primitiveTypes.syncFrom(xmlLibraries);

    trace('reloadPlatformAssets.done', {
      xmlFilesLoaded: allXmlFiles.length,
      b4xlibFilesProcessed: platformB4xlibFiles.length,
      referenceModules: allReferenceModules.length,
    });

    // Notify user that XML libraries were loaded
    try {
      const xmlLoaded = allXmlFiles.length;
      void vscode.window.showInformationMessage(`B4X: Loaded ${xmlLoaded} XML file(s)`);
    } catch { /* best-effort UI update */ }

    // Refresh the Projects view title and contents
    try {
      void vscode.commands.executeCommand('b4xIntellisense.refreshCommandsView');
    } catch { /* ignore */ }

    // Do not set a global "Ready" here — leave final Ready state to the
    // enclosing open flow (which will wait for the language server/indexing)
    // or to the caller. We avoid emitting a Ready state prematurely.
  }

  /**
   * Resolve b4xlib dependencies by extracting manifests and adding
   * platform-specific `B4X.DependsOn` entries to the allowed libraries set.
   *
   * This walks the library folders for each loaded platform, finds b4xlib files
   * matching the allowed library names, extracts their manifest.txt, parses
   * `B4J.DependsOn` (or current platform), and adds any new dependencies.
   * The process repeats recursively until no new dependencies are found.
   */
  async function resolveB4xlibDependencies(
    initialLibraries: ReadonlySet<string>,
    platform: B4xPlatformName,
    activePlatform: LoadedPlatformConfig,
  ): Promise<ReadonlySet<string>> {
    const libraries = new Set(initialLibraries);
    const processed = new Set<string>();
    const searchFolders = new Set<string>();

    // Gather search folders from the single active platform only
    const regDirs = findPlatformInstallDirs();
    const regPlatformDir = regDirs[activePlatform.platform];
    if (regPlatformDir) {
      searchFolders.add(path.join(regPlatformDir, 'Libraries'));
    }
    const additionalFolder = activePlatform.folders.additionalLibrariesFolder;
    if (additionalFolder) searchFolders.add(additionalFolder);

    // Iteratively resolve dependencies
    let changed = true;
    while (changed) {
      changed = false;
      for (const lib of libraries) {
        if (processed.has(lib)) continue;

        // Find the b4xlib file for this library
        let b4xlibPath: string | undefined;
        for (const folder of searchFolders) {
          const candidates = [
            path.join(folder, `${lib}.b4xlib`),
            path.join(folder, lib, `${lib}.b4xlib`),
          ];
          for (const c of candidates) {
            try {
              if (fs.existsSync(c)) {
                b4xlibPath = c;
                break;
              }
            } catch { /* ignore */ }
          }
          if (b4xlibPath) break;
        }

        processed.add(lib);

        if (!b4xlibPath) continue;

        // Extract manifest from b4xlib
        try {
          const manifest = await extractManifestFromB4xlib(b4xlibPath);
          const deps = parseManifestDependsOn(manifest, platform);
          for (const dep of deps) {
            if (!libraries.has(dep)) {
              libraries.add(dep);
              changed = true;
              trace(`b4xlib.dependency: ${lib} -> ${dep} (${platform})`);
            }
          }
        } catch (err) {
          console.warn(`B4X: failed to extract manifest from ${b4xlibPath}`, err);
        }
      }
    }

    trace(`b4xlib.dependencyResolution: resolved ${libraries.size} libraries (from ${initialLibraries.size} initial)`);
    return libraries;
  }

  /** Extract manifest.txt from a b4xlib archive. */
  async function extractManifestFromB4xlib(archivePath: string): Promise<Record<string, string>> {
    const zip = new StreamZip({ file: archivePath, storeEntries: true });
    return new Promise((resolve, reject) => {
      zip.on('ready', () => {
        try {
          const entries = zip.entries();
          const manifestEntry = Object.keys(entries).find(e => e.toLowerCase() === 'manifest.txt');
          if (!manifestEntry) {
            zip.close(() => {});
            resolve({});
            return;
          }
          const data = zip.entryDataSync(manifestEntry).toString('utf8');
          const manifest: Record<string, string> = {};
          for (const line of data.split(/\r?\n/)) {
            const eq = line.indexOf('=');
            if (eq > 0) {
              manifest[line.substring(0, eq).trim().toLowerCase()] = line.substring(eq + 1).trim();
            }
          }
          zip.close(() => {});
          resolve(manifest);
        } catch (err) {
          zip.close(() => {});
          reject(err);
        }
      });
      zip.on('error', e => reject(e));
    });
  }

  /**
   * Extract modules from a .b4xtemplate archive (ZIP file with $APPNAME$ placeholders)
   * and replace placeholders with the actual project name.
   * Returns absolute paths to extracted module files.
   */
  async function extractModulesFromB4xtemplate(
    archivePath: string,
    projectName: string
  ): Promise<string[]> {
    const cacheBase = libraryIndex.getCacheDir();
    const nameSafe = path.basename(archivePath).replace(/[^a-z0-9\.\-_]/gi, '_');
    // Async stat — used both for the cache-dir name and later for DB registration.
    const archiveStat = await fs.promises.stat(archivePath).catch(() => undefined);
    const outDir = path.join(cacheBase, `${nameSafe}_${Math.floor(archiveStat ? archiveStat.mtimeMs : Date.now())}_${projectName}`);
    try {
      await fs.promises.mkdir(outDir, { recursive: true });
    } catch {
      return [];
    }
    // Use node-stream-zip to extract entries (works regardless of file extension).
    const zip = new StreamZip({ file: archivePath, storeEntries: true });
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on('ready', () => resolve());
        zip.on('error', (err) => reject(err));
      });
      const entries = zip.entries();
      for (const entryName of Object.keys(entries)) {
        const entry = entries[entryName];
        if (!entry || entry.isDirectory) continue;
        let outName = entry.name;
        // Replace $APPNAME$ placeholder in the filename
        if (outName.includes('$APPNAME$')) {
          outName = outName.replace(/\$APPNAME\$/g, projectName);
        }
        const outPath = path.join(outDir, outName.replace(/\\/g, '/'));
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        const data = zip.entryDataSync(entry.name);
        await fs.promises.writeFile(outPath, data);
      }
    } finally {
      await new Promise<void>((resolve) => zip.close(resolve));
    }
    // Recursively find .bas files in the extracted folder
    const result: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(entries.map(async (entry) => {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(p);
          return;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.bas') {
          result.push(p);
        }
      }));
    }
    await walk(outDir);
    // Guard against zip entries that may have written files outside outDir (defense-in-depth).
    const resolvedOutDir = path.resolve(outDir);
    const safeResult = result.filter(p => path.resolve(p).startsWith(resolvedOutDir + path.sep));
    // Register extracted files in DB for this archive — reuse the already-fetched archiveStat.
    try {
      const inner = [];
      for (const p of safeResult) {
        const rel = path.relative(outDir, p);
        const s = await fs.promises.stat(p).catch(() => undefined);
        if (s) {
          inner.push({ relPath: rel, absPath: p, mtime: Math.floor(s.mtimeMs), size: s.size });
        }
      }
      await (async () => {
        try {
          libraryIndex.upsertB4xlibArchive(archivePath, archiveStat ? Math.floor(archiveStat.mtimeMs) : Date.now(), outDir, inner);
        } catch (err) {
          console.warn('B4X: failed to upsert b4xtemplate archive info', archivePath, err);
        }
      })();
    } catch { /* ignore */ }
    return safeResult;
  }

  /**
   * Scan all configured platform library folders for .b4xtemplate files.
   * Called once during activation so the template menu is instant.
   * Returns a promise that resolves when scanning is complete.
   */
  async function scanTemplates(): Promise<void> {
    // Preserve previous status text so we can restore it when done
    const _prevStatusText = statusBarItem?.text ?? '$(symbol-misc) B4X';
    try {
      try {
        statusBarItem.text = '$(sync~spin) Loading B4X templates...';
        statusBarItem.show();
        try { void extContext?.globalState.update(GLOBAL_STATE_LAST_STATUS, { text: statusBarItem.text, tooltip: statusBarItem.tooltip }); } catch {}
      } catch { /* best-effort UI update */ }

      // Refresh Projects view so the header reflects the opened project name.
      try {
        await vscode.commands.executeCommand('b4xIntellisense.refreshCommandsView');
      } catch { /* best-effort: ignore if provider/command not yet registered */ }
      const platformSettings = getPlatformSettings();
      const loadedPlatforms = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
      const installDirs = findPlatformInstallDirs();

      for (const platform of loadedPlatforms) {
        let librariesFolder = platform.folders.librariesFolder;
        const additionalFolder = platform.folders.additionalLibrariesFolder;

        const installDir = installDirs[platform.platform];
        if (!librariesFolder && installDir) {
          const defaultLibrariesFolder = path.join(installDir, 'Libraries');
          if (fs.existsSync(defaultLibrariesFolder)) {
            librariesFolder = defaultLibrariesFolder;
          }
        }

        const searchFolders: string[] = [];
        if (librariesFolder) searchFolders.push(librariesFolder);
        if (additionalFolder) searchFolders.push(additionalFolder);

        for (const folder of searchFolders) {
          if (!fs.existsSync(folder)) continue;
          try {
            const files = await fs.promises.readdir(folder);
            for (const file of files) {
              if (file.toLowerCase().endsWith('.b4xtemplate')) {
                const displayName = file.substring(0, file.length - '.b4xtemplate'.length);
                cachedTemplates.push({
                  path: path.join(folder, file),
                  name: `[${platform.platform.toUpperCase()}] ${displayName}`,
                  platform: platform.platform,
                });
              }
            }
            // Also check subdirectories
            const subdirs = await fs.promises.readdir(folder, { withFileTypes: true });
            for (const subdir of subdirs) {
              if (!subdir.isDirectory()) continue;
              const subdirPath = path.join(folder, subdir.name);
              const subFiles = await fs.promises.readdir(subdirPath);
              for (const file of subFiles) {
                if (file.toLowerCase().endsWith('.b4xtemplate')) {
                  const displayName = file.substring(0, file.length - '.b4xtemplate'.length);
                  cachedTemplates.push({
                    path: path.join(subdirPath, file),
                    name: `[${platform.platform.toUpperCase()}] ${subdir.name}/${displayName}`,
                    platform: platform.platform,
                  });
                }
              }
            }
          } catch { /* ignore */ }
        }
      }

      // Sort by platform then name
      cachedTemplates.sort((a, b) => {
        const order: Record<string, number> = { b4a: 0, b4i: 1, b4j: 2, b4r: 3 };
        const diff = (order[a.platform] ?? 999) - (order[b.platform] ?? 999);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });

      trace('scanTemplates.done', { count: cachedTemplates.length });
    } catch (err) {
      console.warn('B4X: failed to scan templates', err);
    } finally {
      // Signal that scanning is complete
      templateScanResolve();
      try {
        // Do not restore _prevStatusText here. If we were in a "Ready" state, 
        // it's likely stale and will be overwritten by the actual project loading flow.
        // If we were in a "Loading" state, the next step in the sequence will handle it.
      } catch { /* ignore */ }
      try {
        const tCount = cachedTemplates.length;
        void vscode.window.showInformationMessage(`B4X: Templates scanned — ${tCount} template(s) available`);
      } catch { /* best-effort UI update */ }
    }
  }

  /**
   * Create a new B4X project from a template file (.b4xtemplate)
   * Handles template selection, project naming, extraction, and placeholder replacement.
   * Uses pre-scanned templates from platform library folders.
   * If no templates are found, informs the user and exits.
   */
  async function createNewB4xProjectFromTemplate(context: vscode.ExtensionContext): Promise<void> {
    const templateSteps = createStepTracker(6);
    try {
      templateSteps.step('Selecting template...');

      // Wait for template scanning to complete if it's still in progress
      await templateScanComplete;

      // Use the pre-scanned template cache populated during activation.
      if (cachedTemplates.length === 0) {
        templateSteps.error('No templates found');
        void vscode.window.showErrorMessage(
          'B4X: No .b4xtemplate files found in your platform library folders. Cannot create a new project from template.'
        );
        return;
      }

      let templatePath: string | undefined;
      let selectedPlatformKey: string | undefined;

      const templatePicks = cachedTemplates.map(tf => ({
        label: tf.name,
        templatePath: tf.path,
        platform: tf.platform,
      } as vscode.QuickPickItem & { templatePath: string; platform: string }));

      const templatePick = await vscode.window.showQuickPick(templatePicks, { placeHolder: 'Select a template' });
      if (!templatePick) return;
      templatePath = templatePick.templatePath;
      selectedPlatformKey = templatePick.platform;

      if (!templatePath) return;

      // 4. Prompt for project name
      templateSteps.step('Naming project...');
      const templateBasename = path.basename(templatePath, '.b4xtemplate');
      const projectName = await vscode.window.showInputBox({
        prompt: 'Enter the project name',
        placeHolder: templateBasename,
        value: templateBasename,
        validateInput: (value) => {
          if (!value || !value.trim()) return 'Project name is required';
          if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Project name can only contain letters, numbers, and underscores';
          return null;
        },
      });
      if (!projectName) {
        templateSteps.done('Cancelled');
        return; // User cancelled
      }
      const trimmedName = projectName.trim();

      // 5. Select destination folder — only prompt if the workspace folder
      //    for this platform is not already configured in extension settings.
      templateSteps.step('Choosing destination...');
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const wsSettingKeys: Record<string, string> = {
        b4a: 'b4aWorkspaceFolder',
        b4i: 'b4iWorkspaceFolder',
        b4j: 'b4jWorkspaceFolder',
        b4r: 'b4rWorkspaceFolder',
      };
      const wsPlatform = selectedPlatformKey ?? 'b4a';
      const wsSettingKey = wsSettingKeys[wsPlatform] ?? 'b4aWorkspaceFolder';
      let destinationFolder = cfg.get<string>(wsSettingKey, '') ?? '';

      if (!destinationFolder.trim()) {
        const pick = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Select Project Destination Folder',
        });
        if (!pick || pick.length === 0) {
          templateSteps.done('Cancelled');
          return;
        }
        destinationFolder = pick[0]!.fsPath;

        // Persist the chosen folder so we don't prompt again for this platform
        await cfg.update(wsSettingKey, destinationFolder, vscode.ConfigurationTarget.Global);
      }

      // 6. Use the platform captured when the template was selected from the menu.
      //    No guessing — the platform is known because we stored it during scanning.
      templateSteps.step('Creating project...');

      if (!selectedPlatformKey) {
        void vscode.window.showErrorMessage('Could not determine platform for selected template.');
        return;
      }
      const platformKey = Object.keys(B4X_PLATFORMS).find(k => k.toLowerCase() === selectedPlatformKey);
      if (!platformKey) {
        void vscode.window.showErrorMessage(`Unknown platform: ${selectedPlatformKey}`);
        return;
      }

      const platformConfig = B4X_PLATFORMS[platformKey];
      if (!platformConfig) {
        void vscode.window.showErrorMessage(`Unsupported platform for template: ${platformKey}`);
        return;
      }

      // 7. Create the project directory: <destination>/<ProjectName>/
      const projectDir = path.join(destinationFolder, trimmedName);

      try {
        await fs.promises.mkdir(projectDir, { recursive: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`Failed to create project directory: ${projectDir}`);
        return;
      }

      // 8. Extract the .b4xtemplate (ZIP) directly into the project directory,
      //    replacing $APPNAME$ placeholders in filenames.
      const zip = new StreamZip({ file: templatePath, storeEntries: true });
      try {
        await new Promise<void>((resolve, reject) => {
          zip.on('ready', () => resolve());
          zip.on('error', (err) => reject(err));
        });

        const entries = zip.entries();
        for (const entryName of Object.keys(entries)) {
          const entry = entries[entryName];
          if (!entry || entry.isDirectory) continue;

          let outName = entry.name.replace(/\\/g, '/');
          // Replace $APPNAME$ in filenames
          if (outName.includes('$APPNAME$')) {
            outName = outName.replace(/\$APPNAME\$/g, trimmedName);
          }

          const outPath = path.join(projectDir, outName);
          await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
          
          const data = zip.entryDataSync(entryName);
          await fs.promises.writeFile(outPath, data);
        }
      } finally {
        await new Promise<void>((resolve) => zip.close(resolve));
      }

      // 9. Find the project file matching the selected platform's extension.
      async function findProjectFile(dir: string, ext: string): Promise<string | undefined> {
        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return undefined;
        }
        for (const entry of entries) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = await findProjectFile(p, ext);
            if (found) return found;
          } else if (entry.name.toLowerCase().endsWith(ext)) {
            return p;
          }
        }
        return undefined;
      }

      const projectFilePath = await findProjectFile(projectDir, platformConfig.ext);
      if (!projectFilePath) {
        void vscode.window.showErrorMessage(`No ${platformConfig.ext} project file found in extracted template.`);
        return;
      }

      // 10. Open the project file — triggers the same flow as "Open B4X Project".
      templateSteps.step('Opening project...');
      const projectUri = vscode.Uri.file(projectFilePath);

      // Persist state so the extension can auto-reload on activation
      await context.globalState.update(GLOBAL_STATE_LAST_PROJECT_FILE, projectFilePath);
      await context.globalState.update(GLOBAL_STATE_LAST_PROJECT_PLATFORM, platformKey.toLowerCase());

      // Delegate to the existing "Open B4X Project" command which handles
      // workspace setup, intellisense loading, and LSP startup.
      await vscode.commands.executeCommand('b4xIntellisense.openB4xProject', projectUri);

      templateSteps.done(`${trimmedName} ready`);
      void vscode.window.showInformationMessage(
        `B4X: Project "${trimmedName}" created successfully at ${projectDir}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('B4X: newB4xProjectFromTemplate failed', err);
      templateSteps.error(`Failed — ${msg}`);
    }
  }

  // The language server will be started after the user explicitly opens a project
  // to ensure heavy initialization does not run during activation or before the user selects a B4X project file.
  console.log('B4X: LSP client start deferred until explicit project open');

  async function startB4XLanguageClient(context: vscode.ExtensionContext, steps?: ReturnType<typeof createStepTracker>, projectFileToReveal?: vscode.Uri): Promise<void> {
    try {
      // Dispose previous client if present
      if (lspClientDisposable) {
        try { lspClientDisposable.dispose(); } catch { /* ignore */ }
        lspClientDisposable = undefined;
      }

      // Indicate LSP startup so the user knows work continues.
      try {
        if (steps) steps.step('Starting language server...');
        statusBarItem.text = `$(sync~spin) B4X: Starting language server...`;
        statusBarItem.tooltip = 'B4X IntelliSense — Starting language server';
        statusBarItem.show();
      } catch { /* ignore UI errors */ }

      const lspDisposable = await startLanguageClient(context, (method: string, params: any) => {
        try {
          if (method === 'b4x/indexing') {
            const phase = params && params.phase;
            if (phase === 'start') {
              const total = params.total || 0;
              try { statusBarItem.text = `$(sync~spin) B4X: Indexing workspace (0/${total})`; statusBarItem.tooltip = `Indexing workspace — 0 of ${total} files`; } catch {}
            } else if (phase === 'progress') {
              const processed = params.processed || 0;
              const total = params.total || 0;
              try { statusBarItem.text = `$(sync~spin) B4X: Indexing workspace (${processed}/${total})`; statusBarItem.tooltip = `Indexing workspace — ${processed} of ${total} files`; } catch {}
            } else if (phase === 'done') {
              try {
                statusBarItem.text = '$(check) B4X: Ready';
                statusBarItem.tooltip = 'B4X IntelliSense — Ready';
                void context.globalState.update(GLOBAL_STATE_LAST_STATUS, {
                  text: statusBarItem.text,
                  tooltip: statusBarItem.tooltip,
                  step: 10,
                  total: 10,
                  gen: statusBarGeneration,
                  ready: true,
                });
              } catch { /* best-effort persistence */ }
            }
          }
        } catch { /* swallow notification handler errors */ }
      });

      if (lspDisposable) { context.subscriptions.push(lspDisposable); lspClientDisposable = lspDisposable; }
      trace('startB4XLanguageClient.lspStarted');

      // Focus the explorer view and reveal the project file to expand the workspace tree.
      if (projectFileToReveal) {
        try {
          await vscode.commands.executeCommand('workbench.view.explorer');
          await vscode.commands.executeCommand('revealInExplorer', projectFileToReveal);
        } catch {
          // Ignore explorer focus errors — non-critical for project loading
        }
      }
    } catch (lspErr) {
      console.warn('B4X: failed to start language client', lspErr);
      if (steps) steps.error('LSP failed');
      throw lspErr;
    }
  }

  const selector: vscode.DocumentSelector = [
    { language: 'b4x', scheme: 'file' },
    { language: 'b4x', scheme: 'untitled' },
  ];
  const completionTriggers = ['.', '_', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];

  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.openB4xProject', async (uri?: vscode.Uri) => {
      const openSteps = createStepTracker(15);
      try {
        trace('openB4xProject.enter');
        const selectedProjectFile = uri ?? await promptForB4xProjectFile();
        if (!selectedProjectFile) {
          trace('openB4xProject.exit.no-selection');
          return;
        }

      // Track whether LSP indexing is expected; declared outside the
      // withProgress callback so it's visible after the flow completes.
      let lspIndexingExpected = false;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'B4X', cancellable: false },
        async (progress) => {
        const report = (msg: string) => { progress.report({ message: msg }); openSteps.step(msg); };
        openSteps.step('Opening project file...');
        // If we will start the language server and let it index, suppress
        // emitting a final Ready state here — wait for the LSP indexing
        // 'done' notification to set Ready.
        lspIndexingExpected = false;

      const projectRoot = getProjectRootFromProjectFile(selectedProjectFile.fsPath);
      // set current project directory (platform folder) so watchers and scoped scans use it
      currentProjectDirectory = projectRoot;

      // Persist the project path BEFORE any folder operations that may restart the
      // extension host (updateWorkspaceFolders / openFolder). Without this the state
      // key is never written when a restart occurs and auto-reload on the next
      // activation would be skipped.
      await context.globalState.update(GLOBAL_STATE_LAST_PROJECT_FILE, selectedProjectFile.fsPath);

      // Persist the detected platform so intellisense knows which library
      // folders and dependency rules to use across VS Code restarts.
      const detectedPlatform = detectPlatformFromPath(selectedProjectFile.fsPath);
      if (detectedPlatform) {
        await context.globalState.update(GLOBAL_STATE_LAST_PROJECT_PLATFORM, detectedPlatform);
      }

      // Determine workspace root from actual module paths in the project file.
      // This scans the .b4a file, resolves all ModuleN= entries, and finds the
      // common ancestor directory that contains all referenced modules.
      openSteps.step('Determining workspace root...');
      let workspaceRoot: string;
      try {
        workspaceRoot = await determineWorkspaceRoot(selectedProjectFile.fsPath, []);
        trace('openB4xProject.workspaceRoot', workspaceRoot);
      } catch (err) {
        console.warn('B4X: failed to determine workspace root from project file, using platform folder', err);
        workspaceRoot = projectRoot;
      }

      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const autoAdd = cfg.get<boolean>('autoAddProjectFolderOnOpen', true);
      const autoOpen = cfg.get<boolean>('autoOpenProjectFolderOnOpen', false);

      // Load project folder into the IDE according to user settings.
      openSteps.step('Preparing workspace...');
      try {
        if (autoOpen) {
          trace('openB4xProject.openFolderCommand', workspaceRoot);
          // This will open the folder in the current window, which restarts the
          // extension host. Nothing after this point will run reliably, so we
          // bail out and let the activation auto-reload handle the rest.
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceRoot), false);
          return;
        } else if (autoAdd) {
          trace('openB4xProject.ensureWorkspaceFolder', workspaceRoot);
          ensureWorkspaceFolder(vscode.Uri.file(workspaceRoot));

          // Configure workspace settings for the project root folder
          await configureWorkspaceSettings(workspaceRoot, detectedPlatform);
          
          // updateWorkspaceFolders MAY restart the extension host when the first
          // workspace folder changes. If a restart happens, everything past this
          // point is interrupted and the activation auto-reload (reading from
          // globalState) finishes the remaining work.  If NO restart happens
          // (folder was already correct), the flow continues normally below.
        }
      } catch (err) {
        console.warn('B4X: failed to load project folder into IDE', err);
      }

      // Wait for workspace folder to be registered BEFORE opening the document.
      // ensureWorkspaceFolder fires asynchronously; if we open the project doc before
      // the folder is committed, VS Code may fail to resolve it properly.
      await waitForWorkspaceFolderLoad(workspaceRoot);

      // Update the build command visibility now that the workspace is loaded.
      // This ensures the Build & Install command appears in the command palette.
      updateBuildCommandContext();

      // Close all open editor tabs from the previous project BEFORE opening the
      // new project file so the user never sees the open-then-immediately-close flicker.
      try {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      } catch (err) {
        console.warn('B4X: failed to close all editors', err);
      }

      // Open and show the new project file once, after the slate is clear.
      const document = await vscode.workspace.openTextDocument(selectedProjectFile);
      try {
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (err) {
        console.warn('B4X: failed to open project file', err);
      }

      // Fully clear all intellisense state — reloadPlatformAssets will populate
      // everything from scratch based on the opened project's allowedLibraries.
      openSteps.step('Clearing previous state...');
      try {
        // clear workspace classes and external classes
        try { workspaceClasses.clear(); } catch (err) { console.warn('B4X: failed to clear workspaceClasses', err); }
        // reset project-scoped allowed sets so previous project's data doesn't leak into the new one
        currentAllowedLibraries = undefined;
        currentAllowedModuleBasePaths = undefined;
        currentProjectDirectory = undefined;
        // clear the cached project config from a previous load so it is not reused
        clearProjectConfigCache();
        try { await xmlLibraries.replaceXmlFiles([]); } catch (err) { console.warn('B4X: failed to clear xmlLibraries', err); }
        // clear common class and primitive types — they will be re-synced from the new XML libraries
        commonClass.syncFrom(xmlLibraries);
        primitiveTypes.syncFrom(xmlLibraries);
      } catch (err) {
        console.warn('B4X: error clearing intellisense state', err);
      }

      // Intellisense report generation removed from automatic project-open flow.

      // After initialization, optionally wait for the workspace folder to be loaded
      // and then perform full platform reload + LSP start (config: autoLoadProjectAssets)
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        if (cfg.get('autoLoadProjectAssets', true)) {
          try {
            await reloadPlatformAssets({}, openSteps);

             // Show a summary of what was actually loaded
            const xmlCount = xmlLibraries.findClassesByPrefix('').length;
            const wsCount = workspaceClasses.findClassesByPrefix('').length;
            const libsSummary = currentAllowedLibraries ? Array.from(currentAllowedLibraries).join(', ') : 'none';
            trace('openB4xProject.reloadPlatformAssets.done', { xmlClasses: xmlCount, workspaceClasses: wsCount, allowedLibraries: libsSummary });
            if (xmlCount === 0 && wsCount === 0) {
              openSteps.error('No libraries loaded');
            }
            try {
              // Libraries finished loading — advance the tracker but DO NOT
              // mark the overall flow as Ready yet. The language server may
              // still need to start and index; the final Ready state should
              // be emitted only after indexing completes.

              // Start the language client in the background so its startup time
              // does not block the Ready status. Any startup errors will surface
              // and set the status to an error state. Also show LSP/indexing
              // progress in the status bar by listening to a simple
              // custom notification from the server (`b4x/indexing`).
              lspIndexingExpected = true;
              void (async () => {
                try {
                  await startB4XLanguageClient(context, openSteps, selectedProjectFile);
                } catch (lspErr) {
                  console.warn('B4X: failed to start language client during autoLoad after workspace load', lspErr);
                  lspIndexingExpected = false;
                  statusBarItem.text = '$(check) B4X: Ready (No LSP)';
                }
              })();
            } catch (err) {
              // Preserve previous behavior: if something unexpected happens here
              // surface it via the step tracker.
              const msg = err instanceof Error ? err.message : String(err);
              console.warn('B4X: auto-load after workspace load failed', err);
              openSteps.error(`Load failed — ${msg}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('B4X: auto-load after workspace load failed', err);
            openSteps.error(`Load failed — ${msg}`);
          }
        } else {
          trace('openB4xProject.autoLoad.disabled');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('B4X: auto-load after workspace load failed', err);
        openSteps.error(`Load failed — ${msg}`);
      }
      
      // Refresh the Projects tree view now that the project is opened and assets are loaded
      try {
        await vscode.commands.executeCommand('b4xIntellisense.refreshCommandsView');
      } catch { /* ignore */ }
      }); // end withProgress

      // Ensure the status bar shows a final Ready state after the open flow
      // completes only when we are not expecting LSP indexing to run.
      try {
        if (!lspIndexingExpected) {
          statusBarItem.text = '$(check) B4X: Ready';
          statusBarItem.tooltip = 'B4X IntelliSense — Ready';
          statusBarItem.show();
          try {
            await context.globalState.update(GLOBAL_STATE_LAST_STATUS, {
              text: statusBarItem.text,
              tooltip: statusBarItem.tooltip,
              step: 10,
              total: 10,
              gen: statusBarGeneration,
              ready: true,
            });
          } catch { /* best-effort persistence */ }
        }
      } catch { /* best-effort UI update */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('B4X: openB4xProject failed', err);
      openSteps.error(`Failed — ${msg}`);
    }
    }),

    // Library DB: refresh/inspect/clear commands
    vscode.commands.registerCommand('b4xIntellisense.refreshLibraryIndex', async () => {
      try {
        if (currentProjectDirectory) libraryIndex.touchProject(currentProjectDirectory);
        await workspaceClasses.refresh(currentAllowedModuleBasePaths);
        void vscode.window.showInformationMessage('B4X: Library index refreshed');
      } catch (err) {
        console.error('refreshLibraryIndex failed', err);
        void vscode.window.showErrorMessage('Failed to refresh library index');
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.showLibraryDbPath', async () => {
      try {
        const dbPath = libraryIndex.getDbPath();
        if (!dbPath) {
          void vscode.window.showInformationMessage('B4X: Library DB not initialized');
          return;
        }
        void vscode.window.showInformationMessage(`B4X: Library DB path: ${dbPath}`);
        try { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dbPath)); } catch { /* ignore */ }
      } catch (err) {
        console.error('showLibraryDbPath failed', err);
        void vscode.window.showErrorMessage('Failed to show library DB path');
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.clearLibraryCache', async () => {
      try {
        const storageBase = context.globalStorageUri?.fsPath;
        if (!storageBase) {
          void vscode.window.showErrorMessage('Extension storage path not available');
          return;
        }
        const dbPath = libraryIndex.getDbPath() || path.join(storageBase, 'library-index.sqlite');
        const cacheDir = path.join(storageBase, 'b4xlib-cache');
        libraryIndex.close();
        try { await fs.promises.unlink(dbPath).catch(() => {}); } catch { /* ignore */ }
        try { await fs.promises.rm(cacheDir, { recursive: true, force: true }).catch(() => {}); } catch { /* ignore */ }
        libraryIndex.init(storageBase);
        void vscode.window.showInformationMessage('B4X: Library cache cleared');
      } catch (err) {
        console.error('clearLibraryCache failed', err);
        void vscode.window.showErrorMessage('Failed to clear library cache');
      }
    }),
    // Helper test command: simulate opening a B4X project by entering a path (bypasses file-picker)
    vscode.commands.registerCommand('b4xIntellisense.simulateOpen', async () => {
      try {
        const input = await vscode.window.showInputBox({ prompt: 'Enter path to B4X project file to simulate open (full path)' });
        if (!input) return;
        const filePath = path.resolve(input);
        if (!fs.existsSync(filePath)) {
          void vscode.window.showErrorMessage(`File not found: ${filePath}`);
          return;
        }
        const uri = vscode.Uri.file(filePath);
        // Invoke the real command handler with the URI to bypass the open dialog.
        await vscode.commands.executeCommand('b4xIntellisense.openB4xProject', uri);
      } catch (err) {
        console.error('B4X: simulateOpen failed', err);
      }
    }),
    
    // Create a new B4X project from a template file (.b4xtemplate)
    vscode.commands.registerCommand('b4xIntellisense.newB4xProjectFromTemplate', async () => {
      await createNewB4xProjectFromTemplate(context);
    }),
    // Debug command: show persisted workspace state keys and some values
    vscode.commands.registerCommand('b4xIntellisense.debugState', async () => {
      try {
        const keys = context.globalState.keys();
        const sysIni = context.globalState.get(GLOBAL_STATE_SYSTEM_INI);
        const last = context.globalState.get(GLOBAL_STATE_LAST_PROJECT_FILE);
        console.log('B4X: debugState -> globalState keys=', keys);
        console.log('B4X: debugState -> b4x.systemIni=', sysIni);
        console.log('B4X: debugState -> b4x.lastOpenedProjectFile=', last);
        void vscode.window.showInformationMessage(`B4X: globalState keys: ${keys.join(', ')}`);
      } catch (err) {
        console.error('B4X: debugState failed', err);
      }
    }),
    // Debug command: show counts of in-memory stores (workspace, XML)
    vscode.commands.registerCommand('b4xIntellisense.printStores', async () => {
      try {
        const workspaceCount = workspaceClasses.findClassesByPrefix('').length;
        const xmlCount = xmlLibraries.findClassesByPrefix('').length;
        const libCount = currentAllowedLibraries?.size ?? 0;
        const modCount = currentAllowedModuleBasePaths?.size ?? 0;
        console.log(`B4X: store counts -> workspace=${workspaceCount}, xml=${xmlCount}, allowedLibs=${libCount}, allowedMods=${modCount}`);
        const projectNote = currentProjectDirectory
          ? ` | project: ${path.basename(currentProjectDirectory)}`
          : ' | no project loaded';
        void vscode.window.showInformationMessage(
          `B4X: workspace=${workspaceCount}, xml=${xmlCount}, allowedLibs=${libCount}, allowedMods=${modCount}${projectNote}`,
        );
      } catch (err) {
        console.error('B4X: printStores failed', err);
      }
    }),
    // Diagnostic command: dump intellisense diagnostics to a JSON file in workspace root
    vscode.commands.registerCommand('b4xIntellisense.dumpDiagnostics', async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          void vscode.window.showErrorMessage('No workspace folder is open. Open a workspace and try again.');
          return;
        }

        const projectRoot = folders[0]!.uri.fsPath;
        const outPath = path.join(projectRoot, 'b4x-intellisense-diagnostics.json');
        console.log(`B4X: dumpDiagnostics -> projectRoot=${projectRoot} outPath=${outPath}`);

        // All data comes from in-memory intellisense state — the .b4a was already
        // parsed when the project was opened and these variables were populated then.
        // The last-opened project is persisted in `globalState` (survives host restarts).
        const activeProjectFile = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE) || null;
        const activeProjectDirectory = currentProjectDirectory ?? null;

        // Allow-lists populated during project open + reloadPlatformAssets
        const allowedLibraries = Array.from(currentAllowedLibraries ?? []);
        const allowedModules = Array.from(currentAllowedModuleBasePaths ?? []);

        // What each store actually contains right now
        const xmlClassCount = xmlLibraries.findClassesByPrefix('').length;
        const workspaceClassCount = workspaceClasses.findClassesByPrefix('').length;
        const loadedXmlFiles = Array.from(xmlLibraries.loadedFilePaths);
        const loadedModuleFiles = Array.from(workspaceClasses.loadedFilePaths);

        // Also include last-discovered .b4xlib archive files in diagnostics
        const loadedB4xlibFiles = Array.from(lastLoadedB4xlibFiles ?? []);

        // Cross-reference: for each allowed library, did a matching XML or .b4xlib get loaded?
        const loadedXmlBasenames = loadedXmlFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase());
        const loadedB4xlibBasenames = loadedB4xlibFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase());
        const libraryResolution = allowedLibraries.map((lib) => ({
          library: lib,
          loaded: loadedXmlBasenames.includes(lib) || loadedB4xlibBasenames.includes(lib),
        }));

        // Cross-reference: for each allowed module base path, did a file get indexed?
        const loadedModuleBasenames = loadedModuleFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase());
        const moduleResolution = allowedModules.map((mod) => ({
          module: mod,
          loaded: loadedModuleBasenames.includes(path.basename(mod).toLowerCase()),
        }));

        const stateKeys = await context.workspaceState.keys();
        const state: Record<string, unknown> = {};
        for (const k of stateKeys) state[k] = context.workspaceState.get(k);

        const report = {
          generated: new Date().toISOString(),
          // ── Active project ────────────────────────────────────────────────
          activeProjectFile,
          activeProjectDirectory,
          lspActive: lspClientDisposable != null,
          // ── Allow-lists parsed from .b4a during project open ──────────────
          allowedLibraries,
          allowedModules,
          // ── Resolution: allowed → what actually got loaded ────────────────
          libraryResolution,
          moduleResolution,
          // ── IntelliSense store contents ───────────────────────────────────
          stores: {
            xmlClassCount,
            workspaceClassCount,
            loadedXmlFiles,
            loadedB4xlibFiles,
            loadedModuleFiles,
            xmlClasses: xmlLibraries.findClassesByPrefix('').map((c) => c.name),
            workspaceClasses: workspaceClasses.findClassesByPrefix('').map((c) => c.name),
          },
          workspaceState: state,
        };

        try {
          await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
          console.log(`B4X: dumpDiagnostics -> wrote diagnostics to ${outPath}`);
        } catch (writeErr) {
          console.error('B4X: dumpDiagnostics write error', writeErr);
          throw writeErr;
        }

        // Do not await the user-facing message — return immediately so callers
        // (tests) don't hang waiting for a user interaction. If the user clicks
        // the action, open the diagnostics file asynchronously.
        void vscode.window
          .showInformationMessage(`B4X: diagnostics written to ${outPath}`, 'Open diagnostics file')
          .then(async (openAction) => {
            if (openAction === 'Open diagnostics file') {
              try {
                const doc = await vscode.workspace.openTextDocument(outPath);
                await vscode.window.showTextDocument(doc, { preview: false });
              } catch (openErr) {
                console.error('B4X: open diagnostics file failed', openErr);
                void vscode.window.showErrorMessage('Failed to open diagnostics file.');
              }
            }
          });
      } catch (err) {
        console.error('B4X: dumpDiagnostics failed', err);
        void vscode.window.showErrorMessage('B4X: Failed to write diagnostics. See console for details.');
      }
    }),
    // Open last-dumped diagnostics JSON file from workspace root
    vscode.commands.registerCommand('b4xIntellisense.openDiagnostics', async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          void vscode.window.showErrorMessage('No workspace folder is open. Open a workspace and try again.');
          return;
        }

        const projectRoot = folders[0]!.uri.fsPath;
        const diagnosticFile = path.join(projectRoot, 'b4x-intellisense-diagnostics.json');
        if (!fs.existsSync(diagnosticFile)) {
          void vscode.window.showErrorMessage('Diagnostics file not found; run Dump Diagnostics first.');
          return;
        }

        const doc = await vscode.workspace.openTextDocument(diagnosticFile);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        console.error('B4X: openDiagnostics failed', err);
        void vscode.window.showErrorMessage('Failed to open diagnostics file.');
      }
    }),
    // Master diagnostic command for one-button run of all diag ops
    vscode.commands.registerCommand('b4xIntellisense.runDiagnostics', async () => {
      try {
        await vscode.commands.executeCommand('b4xIntellisense.debugState');
        await vscode.commands.executeCommand('b4xIntellisense.printStores');
        await vscode.commands.executeCommand('b4xIntellisense.dumpDiagnostics');
        await vscode.commands.executeCommand('b4xIntellisense.openDiagnostics');
      } catch (err) {
        console.error('B4X: runDiagnostics failed', err);
        void vscode.window.showErrorMessage('Failed to run diagnostics. See console for details.');
      }
    }),
    // B4X Intellisense context submenu commands
    vscode.commands.registerCommand('b4xIntellisense.gotoDefinition', async () => {
      await vscode.commands.executeCommand('editor.action.revealDefinition');
    }),
    vscode.commands.registerCommand('b4xIntellisense.findReferences', async () => {
      await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
    }),
    vscode.commands.registerCommand('b4xIntellisense.renameSymbol', async () => {
      await vscode.commands.executeCommand('editor.action.rename');
    }),
    vscode.commands.registerCommand('b4xIntellisense.formatDocument', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      // Step 1: Un-format first — strip all leading indentation
      const lines = document.getText().split(/\r?\n/);
      const unformatted = lines.map(l => l.trimStart());
      const unformattedText = unformatted.join('\n');
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0),
      );
      const edit1 = new vscode.WorkspaceEdit();
      edit1.replace(document.uri, fullRange, unformattedText);
      await vscode.workspace.applyEdit(edit1);
      // Step 2: Format the clean document
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('b4xIntellisense.formatSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const selection = editor.selection;
      if (selection.isEmpty) return;
      // Step 1: Un-format the selection first
      const edits: vscode.TextEdit[] = [];
      for (let line = selection.start.line; line <= selection.end.line; line++) {
        const lineText = document.lineAt(line).text;
        const trimmed = lineText.trimStart();
        if (lineText !== trimmed) {
          const indentLength = lineText.length - trimmed.length;
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(line, 0, line, indentLength),
              '',
            ),
          );
        }
      }
      if (edits.length > 0) {
        const edit1 = new vscode.WorkspaceEdit();
        edit1.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit1);
      }
      // Step 2: Format the cleaned selection
      await vscode.commands.executeCommand('editor.action.formatSelection');
    }),
    vscode.commands.registerCommand('b4xIntellisense.gotoImplementation', async () => {
      await vscode.commands.executeCommand('editor.action.goToImplementation');
    }),
    vscode.commands.registerCommand('b4xIntellisense.gotoTypeDefinition', async () => {
      await vscode.commands.executeCommand('editor.action.goToTypeDefinition');
    }),
    vscode.commands.registerCommand('b4xIntellisense.unformatSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const selection = editor.selection;
      if (selection.isEmpty) return;
      const edits: vscode.TextEdit[] = [];
      for (let line = selection.start.line; line <= selection.end.line; line++) {
        const lineText = document.lineAt(line).text;
        const trimmed = lineText.trimStart();
        if (trimmed !== '' && lineText !== trimmed) {
          const indentLength = lineText.length - trimmed.length;
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(line, 0, line, indentLength),
              '',
            ),
          );
        }
      }
      if (edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.blockComment', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const selection = editor.selection;
      if (selection.isEmpty) {
        // Single line: comment out current line
        const line = document.lineAt(selection.active.line);
        const trimmed = line.text.trimStart();
        if (trimmed === '' || trimmed.startsWith("'")) return;
        const edits: vscode.TextEdit[] = [];
        const indentLength = line.text.length - trimmed.length;
        edits.push(
          new vscode.TextEdit(
            new vscode.Range(selection.active.line, indentLength, selection.active.line, indentLength),
            "' ",
          ),
        );
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
      } else {
        // Multi-line selection
        const edits: vscode.TextEdit[] = [];
        const startLine = selection.start.line;
        const endLine = selection.end.character === 0 && selection.end.line > startLine
          ? selection.end.line - 1
          : selection.end.line;
        for (let line = startLine; line <= endLine; line++) {
          const lineText = document.lineAt(line).text;
          const trimmed = lineText.trimStart();
          if (trimmed === '' || trimmed.startsWith("'")) continue;
          const indentLength = lineText.length - trimmed.length;
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(line, indentLength, line, indentLength),
              "' ",
            ),
          );
        }
        if (edits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          workspaceEdit.set(document.uri, edits);
          await vscode.workspace.applyEdit(workspaceEdit);
        }
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.unblockComment', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const selection = editor.selection;
      if (selection.isEmpty) {
        // Single line: uncomment current line
        const line = document.lineAt(selection.active.line);
        const trimmed = line.text.trimStart();
        if (!trimmed.startsWith("'")) return;
        const indentLength = line.text.length - trimmed.length;
        const rest = trimmed.slice(1).trimStart();
        const edits: vscode.TextEdit[] = [];
        edits.push(
          new vscode.TextEdit(
            new vscode.Range(selection.active.line, indentLength, selection.active.line, line.text.length),
            rest,
          ),
        );
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
      } else {
        // Multi-line selection
        const edits: vscode.TextEdit[] = [];
        const startLine = selection.start.line;
        const endLine = selection.end.character === 0 && selection.end.line > startLine
          ? selection.end.line - 1
          : selection.end.line;
        for (let line = startLine; line <= endLine; line++) {
          const lineText = document.lineAt(line).text;
          const trimmed = lineText.trimStart();
          if (!trimmed.startsWith("'")) continue;
          const indentLength = lineText.length - trimmed.length;
          const rest = trimmed.slice(1).trimStart();
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(line, indentLength, line, lineText.length),
              rest,
            ),
          );
        }
        if (edits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          workspaceEdit.set(document.uri, edits);
          await vscode.workspace.applyEdit(workspaceEdit);
        }
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.triggerSuggest', async () => {
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
    }),
    vscode.commands.registerCommand('b4xIntellisense.triggerParameterHints', async () => {
      await vscode.commands.executeCommand('editor.action.triggerParameterHints');
    }),
    vscode.commands.registerCommand('b4xIntellisense.gotoSymbol', async () => {
      await vscode.commands.executeCommand('workbench.action.gotoSymbol');
    }),
    vscode.commands.registerCommand('b4xIntellisense.searchOnline', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      let word = editor.document.getText(selection);
      if (!word) {
        const wordRange = editor.document.getWordRangeAtPosition(selection.active, /[A-Za-z_][A-Za-z0-9_]*/);
        if (wordRange) {
          word = editor.document.getText(wordRange);
        }
      }
      if (!word) return;
      // Determine platform from file extension first, then fall back to project context
      const fileName = editor.document.fileName.toLowerCase();
      let product = fileName.endsWith('.b4j') ? 'b4j'
        : fileName.endsWith('.b4i') ? 'b4i'
        : fileName.endsWith('.b4r') ? 'b4r'
        : fileName.endsWith('.b4a') ? 'b4a'
        : null;
      // For .bas files, infer from the current project's platform
      if (!product && currentProjectDirectory) {
        const platformExt = currentProjectDirectory.toLowerCase();
        if (platformExt.endsWith('.b4j')) product = 'b4j';
        else if (platformExt.endsWith('.b4i')) product = 'b4i';
        else if (platformExt.endsWith('.b4r')) product = 'b4r';
        else product = 'b4a';
      } else if (!product) {
        product = 'b4a';
      }
      const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(word)}&ide=true&product=${product}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('b4xIntellisense.peekDefinition', async () => {
      await vscode.commands.executeCommand('editor.action.peekDefinition');
    }),
    vscode.commands.registerCommand('b4xIntellisense.quickFix', async () => {
      await vscode.commands.executeCommand('editor.action.quickFix');
    }),
    vscode.commands.registerCommand('b4xIntellisense.unformatDocument', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const edits: vscode.TextEdit[] = [];
      const lines = document.getText().split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const original = lines[i];
        if (original === undefined) continue;
        // Trim leading whitespace but preserve blank lines and comments
        const trimmed = original.trimStart();
        if (original !== trimmed && original !== '') {
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(i, 0, i, original.length),
              trimmed,
            ),
          );
        }
      }
      if (edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
      }
    }),
    vscode.commands.registerCommand('b4xIntellisense.removeBlankLines', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const lines = document.getText().split(/\r?\n/);
      const compacted = lines.filter(l => l && l.trim() !== '');
      const newText = compacted.join('\n') + '\n';
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('b4xIntellisense.removeComments', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const lines = document.getText().split(/\r?\n/);
      const filtered = lines.filter(l => {
        const trimmed = l.trimStart();
        return trimmed !== '' && !trimmed.startsWith("'");
      });
      const newText = filtered.join('\n') + '\n';
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    // Run installer script for the active workspace using configured B4A install path
    vscode.commands.registerCommand('b4xIntellisense.installProject', async () => {
      try {
        const lastOpenedPath = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE, '');
        const lastOpenedPlatform = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_PLATFORM, '');

        let projectFilePath = '';
        let platformKey = '';

        if (lastOpenedPath && fs.existsSync(lastOpenedPath)) {
          projectFilePath = lastOpenedPath;
          platformKey = lastOpenedPlatform || detectPlatformFromPath(lastOpenedPath) || 'B4A';
        } else {
          const chosenFolder = await pickWorkspaceFolder('Select workspace to install');
          if (!chosenFolder) return;

          // Detect which platform folders exist in the workspace.
          const detectedPlatforms: { key: string; projectDir: string }[] = [];
          for (const [key, config] of Object.entries(B4X_PLATFORMS)) {
            const subDir = path.join(chosenFolder!.uri.fsPath, config.folder);
            if (fs.existsSync(subDir)) {
              detectedPlatforms.push({ key, projectDir: subDir });
            }
          }
          // Fallback: scan workspace root for project files directly
          if (detectedPlatforms.length === 0) {
            const rootFiles = fs.readdirSync(chosenFolder!.uri.fsPath);
            for (const [key, config] of Object.entries(B4X_PLATFORMS)) {
              if (rootFiles.some((f) => f.toLowerCase().endsWith(config.ext))) {
                detectedPlatforms.push({ key, projectDir: chosenFolder!.uri.fsPath });
              }
            }
          }
          if (detectedPlatforms.length === 0) {
            void vscode.window.showErrorMessage('No B4X project found in workspace.');
            return;
          }

          let chosen = detectedPlatforms[0]!;
          if (detectedPlatforms.length > 1) {
            const openedPlatform = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_PLATFORM);
            if (openedPlatform) {
              const match = detectedPlatforms.find((d) => d.key === openedPlatform);
              if (match) { chosen = match; }
            }
          }
          platformKey = chosen.key;
          const platform = B4X_PLATFORMS[platformKey]!;
          const platformPath = chosen.projectDir;

          // Find project files matching the platform extension
          const candidates = fs.readdirSync(platformPath).filter((n) => n.toLowerCase().endsWith(platform.ext));
          if (candidates.length === 0) {
            void vscode.window.showErrorMessage(`No ${platform.ext} project file found in ${platform.folder} folder.`);
            return;
          }
          let projectFileName = candidates[0];
          if (candidates.length > 1) {
            const pick = await vscode.window.showQuickPick(candidates, { placeHolder: `Select ${platform.ext} project file to build` });
            if (!pick) { return; }
            projectFileName = pick;
          }
          projectFilePath = path.join(platformPath, projectFileName!);
        }

        const platform = B4X_PLATFORMS[platformKey.toUpperCase()]!;

        // Resolve builder install path
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        let installDir = cfg.get<string>(platform.settingKey, '') ?? '';
        if (!installDir) {
          installDir = getDefaultInstallPath(platformKey);
        }
        if (!fs.existsSync(installDir)) {
          const setNow = 'Set install folder';
          const choice = await vscode.window.showInformationMessage(`${platformKey} install path not found (${installDir}). Set it now?`, setNow, 'Cancel');
          if (choice !== setNow) { return; }
          const foldersPick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: `Select ${platformKey} install folder` });
          if (!foldersPick || foldersPick.length === 0) { return; }
          installDir = foldersPick[0]!.fsPath;
          await cfg.update(platform.settingKey, installDir, vscode.ConfigurationTarget.Workspace);
        }

        const builderExe = getBuilderPath(platformKey, installDir);
        if (!fs.existsSync(builderExe)) {
          void vscode.window.showErrorMessage(`Builder not found: ${builderExe}`);
          return;
        }

        if (process.platform !== 'win32' && getB4xBooleanSetting('wine.enabled', false) && platformKey.toUpperCase() === 'B4J') {
          await buildAndRunB4JWithWine(installDir, projectFilePath);
          return;
        }

        const scriptPath = context.asAbsolutePath(path.join('src', 'install.ps1'));

        const term = vscode.window.createTerminal({ name: `B4X Install (${platformKey})` });
        term.show(true);

        const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

        // Resolve adb path only for platforms that need it (B4A)
        let adbPath = '';
        // Resolve java path for B4J execution if needed
        let javaPathArg = '';
        if (platformKey.toUpperCase() === 'B4J') {
          let b4jJavaPath = cfg.get<string>('b4jJavaPath', '') ?? '';
          if (!b4jJavaPath) {
            // Attempt to detect from B4J INI file
            const b4jIni = cfg.get<string>('b4jIniPath', '') ?? '';
            if (b4jIni && fs.existsSync(b4jIni)) {
              const iniConfig = await loadPlatformIni({ platform: 'b4j', iniPath: b4jIni });
              if (iniConfig?.folders.javacPath) {
                const binDir = path.dirname(iniConfig.folders.javacPath);
                const javaExec = path.join(binDir, 'java.exe');
                if (fs.existsSync(javaExec)) {
                  b4jJavaPath = javaExec;
                }
              }
            }
          }
          if (b4jJavaPath) {
            javaPathArg = ` -JavaPath "${b4jJavaPath}"`;
          }
        }

        const cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Platform "${platformKey}" -BuilderPath "${builderExe}"${adbPath ? ` -AdbPath "${adbPath}"` : ''}${javaPathArg} -ProjectFile "${projectFilePath}"`;
        term.sendText(cmd, true);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to start install process.');
        console.error('installProject failed', err);
      }
    }),
    // Start Android emulator using bundled PowerShell script
    vscode.commands.registerCommand('b4xIntellisense.startEmulator', async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');

        // Resolve emulator path from setting or use default
        let emulatorPath = cfg.get<string>('emulatorPath', '') ?? '';
        if (!emulatorPath || !fs.existsSync(emulatorPath)) {
          const defaultEmulator = 'C:\\b4a\\sdk\\emulator\\emulator.exe';
          if (fs.existsSync(defaultEmulator)) {
            emulatorPath = defaultEmulator;
          } else {
            const setNow = 'Set emulator path';
            const choice = await vscode.window.showInformationMessage(
              'Android emulator not found. Set the path now?',
              setNow,
              'Cancel'
            );
            if (choice !== setNow) return;
            const foldersPick = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              openLabel: 'Select emulator.exe',
            });
            if (!foldersPick || foldersPick.length === 0) return;
            emulatorPath = foldersPick[0]!.fsPath;
            await cfg.update('emulatorPath', emulatorPath, vscode.ConfigurationTarget.Workspace);
          }
        }

        const scriptPath = context.asAbsolutePath(path.join('src', 'startemulator.ps1'));
        const term = vscode.window.createTerminal({ name: 'B4X Emulator' });
        term.show(true);
        const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

        // Optionally pass a configured B4A INI path so the script can derive the SDK root
        const configuredIni = cfg.get<string>('b4aIniPath', '') ?? '';
        let cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -EmulatorPath "${emulatorPath}"`;
        if (configuredIni && fs.existsSync(configuredIni)) {
          // Wrap in quotes in case the path contains spaces
          cmd += ` -IniPath "${configuredIni}"`;
        }
        term.sendText(cmd, true);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to start emulator.');
        console.error('startEmulator failed', err);
      }
    }),
    // Prompt user to set platform install folders (used by installer scripts)
    vscode.commands.registerCommand('b4xIntellisense.setB4aInstallPath', async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        
        // Let user choose which platform to configure
        const platforms = [
          { label: 'B4A', key: 'b4aInstallPath', defaultPath: 'C:\\Program Files\\Anywhere Software\\B4A' },
          { label: 'B4i', key: 'b4iInstallPath', defaultPath: 'C:\\Program Files (x86)\\Anywhere Software\\B4i' },
          { label: 'B4J', key: 'b4jInstallPath', defaultPath: 'C:\\Program Files\\Anywhere Software\\B4J' },
          { label: 'B4R', key: 'b4rInstallPath', defaultPath: 'C:\\Program Files\\Anywhere Software\\B4R' },
        ];
        
        const pick = await vscode.window.showQuickPick(platforms.map(p => ({ label: p.label, description: p.defaultPath })), {
          placeHolder: 'Select platform to configure',
        });
        if (!pick) return;
        
        const platform = platforms.find(p => p.label === pick.label)!;
        const current = cfg.get<string>(platform.key, '');
        const defaultUri = current ? vscode.Uri.file(current) : vscode.Uri.file(platform.defaultPath);
        const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri, openLabel: `Select ${platform.label} Install Folder` });
        if (!folders || folders.length === 0) { return; }
        const chosenFolder = folders[0];
        if (!chosenFolder) { return; }
        const chosen = chosenFolder.fsPath;
        await cfg.update(platform.key, chosen, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`${platform.label} install path set to ${chosen}`);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to set install path.');
        console.error('setB4aInstallPath failed', err);
      }
    }),
    // Open extension settings in Settings editor filtered to our extension
    vscode.commands.registerCommand('b4xIntellisense.openSettings', async () => {
      try {
        // Open Settings UI filtered to the extension's configuration section
        await vscode.commands.executeCommand('workbench.action.openSettings', 'b4xIntellisense');
      } catch (err) {
        console.error('B4X: failed to open extension settings', err);
        void vscode.window.showErrorMessage('Failed to open B4X extension settings.');
      }
    }),
    // Import a .vssettings from the configured B4X install Themes folder
    // (the standalone `importVsSettings` command was removed in favor of importing from the
    // B4X install which better matches workspace/theme hints)
    // Import a .vssettings from the configured B4X install Themes folder
    vscode.commands.registerCommand('b4xIntellisense.importThemeFromInstall', async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        
        // Determine which platform to use: prefer the last opened project's platform
        const lastPlatform = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_PLATFORM);
        const installPathSetting = lastPlatform ? `${lastPlatform}InstallPath` : 'b4aInstallPath';
        const platformLabel = lastPlatform ? lastPlatform.toUpperCase() : 'B4A';
        
        let installPath = cfg.get<string>(installPathSetting, '') ?? '';
        if (!installPath || !fs.existsSync(installPath)) {
          const setNow = 'Set install folder';
          const choice = await vscode.window.showInformationMessage(`${platformLabel} install path is not configured. Set it now?`, setNow, 'Cancel');
          if (choice !== setNow) return;
          const foldersPick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: `Select ${platformLabel} install folder` });
          if (!foldersPick || foldersPick.length === 0) return;
          installPath = foldersPick[0]!.fsPath;
          await cfg.update(installPathSetting, installPath, vscode.ConfigurationTarget.Workspace);
        }

        const themesDir = path.join(installPath, 'Themes');
        const stat = await fs.promises.stat(themesDir).catch(() => undefined);
        if (!stat || !stat.isDirectory()) {
          void vscode.window.showInformationMessage(`No Themes folder found in ${platformLabel} install.`);
          return;
        }

        const entries = await fs.promises.readdir(themesDir, { withFileTypes: true });
        const candidates = entries.filter((e) => e.isFile() && (e.name.toLowerCase().endsWith('.vssettings') || e.name.toLowerCase().endsWith('.xml'))).map((e) => e.name);
        if (candidates.length === 0) {
          void vscode.window.showInformationMessage(`No .vssettings files found in ${platformLabel} Themes folder.`);
          return;
        }

        const pick = await vscode.window.showQuickPick(candidates, { placeHolder: `Select a theme to import from ${platformLabel} install` });
        if (!pick) return;
        const pickedPath = path.join(themesDir, pick);

        const applyNow = 'Import and Apply';
        const importOnly = 'Import Only';
        const choice = await vscode.window.showInformationMessage(`Import theme '${pick}' from ${platformLabel} install?`, applyNow, importOnly, 'Cancel');
        if (!choice || choice === 'Cancel') return;

        const autoApply = choice === applyNow;
        await importVsSettingsFile(vscode.Uri.file(pickedPath), autoApply);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to import theme from B4A install. See console for details.');
        console.error('importThemeFromInstall failed', err);
      }
    }),
    // Open bundled documentation (README.md or User Manual)
    vscode.commands.registerCommand('b4xIntellisense.openDocs', async () => {
      try {
        const choice = await vscode.window.showQuickPick(['User Manual', 'README'], { placeHolder: 'Open documentation' });
        if (!choice) return;
        const fileName = choice === 'User Manual' ? 'docs/manual.md' : 'README.md';
        const docPath = path.join(context.extensionPath, fileName);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docPath));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        void vscode.window.showErrorMessage('Unable to open B4X IntelliSense documentation.');
        console.error('openDocs failed', err);
      }
    }),
    // Open the B4X website in a workspace webview (falls back to external browser)
    vscode.commands.registerCommand('b4xIntellisense.openB4x', async () => {
      try {
        const panel = vscode.window.createWebviewPanel(
          'b4xWebsite',
          'B4X Website',
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
          },
        );
        // Ensure the panel is disposed when closed or on extension deactivation
        panel.onDidDispose(() => { /* cleanup */ });
        context.subscriptions.push(panel);

        panel.webview.html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https:; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html,body,iframe{height:100%;width:100%;margin:0;padding:0;border:0} .note{padding:8px;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif}</style>
  </head>
  <body>
    <iframe id="site" src="https://www.b4x.com/" title="B4X website" sandbox="allow-forms allow-scripts allow-same-origin allow-popups"></iframe>
    <div class="note">If the site prevents embedding, <a id="openExt" href="#">open in external browser</a>.</div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('openExt').addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ command: 'openExternal' });
      });
    </script>
  </body>
</html>`;

        panel.webview.onDidReceiveMessage(async (msg) => {
          if (msg?.command === 'openExternal') {
            try {
              await vscode.env.openExternal(vscode.Uri.parse('https://www.b4x.com/'));
            } catch (err) {
              console.error('Failed to open external URL', err);
            }
          }
        });
      } catch (err) {
        void vscode.window.showErrorMessage('Unable to open B4X website.');
        console.error('openB4X failed', err);
      }
    }),
    // Backup active workspace platform folders (runs bundled PowerShell script with confirmation)
    vscode.commands.registerCommand('b4xIntellisense.backupWorkspace', async () => {
      try {
        const chosenFolder = await pickWorkspaceFolder('Select workspace for backup');
        if (!chosenFolder) return;

        // Detect which platform folders exist
        const platformFolders = [
          { name: 'B4A', path: path.join(chosenFolder!.uri.fsPath, 'B4A') },
          { name: 'B4i', path: path.join(chosenFolder!.uri.fsPath, 'B4i') },
          { name: 'B4J', path: path.join(chosenFolder!.uri.fsPath, 'B4J') },
          { name: 'B4R', path: path.join(chosenFolder!.uri.fsPath, 'B4R') },
        ].filter(pf => fs.existsSync(pf.path));
        
        if (platformFolders.length === 0) {
          void vscode.window.showErrorMessage(`No B4X platform folders found in workspace: ${chosenFolder!.uri.fsPath}`);
          return;
        }

        const platformNames = platformFolders.map(pf => pf.name).join(', ');
        const confirm = await vscode.window.showInformationMessage(
          `Create a backup of ${platformNames} folder(s) for '${chosenFolder!.name}'?`,
          { modal: true },
          'Backup',
        );
        if (confirm !== 'Backup') { return; }

        const backupChannel = vscode.window.createOutputChannel('B4X Backup');
        backupChannel.show(true);
        
        const scriptPath = context.asAbsolutePath(path.join('src', 'backup.ps1'));
        const backupRoot = path.join(chosenFolder!.uri.fsPath, '_backups');
        const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'B4X: Creating backup...', cancellable: false }, async (progress) => {
          let completed = 0;
          for (const pf of platformFolders) {
            backupChannel.appendLine(`Backing up: ${pf.name} (${pf.path})`);
            progress.report({ message: `Backing up ${pf.name}...` });
            
            const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-SourcePath', pf.path, '-BackupRoot', backupRoot];
            backupChannel.appendLine(`${runner} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
            
            await new Promise((resolve, reject) => {
              const proc = cp.spawn(runner, args, { windowsHide: true });
              proc.stdout.on('data', (b) => backupChannel.append(b.toString()));
              proc.stderr.on('data', (b) => backupChannel.append(b.toString()));
              proc.on('error', (err) => {
                backupChannel.appendLine(`Failed to start backup script for ${pf.name}: ${String(err)}`);
                void vscode.window.showErrorMessage(`Failed to backup ${pf.name}. See B4X Backup output.`);
                completed++;
                reject(err);
              });
              proc.on('close', (code) => {
                if (code === 0) {
                  backupChannel.appendLine(`Backup completed successfully for ${pf.name}.`);
                } else {
                  backupChannel.appendLine(`Backup may have failed for ${pf.name} (exit code ${code}).`);
                }
                completed++;
                resolve(code);
              });
            });
          }
          progress.report({ message: 'Backup finished' });
        });
      } catch (err) {
        void vscode.window.showErrorMessage('Backup failed to start.');
        console.error('backupWorkspace failed', err);
      }
    }),
      // Capture GIF from device using adb + ffmpeg (runs bundled PowerShell script)
      vscode.commands.registerCommand('b4xIntellisense.captureGif', async () => {
        try {
          const name = await vscode.window.showInputBox({ placeHolder: 'Enter GIF name (no extension)', prompt: 'Name for the GIF file' });
          if (!name) { return; }

          const chosenFolder = await pickWorkspaceFolder('Select workspace for GIF capture');
          if (!chosenFolder) return;

          // Resolve adb and ffmpeg paths
          const adbPath = await resolveAdbPath(context);
          const ffmpegPath = await resolveFfmpegPath();

          const scriptPath = context.asAbsolutePath(path.join('src', 'gif.ps1'));
          const term = vscode.window.createTerminal({ name: 'B4X GIF', cwd: chosenFolder!.uri.fsPath });
          term.show(true);
          const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
          const cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Name "${name}"${adbPath ? ` -AdbPath "${adbPath}"` : ''}${ffmpegPath ? ` -FfmpegPath "${ffmpegPath}"` : ''}`;
          term.sendText(cmd, true);
        } catch (err) {
          void vscode.window.showErrorMessage('Failed to start GIF capture.');
          console.error('captureGif failed', err);
        }
      }),
      // Capture screenshots sequence using adb (runs bundled PowerShell script)
      vscode.commands.registerCommand('b4xIntellisense.captureScreenshots', async () => {
        try {
          const prefix = await vscode.window.showInputBox({ placeHolder: 'Enter prefix for screenshots (e.g. page-)', prompt: 'Filename prefix' });
          if (!prefix) { return; }

          const chosenFolder = await pickWorkspaceFolder('Select workspace for screenshots');
          if (!chosenFolder) return;

          // Resolve adb path using shared helper
          const adbPath = await resolveAdbPath(context);

          const scriptPath = context.asAbsolutePath(path.join('src', 'screenshot.ps1'));
          const term = vscode.window.createTerminal({ name: 'B4X Screenshots', cwd: chosenFolder!.uri.fsPath });
          term.show(true);
          const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
          const cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Prefix "${prefix}"${adbPath ? ` -AdbPath "${adbPath}"` : ''}`;
          term.sendText(cmd, true);
        } catch (err) {
          void vscode.window.showErrorMessage('Failed to start screenshot capture.');
          console.error('captureScreenshots failed', err);
        }
      }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new B4xCompletionProvider(workspaceClasses, xmlLibraries, primitiveTypes, commonClass),
      ...completionTriggers,
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new B4xDefinitionProvider(workspaceClasses, xmlLibraries, primitiveTypes),
    ),
    vscode.languages.registerHoverProvider(
      selector,
      new B4xHoverProvider(workspaceClasses, xmlLibraries, primitiveTypes, commonClass, context),
    ),
  );

  try {
    context.subscriptions.push(
      vscode.languages.registerReferenceProvider(
        selector,
        new B4xReferenceProvider(workspaceClasses, xmlLibraries),
      ),
      // Register Folding Range provider
      vscode.languages.registerFoldingRangeProvider(
        selector,
        new B4xFoldingRangeProvider(),
      ),
      // Register Auto-Close Keywords handler
      registerAutoCloseKeywords(context),
    );
  } catch (err) {
    console.error('B4X: Failed to register language providers', err);
  }

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('b4xIntellisense.b4aIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4iIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4jIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4rIniPath')
      ) {
        void reloadPlatformAssets();
      }
    }),
    
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === 'b4x') {
        workspaceClasses.upsertDocument(document);
        return;
      }

      if (document.uri.fsPath.toLowerCase().endsWith('.b4a')) {
        void reloadPlatformAssets();
      }
      // If a generated Main module was edited, sync changes back to the .b4a
      void syncGeneratedMainBack(document);
    }),

    // Command: insert event handler stub into the active editor
    vscode.commands.registerCommand('b4xIntellisense.insertEventHandler', async (args: { ownerClass: string; eventName: string; params: string[] }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      // Build the event handler sub signature
      const subName = `${args.ownerClass}_${args.eventName}`;
      const paramList = args.params.length > 0 ? args.params.join(', ') : '';
      const subLine = `Sub ${subName}(${paramList})`;

      // Insert at the current cursor position (or at end of document if no selection)
      const position = editor.selection.active;
      await editor.edit(editBuilder => {
        editBuilder.insert(position, `${subLine}\n\t\nEnd Sub\n`);
      });

      // Move cursor inside the sub body
      const newPos = position.with(position.line + 1, 1);
      editor.selection = new vscode.Selection(newPos, newPos);
      await vscode.commands.executeCommand('editor.action.indentLines');
    }),

  context.subscriptions.push(
    // Extract Method: sends selected code to the LSP server for extraction.
    // Falls back to a basic client-side extraction when the server is unavailable.
    vscode.commands.registerCommand('b4xIntellisense.extractMethod', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const document = editor.document;
      if (document.languageId !== 'b4x') return;
      const selection = editor.selection;
      if (selection.isEmpty) {
        void vscode.window.showInformationMessage('Select code to extract into a method first.');
        return;
      }

      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const behavior = cfg.get<string>('extractMethod.previewBehavior', 'prompt');

      // Attempt server-side extraction via LSP
      try {
        const result = await sendRequest('b4x/extractMethod', {
          uri: document.uri.toString(),
          range: {
            start: { line: selection.start.line, character: selection.start.character },
            end: { line: selection.end.line, character: selection.end.character },
          },
        });
        if (result?.edits && Array.isArray(result.edits) && result.edits.length > 0) {
          if (behavior === 'autoApply') {
            const workspaceEdit = new vscode.WorkspaceEdit();
            for (const edit of result.edits) {
              const r = new vscode.Range(
                edit.range.start.line, edit.range.start.character,
                edit.range.end.line, edit.range.end.character,
              );
              workspaceEdit.replace(document.uri, r, edit.newText);
            }
            await vscode.workspace.applyEdit(workspaceEdit);
            return;
          }
          if (behavior === 'alwaysPreview' || behavior === 'prompt') {
            // Show diff preview via refactorPreview
            const workspaceEdit = new vscode.WorkspaceEdit();
            for (const edit of result.edits) {
              const r = new vscode.Range(
                edit.range.start.line, edit.range.start.character,
                edit.range.end.line, edit.range.end.character,
              );
              workspaceEdit.replace(document.uri, r, edit.newText);
            }
            if (behavior === 'prompt') {
              const apply = await vscode.window.showInformationMessage(
                'Extract Method: apply the proposed refactoring?',
                { modal: false },
                'Apply',
                'Cancel',
              );
              if (apply !== 'Apply') return;
            }
            await vscode.workspace.applyEdit(workspaceEdit);
            return;
          }
        }
      } catch { /* LSP not available or returned no edits — fall through to client-side */ }

      // Client-side fallback: wrap selection in a new Sub at end of document
      const selectedText = document.getText(selection);
      const lines = selectedText.split(/\r?\n/);
      const methodName = await vscode.window.showInputBox({
        prompt: 'New method name',
        placeHolder: 'ExtractedMethod',
        validateInput: (v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? undefined : 'Must be a valid B4X identifier',
      });
      if (!methodName) return;

      const indented = lines.map(l => `\t${l}`).join('\n');
      const newSub = `\nSub ${methodName}()\n${indented}\nEnd Sub\n`;

      const workspaceEdit = new vscode.WorkspaceEdit();
      // Replace selected lines with a call to the new method
      workspaceEdit.replace(document.uri, selection, `${methodName}()`);
      // Append new sub at the end of the file
      const endPos = new vscode.Position(document.lineCount, 0);
      workspaceEdit.insert(document.uri, endPos, newSub);
      await vscode.workspace.applyEdit(workspaceEdit);
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'b4x') {
        workspaceClasses.upsertDocument(event.document);
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document || event.document.languageId !== 'b4x') {
        return;
      }

      const insertedDot = event.contentChanges.some((change) => change.text === '.' && change.rangeLength === 0);
      if (!insertedDot) {
        return;
      }

      scheduleMemberSuggest(event.document);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.languageId !== 'b4x') {
        return;
      }

      const selection = event.selections[0];
      if (!selection || !selection.isEmpty) {
        return;
      }

      if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
        return;
      }

      scheduleMemberSuggest(event.textEditor.document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      // minimal handler to avoid side-effects during active editor changes
      if (!editor) return;
    }),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      new B4xSignatureHelpProvider(workspaceClasses, xmlLibraries, primitiveTypes, commonClass),
      '(',
      ',',
    ),
  );

  context.subscriptions.push(
    // Type diagnostics: warn when `Type` is declared outside Class_Globals / Process_Globals
    registerTypeDiagnostics(context),
    // CallSub validation: warn when CallSub references a non-existent Sub
    registerCallSubDiagnostics(context, workspaceClasses, xmlLibraries),
    // Code actions: quick-fix to move Type blocks into Class_Globals/Process_Globals
    vscode.languages.registerCodeActionsProvider(selector, new TypeCodeActionProvider(), { providedCodeActionKinds: TypeCodeActionProvider.providedCodeActionKinds }),
    vscode.languages.registerCodeActionsProvider(selector, new ExtractMethodCodeActionProvider(), { providedCodeActionKinds: ExtractMethodCodeActionProvider.providedCodeActionKinds }),
    // Document Symbols: Outline view and Ctrl+Shift+O (Go to Symbol in Editor)
    vscode.languages.registerDocumentSymbolProvider(
      selector,
      new B4xDocumentSymbolProvider(),
    ),
    // Workspace Symbols: Ctrl+T (Go to Symbol in Workspace)
    vscode.languages.registerWorkspaceSymbolProvider(
      new B4xWorkspaceSymbolProvider(workspaceClasses, xmlLibraries),
    ),
    // Document Formatting: Shift+Alt+F
    vscode.languages.registerDocumentFormattingEditProvider(
      selector,
      new B4xDocumentFormattingProvider(),
    ),
    // Rename: F2
    vscode.languages.registerRenameProvider(
      selector,
      new B4xRenameProvider(),
    ),
    // Code Lens: reference counts above Subs
    (() => {
      const codeLensProvider = new B4xCodeLensProvider(workspaceClasses);
      // Refresh CodeLens when documents are saved (references may have changed)
      const codeLensRefresh = vscode.workspace.onDidSaveTextDocument(() => codeLensProvider.refresh());
      context.subscriptions.push(codeLensRefresh);
      return vscode.languages.registerCodeLensProvider(selector, codeLensProvider);
    })(),
    // Document Range Formatting: format selected text
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      new B4xDocumentRangeFormattingProvider(),
    ),
    // Document Highlight: highlight all occurrences under cursor
    vscode.languages.registerDocumentHighlightProvider(
      selector,
      new B4xDocumentHighlightProvider(),
    ),
  );

  context.subscriptions.push(
    // Document Links: clickable links for #AdditionalJar, LoadLayout, ShowPage
    vscode.languages.registerDocumentLinkProvider(
      selector,
      new B4xDocumentLinkProvider(),
    ),
    // On-Type Formatting: auto-fix keyword casing as you type
    vscode.languages.registerOnTypeFormattingEditProvider(
      selector,
      new B4xOnTypeFormattingProvider(),
      ' ',
      '\n',
      ':',
    ),
    // Selection Ranges: smart expand selection
    vscode.languages.registerSelectionRangeProvider(
      selector,
      new B4xSelectionRangeProvider(),
    ),
    // Implementation: Go to Implementation
    vscode.languages.registerImplementationProvider(
      selector,
      new B4xImplementationProvider(workspaceClasses, xmlLibraries),
    ),
    // Type Definition: Go to Type Definition
    vscode.languages.registerTypeDefinitionProvider(
      selector,
      new B4xTypeDefinitionProvider(workspaceClasses, xmlLibraries, primitiveTypes),
    ),
    // Inline Completions: ghost text completions (Tab to accept)
    vscode.languages.registerInlineCompletionItemProvider(
      selector,
      new B4xInlineCompletionItemProvider(workspaceClasses, xmlLibraries),
    ),
  );

  // Semantic tokens: mark globals (from `Sub Class_Globals` and `Sub Process_Globals`) as `variable` with modifiers
  // so themes can color them differently when used inside methods. Modifiers emitted: static, private, public, process
  context.subscriptions.push(
    ((): vscode.Disposable => {
      /** Find the position of the first B4X comment marker (') that is not inside a string. */
      function findCommentPosition(text: string): number {
        let inString = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (ch === '"' && (i === 0 || text[i - 1] !== '\\')) {
            inString = !inString;
          } else if (ch === "'" && !inString) {
            return i;
          }
        }
        return text.length; // no comment found
      }
      /** Check if a character position is inside a double-quoted string. */
      function isInsideString(text: string, pos: number): boolean {
        let inString = false;
        for (let i = 0; i < pos && i < text.length; i++) {
          if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
            inString = !inString;
          }
        }
        return inString;
      }

      const legend = new vscode.SemanticTokensLegend(['variable'], ['static', 'private', 'public', 'process']);
      const provider: vscode.DocumentSemanticTokensProvider = {
        provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
          const globals = collectGlobalsVariables(document); // Map name -> { visibility, scope }
          if (globals.size === 0) {
            return new vscode.SemanticTokens(new Uint32Array());
          }

          const subRanges = collectSubRanges(document);
          const builder = new vscode.SemanticTokensBuilder(legend);

          for (const [startLine, endLine] of subRanges) {
            for (let line = startLine; line <= endLine; line += 1) {
              const text = document.lineAt(line).text;
              // Find comment start position (first ' not inside a string)
              const commentPos = findCommentPosition(text);
              for (const [name, info] of globals) {
                const regex = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
                let match: RegExpExecArray | null;
                while ((match = regex.exec(text)) !== null) {
                  // Skip matches inside comments or strings
                  if (match.index >= commentPos) continue;
                  if (isInsideString(text, match.index)) continue;
                  const startChar = match.index;
                  const length = match[0].length;
                  // tokenType 0 -> 'variable'
                  // modifier bits: 1<<0 static, 1<<1 private, 1<<2 public, 1<<3 process
                  let modifierMask = 0;
                  if (info.scope === 'class') modifierMask |= (1 << 0); // static
                  if (info.visibility === 'private') modifierMask |= (1 << 1);
                  if (info.visibility === 'public' || info.visibility === 'dim') modifierMask |= (1 << 2);
                  if (info.scope === 'process') modifierMask |= (1 << 3);
                  builder.push(line, startChar, length, 0, modifierMask);
                }
              }
            }
          }

          return builder.build();
        },
      };

      return vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);
    })(),
  );

  // Pre-scan all platform library folders for .b4xtemplate files.
  // Scanning runs asynchronously but callers can await templateScanComplete.
  scanTemplates();

  // If the extension was restarted after an Open Project flow (for example
  // when `updateWorkspaceFolders` or `vscode.openFolder` caused a reload),
  // resume the project load automatically using the persisted last-opened
  // project file stored in globalState. Use a step tracker so the status
  // bar continues to show numbered progress (1/10, 2/10...) during reload.
  if (hasOpenedProject) {
    void (async () => {
      const activationSteps = createStepTracker(10);
      try {
        await reloadPlatformAssets({}, activationSteps);
        void (async () => {
          try {
            await startB4XLanguageClient(context, activationSteps);
          } catch {
            statusBarItem.text = '$(check) B4X: Ready (No LSP)';
            void context.globalState.update(GLOBAL_STATE_LAST_STATUS, statusBarItem.text);
          }
        })();
        console.log('B4X: activation auto-reload completed for', context.globalState.get(GLOBAL_STATE_LAST_PROJECT_FILE));
      } catch (err) {
        console.error('B4X: activation auto-reload failed', err);
        activationSteps.error('Reload failed');
      }
    })();
  }

  // Register a user-facing command to reload the currently opened B4X project
  // (re-applies INI hints and reloads platform assets). This provides a
  // convenient Command Palette entry for test workflows and manual reloads.
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.reloadProject', async () => {
      try {
        const lastProject = context.globalState.get<string>(GLOBAL_STATE_LAST_PROJECT_FILE);
        if (!lastProject || !fs.existsSync(lastProject)) {
          void vscode.window.showWarningMessage('B4X: No opened project to reload. Open a project first.');
          return;
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'B4X: Reloading project...', cancellable: false }, async (progress) => {
          const reloadSteps = createStepTracker(10);
          try {
            await reloadPlatformAssets({}, reloadSteps);
            void (async () => {
              try {
                await startB4XLanguageClient(context, reloadSteps);
                void vscode.window.showInformationMessage('B4X: Project reload complete');
              } catch {
                statusBarItem.text = '$(check) B4X: Ready (No LSP)';
                void context.globalState.update(GLOBAL_STATE_LAST_STATUS, statusBarItem.text);
              }
            })();
          } catch (err) {
            console.error('B4X: reloadProject failed', err);
            reloadSteps.error('Reload failed');
            void vscode.window.showErrorMessage('B4X: Project reload failed. See console for details.');
          }
        });
      } catch (err) {
        console.error('B4X: reloadProject handler failed', err);
        void vscode.window.showErrorMessage('B4X: Project reload failed. See console for details.');
      }
    }),
  );

  // Status summary shown when the user clicks the B4X status bar item
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.showStatusSummary', async () => {
      try {
        const templatesCount = cachedTemplates.length;
        const b4xlibsCount = lastLoadedB4xlibFiles.length;
        const xmlCount = Array.isArray(Array.from(xmlLibraries.loadedFilePaths)) ? Array.from(xmlLibraries.loadedFilePaths).length : xmlLibraries.findClassesByPrefix('').length;
        const modulesCount = Array.isArray(Array.from(workspaceClasses.loadedFilePaths)) ? Array.from(workspaceClasses.loadedFilePaths).length : workspaceClasses.findClassesByPrefix('').length;
        const message = `B4X — Templates: ${templatesCount} | b4xlibs: ${b4xlibsCount} | XML files: ${xmlCount} | Modules: ${modulesCount}`;
        void vscode.window.showInformationMessage(message);
      } catch (err) {
        console.error('B4X: showStatusSummary failed', err);
        void vscode.window.showErrorMessage('B4X: Failed to show status summary');
      }
    }),
  );

  // Make the persistent status bar item clickable to show the summary
  try {
    statusBarItem.command = 'b4xIntellisense.showStatusSummary';
  } catch { /* best-effort */ }

  // Initialize and watch for build context changes (controls Build & Install command visibility)
  updateBuildCommandContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateBuildCommandContext()),
    vscode.workspace.onDidCreateFiles(() => updateBuildCommandContext()),
    vscode.workspace.onDidDeleteFiles(() => updateBuildCommandContext()),
  );

  // Activity Bar: show contributed commands in the `Projects` view so users
  // can run extension commands from the Activity Bar. The view is declared
  // in `package.json` as `b4xProjects`.
  try {
    const commandsProvider = new CommandsProvider(context);
    const treeView = vscode.window.createTreeView('b4xProjects', { treeDataProvider: commandsProvider });
    commandsProvider.bindView(treeView);
    context.subscriptions.push(treeView);

    // Allow manual refresh of the commands list
    context.subscriptions.push(vscode.commands.registerCommand('b4xIntellisense.refreshCommandsView', async () => {
      try { await commandsProvider.reload(); } catch { /* ignore */ }
    }));
  } catch (err) {
    console.error('B4X: Failed to register b4xProjects tree view', err);
  }
}

function dedupePaths(filePaths: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const p of filePaths) {
    const key = pathKey(p);
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values());
}

async function resolveLibraryAssetPath(folder: string, lib: string, ext: '.xml' | '.b4xlib'): Promise<string | undefined> {
  const exactCandidates = [
    path.join(folder, `${lib}${ext}`),
    path.join(folder, lib, `${lib}${ext}`),
  ];

  for (const candidate of exactCandidates) {
    try {
      const st = await fs.promises.stat(candidate).catch(() => undefined);
      if (st?.isFile()) return candidate;
    } catch {
      // ignore and continue
    }
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true }) as fs.Dirent[];
  } catch {
    return undefined;
  }

  const wantedFile = `${lib}${ext}`.toLowerCase();
  const directFile = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === wantedFile);
  if (directFile) {
    return path.join(folder, directFile.name);
  }

  const matchingDir = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === lib.toLowerCase());
  if (!matchingDir) return undefined;

  try {
    const subEntries = await fs.promises.readdir(path.join(folder, matchingDir.name), { withFileTypes: true }) as fs.Dirent[];
    const nestedFile = subEntries.find((entry) => entry.isFile() && entry.name.toLowerCase() === wantedFile);
    if (nestedFile) {
      return path.join(folder, matchingDir.name, nestedFile.name);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function promptForB4xProjectFile(): Promise<vscode.Uri | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Open B4X Project',
    filters: {
      'B4X Project Files': ['b4a', 'b4i', 'b4j', 'b4r'],
    },
  });

  return selection?.[0];
}

/** Configure workspace settings for the project root folder.
 *  Creates .vscode/settings.json with appropriate settings for the selected platform.
 *  Excludes other platform folders that are not part of the opened project. */
async function configureWorkspaceSettings(workspaceRoot: string, platform?: string): Promise<void> {
  try {
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');

    // Create .vscode directory if it doesn't exist
    try {
      await fs.promises.mkdir(vscodeDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Read existing settings if they exist
    let existingSettings: Record<string, any> = {};
    try {
      const existingContent = await fs.promises.readFile(settingsPath, 'utf8');
      existingSettings = JSON.parse(existingContent);
    } catch {
      // Settings file doesn't exist or is invalid, start fresh
    }

    // Clean out stale per-file B4X exclusions from previous extension runs.
    if (existingSettings['files.exclude'] && typeof existingSettings['files.exclude'] === 'object') {
      for (const key of Object.keys(existingSettings['files.exclude'])) {
        if (/\.(bas|b4a|b4i|b4j|b4r)$/i.test(key)) {
          delete existingSettings['files.exclude'][key];
        }
      }
    }

    // Determine which platform folders to exclude
    const platformFolders: Record<string, string> = {
      b4a: 'B4A',
      b4j: 'B4J',
      b4i: 'B4i',
      b4r: 'B4R',
    };
    const activeFolder = platform ? platformFolders[platform] : undefined;
    const excludedFolders = Object.entries(platformFolders)
      .filter(([key]) => key !== platform)
      .map(([, folderName]) => `**/${folderName}/**`);

    // Merge with our B4X-specific settings
    const b4xSettings: Record<string, any> = {
      // File associations for B4X files
      'files.associations': {
        '*.b4a': 'b4x',
        '*.b4j': 'b4x',
        '*.b4i': 'b4x',
        '*.b4r': 'b4x',
        '*.bas': 'b4x',
        '*.bal': 'b4x',
        '*.b4xlib': 'b4x',
      },
      // Exclude other platform folders not part of this project
      'files.exclude': excludedFolders.reduce((acc, pattern) => {
        acc[pattern] = true;
        return acc;
      }, {} as Record<string, boolean>),
      // Exclude common build artifacts from file watchers
      'files.watcherExclude': {
        '**/.b4a_cache': true,
        '**/Objects': true,
        '**/B4A/Objects': true,
      },
      // Search exclusions for better performance
      'search.exclude': {
        ...excludedFolders.reduce((acc, pattern) => {
          acc[pattern] = true;
          return acc;
        }, {} as Record<string, boolean>),
        '**/Objects': true,
        '**/.b4a_cache': true,
      },
    };
    
    // Deep merge the settings
    const mergedSettings = { ...existingSettings };
    for (const [key, value] of Object.entries(b4xSettings)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        mergedSettings[key] = { ...(mergedSettings[key] || {}), ...value };
      } else {
        mergedSettings[key] = value;
      }
    }
    
    // Write settings file
    await fs.promises.writeFile(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
    trace('configureWorkspaceSettings: wrote settings to', settingsPath);
  } catch (err) {
    console.warn('B4X: failed to configure workspace settings', err);
  }
}

/** Find the common ancestor directory that contains all given file paths. */
function findCommonAncestor(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return path.dirname(paths[0]!);

  const resolved = paths.map(p => path.resolve(p));
  let common = path.dirname(resolved[0]!);

  for (let i = 1; i < resolved.length; i++) {
    const currentKey = pathKey(resolved[i]!);
    while (common !== '') {
      const commonKey = pathKey(common);
      if (currentKey === commonKey || currentKey.startsWith(`${commonKey}/`)) {
        break;
      }
      common = path.dirname(common);
      if (common === path.dirname(common)) break;
    }
    if (common === '') break;
  }

  return common;
}

/** Determine the workspace root by scanning the project file for all module paths,
 *  resolving them to absolute paths, and finding their common ancestor.
 *  This ensures the workspace includes all referenced modules without assumptions.
 *
 *  @param projectFilePath The .b4a/.b4j/.b4i/.b4r project file path
 *  @param sharedModuleFolders Shared module folders from INI (for resolving |shared| paths)
 *  @returns The workspace root directory that contains all modules
 */
async function determineWorkspaceRoot(
  projectFilePath: string,
  sharedModuleFolders: readonly string[] = [],
): Promise<string> {
  const projectBase = getB4xProjectRoot(projectFilePath);

  // Parse the project file to get all resolved module paths
  const config = await loadWorkspaceProjectConfig(sharedModuleFolders, vscode.Uri.file(projectFilePath));
  const moduleFiles = config.allowedModuleFiles ?? [];

  if (moduleFiles.length === 0) {
    // No modules resolved — fall back to the project base
    return projectBase;
  }

  // Include the project file itself in the ancestor calculation
  const allPaths = [...moduleFiles, projectFilePath];
  
  // Only include paths that are "inside" or "near" the project base to avoid climbing too high.
  // This satisfies the "don't load C:\b4j" requirement.
  const internalPaths = allPaths.filter(p => {
    const norm = pathKey(p);
    const baseNorm = pathKey(projectBase);
    return norm === baseNorm || norm.startsWith(`${baseNorm}/`);
  });

  const commonAncestor = findCommonAncestor(internalPaths.length > 0 ? internalPaths : [projectFilePath]);

  if (commonAncestor) {
    // Ensure we don't go ABOVE the project base conventions
    const baseNorm = pathKey(projectBase);
    const ancestorNorm = pathKey(commonAncestor);
    if (ancestorNorm.length < baseNorm.length) {
      return projectBase;
    }
    return commonAncestor;
  }

  // Fallback to project base
  return projectBase;
}

/** Replace all workspace folders with the determined workspace root.
 *  The workspace root is computed from actual module paths in the project file,
 *  ensuring all referenced modules appear in the file tree.
 *  When the first workspace folder changes, VS Code MAY restart the extension
 *  host.  Callers should continue their flow after this call.
 *
 *  @param workspaceRoot The workspace root folder URI
 */
function ensureWorkspaceFolder(workspaceRoot: vscode.Uri): void {
  const normalizedWorkspaceRoot = pathKey(workspaceRoot.fsPath);

  const existingFolders = vscode.workspace.workspaceFolders ?? [];
  const alreadyOnlyFolder = existingFolders.length === 1 &&
    pathKey(existingFolders[0]!.uri.fsPath) === normalizedWorkspaceRoot;
  if (alreadyOnlyFolder) {
    return;
  }

  trace('ensureWorkspaceFolder.replace', {
    removed: existingFolders.map(f => f.name),
    adding: workspaceRoot.fsPath,
  });

  vscode.workspace.updateWorkspaceFolders(
    0,                          // start index
    existingFolders.length,     // remove count (remove ALL)
    { uri: workspaceRoot, name: path.basename(workspaceRoot.fsPath) },
  );
}

async function waitForWorkspaceFolderLoad(projectRootFsPath: string, timeoutMs = 5000): Promise<void> {
  const normalized = pathKey(projectRootFsPath);
  const existing = vscode.workspace.workspaceFolders ?? [];
  if (existing.some((f) => pathKey(f.uri.fsPath) === normalized)) {
    return;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      console.warn(`B4X: waitForWorkspaceFolderLoad timed out after ${timeoutMs}ms for ${projectRootFsPath}`);
      resolve();
    }, timeoutMs);

    const disposable = vscode.workspace.onDidChangeWorkspaceFolders((ev) => {
      const now = vscode.workspace.workspaceFolders ?? [];
      if (now.some((f) => pathKey(f.uri.fsPath) === normalized)) {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      }
    });
  });
}

export function deactivate(): void {
  try {
    if (pendingSuggestRequest) {
      clearTimeout(pendingSuggestRequest);
      pendingSuggestRequest = undefined;
    }

    if (lspClientDisposable) {
      try { lspClientDisposable.dispose(); } catch { /* ignore */ }
      lspClientDisposable = undefined;
    }
  } catch (err) {
    // best-effort cleanup
    console.warn('B4X: error during deactivate cleanup', err);
  }
}



class B4xCompletionProvider implements vscode.CompletionItemProvider {
  public constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
    private readonly primitiveTypes: PrimitiveTypeStore,
    private readonly commonClass: CommonClassStore,
  ) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    if (isCommentPosition(lineText, position.character)) {
      return undefined;
    }

    const memberAccess = getMemberAccessInfo(getLinePrefix(document, position));
    if (memberAccess) {
      const memberRange = createMemberCompletionRange(position, memberAccess.memberPrefix);
      const ownerClass = inferCompletionOwnerClass(document, position, this.workspaceClasses, this.xmlLibraries, this.primitiveTypes);
      if (ownerClass) {
        return createMemberCompletionItems(ownerClass, memberAccess.expression, memberAccess.memberPrefix, memberRange);
      }

      const inferredTypes = inferVariableTypes(document, this.workspaceClasses, this.xmlLibraries, this.primitiveTypes);
      const ownerType = resolveExpressionType(
        memberAccess.expression,
        document,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
        this.primitiveTypes,
      );
      const localType = getLocalTypeDefinition(document, ownerType);
      if (localType) {
        return createLocalTypeMemberCompletionItems(localType, memberAccess.expression, memberAccess.memberPrefix, memberRange);
      }

      return [];
    }

    const prefix = getCompletionPrefix(document, position);

    // Handle preprocessor directive completions when line starts with #
    const linePrefix = getLinePrefix(document, position);
    if (linePrefix.trimStart().startsWith('#')) {
      const directivePrefix = linePrefix.replace(/^(\s*)#/, '').trim();
      const directiveItems = createPreprocessorCompletionItems(directivePrefix);
      if (directiveItems.length > 0) {
        return directiveItems;
      }
    }

    return createGeneralCompletionItems(this.workspaceClasses, this.xmlLibraries, this.primitiveTypes, this.commonClass, collectLocalSymbols(document), prefix);
  }
}

class B4xHoverProvider implements vscode.HoverProvider {
  public constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
    private readonly primitiveTypes: PrimitiveTypeStore,
    private readonly commonClass: CommonClassStore,
    private readonly context: vscode.ExtensionContext,
  ) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    return this.provideHoverAsync(document, position);
  }

  private async provideHoverAsync(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const lineText = document.lineAt(position.line).text;
    if (isCommentPosition(lineText, position.character)) {
      return undefined;
    }

    // Return early if intellisense hasn't been initialised yet (no project opened).
    try {
      const xmlCount = this.xmlLibraries.getDiagnostics().count;
      const wsCount = this.workspaceClasses.findClassesByPrefix('').length;
      if (xmlCount === 0 && wsCount === 0) {
        return undefined;
      }
    } catch (err) {
      // ignore diagnostics errors and continue
    }

    const memberReference = getMemberReferenceAtPosition(document, position);
    if (memberReference) {
      const inferredTypes = inferVariableTypes(document, this.workspaceClasses, this.xmlLibraries, this.primitiveTypes);
      const ownerType = resolveExpressionType(
        memberReference.expression,
        document,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
        this.primitiveTypes,
      );
      const ownerClass = this.workspaceClasses.getDefinitionByName(ownerType)
        ?? this.xmlLibraries.getClassByName(ownerType);
      const member = ownerClass?.methods.find((item) => item.name.toLowerCase() === memberReference.memberName.toLowerCase())
        ?? ownerClass?.properties.find((item) => item.name.toLowerCase() === memberReference.memberName.toLowerCase());

      if (ownerClass && member) {
        const product = await determineProductForDocument(document.uri);
        return new vscode.Hover(
          createMemberHoverDocumentation(
            ownerClass,
            'parameters' in member
              ? { kind: 'method', item: member }
              : { kind: 'property', item: member },
            product,
          ),
        );
      }

      const localType = getLocalTypeDefinition(document, ownerType);
      const localField = localType?.fields.find(
        (item) => item.name.toLowerCase() === memberReference.memberName.toLowerCase(),
      );
      if (localType && localField) {
        return new vscode.Hover(createLocalTypeMemberDocumentation(localType, localField));
      }
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }

    const hoveredWord = document.getText(wordRange);
    const classInfo = this.workspaceClasses.getDefinitionByName(hoveredWord)
      ?? this.xmlLibraries.getClassByName(hoveredWord);
    // Diagnostic logging
    try {
      console.log('B4X: hover -> hoveredWord=', hoveredWord, 'class=', Boolean(classInfo));
    } catch {
      // ignore logging errors
    }

    if (!classInfo) {
      // Check if the hovered word is a primitive type
      if (this.primitiveTypes.isPrimitiveType(hoveredWord)) {
        // For types that map to XML classes (e.g., String -> String2), show the XML class
        const mappedClassName = this.primitiveTypes.resolvePrimitiveType(hoveredWord);
        if (mappedClassName) {
          const xmlClass = this.xmlLibraries.getClassByName(mappedClassName);
          if (xmlClass) {
            const product = await determineProductForDocument(document.uri);
            return new vscode.Hover(createClassHoverDocumentation(xmlClass, product));
          }
        }
        
        // For pure primitive types (Int, Double, Boolean, etc.), show synthetic class info
        const primitiveInfo = this.primitiveTypes.getPrimitiveClassInfo(hoveredWord);
        if (primitiveInfo) {
          const product = await determineProductForDocument(document.uri);
          return new vscode.Hover(createPrimitiveTypeDocumentation(primitiveInfo, product));
        }
      }

      // If token isn't a class, try global member lookup across Common, workspace, xml
      try {
        const memberName = hoveredWord;

        // Check Common class global functions/fields first (e.g. Log, CRLF, Msgbox)
        const commonMember = this.commonClass.findMemberByName(memberName);
        if (commonMember) {
          const product = await determineProductForDocument(document.uri);
          return new vscode.Hover(createCommonMemberDocumentation(commonMember));
        }

        const wsMember = this.workspaceClasses.findMemberByName(memberName);
        if (wsMember) {
          const owner = wsMember.owner as unknown as B4xClass;
          const member: B4xMemberEntry = wsMember.kind === 'method'
            ? { kind: 'method', item: wsMember.item as any }
            : { kind: 'property', item: wsMember.item as any };
          const product = await determineProductForDocument(document.uri);
          return new vscode.Hover(createMemberHoverDocumentation(owner, member, product));
        }

        const xmlMember = this.xmlLibraries.findMemberByName(memberName);
        if (xmlMember) {
          const owner = xmlMember.owner as unknown as B4xClass;
          const member: B4xMemberEntry = xmlMember.kind === 'method'
            ? { kind: 'method', item: xmlMember.item as any }
            : { kind: 'property', item: xmlMember.item as any };
          const product = await determineProductForDocument(document.uri);
          return new vscode.Hover(createMemberHoverDocumentation(owner, member, product));
        }
      } catch (searchErr) {
        console.warn('B4X: hover -> global member search failed', searchErr);
      }

      return undefined;
    }

    const product = await determineProductForDocument(document.uri);
    return new vscode.Hover(createClassHoverDocumentation(classInfo, product));
  }
}

async function determineProductForDocument(preferredDocumentUri?: vscode.Uri): Promise<'b4a' | 'b4i' | 'b4j' | 'b4r'> {
  // 1. Check the file extension of the project file itself
  if (preferredDocumentUri) {
    const ext = path.extname(preferredDocumentUri.fsPath).toLowerCase();
    if (ext === '.b4a') return 'b4a';
    if (ext === '.b4i') return 'b4i';
    if (ext === '.b4j') return 'b4j';
    if (ext === '.b4r') return 'b4r';
  }

  // 2. Fall back to checking the project config's path for platform folder names
  try {
    const cfg = await loadWorkspaceProjectConfig([], preferredDocumentUri);
    const projectFile = cfg.projectFilePath;
    if (projectFile) {
      // Check extension of the discovered project file
      const ext = path.extname(projectFile).toLowerCase();
      if (ext === '.b4a') return 'b4a';
      if (ext === '.b4i') return 'b4i';
      if (ext === '.b4j') return 'b4j';
      if (ext === '.b4r') return 'b4r';

      // Check folder path for platform names
      const parts = projectFile.replace(/\\/g, '/').toLowerCase().split('/');
      if (parts.includes('b4a')) return 'b4a';
      if (parts.includes('b4i')) return 'b4i';
      if (parts.includes('b4j')) return 'b4j';
      if (parts.includes('b4r')) return 'b4r';
    }
  } catch {
    // ignore and fallback
  }

  // Fallback to b4a
  return 'b4a';
}

class B4xDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
    private readonly primitiveTypes: PrimitiveTypeStore,
  ) {}

  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const lineText = document.lineAt(position.line).text;
    if (isCommentPosition(lineText, position.character)) {
      return undefined;
    }

    const memberReference = getMemberReferenceAtPosition(document, position);
    if (memberReference) {
      const inferredTypes = inferVariableTypes(document, this.workspaceClasses, this.xmlLibraries, this.primitiveTypes);
      const ownerType = resolveExpressionType(
        memberReference.expression,
        document,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
        this.primitiveTypes,
      );
      const member = this.workspaceClasses.getMember(ownerType, memberReference.memberName)
        ?? this.xmlLibraries.getMember(ownerType, memberReference.memberName);
      if (member) {
        return member.item.location;
      }
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);

    // 1. Check for local Sub/Type definitions in the current document
    const localDef = this.findLocalDefinition(document, word);
    if (localDef) {
      return localDef;
    }

    // 2. Check for a Sub with this name in any workspace module (other .bas files)
    const workspaceMember = this.workspaceClasses.findMemberByName(word);
    if (workspaceMember) {
      return workspaceMember.item.location;
    }

    // 3. Check for a method with this name in XML library classes
    const xmlMember = this.xmlLibraries.findMemberByName(word);
    if (xmlMember) {
      return xmlMember.item.location;
    }

    // 4. Check workspace classes (user's own class files) by name
    // 5. Check XML library classes by name
    return this.workspaceClasses.getDefinitionByName(word)?.location
      ?? this.xmlLibraries.getClassByName(word)?.location;
  }

  /**
   * Find a Sub or Type definition by name in the current document.
   */
  private findLocalDefinition(
    document: vscode.TextDocument,
    word: string,
  ): vscode.Location | undefined {
    const wordLower = word.toLowerCase();
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Match Sub declaration
      const subMatch = /^\s*(Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
      if (subMatch && subMatch[2] && subMatch[2].toLowerCase() === wordLower) {
        const nameStart = line.indexOf(subMatch[2]);
        return new vscode.Location(
          document.uri,
          new vscode.Range(i, nameStart, i, nameStart + subMatch[2].length),
        );
      }

      // Match Type declaration
      const typeMatch = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(line);
      if (typeMatch && typeMatch[1] && typeMatch[1].toLowerCase() === wordLower) {
        const nameStart = line.indexOf(typeMatch[1]);
        return new vscode.Location(
          document.uri,
          new vscode.Range(i, nameStart, i, nameStart + typeMatch[1].length),
        );
      }
    }

    return undefined;
  }
}

class B4xSignatureHelpProvider implements vscode.SignatureHelpProvider {
  public constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
    private readonly primitiveTypes: PrimitiveTypeStore,
    private readonly commonClass: CommonClassStore,
  ) {}

  public provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.SignatureHelp> {
    const lineText = document.lineAt(position.line).text;
    if (isCommentPosition(lineText, position.character)) {
      return undefined;
    }

    const callContext = getCallContext(getLinePrefix(document, position));
    if (!callContext) {
      return undefined;
    }

    const methods = this.findMatchingMethods(document, position, callContext);
    if (methods.length === 0) {
      return undefined;
    }

    const help = new vscode.SignatureHelp();
    help.signatures = methods.map((entry) => createSignatureInformation(entry.ownerClass, entry.method));
    help.activeSignature = findActiveSignatureIndex(methods, callContext.argumentIndex);

    const activeParameters = help.signatures[help.activeSignature]?.parameters.length ?? 0;
    help.activeParameter = activeParameters === 0
      ? 0
      : Math.min(callContext.argumentIndex, activeParameters - 1);

    return help;
  }

  private findMatchingMethods(
    document: vscode.TextDocument,
    position: vscode.Position,
    callContext: { expression?: string; callee: string; argumentIndex: number },
  ): B4xMethodEntry[] {
    const methodName = callContext.callee.toLowerCase();

    if (callContext.expression) {
      // Member call: obj.Method(...)
      const inferredTypes = inferVariableTypes(document, this.workspaceClasses, this.xmlLibraries, this.primitiveTypes);
      const ownerType = resolveExpressionType(
        callContext.expression,
        document,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
        this.primitiveTypes,
      );
      const ownerClass = this.workspaceClasses.getDefinitionByName(ownerType)
        ?? this.xmlLibraries.getClassByName(ownerType);
      if (!ownerClass) {
        return [];
      }

      return ownerClass.methods
        .filter((item) => item.name.toLowerCase() === methodName)
        .map((method) => ({ ownerClass, method }));
    }

    // Bare (global) call: look in Common class, then workspace, then XML libraries.
    const results: B4xMethodEntry[] = [];

    // 1. Common class global functions (e.g. Log, Msgbox, CallSubDelayed)
    const commonMember = this.commonClass.findMemberByName(callContext.callee);
    if (commonMember && commonMember.kind === 'method') {
      const params = (commonMember.params ?? []).map(p => ({ name: p.name, type: p.type, rawType: p.type }));
      const syntheticMethod: B4xMethod = {
        kind: 'method',
        name: commonMember.name,
        params,
        parameters: params,
        returnType: commonMember.returnType ?? 'void',
        rawReturnType: commonMember.returnType ?? 'void',
        rawSignature: commonMember.signature,
        signature: commonMember.signature,
        doc: commonMember.doc,
        description: commonMember.doc,
        isPublic: true,
      };
      const syntheticClass: B4xClass = {
        name: 'Common',
        libraryName: 'Core',
        methods: [syntheticMethod],
        properties: [],
      };
      results.push({ ownerClass: syntheticClass, method: syntheticMethod });
    }

    // 2. Workspace sub in any loaded module
    const wsMember = this.workspaceClasses.findMemberByName(callContext.callee);
    if (wsMember && wsMember.kind === 'method') {
      results.push({ ownerClass: wsMember.owner as unknown as B4xClass, method: wsMember.item as unknown as B4xMethod });
    }

    // 3. XML library method (static/global call pattern)
    const xmlMember = this.xmlLibraries.findMemberByName(callContext.callee);
    if (xmlMember && xmlMember.kind === 'method') {
      results.push({ ownerClass: xmlMember.owner as unknown as B4xClass, method: xmlMember.item as unknown as B4xMethod });
    }

    return results;
  }
}

// Helper: apply a set of edits (as returned by the server) to a text blob and return the new text
function applyEditsToText(originalText: string, edits: Array<any>): string {
  const lines = originalText.split(/\r?\n/);
  // Separate append edits (range at EOF) from replacements
  const appendEdits = edits.filter((e) => e.range && e.range.start.line >= lines.length);
  const replaceEdits = edits.filter((e) => !(e.range && e.range.start.line >= lines.length));

  // Apply replacements in reverse order by start line
  replaceEdits.sort((a, b) => (b.range.start.line - a.range.start.line) || (b.range.start.character - a.range.start.character));
  let working = lines;
  for (const e of replaceEdits) {
    const start = e.range.start.line;
    const end = e.range.end.line;
    const before = working.slice(0, start);
    const after = working.slice(end + 1);
    const replacementLines = e.newText.split(/\r?\n/);
    working = before.concat(replacementLines).concat(after);
  }

  // Apply append edits (simply append their newText)
  for (const e of appendEdits) {
    working = working.concat(e.newText.split(/\r?\n/));
  }

  return working.join('\n');
}

/**
 * Returns B4X language keywords as completion items
 * These are language constructs, not library methods - they come from the B4X language specification
 */
function getB4XLanguageKeywords(): vscode.CompletionItem[] {
  const keywords: Array<{label: string, detail: string, doc: string, kind: vscode.CompletionItemKind, insertText?: string}> = [
    // Variable declarations
    { label: 'Dim', detail: 'Declare local variable', doc: 'Dim variableName As Type\n\nDeclares a local variable with a specific type.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Private', detail: 'Declare private variable', doc: 'Private variableName As Type\n\nDeclares a private variable accessible only within the current module.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Public', detail: 'Declare public variable', doc: 'Public variableName As Type\n\nDeclares a public variable accessible from all modules.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Const', detail: 'Declare constant', doc: 'Private Const NAME = value As Type\n\nDeclares a constant value that cannot be changed.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Type', detail: 'Define custom type', doc: 'Type TypeName(Field1 As String, Field2 As Int)\n\nDefines a custom data type with multiple fields.', kind: vscode.CompletionItemKind.Keyword },
    
    // Control flow - Conditional
    { label: 'If', detail: 'Conditional statement', doc: 'If condition Then\n\t\' code\nEnd If\n\nExecutes code block if condition is true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Then', detail: 'If-Then keyword', doc: 'Used with If to execute code when condition is true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Else', detail: 'Alternative branch', doc: 'Else\n\t\' code if false\n\nAlternative code block when If condition is false.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Else If', detail: 'Additional condition', doc: 'Else If condition Then\n\t\' code\n\nTests another condition if previous If was false.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'End If', detail: 'End If block', doc: 'Ends an If block structure.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'IIf', detail: 'Inline If function', doc: 'result = IIf(condition, trueValue, falseValue)\n\nReturns one of two values based on condition.', kind: vscode.CompletionItemKind.Keyword, insertText: 'IIf(${1:condition}, ${2:TrueValue}, ${3:FalseValue})' },
    { label: 'Select', detail: 'Select-Case statement', doc: 'Select value\n\tCase 1\n\t\t\' code\n\tCase Else\n\t\t\' default\nEnd Select\n\nMulti-way branch statement.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Case', detail: 'Case branch', doc: 'Case value\n\t\' code\n\nDefines a branch in Select statement.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Case Else', detail: 'Default case', doc: 'Case Else\n\t\' default code\n\nDefault branch when no other Case matches.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'End Select', detail: 'End Select block', doc: 'Ends a Select-Case block structure.', kind: vscode.CompletionItemKind.Keyword },
    
    // Control flow - Loops
    { label: 'For', detail: 'For loop', doc: 'For i = 0 To 10\n\t\' code\nNext\n\nExecutes code block a specified number of times.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'To', detail: 'For loop range', doc: 'Used in For loops to specify the range: For i = 0 To 10', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Next', detail: 'End For loop', doc: 'Next\n\nEnds a For loop and continues to next iteration or exits loop.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'For Each', detail: 'For-Each loop', doc: 'For Each item As Type In collection\n\t\' code\nNext\n\nIterates through each item in a collection.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Do', detail: 'Do loop start', doc: 'Do While condition\n\t\' code\nLoop\n\nStarts a Do-Loop structure.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'While', detail: 'While condition', doc: 'Do While condition\n\t\' code\nLoop\n\nContinues loop while condition is true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Until', detail: 'Until condition', doc: 'Do Until condition\n\t\' code\nLoop\n\nContinues loop until condition becomes true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Loop', detail: 'End Do loop', doc: 'Loop\n\nEnds a Do-Loop structure.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Loop While', detail: 'Loop with condition at end', doc: 'Do\n\t\' code\nLoop While condition\n\nExecutes loop at least once, then continues while condition is true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Loop Until', detail: 'Loop with condition at end', doc: 'Do\n\t\' code\nLoop Until condition\n\nExecutes loop at least once, then continues until condition is true.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Continue', detail: 'Continue to next iteration', doc: 'Continue\n\nSkips to the next iteration of the current loop.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Exit', detail: 'Exit loop or sub', doc: 'Exit\n\nExits the current loop or subroutine immediately.', kind: vscode.CompletionItemKind.Keyword },
    
    // Error handling
    { label: 'Try', detail: 'Try block', doc: 'Try\n\t\' code that might fail\nCatch\n\tLog(LastException)\nEnd Try\n\nStarts error handling block.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Catch', detail: 'Catch block', doc: 'Catch\n\tLog(LastException)\n\nHandles exceptions caught by Try block.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'End Try', detail: 'End Try block', doc: 'Ends a Try-Catch block structure.', kind: vscode.CompletionItemKind.Keyword },
    
    // Subroutines
    { label: 'Sub', detail: 'Define subroutine', doc: 'Sub Name(args)\n\t\' code\nEnd Sub\n\nDefines a subroutine (function/method).', kind: vscode.CompletionItemKind.Keyword },
    { label: 'End Sub', detail: 'End subroutine', doc: 'End Sub\n\nEnds a subroutine definition.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Return', detail: 'Return value', doc: 'Return value\n\nReturns a value from a subroutine and exits.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Wait For', detail: 'Wait for async event', doc: 'Wait For (sender)_EventName (args)\n\t\' code\n\nWaits for an asynchronous event to complete.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Sleep', detail: 'Pause execution', doc: 'Sleep(milliseconds)\n\nPauses execution for specified time without blocking UI.', kind: vscode.CompletionItemKind.Keyword, insertText: 'Sleep(${1:1000})' },
    { label: 'CallSub', detail: 'Call subroutine', doc: 'CallSub(component, "SubName")\n\nCalls a subroutine in another component.', kind: vscode.CompletionItemKind.Keyword, insertText: 'CallSub(${1:Component}, "${2:SubName}")' },
    { label: 'CallSub2', detail: 'Call subroutine with 1 arg', doc: 'CallSub2(component, "SubName", argument)\n\nCalls a subroutine with one argument.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'CallSub3', detail: 'Call subroutine with 2 args', doc: 'CallSub3(component, "SubName", arg1, arg2)\n\nCalls a subroutine with two arguments.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'CallSubDelayed', detail: 'Call subroutine async', doc: 'CallSubDelayed(component, "SubName")\n\nCalls a subroutine asynchronously.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'SubExists', detail: 'Check if sub exists', doc: 'SubExists(object, "SubName") As Boolean\n\nReturns True if the specified subroutine exists.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'RaiseEvent', detail: 'Raise event', doc: 'RaiseEvent EventName(args)\n\nRaises an event in a class module.', kind: vscode.CompletionItemKind.Keyword },
    
    // Operators
    { label: 'And', detail: 'Logical AND', doc: 'condition1 And condition2\n\nLogical AND operator.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Or', detail: 'Logical OR', doc: 'condition1 Or condition2\n\nLogical OR operator.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Not', detail: 'Logical NOT', doc: 'Not condition\n\nLogical NOT operator.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Xor', detail: 'Logical XOR', doc: 'condition1 Xor condition2\n\nLogical XOR operator.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Mod', detail: 'Modulo operator', doc: 'value1 Mod value2\n\nReturns remainder of division.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Eqv', detail: 'Equivalence operator', doc: 'condition1 Eqv condition2\n\nLogical equivalence operator.', kind: vscode.CompletionItemKind.Operator },
    { label: 'Is', detail: 'Type check operator', doc: 'object Is Type\n\nChecks if object is of specified type.', kind: vscode.CompletionItemKind.Operator },
    { label: 'As', detail: 'Type cast operator', doc: 'object As Type\n\nCasts object to specified type.', kind: vscode.CompletionItemKind.Operator },
    
    // Constants
    { label: 'CRLF', detail: 'Carriage return + line feed', doc: 'CRLF\n\nNew line character (Chr(10)).', kind: vscode.CompletionItemKind.Constant },
    { label: 'TAB', detail: 'Tab character', doc: 'TAB\n\nTab character constant.', kind: vscode.CompletionItemKind.Constant },
    { label: 'QUOTE', detail: 'Quote character', doc: 'QUOTE\n\nQuote character (Chr(34)).', kind: vscode.CompletionItemKind.Constant },
    { label: 'cPI', detail: 'Pi constant', doc: 'cPI\n\nMathematical constant π (3.14159...).', kind: vscode.CompletionItemKind.Constant },
    { label: 'cE', detail: 'E constant', doc: 'cE\n\nNatural logarithm base e (2.71828...).', kind: vscode.CompletionItemKind.Constant },
    { label: 'True', detail: 'Boolean true', doc: 'True\n\nBoolean true value.', kind: vscode.CompletionItemKind.Constant },
    { label: 'False', detail: 'Boolean false', doc: 'False\n\nBoolean false value.', kind: vscode.CompletionItemKind.Constant },
    { label: 'Null', detail: 'Null reference', doc: 'Null\n\nRepresents a null/empty object reference.', kind: vscode.CompletionItemKind.Constant },
    { label: 'Me', detail: 'Self reference', doc: 'Me\n\nReference to current object instance.', kind: vscode.CompletionItemKind.Keyword },
    { label: 'Sender', detail: 'Event sender', doc: 'Sender As Object\n\nReturns the object that raised the current event.', kind: vscode.CompletionItemKind.Keyword },
    
    // Built-in objects
    { label: 'File', detail: 'File operations', doc: 'File object provides methods for working with files and directories.', kind: vscode.CompletionItemKind.Class },
    { label: 'DateTime', detail: 'Date/time functions', doc: 'DateTime object provides methods for date and time operations.', kind: vscode.CompletionItemKind.Class },
    { label: 'Colors', detail: 'Color constants', doc: 'Colors object provides color constants and methods.', kind: vscode.CompletionItemKind.Class },
    { label: 'Regex', detail: 'Regular expressions', doc: 'Regex object provides regular expression methods.', kind: vscode.CompletionItemKind.Class },
    { label: 'Bit', detail: 'Bitwise operations', doc: 'Bit object provides bitwise operation methods.', kind: vscode.CompletionItemKind.Class },
    { label: 'Typeface', detail: 'Font typefaces', doc: 'Typeface object provides font typeface constants.', kind: vscode.CompletionItemKind.Class },
    { label: 'Gravity', detail: 'Layout gravity', doc: 'Gravity object provides layout alignment constants.', kind: vscode.CompletionItemKind.Class },
    { label: 'KeyCodes', detail: 'Keyboard codes', doc: 'KeyCodes object provides keyboard key code constants.', kind: vscode.CompletionItemKind.Class },
    { label: 'DialogResponse', detail: 'Dialog response codes', doc: 'DialogResponse object provides dialog return values.', kind: vscode.CompletionItemKind.Class },
    { label: 'Application', detail: 'Application info', doc: 'Application object provides application properties.', kind: vscode.CompletionItemKind.Class },
    { label: 'Density', detail: 'Screen density', doc: 'Density\n\nReturns the device screen scale (DPI / 160).', kind: vscode.CompletionItemKind.Property },
  ];
  
  return keywords.map(kw => {
    const item = new vscode.CompletionItem(kw.label, kw.kind);
    item.detail = kw.detail;
    item.documentation = new vscode.MarkdownString(kw.doc);
    item.sortText = `0_${kw.label.toLowerCase()}`; // Keywords come first (0_ prefix)
    
    if (kw.insertText) {
      item.insertText = new vscode.SnippetString(kw.insertText);
    } else {
      item.insertText = kw.label;
    }
    
    return item;
  });
}

/**
 * Create completion items for B4X preprocessor directives.
 */
function createPreprocessorCompletionItems(prefix: string): vscode.CompletionItem[] {
  const prefixLower = prefix.toLowerCase();
  const items: vscode.CompletionItem[] = [];

  const directives = [
    { label: 'If B4A', insertText: 'If B4A', detail: 'Conditional compilation for B4A' },
    { label: 'If B4i', insertText: 'If B4i', detail: 'Conditional compilation for B4i' },
    { label: 'If B4J', insertText: 'If B4J', detail: 'Conditional compilation for B4J' },
    { label: 'If B4R', insertText: 'If B4R', detail: 'Conditional compilation for B4R' },
    { label: 'If Debug', insertText: 'If Debug', detail: 'Conditional compilation for debug mode' },
    { label: 'If Release', insertText: 'If Release', detail: 'Conditional compilation for release mode' },
    { label: 'If', insertText: 'If ', detail: 'Conditional compilation directive' },
    { label: 'Else If', insertText: 'Else If ', detail: 'Alternative condition' },
    { label: 'Else', insertText: 'Else', detail: 'Else block' },
    { label: 'End If', insertText: 'End If', detail: 'End conditional compilation' },
    { label: 'Region', insertText: 'Region ', detail: 'Start a code folding region' },
    { label: 'End Region', insertText: 'End Region', detail: 'End a code folding region' },
    { label: 'AdditionalJar', insertText: 'AdditionalJar: ', detail: 'Include an additional JAR file' },
    { label: 'AdditionalRes', insertText: 'AdditionalRes: ', detail: 'Include an additional resource folder' },
    { label: 'ExcludeClasses', insertText: 'ExcludeClasses: ', detail: 'Exclude classes from compilation' },
    { label: 'Version', insertText: 'Version: ', detail: 'Set project version' },
    { label: 'VersionName', insertText: 'VersionName: ', detail: 'Set version name for manifest' },
    { label: 'VersionCode', insertText: 'VersionCode: ', detail: 'Set version code for manifest' },
    { label: 'Package', insertText: 'Package: ', detail: 'Set package name' },
    { label: 'MinSdkVersion', insertText: 'MinSdkVersion: ', detail: 'Set minimum SDK version' },
    { label: 'TargetSdkVersion', insertText: 'TargetSdkVersion: ', detail: 'Set target SDK version' },
    { label: 'BridgeLogger', insertText: 'BridgeLogger: ', detail: 'Enable/disable bridge logging' },
    { label: 'Event', insertText: 'Event: ', detail: 'Declare an event handler signature' },
    { label: 'RaisesSynchronousEvents', insertText: 'RaisesSynchronousEvents: ', detail: 'Mark sub as raising synchronous events' },
    { label: 'Ignore', insertText: 'Ignore', detail: 'Ignore the next line during compilation' },
    { label: 'Defines', insertText: 'Defines: ', detail: 'Define a preprocessor symbol' },
  ];

  for (const directive of directives) {
    if (!prefixLower || directive.label.toLowerCase().startsWith(prefixLower)) {
      const item = new vscode.CompletionItem(directive.label, vscode.CompletionItemKind.Keyword);
      item.insertText = directive.insertText;
      item.detail = directive.detail;
      item.documentation = new vscode.MarkdownString(`\`${directive.insertText}\`\n\n${directive.detail}`);
      item.sortText = `0${directive.label}`;
      items.push(item);
    }
  }

  return items;
}

function createGeneralCompletionItems(
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
  primitiveTypes: PrimitiveTypeStore,
  commonClass: CommonClassStore,
  localSymbols: readonly B4xLocalSymbol[],
  prefix: string,
): vscode.CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();
  const localItems = localSymbols
    .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
    .map((item) => createLocalSymbolCompletionItem(item));
  // Workspace and XML-backed classes
  const workspaceClassItems = workspaceClasses
    .findClassesByPrefix(normalizedPrefix)
    .map((item) => createClassCompletionItem(item));
  const xmlClassItems = xmlLibraries
    .findClassesByPrefix(normalizedPrefix)
    .map((item) => createClassCompletionItem(item));

  // Common class global functions/fields — available as bare-word completions
  // Filter out Common members that have XML class definitions to avoid duplicates
  const xmlClassNamesForCommon = new Set(
    xmlLibraries.getAllClasses().map(c => c.name.toLowerCase())
  );
  const workspaceClassNamesForCommon = new Set(
    workspaceClasses.getAllClasses().map(c => c.name.toLowerCase())
  );

  const commonItems = commonClass
    .findMembersByPrefix(normalizedPrefix)
    .filter(m => {
      const nameLower = m.name.toLowerCase();
      // Filter out Common fields that have XML class definitions (e.g., File, DateTime, Colors)
      if (xmlClassNamesForCommon.has(nameLower) || workspaceClassNamesForCommon.has(nameLower)) {
        return false; // XML/workspace class will provide the completion
      }
      return true;
    })
    .map((m) => m.kind === 'method'
      ? createCommonMethodCompletion(m)
      : createCommonPropertyCompletion(m));

  // B4X Language Keywords
  // Filter out keywords that already have XML class definitions to avoid duplicates
  const xmlClassNamesForKeywords = new Set(
    xmlLibraries.getAllClasses().map(c => c.name.toLowerCase())
  );
  const workspaceClassNamesForKeywords = new Set(
    workspaceClasses.getAllClasses().map(c => c.name.toLowerCase())
  );
  const commonMemberNamesForKeywords = new Set(
    commonClass.findMembersByPrefix('').map(m => m.name.toLowerCase())
  );

  const keywordItems = getB4XLanguageKeywords().filter((kw) => {
    const labelText = typeof kw.label === 'string' ? kw.label : kw.label.label;
    
    // Filter by prefix first
    if (normalizedPrefix && !labelText.toLowerCase().startsWith(normalizedPrefix)) {
      return false;
    }
    
    // Filter out keywords that have XML class definitions (avoid duplicates)
    const labelLower = labelText.toLowerCase();
    if (xmlClassNamesForKeywords.has(labelLower) || workspaceClassNamesForKeywords.has(labelLower)) {
      return false; // XML/workspace class will provide the completion
    }
    
    // Filter out keywords that are Common class fields (avoid duplicates)
    if (commonMemberNamesForKeywords.has(labelLower)) {
      return false; // Common class field will provide the completion
    }
    
    return true;
  });

  // Primitive Type Completions
  // Filter out primitive types that already have XML class definitions to avoid duplicates
  const xmlClassNames = new Set(
    xmlLibraries.getAllClasses().map(c => c.name.toLowerCase())
  );
  const workspaceClassNames = new Set(
    workspaceClasses.getAllClasses().map(c => c.name.toLowerCase())
  );
  
  const primitiveItems = primitiveTypes
    .getPrimitiveTypeNames()
    .filter(name => {
      // Skip if already filtered by prefix
      if (normalizedPrefix && !name.toLowerCase().startsWith(normalizedPrefix)) {
        return false;
      }
      // Skip if this primitive maps to a real XML/workspace class (avoid duplicates)
      const mappedName = primitiveTypes.resolvePrimitiveType(name);
      if (mappedName) {
        const mappedLower = mappedName.toLowerCase();
        if (xmlClassNames.has(mappedLower) || workspaceClassNames.has(mappedLower)) {
          return false; // XML/workspace class will provide the completion
        }
      } else {
        // No mapping - this is a pure synthetic primitive (like Int, Double, etc.)
        // Keep it in the list
      }
      return true;
    })
    .map(name => createPrimitiveTypeCompletionItem(name, primitiveTypes));

  if (!normalizedPrefix) {
    return dedupeCompletionItems([
      ...keywordItems,
      ...primitiveItems,
      ...localItems,
      ...commonItems,
      ...workspaceClassItems,
      ...xmlClassItems,
    ]);
  }

  return dedupeCompletionItems([
    ...keywordItems,
    ...primitiveItems,
    ...localItems,
    ...commonItems,
    ...workspaceClassItems,
    ...xmlClassItems,
  ]);
}

function createMemberCompletionItems(
  ownerClass: B4xClass,
  ownerExpression: string,
  prefix: string,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  const events = (ownerClass.events ?? []) as B4xEventDef[];
  const eventItems = events
    .filter(e => e.name.toLowerCase().startsWith(normalizedPrefix))
    .map(e => createEventCompletionItem(ownerClass, e, range, ownerExpression));

  const fieldItems = (ownerClass.fields ?? [])
    .filter(f => f.name.toLowerCase().startsWith(normalizedPrefix))
    .map(f => createFieldCompletionItem(ownerClass, f, range, ownerExpression));

  return dedupeCompletionItems([
    ...ownerClass.methods
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => createMethodCompletionItem({ ownerClass, method: item }, range, ownerExpression)),
    ...ownerClass.properties
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => createPropertyCompletionItem({ ownerClass, property: item }, range, ownerExpression)),
    ...eventItems,
    ...fieldItems,
  ]);
}

function createLocalTypeMemberCompletionItems(
  localType: B4xLocalTypeDefinition,
  ownerExpression: string,
  prefix: string,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return dedupeCompletionItems(
    localType.fields
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => createLocalTypeFieldCompletionItem(localType, item, range, ownerExpression)),
  );
}

function createClassCompletionItem(item: B4xClass): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Class);
  const versionStr = item.version ? ` v${item.version}` : '';
  completion.label = {
    label: item.name,
    description: `${item.libraryName}${versionStr}`,
  };
  completion.detail = `${item.libraryName} library${versionStr}`;
  completion.documentation = createClassDocumentation(item);
  completion.sortText = `1_${item.name.toLowerCase()}`;
  // Hidden unique id for deduping across multiple sources
  (completion as any).__uniqueId = `class:${item.name.toLowerCase()}`;
  return completion;
}

function createPrimitiveTypeCompletionItem(typeName: string, primitiveTypes: PrimitiveTypeStore): vscode.CompletionItem {
  // Use the store's display name to get correct casing (e.g. "StringBuilder" not "Stringbuilder")
  const displayName = primitiveTypes.getPrimitiveDisplayName(typeName);
  const completion = new vscode.CompletionItem(displayName, vscode.CompletionItemKind.TypeParameter);

  completion.label = {
    label: displayName,
    description: 'Primitive Type',
  };
  completion.detail = 'B4X Primitive Type';
  
  // Get documentation from primitive store
  const primInfo = primitiveTypes.getPrimitiveClassInfo(displayName);
  if (primInfo) {
    completion.documentation = createPrimitiveTypeDocumentation(primInfo);
  } else {
    // Fallback for mapped types like String
    completion.documentation = new vscode.MarkdownString(`Type: ${displayName}\n\nA primitive data type in B4X.`);
  }
  
  completion.sortText = `0_${typeName.toLowerCase()}`;
  (completion as any).__uniqueId = `primitive:${typeName.toLowerCase()}`;
  return completion;
}

function createLocalSymbolCompletionItem(item: B4xLocalSymbol): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(item.name, toLocalCompletionKind(item.kind));
  completion.detail = createLocalSymbolDetail(item);
  completion.documentation = createLocalSymbolDocumentation(item);
  completion.sortText = `0_${item.name.toLowerCase()}`;
  (completion as any).__uniqueId = `local:${item.kind}:${item.name.toLowerCase()}`;
  return completion;
}

function createLocalTypeFieldCompletionItem(
  localType: B4xLocalTypeDefinition,
  field: B4xLocalTypeDefinition['fields'][number],
  range?: vscode.Range,
  ownerExpression?: string,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
  completion.range = range;
  if (ownerExpression) {
    completion.filterText = `${ownerExpression}.${field.name}`;
  }
  completion.detail = field.typeName
    ? `${localType.name}.${field.name} As ${field.typeName}`
    : `${localType.name}.${field.name}`;
  completion.documentation = createLocalTypeMemberDocumentation(localType, field);
  // Prefer owner-specific members when an owner expression is present.
  completion.sortText = ownerExpression
    ? `0_${field.name.toLowerCase()}_${localType.name.toLowerCase()}`
    : `1_${field.name.toLowerCase()}`;
  if (ownerExpression) {
    completion.preselect = true;
  }
  (completion as any).__uniqueId = `field:${localType.name.toLowerCase()}:${field.name.toLowerCase()}`;
  return completion;
}

function createMethodCompletionItem(
  entry: B4xMethodEntry,
  range?: vscode.Range,
  ownerExpression?: string,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(entry.method.name, vscode.CompletionItemKind.Method);
  completion.label = {
    label: entry.method.name,
    description: entry.ownerClass.name,
  };
  completion.range = range;
  if (ownerExpression) {
    completion.filterText = `${ownerExpression}.${entry.method.name}`;
  }
  completion.detail = `${entry.ownerClass.name}.${entry.method.signature}`;
  completion.insertText = createMethodInsertText(entry.method);
  completion.documentation = createMethodDocumentation(entry.ownerClass, entry.method);
  // When an owner expression is provided, prefer these items so they appear above global members.
  completion.sortText = ownerExpression
    ? `0_${entry.method.name.toLowerCase()}_${entry.ownerClass.name.toLowerCase()}_${entry.method.signature.toLowerCase()}`
    : `2_${entry.method.name.toLowerCase()}_${entry.ownerClass.name.toLowerCase()}_${entry.method.signature.toLowerCase()}`;
  if (ownerExpression) {
    completion.preselect = true;
  }
  (completion as any).__uniqueId = `method:${entry.ownerClass.name.toLowerCase()}:${entry.method.name.toLowerCase()}:${(entry.method.signature||'').toLowerCase()}`;
  return completion;
}

function createPropertyCompletionItem(
  entry: B4xPropertyEntry,
  range?: vscode.Range,
  ownerExpression?: string,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(entry.property.name, vscode.CompletionItemKind.Property);
  completion.label = {
    label: entry.property.name,
    description: `${entry.ownerClass.name} ${formatPropertyAccess(entry.property.access)}`,
  };
  completion.range = range;
  if (ownerExpression) {
    completion.filterText = `${ownerExpression}.${entry.property.name}`;
  }
  completion.detail = `${entry.ownerClass.name}.${entry.property.signature}`;
  completion.documentation = createPropertyDocumentation(entry.ownerClass, entry.property);
  completion.sortText = ownerExpression
    ? `0_${entry.property.name.toLowerCase()}_${entry.ownerClass.name.toLowerCase()}`
    : `3_${entry.property.name.toLowerCase()}_${entry.ownerClass.name.toLowerCase()}`;
  if (ownerExpression) {
    completion.preselect = true;
  }
  (completion as any).__uniqueId = `property:${entry.ownerClass.name.toLowerCase()}:${entry.property.name.toLowerCase()}:${(entry.property.signature||'').toLowerCase()}`;
  return completion;
}

/** Create a completion item for a class event (with event handler snippet). */
function createEventCompletionItem(
  ownerClass: B4xClass,
  event: { name: string; params: string[]; rawEvent?: string; doc?: string },
  range?: vscode.Range,
  ownerExpression?: string,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(event.name, vscode.CompletionItemKind.Event);
  completion.label = {
    label: event.name,
    description: `${ownerClass.name} event`,
  };
  completion.range = range;
  if (ownerExpression) {
    completion.filterText = `${ownerExpression}.${event.name}`;
  }
  const paramStr = event.params.length > 0 ? `(${event.params.join(', ')})` : '()';
  completion.detail = `${ownerClass.name}.${event.name} ${paramStr}`;
  completion.documentation = createEventDocumentation(ownerClass, event);
  completion.sortText = `1_${event.name.toLowerCase()}_${ownerClass.name.toLowerCase()}`;
  // Insert text: creates the event handler stub on double-click / accept
  completion.insertText = new vscode.SnippetString(`${event.name}$0`);
  completion.command = {
    title: 'Insert Event Handler',
    command: 'b4xIntellisense.insertEventHandler',
    arguments: [{ ownerClass: ownerClass.name, eventName: event.name, params: event.params }],
  };
  (completion as any).__uniqueId = `event:${ownerClass.name.toLowerCase()}:${event.name.toLowerCase()}`;
  return completion;
}

/** Create a completion item for a class field. */
function createFieldCompletionItem(
  ownerClass: B4xClass,
  field: { name: string; type?: string; rawType?: string; doc?: string; description?: string },
  range?: vscode.Range,
  ownerExpression?: string,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
  completion.label = {
    label: field.name,
    description: `${ownerClass.name} ${field.type || field.rawType || 'Object'}`,
  };
  completion.range = range;
  if (ownerExpression) {
    completion.filterText = `${ownerExpression}.${field.name}`;
  }
  completion.detail = `${ownerClass.name}.${field.name} As ${field.type || field.rawType || 'Object'}`;
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendCodeblock(`${ownerClass.name}.${field.name} As ${field.type || field.rawType || 'Object'}`, 'b4x');
  if (field.doc || field.description) {
    markdown.appendMarkdown(`${field.doc ?? field.description}\n`);
  }
  completion.documentation = markdown;
  completion.sortText = `2_${field.name.toLowerCase()}_${ownerClass.name.toLowerCase()}`;
  (completion as any).__uniqueId = `field:${ownerClass.name.toLowerCase()}:${field.name.toLowerCase()}`;
  return completion;
}

/** Build Markdown documentation for an event. */
function createEventDocumentation(ownerClass: B4xClass, event: { name: string; params: string[]; rawEvent?: string; doc?: string }): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  const paramStr = event.params.length > 0 ? `(${event.params.join(', ')})` : '()';
  markdown.appendCodeblock(`${event.name} ${paramStr}`, 'b4x');
  if (event.doc) {
    markdown.appendMarkdown(`${event.doc}\n`);
  }
  markdown.appendMarkdown(`\n*Event from ${ownerClass.name} (${ownerClass.libraryName})*`);
  return markdown;
}

/** Create a completion item for a global function from the Common class. */
function createCommonMethodCompletion(member: import('./commonClassStore').CommonMemberInfo): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.Function);
  completion.label = {
    label: member.name,
    description: '(global function)',
  };
  completion.detail = member.signature;
  completion.documentation = createCommonMemberDocumentation(member);
  completion.sortText = `0_${member.name.toLowerCase()}`; // high priority
  completion.insertText = createCommonMethodInsertText(member);
  completion.commitCharacters = ['('];
  (completion as any).__uniqueId = `common:method:${member.name.toLowerCase()}`;
  return completion;
}

/** Create a completion item for a global field/constant from the Common class. */
function createCommonPropertyCompletion(member: import('./commonClassStore').CommonMemberInfo): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(member.name, member.name === member.name.toUpperCase() ? vscode.CompletionItemKind.Constant : vscode.CompletionItemKind.Variable);
  completion.label = {
    label: member.name,
    description: member.returnType ? `(global ${member.returnType})` : '(global)',
  };
  completion.detail = member.signature;
  completion.documentation = createCommonMemberDocumentation(member);
  completion.sortText = `0_${member.name.toLowerCase()}`;
  (completion as any).__uniqueId = `common:property:${member.name.toLowerCase()}`;
  return completion;
}

/** Build insert text for Common methods — inserts snippet with parameter placeholders. */
function createCommonMethodInsertText(member: import('./commonClassStore').CommonMemberInfo): vscode.SnippetString {
  const params = member.params ?? [];
  if (params.length === 0) {
    return new vscode.SnippetString(`${member.name}$0`);
  }
  const placeholders = params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');
  return new vscode.SnippetString(`${member.name}(${placeholders})$0`);
}

/** Build Markdown documentation for a Common class member. */
function createCommonMemberDocumentation(member: import('./commonClassStore').CommonMemberInfo): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  markdown.appendCodeblock(member.signature, 'b4x');
  if (member.doc) {
    markdown.appendMarkdown(`\n${member.doc}\n`);
  }
  markdown.appendMarkdown(`\n*Global function from Core library*`);
  // Add action links
  markdown.appendMarkdown(`\n\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);
  return markdown;
}

function createMethodInsertText(item: B4xMethod): vscode.SnippetString {
  if (item.parameters.length === 0) {
    return new vscode.SnippetString(`${item.name}()$0`);
  }

  const placeholders = item.parameters
    .map((parameter, index) => `\${${index + 1}:${parameter.name}}`)
    .join(', ');

  return new vscode.SnippetString(`${item.name}(${placeholders})$0`);
}

function createClassDocumentation(item: B4xClass): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  markdown.appendCodeblock(item.name, 'b4x');
  const versionStr = item.version ? ` v${item.version}` : '';
  markdown.appendMarkdown(`Library: ${item.libraryName}${versionStr}\n\n`);
  markdown.appendMarkdown(`Methods: ${item.methods.length} | Properties: ${item.properties.length}\n\n`);

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  return markdown;
}

function createLocalSymbolDocumentation(item: B4xLocalSymbol): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;

  if (item.kind === 'sub') {
    markdown.appendCodeblock(`Sub ${item.name}`, 'b4x');
    markdown.appendMarkdown('Local sub declared in the current document.\n');
    // Add action links
    markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
    markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);
    return markdown;
  }

  if (item.kind === 'type') {
    markdown.appendCodeblock(`Type ${item.name}(...)`, 'b4x');
    markdown.appendMarkdown('Local type declared in the current document.\n');
    // Add action links
    markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
    markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);
    return markdown;
  }

  const declaration = item.typeName
    ? `Dim ${item.name} As ${item.typeName}`
    : `Dim ${item.name}`;
  markdown.appendCodeblock(declaration, 'b4x');
  if (item.container) {
    markdown.appendMarkdown(`Scope: ${item.container}\n`);
  } else {
    markdown.appendMarkdown('Local variable declared in the current document.\n');
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  return markdown;
}

function createLocalTypeMemberDocumentation(
  localType: B4xLocalTypeDefinition,
  field: B4xLocalTypeDefinition['fields'][number],
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  const declaration = field.typeName
    ? `${localType.name}.${field.name} As ${field.typeName}`
    : `${localType.name}.${field.name}`;

  markdown.appendCodeblock(declaration, 'b4x');
  markdown.appendMarkdown(`Local type field declared in ${localType.name}.\n`);
  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);
  return markdown;
}

function createClassHoverDocumentation(item: B4xClass, product: 'b4a' | 'b4i' | 'b4j' | 'b4r' = 'b4a'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  markdown.appendCodeblock(item.name, 'b4x');
  markdown.appendMarkdown(`Class: ${item.name}\n\n`);
  markdown.appendMarkdown(`Library: ${item.libraryName}\n\n`);

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  // Add a quick "Search Online" link to B4X forum for this class/keyword.
  try {
    const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(item.name)}&ide=true&product=${product}`;
    markdown.appendMarkdown(` · [Search Online](${url})`);
  } catch (e) {
    // ignore
  }

  return markdown;
}

function createPrimitiveTypeDocumentation(item: PrimitiveClassDef, product: 'b4a' | 'b4i' | 'b4j' | 'b4r' = 'b4a'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  markdown.appendCodeblock(item.name, 'b4x');
  markdown.appendMarkdown(`Type: ${item.name}\n\n`);
  markdown.appendMarkdown(`Library: ${item.libraryName}\n\n`);

  if (item.doc) {
    markdown.appendMarkdown(`${item.doc}\n`);
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  // Add a quick "Search Online" link to B4X forum for this type
  try {
    const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(item.name)}&ide=true&product=${product}`;
    markdown.appendMarkdown(` · [Search Online](${url})`);
  } catch (e) {
    // ignore
  }

  return markdown;
}

function createMethodDocumentation(ownerClass: B4xClass, item: B4xMethod): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;
  markdown.appendCodeblock(`${ownerClass.name}.${item.signature}`, 'b4x');

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  return markdown;
}

function createSignatureInformation(ownerClass: B4xClass, item: B4xMethod): vscode.SignatureInformation {
  const documentation = new vscode.MarkdownString(undefined, true);
  documentation.appendMarkdown(`Class: ${ownerClass.name}\n\n`);
  documentation.appendMarkdown(`Library: ${ownerClass.libraryName}\n\n`);

  if (item.doc ?? item.description) {
    documentation.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  const information = new vscode.SignatureInformation(item.signature, documentation);
  information.parameters = item.parameters.map((parameter) => {
    const typeName = parameter.rawType ?? parameter.type;
    return new vscode.ParameterInformation(`${parameter.name} As ${typeName}`);
  });

  return information;
}

function createPropertyDocumentation(ownerClass: B4xClass, item: B4xProperty): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;

  markdown.appendCodeblock(`${ownerClass.name}.${item.signature}`, 'b4x');
  markdown.appendMarkdown(`Access: ${item.access}\n\n`);
  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  return markdown;
}

function collectGlobalsVariables(document: vscode.TextDocument): Map<string, { visibility: 'private' | 'public' | 'dim'; scope: 'class' | 'process' }> {
  const result = new Map<string, { visibility: 'private' | 'public' | 'dim'; scope: 'class' | 'process' }>();
  let inClassGlobals = false;
  let inProcessGlobals = false;

  const startLine = getPostDesignStartLine(document);
  for (let i = startLine; i < document.lineCount; i += 1) {
    const raw = document.lineAt(i).text;
    const code = raw.replace(/'.*$/, '').trim();
    if (!code) continue;

    if (/^\s*Sub\s+Class_Globals\b/i.test(code)) {
      inClassGlobals = true;
      inProcessGlobals = false;
      continue;
    }

    if (/^\s*Sub\s+Process_Globals\b/i.test(code)) {
      inProcessGlobals = true;
      inClassGlobals = false;
      continue;
    }

    if (/^\s*End\s+Sub\b/i.test(code)) {
      inClassGlobals = false;
      inProcessGlobals = false;
      continue;
    }

    const scope: 'class' | 'process' | undefined = inClassGlobals ? 'class' : inProcessGlobals ? 'process' : undefined;
    if (!scope) continue;

    const declMatch = /^\s*(?<visibility>Dim|Private|Public)\s+(.+)$/i.exec(code);
    const visibilityRaw = declMatch?.groups?.visibility?.toLowerCase();
    const clause = declMatch ? declMatch[2] : undefined;
    if (!clause) continue;

    const visibility = visibilityRaw === 'private' ? 'private' : visibilityRaw === 'public' ? 'public' : 'dim';

    for (const entry of parseTypedNameList(clause)) {
      if (entry.name) {
        result.set(entry.name, { visibility, scope });
      }
    }
  }

  return result;
}

function collectSubRanges(document: vscode.TextDocument): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inSub = false;
  let subStart = 0;

  const startLine = getPostDesignStartLine(document);
  for (let i = startLine; i < document.lineCount; i += 1) {
    const code = document.lineAt(i).text.replace(/'.*$/, '').trim();
    if (!code) continue;

    if (!inSub && /^\s*Sub\b/i.test(code)) {
      inSub = true;
      subStart = i;
      continue;
    }

    if (inSub && /^\s*End\s+Sub\b/i.test(code)) {
      inSub = false;
      ranges.push([subStart, i]);
    }
  }

  return ranges;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMemberHoverDocumentation(ownerClass: B4xClass, member: B4xMemberEntry, product: 'b4a' | 'b4i' | 'b4j' | 'b4r' = 'b4a'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = true;

  if (member.kind === 'method') {
    markdown.appendCodeblock(member.item.signature, 'b4x');
    markdown.appendMarkdown(`Class: ${ownerClass.name}\n\n`);
    markdown.appendMarkdown(`Library: ${ownerClass.libraryName}\n\n`);

    if (member.item.doc ?? member.item.description) {
      markdown.appendMarkdown(`${member.item.doc ?? member.item.description}\n`);
    }

    // Add action links
    markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
    markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

    try {
      const query = `${ownerClass.name} ${member.item.name}`;
      const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(query)}&ide=true&product=${product}`;
      markdown.appendMarkdown(` · [Search Online](${url})`);
    } catch (e) {
      // ignore
    }

    return markdown;
  }

  markdown.appendCodeblock(member.item.signature, 'b4x');
  markdown.appendMarkdown(`Property: ${member.item.name}\n\n`);
  markdown.appendMarkdown(`Access: ${member.item.access}\n\n`);
  markdown.appendMarkdown(`Class: ${ownerClass.name}\n\n`);
  markdown.appendMarkdown(`Library: ${ownerClass.libraryName}\n\n`);

  if (member.item.doc ?? member.item.description) {
    markdown.appendMarkdown(`${member.item.doc ?? member.item.description}\n`);
  }
  // Add action links
  markdown.appendMarkdown(`\n[Go to Definition](command:editor.action.revealDefinition "Go to Definition")`);
  markdown.appendMarkdown(` · [Find All References](command:editor.action.referenceSearch.trigger "Find All References")`);

  try {
    const query = `${ownerClass.name} ${member.item.name}`;
    const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(query)}&ide=true&product=${product}`;
    markdown.appendMarkdown(` · [Search Online](${url})`);
  } catch (e) {
    // ignore
  }

  return markdown;
}

function findActiveSignatureIndex(methods: readonly B4xMethodEntry[], argumentIndex: number): number {
  const matchIndex = methods.findIndex((item) => item.method.parameters.length > argumentIndex);
  return matchIndex >= 0 ? matchIndex : 0;
}

function toLocalCompletionKind(kind: B4xLocalSymbol['kind']): vscode.CompletionItemKind {
  if (kind === 'sub') {
    return vscode.CompletionItemKind.Function;
  }

  if (kind === 'type') {
    return vscode.CompletionItemKind.Struct;
  }

  return vscode.CompletionItemKind.Variable;
}

function createLocalSymbolDetail(item: B4xLocalSymbol): string {
  if (item.kind === 'sub') {
    return 'Local sub';
  }

  if (item.kind === 'type') {
    return 'Local type';
  }

  if (item.container && item.typeName) {
    return `${item.container}: ${item.typeName}`;
  }

  if (item.container) {
    return `${item.container} variable`;
  }

  if (item.typeName) {
    return `Local variable: ${item.typeName}`;
  }

  return 'Local variable';
}

function dedupeCompletionItems(items: vscode.CompletionItem[]): vscode.CompletionItem[] {
  const seen = new Set<string>();
  const result: vscode.CompletionItem[] = [];

  for (const item of items) {
    const uniqueId = (item as any).__uniqueId as string | undefined;
    let key: string;
    if (uniqueId) {
      key = uniqueId;
    } else {
      const detail = typeof item.detail === 'string' ? item.detail.toLowerCase() : '';
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      key = `${item.kind}:${label.toLowerCase()}:${detail}`;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function formatPropertyAccess(access: B4xProperty['access']): string {
  if (access === 'readonly') {
    return '(read only)';
  }

  if (access === 'writeonly') {
    return '(write only)';
  }

  return '(read/write)';
}

function getCompletionPrefix(document: vscode.TextDocument, position: vscode.Position): string {
  const linePrefix = getLinePrefix(document, position);
  const match = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(linePrefix);
  return match?.[1] ?? '';
}

function createMemberCompletionRange(position: vscode.Position, memberPrefix: string): vscode.Range {
  const startCharacter = Math.max(0, position.character - memberPrefix.length);
  return new vscode.Range(position.line, startCharacter, position.line, position.character);
}

function scheduleMemberSuggest(document: vscode.TextDocument): void {
  if (pendingSuggestRequest) {
    clearTimeout(pendingSuggestRequest);
  }

  pendingSuggestRequest = setTimeout(() => {
    pendingSuggestRequest = undefined;

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document !== document) {
      return;
    }

    const position = activeEditor.selection.active;
    const lineText = activeEditor.document.lineAt(position.line).text;
    if (isCommentPosition(lineText, position.character)) {
      return;
    }

    const memberAccess = getMemberAccessInfo(getLinePrefix(activeEditor.document, position));
    if (!memberAccess) {
      return;
    }

    void vscode.commands.executeCommand('editor.action.triggerSuggest');
  }, 0);
}

/** Remove stale per-file B4X exclusions previously written by the extension. */
async function resetExplorerFilter(projectFilePath?: string): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('files');
    const existingExclude = config.get<Record<string, any>>('exclude', {});
    const newExclude = { ...existingExclude };

    for (const key of Object.keys(newExclude)) {
      if (/\.(bas|b4a|b4i|b4j|b4r)$/i.test(key)) {
        delete newExclude[key];
      }
    }

    if (projectFilePath) {
      const relativeProject = vscode.workspace.asRelativePath(vscode.Uri.file(projectFilePath), false);
      if (relativeProject in newExclude) {
        delete newExclude[relativeProject];
      }
    }

    await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
  } catch (err) {
    console.error('B4X: failed to reset explorer filter', err);
  }
}

/**
 * Dynamically updates workspace 'files.exclude' to show ONLY B4X modules
 * that are referenced by the current project file. This helps remove clutter
 * from unrelated projects in the same directory.
 */
async function applyExplorerFilter(projectFilePath: string, referencedFiles: string[]) {
  try {
    const projectRoot = getB4xProjectRoot(projectFilePath);
    const referencedSet = new Set(referencedFiles.map(f => pathKey(f)));
    referencedSet.add(pathKey(projectFilePath));

    // Generate referenced main generated file path
    const mainGenDir = path.join(path.dirname(projectFilePath), '.vscode', 'b4x-main');
    // We don't necessarily know the exact name, but we can treat the whole .vscode folder as allowed
    // or specifically the generated main file if we want to be strict.
    // For now, let's keep it simple.

    // find all B4X related files in the workspace (source and projects)
    const b4xFiles = await vscode.workspace.findFiles('**/*.{bas,b4j,b4a,b4i,b4r}');
    
    const config = vscode.workspace.getConfiguration('files');
    const existingExclude = config.get<Record<string, any>>('exclude', {});
    
    // We only want to manage exclusions for .bas and .b4* files to avoid
    // disturbing user's other exclusions (like .git, node_modules, etc.)
    const newExclude = { ...existingExclude };
    
    for (const fileUri of b4xFiles) {
      const fullPath = pathKey(fileUri.fsPath);
      const relative = vscode.workspace.asRelativePath(fileUri, false);
      
      if (!referencedSet.has(fullPath)) {
        // This is a B4X source/project file but NOT in the active project.
        // If it was previously un-excluded or missing, exclude it now.
        newExclude[relative] = true;
      } else {
        // This IS in the project. Ensure it's NOT excluded.
        // Setting to false explicitly removes any previous dynamic exclusion.
        if (newExclude[relative] === true) {
          delete newExclude[relative];
        }
      }
    }

    // Update the workspace setting. We use ConfigurationTarget.Workspace to anchor 
    // it to the current project/folder session.
    await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
    console.log(`[B4X DEBUG] applyExplorerFilter: Updated files.exclude with ${Object.keys(newExclude).length} entries`);
  } catch (err) {
    console.error('B4X: failed to apply explorer filter', err);
  }
}

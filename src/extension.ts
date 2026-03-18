import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as cp from 'child_process';

import {
  ApiIndexStore,
  B4xMemberEntry,
  B4xMethodEntry,
  B4xPropertyEntry,
} from './apiIndex';
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
import { getPlatformSettings } from './platformConfig';
import { loadConfiguredPlatforms } from './platformIni';
import { getProjectRootFromProjectFile, loadWorkspaceProjectConfig, isInsideWorkspace } from './projectFile';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import { libraryIndex } from './storage/libraryIndexSqlite';
import { B4xClass, B4xMethod, B4xProperty } from './types';
import importVsSettingsFile, { tryImportThemeFromB4aInstall } from './vssettingsImporter';
import { registerTypeDiagnostics } from './typeDiagnostics';
import TypeCodeActionProvider from './typeCodeAction';
import ExtractMethodCodeActionProvider from './extractMethodCodeAction';
import { startLanguageClient } from './lspClient';
import { sendRequest } from './lspClient';

let pendingSuggestRequest: NodeJS.Timeout | undefined;
let pendingPlatformReload: NodeJS.Timeout | undefined;
// Disposable handle for the running language client (if started)
let lspClientDisposable: vscode.Disposable | undefined;
// Track current project scope so workspace scanner only runs for the opened project
let currentProjectDirectory: string | undefined;
let currentAllowedModuleBasePaths: ReadonlySet<string> | undefined;

// Simple trace helper for project-open flow
const trace = (...args: unknown[]): void => {
  try {
    const prefix = `[B4X TRACE ${new Date().toISOString()}]`;
    // If a single string was provided, keep message compact, otherwise spread args
    if (args.length === 1 && typeof args[0] === 'string') {
      // console.log(`${prefix} ${args[0]}`);
    } else {
      // console.log(prefix, ...args);
    }
  } catch {
    // ignore
  }
};

// Extract .bas/.b4x module files from a .b4xlib archive using PowerShell's
// Expand-Archive (Windows). Returns absolute paths to extracted module files.
async function extractModulesFromB4xlib(archivePath: string): Promise<string[]> {
  const cacheBase = libraryIndex.getCacheDir();
  const nameSafe = path.basename(archivePath).replace(/[^a-z0-9\.\-_]/gi, '_');
  const outDir = path.join(cacheBase, `${nameSafe}_${Math.floor(fs.existsSync(archivePath) ? fs.statSync(archivePath).mtimeMs : Date.now())}`);
  try {
    await fs.promises.mkdir(outDir, { recursive: true });
  } catch {
    return [];
  }

  // Use PowerShell Expand-Archive to extract; ignore failures.
  const psCommand = `try { Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force } catch { }`;
  await new Promise<void>((resolve) => {
    try {
      cp.execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], { timeout: 30_000 }, () => resolve());
    } catch {
      resolve();
    }
  });

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
      if (ext === '.bas' || ext === '.b4x') {
        result.push(p);
      }
    }));
  }

  await walk(outDir);
  // register extracted files in DB for this archive
  try {
    const st = await fs.promises.stat(archivePath).catch(() => undefined);
    const inner = [] as any[];
    for (const p of result) {
      const rel = path.relative(outDir, p);
      const s = await fs.promises.stat(p).catch(() => undefined);
      if (s) inner.push({ relPath: rel, absPath: p, mtime: Math.floor(s.mtimeMs), size: s.size });
    }
    await (async () => {
      try {
        libraryIndex.upsertB4xlibArchive(archivePath, st ? Math.floor(st.mtimeMs) : Date.now(), outDir, inner);
      } catch (err) {
        console.warn('B4X: failed to upsert b4xlib archive info', archivePath, err);
      }
    })();
  } catch { /* ignore */ }

  return result;
}
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Ensure autoLoadProjectAssets is always true on activation
    try {
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      await cfg.update('autoLoadProjectAssets', true, vscode.ConfigurationTarget.Workspace);
      // console.log('B4X: autoLoadProjectAssets set to true on activation');
    } catch (err) {
      console.warn('B4X: failed to set autoLoadProjectAssets on activation', err);
    }
  // trace('activate.enter');
  // Defer loading the bundled API index at activation to keep startup lightweight.
  // Use an empty index now and load/merge later on demand if needed.
  let apiIndex = ApiIndexStore.empty();

  // Create workspace class store without performing an initial full refresh at activation.
  // The store will be populated later on-demand via `refresh()` or `replaceExternalSourceFiles()`.
  const workspaceClasses = new WorkspaceClassStore();
  const xmlLibraries = new XmlLibraryStore();

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
  // On activation: check timestamps for important platform assets (B4XPages.b4xlib, Core.xml)
  // and reload them if changed since last activation. This lightweight check helps keep
  // intellisense in sync without performing full workspace initialization.
  (async function checkPlatformAssetsTimestamps(): Promise<void> {
    // trace('checkPlatformAssetsTimestamps.enter');
    try {
      const platformSettings = getPlatformSettings();
      const loadedPlatforms = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
      if (!loadedPlatforms || loadedPlatforms.length === 0) return;
      const preferred = loadedPlatforms.find((p) => p.platform === 'b4a') ?? loadedPlatforms[0];

      // Only inspect the install `libraries` folder for Core.xml/XUI.xml on activation.
      // Try several fallbacks to locate the install `Libraries` folder and discover its XMLs.
      let installXmlCandidates: string[] = [];
      let discoveredInstallFolder: string | undefined;
      try {
        // console.log(`B4X TRACE ${new Date().toISOString()}] activation -> preferred.iniPath=${preferred?.iniPath}`);
        // console.log(`B4X TRACE ${new Date().toISOString()}] activation -> preferred.folders=${JSON.stringify(preferred?.folders)}`);

        const tryFolder = async (folder?: string): Promise<boolean> => {
          if (!folder) return false;
          try {
            const stat = await fs.promises.stat(folder).catch(() => undefined);
            if (!stat || !stat.isDirectory()) return false;
            // Lightweight: only inspect root and one-level subfolders for .xml files
            const found: string[] = [];
            const entries = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => []);
            for (const e of entries) {
              try {
                const full = path.join(folder, e.name);
                if (e.isFile() && path.extname(e.name).toLowerCase() === '.xml') {
                  found.push(full);
                } else if (e.isDirectory()) {
                  const childEntries = await fs.promises.readdir(full).catch(() => []);
                  for (const ce of childEntries) {
                    if (path.extname(ce).toLowerCase() === '.xml') {
                      found.push(path.join(full, ce));
                    }
                  }
                }
              } catch { /* ignore per-entry */ }
            }
            if (found.length > 0) {
              installXmlCandidates = found;
              discoveredInstallFolder = folder;
              return true;
            }
          } catch (err) {
            // ignore and continue
          }
          return false;
        };

        // 1) configured `librariesFolder` from parsed INI
          if (preferred?.folders?.librariesFolder) {
          const ok = await tryFolder(preferred.folders.librariesFolder);
          if (ok) {
            // console.log(`B4X TRACE ${new Date().toISOString()}] activation -> used configured librariesFolder=${preferred.folders.librariesFolder}`);
          }
        }

        // 2) fallback: try to derive from PlatformFolder value inside the INI (common layout)
        if (!discoveredInstallFolder && preferred?.iniPath && fs.existsSync(preferred.iniPath)) {
          try {
            const iniRaw = await fs.promises.readFile(preferred.iniPath, 'utf8').catch(() => '');
            const m = iniRaw.match(/^[ \t]*PlatformFolder[ \t]*=[ \t]*(.+)$/im);
              if (m && m[1]) {
              const platformFolder = m[1].trim();
              const sdkRoot = path.normalize(path.join(platformFolder, '..', '..'));
              const candidate = path.join(sdkRoot, 'Libraries');
              const ok = await tryFolder(candidate);
              if (ok) {
                // console.log(`B4X TRACE ${new Date().toISOString()}] activation -> derived librariesFolder from PlatformFolder -> ${candidate}`);
              }
            }
          } catch (err) {
            // ignore
          }
        }

        // 2b) fallback: try configured B4A install path from extension settings
        if (!discoveredInstallFolder) {
          try {
            const cfgInstall = vscode.workspace.getConfiguration('b4xIntellisense').get<string>('b4aInstallPath', '') ?? '';
            if (cfgInstall) {
              const candidate = path.join(cfgInstall, 'Libraries');
              const ok = await tryFolder(candidate);
              if (ok) trace('activation -> used b4aInstallPath Libraries', candidate);
            }
          } catch (err) {
            // ignore
          }
        }

        // 3) try some nearby candidates relative to the INI file location
        if (!discoveredInstallFolder && preferred?.iniPath) {
          const iniDir = path.dirname(preferred.iniPath);
          const candidates = [path.join(iniDir, '..', 'Libraries'), path.join(iniDir, '..', '..', 'Libraries')].map((p) => path.normalize(p));
          for (const c of candidates) {
            const ok = await tryFolder(c);
            if (ok) {
              // console.log(`B4X TRACE ${new Date().toISOString()}] activation -> found librariesFolder candidate ${c}`);
              break;
            }
          }
        }

        // persist discovered folders (if any) to workspace state so project-open restore can use them
        if (discoveredInstallFolder) {
            try {
            await context.workspaceState.update('b4x.platformLibrariesFolder', discoveredInstallFolder);
            // console.log('B4X: persisted discovered platform libraries folder', discoveredInstallFolder);
          } catch (err) {
            console.warn('B4X: failed to persist discovered platform libraries folder', err);
          }
        }
      } catch (err) {
        console.warn('B4X: failed to discover install library assets during activation', err);
      }

      const stampsKey = 'b4x.assetTimestamps';
      const existing: Record<string, number> = context.workspaceState.get(stampsKey, {});
      const updates: Record<string, number> = { ...existing };

      // Helper to check a file by name in a list and reload if newer
      const checkFile = async (candidates: string[], baseName: string, onChanged?: (filePath: string) => Promise<void>) => {
        const found = candidates.find((c) => path.basename(c).toLowerCase() === baseName.toLowerCase());
        if (!found) return;
        try {
          const stat = await fs.promises.stat(found).catch(() => undefined);
          if (!stat) return;
          const mtime = stat.mtimeMs || stat.mtime?.getTime() || Date.now();
          const prev = existing[found] ?? 0;
            if (!prev || mtime > prev) {
            // mark changed and invoke reload handler
            updates[found] = mtime;
            if (onChanged) await onChanged(found);
            // console.log(`B4X: detected updated asset ${baseName} -> ${found}`);
          }
        } catch (err) {
          console.warn('B4X: failed to stat asset', found, err);
        }
      };

      // Check Core.xml (reload xml libraries into the in-memory xmlLibraries store)
      await checkFile(installXmlCandidates, 'Core.xml', async (filePath) => {
          try {
          await xmlLibraries.replaceXmlFiles([filePath]);
          // Persist the Core.xml path so we can preserve it across intellisense clears
          await context.workspaceState.update('b4x.coreXmlPath', filePath);
          // console.log('B4X: reloaded Core.xml into xmlLibraries store', filePath);
        } catch (err) {
          console.warn('B4X: failed to reload Core.xml', err);
        }
      });
      // Also check for XUI.xml and persist it so we can restore UI classes as needed
      await checkFile(installXmlCandidates, 'XUI.xml', async (filePath) => {
          try {
          // Do not replace xmlLibraries here; just persist the path for later restoration
          await context.workspaceState.update('b4x.xuiXmlPath', filePath);
          // console.log('B4X: detected XUI.xml and persisted path', filePath);
        } catch (err) {
          console.warn('B4X: failed to persist XUI.xml path', err);
        }
      });

      // Also check for the important B4XPages.b4xlib (some installs place it under Libraries)
      try {
        const b4xlibCandidates: string[] = [];
        // include any discovered install folder candidates
        if (discoveredInstallFolder) {
          b4xlibCandidates.push(path.join(discoveredInstallFolder, 'B4XPages.b4xlib'));
          b4xlibCandidates.push(path.join(discoveredInstallFolder, 'B4XPages', 'B4XPages.b4xlib'));
        }
        // include any b4xlib files reported by loadedPlatforms assets
        b4xlibCandidates.push(...loadedPlatforms.flatMap((p) => p.assets?.b4xlibFiles ?? []));

        await checkFile(b4xlibCandidates, 'B4XPages.b4xlib', async (filePath) => {
          try {
            // Load the B4XPages .b4xlib into the XmlLibraryStore so pages/classes are available
            await xmlLibraries.replaceXmlFiles([filePath]);
            await context.workspaceState.update('b4x.b4xlibPath', filePath);
            // console.log('B4X: loaded and persisted B4XPages.b4xlib ->', filePath);
          } catch (err) {
            console.warn('B4X: failed to load B4XPages.b4xlib', err);
          }
        });
      } catch (err) {
        // ignore b4xlib probe errors
      }

      // persist updated timestamps
      // trace('checkPlatformAssetsTimestamps.persistTimestamps', { updatesCount: Object.keys(updates).length });
      await context.workspaceState.update(stampsKey, updates);
      // trace('checkPlatformAssetsTimestamps.exit');
    } catch (err) {
      console.warn('B4X: failed to check platform asset timestamps', err);
    }
  })();
  const preferLiveAtStartup = vscode.workspace.getConfiguration('b4xIntellisense').get<boolean>('preferLiveSources', true);
  const apiCountAtStartup = apiIndex.allClasses.length;
  const workspaceCountAtStartup = workspaceClasses.findClassesByPrefix('').length;
  const xmlCountAtStartup = xmlLibraries.findClassesByPrefix('').length;
  // console.log(
  //   `B4X IntelliSense: preferLiveSources=${preferLiveAtStartup} — classes(api=${apiCountAtStartup}, workspace=${workspaceCountAtStartup}, xml=${xmlCountAtStartup})`,
  // );
  // Do not assume a project is "opened" at activation time. We must wait for the
  // user to explicitly select/open a .b4a via the command before performing
  // heavy initialization (watchers, full platform reload, LSP) or applying INI/theme.
  const hasOpenedProject = Boolean(context.workspaceState.get('b4x.lastOpenedProjectFile'));
  let workspaceWatcher: vscode.FileSystemWatcher | undefined;
  let projectFileWatcher: vscode.FileSystemWatcher | undefined;
  // Only mark initialized once the user explicitly opens a project via the command.
  let initializedForProject = false;
  let platformWatchers: vscode.Disposable[] = [];

  const disposePlatformWatchers = (): void => {
    for (const watcher of platformWatchers) {
      watcher.dispose();
    }

    platformWatchers = [];
  };

  const schedulePlatformReload = (): void => {
    if (pendingPlatformReload) {
      clearTimeout(pendingPlatformReload);
    }

    pendingPlatformReload = setTimeout(() => {
      pendingPlatformReload = undefined;
      void reloadPlatformAssets();
    }, 150);
  };

  async function generateIntellisenseReport(projectRoot: string): Promise<void> {
    // trace('generateIntellisenseReport.enter', projectRoot);
    try {
      const reportPath = path.join(projectRoot, 'b4x-intellisense-report.html');

      // Gather API index classes grouped by library
      const apiClasses = apiIndex!.allClasses;
      const apiByLib = new Map<string, any[]>();
      for (const cls of apiClasses) {
        const lib = (cls.libraryName || 'Unknown').toString();
        if (!apiByLib.has(lib)) apiByLib.set(lib, []);
        apiByLib.get(lib)!.push(cls);
      }

      // Workspace classes (includes external)
      const workspaceAll = workspaceClasses.findClassesByPrefix('');
      const workspaceBySource = new Map<string, any[]>();
      for (const cls of workspaceAll) {
        const src = cls.libraryName || 'Workspace';
        if (!workspaceBySource.has(src)) workspaceBySource.set(src, []);
        workspaceBySource.get(src)!.push(cls);
      }

      // XML libraries
      const xmlAll = xmlLibraries.findClassesByPrefix('');
      const xmlByLib = new Map<string, any[]>();
      for (const cls of xmlAll) {
        const lib = (cls.libraryName || 'Unknown').toString();
        if (!xmlByLib.has(lib)) xmlByLib.set(lib, []);
        xmlByLib.get(lib)!.push(cls);
      }

      // Persistent index if present
      const persistentPath = path.join(projectRoot, '.b4x-index.json');
      let persistentSummary = '';
      if (fs.existsSync(persistentPath)) {
        try {
          const raw = await fs.promises.readFile(persistentPath, 'utf8');
          const parsed = JSON.parse(raw);
          const classes = parsed?.classes?.length ?? parsed?.classesByName ? Object.keys(parsed.classesByName).length : 0;
          persistentSummary = `Found persistent index with ${classes} classes`;
        } catch (err) {
          persistentSummary = 'Failed to read persistent index';
        }
      } else {
        persistentSummary = 'No persistent index found';
      }

      // Build simple HTML
      let html = `<!doctype html><html><head><meta charset="utf-8"><title>B4X Intellisense Report</title>
        <style>body{font-family:Segoe UI,Arial;margin:20px}table{border-collapse:collapse;width:100%;margin-bottom:20px}th,td{border:1px solid #ddd;padding:6px}th{background:#f4f4f4;text-align:left}</style>
        </head><body>`;
      html += `<h1>B4X Intellisense Report</h1><p>Generated: ${new Date().toISOString()}</p>`;
      html += `<h2>Persistent Index</h2><p>${persistentSummary}</p>`;

      html += `<h2>API Index (by library)</h2>`;
      for (const [lib, list] of apiByLib.entries()) {
        html += `<h3>${lib} (${list.length})</h3><table><tr><th>Class</th><th>Methods</th><th>Properties</th></tr>`;
        for (const c of list) {
          html += `<tr><td>${escapeHtml(c.name)}</td><td>${(c.methods||[]).length}</td><td>${(c.properties||[]).length}</td></tr>`;
          html += `<tr><td colspan="3">`;
          html += `<strong>Methods</strong><ul>`;
          for (const m of c.methods || []) {
            const sig = (m.signature ?? m.rawSignature ?? m.name) as string;
            html += `<li>${escapeHtml(m.name)}${sig ? ` — <code>${escapeHtml(sig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `<strong>Properties</strong><ul>`;
          for (const p of c.properties || []) {
            const psig = (p.signature ?? p.rawSignature ?? p.name) as string;
            html += `<li>${escapeHtml(p.name)}${psig ? ` — <code>${escapeHtml(psig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `</td></tr>`;
        }
        html += `</table>`;
      }

      html += `<h2>Workspace Classes</h2>`;
      for (const [src, list] of workspaceBySource.entries()) {
        html += `<h3>${src} (${list.length})</h3><table><tr><th>Class</th><th>File</th><th>Methods</th><th>Properties</th></tr>`;
        for (const c of list) {
          html += `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(path.relative(projectRoot, c.filePath || ''))}</td><td>${(c.methods||[]).length}</td><td>${(c.properties||[]).length}</td></tr>`;
          html += `<tr><td colspan="4">`;
          html += `<strong>Methods</strong><ul>`;
          for (const m of c.methods || []) {
            const sig = (m.signature ?? m.rawSignature ?? m.name) as string;
            html += `<li>${escapeHtml(m.name)}${sig ? ` — <code>${escapeHtml(sig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `<strong>Properties</strong><ul>`;
          for (const p of c.properties || []) {
            const psig = (p.signature ?? p.rawSignature ?? p.name) as string;
            html += `<li>${escapeHtml(p.name)}${psig ? ` — <code>${escapeHtml(psig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `</td></tr>`;
        }
        html += `</table>`;
      }

      html += `<h2>XML Libraries</h2>`;
      for (const [lib, list] of xmlByLib.entries()) {
        html += `<h3>${lib} (${list.length})</h3><table><tr><th>Class</th><th>File</th><th>Methods</th><th>Properties</th></tr>`;
        for (const c of list) {
          html += `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(path.relative(projectRoot, c.filePath || ''))}</td><td>${(c.methods||[]).length}</td><td>${(c.properties||[]).length}</td></tr>`;
          html += `<tr><td colspan="4">`;
          html += `<strong>Methods</strong><ul>`;
          for (const m of c.methods || []) {
            const sig = (m.signature ?? m.rawSignature ?? m.name) as string;
            html += `<li>${escapeHtml(m.name)}${sig ? ` — <code>${escapeHtml(sig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `<strong>Properties</strong><ul>`;
          for (const p of c.properties || []) {
            const psig = (p.signature ?? p.rawSignature ?? p.name) as string;
            html += `<li>${escapeHtml(p.name)}${psig ? ` — <code>${escapeHtml(psig)}</code>` : ''}</li>`;
          }
          html += `</ul>`;
          html += `</td></tr>`;
        }
        html += `</table>`;
      }

      html += `<p>Report generated by B4X IntelliSense extension.</p></body></html>`;

      await fs.promises.writeFile(reportPath, html, 'utf8');
      void vscode.window.showInformationMessage(`B4X: intellisense report written to ${reportPath}`);
    } catch (err) {
      console.error('B4X: failed to generate intellisense report', err);
    }
  }

  function escapeHtml(input: string | undefined): string {
    if (!input) return '';
    return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const rebuildPlatformWatchers = (loadedPlatforms: Awaited<ReturnType<typeof loadConfiguredPlatforms>>): void => {
    // trace('rebuildPlatformWatchers.enter', { platformCount: loadedPlatforms.length });
    disposePlatformWatchers();

    const watchedFolders = new Set<string>();

    for (const platform of loadedPlatforms) {
      const iniWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(platform.iniPath), path.basename(platform.iniPath)),
      );
      iniWatcher.onDidChange(() => schedulePlatformReload());
      iniWatcher.onDidCreate(() => schedulePlatformReload());
      iniWatcher.onDidDelete(() => schedulePlatformReload());
      platformWatchers.push(iniWatcher);

      // Watch libraries first, then additional libraries, then shared modules.
      for (const folder of [
        platform.folders.librariesFolder,
        platform.folders.additionalLibrariesFolder,
        platform.folders.sharedModulesFolder,
      ].filter((item): item is string => Boolean(item))) {
        const normalizedFolder = folder.toLowerCase();
        if (watchedFolders.has(normalizedFolder)) {
          continue;
        }

        watchedFolders.add(normalizedFolder);

        const folderWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, '**/*.{bas,b4x,xml,b4xlib}'),
        );
        folderWatcher.onDidChange(() => schedulePlatformReload());
        folderWatcher.onDidCreate(() => schedulePlatformReload());
        folderWatcher.onDidDelete(() => schedulePlatformReload());
        platformWatchers.push(folderWatcher);
      }
    }
  };

  // Sync generated Main .b4x edits back to the .b4a project file (content after @EndOfDesignText@)
  const syncGeneratedMainBack = async (document: vscode.TextDocument): Promise<void> => {
    try {
      const genPath = document.uri.fsPath;
      if (!genPath.toLowerCase().includes(`${path.sep}.vscode${path.sep}b4x-main${path.sep}`)) return;

      const genDir = path.dirname(genPath);
      const projectDir = path.resolve(path.join(genDir, '..', '..'));

      // Look for .b4a files in projectDir/B4A first
      let candidates: string[] = [];
      try {
        const b4aFolder = path.join(projectDir, 'B4A');
        const entries = await fs.promises.readdir(b4aFolder).catch(() => []);
        candidates = entries.filter((n) => n.toLowerCase().endsWith('.b4a')).map((n) => path.join(b4aFolder, n));
      } catch {
        candidates = [];
      }

      if (candidates.length === 0) {
        // Do not perform workspace-wide search; assume .b4a lives in projectDir/B4A.
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

      // create a timestamped backup of the .b4a before overwriting
        try {
          const now = new Date();
          const stamp = now.toISOString().replace(/[:]/g, '-').replace(/T/, '_').split('.')[0];
          const backupPath = `${target}.bak-${stamp}`;
          await fs.promises.copyFile(target!, backupPath);
          // console.log(`B4X: backed up ${path.basename(target!)} -> ${path.basename(backupPath)}`);
        } catch (err) {
        console.warn('B4X: failed to create .b4a backup', err);
      }

      await fs.promises.writeFile(target!, outText, 'utf8');
      void vscode.window.showInformationMessage(`B4X: Synced Main content back to ${path.basename(target!)} (backup created)`);
    } catch (err) {
      console.warn('B4X: failed to sync generated Main back to .b4a', err);
    }
  };

  // Apply persisted system INI values (auto-save, format hints, fonts).
  // This was extracted from `reloadPlatformAssets` so callers can invoke
  // INI/theme application independently of the full platform reload.
  const applyPersistedSystemIniSettings = async (): Promise<void> => {
    // trace('applyPersistedSystemIniSettings.enter');
    try {
      const systemSettings = context.workspaceState.get<any>('b4x.systemIni');
      const hasOpenedProject = Boolean(context.workspaceState.get<string>('b4x.lastOpenedProjectFile'));
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
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        const themeAutoApply = cfg.get<string>('autoApplyIni', 'prompt');
        const doApplyFont = async () => {
          const editorCfg = vscode.workspace.getConfiguration('editor');
          if (systemSettings.fontName2) {
            await editorCfg.update('fontFamily', systemSettings.fontName2, vscode.ConfigurationTarget.Workspace);
          }
          if (typeof systemSettings.fontSize2 === 'number') {
            await editorCfg.update('fontSize', systemSettings.fontSize2, vscode.ConfigurationTarget.Workspace);
          }
          // console.log('B4X: applied font hints from system INI', { fontName2: systemSettings.fontName2, fontSize2: systemSettings.fontSize2 });
          void vscode.window.showInformationMessage('B4X: Applied font hints from system INI to workspace editor.');
        };

        if (systemSettings.fontName2 || typeof systemSettings.fontSize2 === 'number') {
          // When a project is open, apply font hints immediately without prompting.
          const hasOpenedProjectNow = Boolean(context.workspaceState.get<string>('b4x.lastOpenedProjectFile'));
          if (hasOpenedProjectNow) {
            await doApplyFont();
          } else if (themeAutoApply === 'always') {
            await doApplyFont();
          } else if (themeAutoApply === 'never') {
            // skip
          } else {
            const apply = 'Apply Font';
            const always = 'Always apply for workspace';
            const never = "Don't apply";
            const choice = await vscode.window.showInformationMessage(
              `B4X: System INI suggests font '${systemSettings.fontName2 ?? ''}' size '${systemSettings.fontSize2 ?? ''}'. Apply to workspace?`,
              { modal: false },
              apply,
              always,
              never,
            );
            if (choice === apply) {
              await doApplyFont();
            } else if (choice === always) {
              await cfg.update('autoApplyIni', 'always', vscode.ConfigurationTarget.Workspace);
              await doApplyFont();
            } else if (choice === never) {
              await cfg.update('autoApplyIni', 'never', vscode.ConfigurationTarget.Workspace);
            }
          }
        }
      } catch (err) {
        console.warn('B4X: failed to apply font hints from system INI during reload', err);
      }
    } catch (err) {
      console.warn('B4X: error applying system INI during platform reload', err);
    }
    // trace('applyPersistedSystemIniSettings.exit');
  };

  // Apply platform INI-derived theme/font hints (prefer b4a). Extracted
  // from `reloadPlatformAssets` to allow explicit invocation when desired.
  const applyPlatformIniHints = async (loadedPlatforms: Awaited<ReturnType<typeof loadConfiguredPlatforms>>): Promise<void> => {
    // trace('applyPlatformIniHints.enter');
    try {
      const preferredPlatform = loadedPlatforms.find((p) => p.platform === 'b4a') ?? loadedPlatforms[0];
      const settings = preferredPlatform?.settings;
      if (settings) {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        const autoApply = cfg.get<string>('autoApplyIni', 'prompt');

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
              void vscode.window.showInformationMessage(`B4X: Applied theme hint '${themeName}' from platform INI`);
            } catch (err) {
              console.warn('B4X: failed to apply workbench.theme from INI', err);
            }
          }
        };

        // Only apply INI-derived font/theme hints after a .b4a project has been opened by the user.
        const hasOpenedProject = Boolean(context.workspaceState.get<string>('b4x.lastOpenedProjectFile'));
        if (!hasOpenedProject) {
          // console.log('B4X: deferring INI font/theme application until a .b4a project is opened');
        } else {
          // When a project is open we apply platform INI hints immediately without prompting.
          await doApply();
          try {
            const b4aInstall = vscode.workspace.getConfiguration('b4xIntellisense').get<string>('b4aInstallPath');
            const themeHint = settings.codeTheme ?? settings.ideTheme2 ?? '';
            if (b4aInstall && themeHint) {
              const found = await tryImportThemeFromB4aInstall(b4aInstall, themeHint);
              if (found) {
                // When a project is open, automatically import the matching .vssettings without prompting.
                try {
                  await importVsSettingsFile(vscode.Uri.file(found));
                  // console.log(`B4X: auto-imported theme from ${found}`);
                } catch (impErr) {
                  console.warn('B4X: failed to auto-import theme', impErr);
                }
              }
            }
          } catch (err) {
            console.warn('B4X: theme import attempt failed', err);
          }
        }
      }
    } catch (err) {
      console.warn('B4X: failed to apply font/theme from platform INI', err);
    }
    // trace('applyPlatformIniHints.exit');
  };

  const reloadPlatformAssets = async (
    opts?: { applyIniOnly?: boolean },
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> => {
    // trace('reloadPlatformAssets.enter', { opts });
    // console.log('B4X: reloadPlatformAssets called', { opts });
    const platformSettings = getPlatformSettings();
    const loadedPlatforms = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
    progress?.report({ message: `Discovered ${loadedPlatforms.length} platform(s)` , increment: 5 });
    if (!loadedPlatforms || loadedPlatforms.length === 0) {
      // Nothing to do when no platforms are configured
      return;
    }
    try {
      const systemSettingsDbg = context.workspaceState.get<any>('b4x.systemIni');
      const hasOpenedProjectDbg = Boolean(context.workspaceState.get<string>('b4x.lastOpenedProjectFile'));
      // console.log('B4X: reloadPlatformAssets -> hasOpenedProject=', hasOpenedProjectDbg, 'systemSettings=', systemSettingsDbg ? 'present' : 'missing');
      const cfgDbg = vscode.workspace.getConfiguration('b4xIntellisense');
      // console.log('B4X: reloadPlatformAssets -> autoApplyIni config=', cfgDbg.get('autoApplyIni'));
    } catch (e) {
      console.warn('B4X: reloadPlatformAssets debug info failed', e);
    }
    // Persisted system INI application was extracted to
    // `applyPersistedSystemIniSettings()`; call it explicitly when INI/theme
    // application is desired. `reloadPlatformAssets` no longer applies system
    // INI values directly.
    // If caller requested only INI/theme application, stop here.
    if (opts?.applyIniOnly) {
      return;
    }
    // Platform INI theme/font application was extracted to
    // `applyPlatformIniHints(loadedPlatforms)` and is no longer invoked
    // automatically from this routine.
    const sharedModuleFolders = loadedPlatforms
      .map((platform) => platform.folders.sharedModulesFolder)
      .filter((item): item is string => Boolean(item));
    const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
    const projectConfig = await loadWorkspaceProjectConfig(sharedModuleFolders, activeDocumentUri);
    const allowedLibraries = projectConfig.allowedLibraries;
    const allowedModules = projectConfig.allowedModuleBasePaths;
    apiIndex.setAllowedLibraries(allowedLibraries);
    // Store current project scope for watcher handlers
    currentAllowedModuleBasePaths = allowedModules;
    currentProjectDirectory = projectConfig.projectDirectory;
    progress?.report({ message: 'Scanning workspace modules...' , increment: 10 });
    await workspaceClasses.refresh(currentAllowedModuleBasePaths, currentProjectDirectory);
    progress?.report({ message: 'Workspace scan complete', increment: 10 });

    // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.enter -> platforms=${loadedPlatforms.length}`);
      // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.enter -> platforms=${loadedPlatforms.length}`);
    for (const platform of loadedPlatforms) {
      try {
        const installFolder = platform.folders.librariesFolder;
        // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.platform -> ${platform.platform} ini=${platform.iniPath} installFolder=${installFolder}`);
          if (installFolder) {
            // Do not scan the entire install tree. Instead, for project-scoped
            // loads we only attempt to locate files for libraries explicitly
            // declared in the .b4a. Check both known platform.assets (additional/shared)
            // and a few expected locations under the install `Libraries` folder.
            if (allowedLibraries && allowedLibraries.size > 0) {
              const libs = Array.from(allowedLibraries);
              const matchedXml: string[] = [];
              const matchedB4xlib: string[] = [];
              for (const lib of libs) {
                const libLower = lib.toLowerCase();

                // First check existing platform.assets.xmlFiles (additional/shared folders)
                const xmlFromAssets = (platform.assets.xmlFiles ?? []).find((f) => path.basename(f, path.extname(f)).toLowerCase() === libLower);
                if (xmlFromAssets) {
                  matchedXml.push(xmlFromAssets);
                  continue;
                }

                // Then check a few lightweight install-folder candidates (no recursion)
                const installCandidates = [
                  path.join(installFolder, `${lib}.xml`),
                  path.join(installFolder, lib, `${lib}.xml`),
                ];
                let found = false;
                for (const c of installCandidates) {
                  try {
                    const st = await fs.promises.stat(c).catch(() => undefined);
                    if (st && st.isFile()) {
                      matchedXml.push(c);
                      found = true;
                      break;
                    }
                  } catch { /* ignore */ }
                }
                if (found) continue;

                // Check for .b4xlib in assets first
                const b4FromAssets = (platform.assets.b4xlibFiles ?? []).find((f) => path.basename(f, path.extname(f)).toLowerCase() === libLower);
                if (b4FromAssets) {
                  matchedB4xlib.push(b4FromAssets);
                  continue;
                }

                const b4Candidates = [
                  path.join(installFolder, `${lib}.b4xlib`),
                  path.join(installFolder, lib, `${lib}.b4xlib`),
                ];
                for (const c of b4Candidates) {
                  try {
                    const st = await fs.promises.stat(c).catch(() => undefined);
                    if (st && st.isFile()) {
                      matchedB4xlib.push(c);
                      break;
                    }
                  } catch { /* ignore */ }
                }
              }

              platform.assets.xmlFiles = dedupePaths(matchedXml);
              platform.assets.b4xlibFiles = dedupePaths(matchedB4xlib);
              progress?.report({ message: `Found ${platform.assets.xmlFiles.length} xml and ${platform.assets.b4xlibFiles.length} b4xlib for ${platform.platform}`, increment: 5 });
              // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.platform.filtered -> ${platform.platform} xml=${platform.assets.xmlFiles.length} b4xlib=${platform.assets.b4xlibFiles.length}`);
            } else {
              // No allowed-libraries restriction -> do not probe the install tree.
              // Keep platform.assets values discovered from additional/shared folders.
              console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.platform.skippedInstallScan -> ${platform.platform}`);
                        // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.platform.skippedInstallScan -> ${platform.platform}`);
            }
          }
      } catch (err) {
        console.warn('B4X: failed to discover install libraries for platform', platform.platform, err);
      }
    }

    progress?.report({ message: 'Collecting external modules from platforms...', increment: 5 });
    const configuredExternalModules = loadedPlatforms
      .flatMap((platform) => platform.assets.sourceModuleFiles ?? [])
      .filter((filePath) => isAllowedModuleFile(filePath, allowedModules) && !isInsideWorkspace(filePath));

    console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.exit -> configuredExternalModules=${configuredExternalModules.length}`);
  // console.log(`[B4X TRACE ${new Date().toISOString()}] discoverInstallLibraries.exit -> configuredExternalModules=${configuredExternalModules.length}`);

    // Build a map of file -> platforms for diagnostics so we can trace why
    // specific files are being loaded as external modules.
    const fileToPlatforms = new Map<string, string[]>();
    for (const platform of loadedPlatforms) {
      for (const fp of (platform.assets.sourceModuleFiles ?? [])) {
        const key = fp.toLowerCase();
        const arr = fileToPlatforms.get(key) ?? [];
        if (!arr.includes(platform.platform)) arr.push(platform.platform);
        fileToPlatforms.set(key, arr);
      }
    }

    const externalCandidates = dedupePaths([
      ...configuredExternalModules,
      ...(projectConfig.externalModuleFiles ?? []),
    ]);

    progress?.report({ message: `External module candidates: ${externalCandidates.length}`, increment: 5 });
    console.log(`[B4X TRACE ${new Date().toISOString()}] externalCandidates.count=${externalCandidates.length}`);
      // console.log(`[B4X TRACE ${new Date().toISOString()}] externalCandidates.count=${externalCandidates.length}`);
    // Log a small sample with origin info for debugging
    for (let i = 0; i < Math.min(50, externalCandidates.length); i += 1) {
      const p = externalCandidates[i];
      if (!p) continue;
      const inWorkspace = ((): boolean => {
        try {
          return isInsideWorkspace(p!);
        } catch { return false; }
      })();
      const key = (p || '').toLowerCase();
      const origins = fileToPlatforms.get(key) ?? [];
      // console.log(`[B4X TRACE ${new Date().toISOString()}] externalCandidate[${i}] -> ${p} | inWorkspace=${inWorkspace} | platforms=${origins.join(',')}`);
    }

    progress?.report({ message: 'Loading external source files...', increment: 10 });
    await workspaceClasses.replaceExternalSourceFiles(externalCandidates);
    progress?.report({ message: 'Loading XML libraries...', increment: 10 });
    // Gather XML files from configured platforms, filtered by allowed libraries
    const platformXmlFiles = loadedPlatforms
      .flatMap((platform) => platform.assets.xmlFiles)
      .filter((filePath) => isAllowedLibraryFile(filePath, allowedLibraries));

    // Include persisted B4XPages .b4xlib if present (ensure file exists)
    const persistedB4xlib = context.workspaceState.get<string>('b4x.b4xlibPath');
    const filesToLoad = [...platformXmlFiles];
    if (persistedB4xlib && fs.existsSync(persistedB4xlib)) {
      filesToLoad.push(persistedB4xlib);
    }

    // If any .b4xlib files are present, extract contained .bas/.b4x modules
    // and load them as external source modules so they are classified as
    // `class` or `static` based on their header `Type=` value.
    const extractedExternalModules: string[] = [];
    for (const f of filesToLoad) {
      if (f.toLowerCase().endsWith('.b4xlib')) {
        try {
          const mods = await extractModulesFromB4xlib(f);
          if (mods && mods.length > 0) {
            extractedExternalModules.push(...mods);
          }
        } catch (e) {
          console.warn('B4X: failed to extract modules from b4xlib', f, e);
        }
      }
    }
    if (extractedExternalModules.length > 0) {
      await workspaceClasses.replaceExternalSourceFiles(extractedExternalModules);
    }

    // Write a small diagnostic listing which XML/.b4xlib files we are about to load
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const projectRootPath = folders[0]!.uri.fsPath;
        const outPath = path.join(projectRootPath, 'b4x-intellisense-loaded-files.json');
        const report = {
          generated: new Date().toISOString(),
          platformXmlFiles,
          persistedB4xlib: persistedB4xlib || null,
          filesToLoad,
          externalCandidatesCount: externalCandidates.length,
          allowedLibraries: Array.from(allowedLibraries ?? []),
        };
        await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
        void vscode.window.showInformationMessage(`B4X: loaded files diagnostics written to ${outPath}`);
      }
    } catch (err) {
      console.warn('B4X: failed to write loaded-files diagnostics', err);
    }

    await xmlLibraries.replaceXmlFiles(filesToLoad);

    progress?.report({ message: 'Finalizing reload...', increment: 5 });

    // Log summary of loaded assets and project config for debugging.
    try {
      const preferLive = vscode.workspace.getConfiguration('b4xIntellisense').get<boolean>('preferLiveSources', true);
      const apiCount = apiIndex.allClasses.length;
      const workspaceCount = workspaceClasses.findClassesByPrefix('').length;
      const xmlCount = xmlLibraries.findClassesByPrefix('').length;
      const allowedLibCount = projectConfig.allowedLibraries?.size ?? 0;
      const allowedModuleCount = projectConfig.allowedModuleBasePaths?.size ?? 0;
      const externalModuleFilesCount = (projectConfig.externalModuleFiles ?? []).length;
      // console.log(
      //   `B4X IntelliSense reload: preferLive=${preferLive} | platforms=${loadedPlatforms.length} | api=${apiCount} | workspace=${workspaceCount} | xml=${xmlCount} | allowedLibs=${allowedLibCount} | allowedModules=${allowedModuleCount} | externalModules=${externalModuleFilesCount}`,
      // );
        try {
          const brief = `B4X: reload complete — platforms=${loadedPlatforms.length}, api=${apiCount}, workspace=${workspaceCount}, xml=${xmlCount}`;
          const details = `Reload details:\nPlatforms: ${loadedPlatforms.map((p) => p.platform).join(', ') || '<none>'}\nAPI classes: ${apiCount}\nWorkspace classes: ${workspaceCount}\nXML classes: ${xmlCount}\nAllowed libraries: ${allowedLibCount}\nAllowed modules: ${allowedModuleCount}\nExternal modules: ${externalModuleFilesCount}`;
          // try {
          //   const ch = vscode.window.createOutputChannel('B4X Intellisense');
          //   ch.show(true);
          //   ch.appendLine(brief);
          //   ch.appendLine('');
          //   ch.appendLine(details);
          // } catch (uiErr) {
          //   // ignore UI errors
          // }
        } catch (msgErr) {
          // ignore UI errors
        }
    } catch (err) {
      console.warn('B4X IntelliSense: failed to log platform reload summary', err);
    }

    rebuildPlatformWatchers(loadedPlatforms);

    for (const platform of loadedPlatforms) {
      // console.log(
      //   `B4X IntelliSense loaded ${platform.platform.toUpperCase()} ini from ${platform.iniPath} `
      //   + `(source modules: ${platform.assets.sourceModuleFiles.length}, xml files: ${platform.assets.xmlFiles.length}, b4xlib files: ${platform.assets.b4xlibFiles.length})`,
      // );
    }
  };

  // Always defer the full platform reload until the user explicitly opens a project
  // via the `openB4aProject` command. This prevents INI/theme application or heavy
  // asset loading from occurring during activation or before the user selects a
  // project file.
  console.log('B4X: deferring full platform reload until explicit project open');

  // Read system-wide B4X INI (if present) from %APPDATA% and persist useful flags
  const readSystemB4xIni = async (): Promise<Record<string, string>> => {
    try {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const iniPath = path.join(appData, 'Anywhere Software', 'Basic4android', 'b4xV5.ini');
      if (!fs.existsSync(iniPath)) {
        return {};
      }
      const raw = await fs.promises.readFile(iniPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const out: Record<string, string> = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        out[key] = val;
      }
      return out;
    } catch (err) {
      console.warn('B4X: failed to read system b4xV5.ini', err);
      return {};
    }
  };

  try {
    const sysIni = await readSystemB4xIni();
    if (sysIni && Object.keys(sysIni).length > 0) {
      const get = (k: string) => {
        const found = Object.keys(sysIni).find((x) => x.toLowerCase() === k.toLowerCase());
        return found ? sysIni[found] : undefined;
      };
      const parseIntOrUndefined = (v?: string) => {
        if (!v) return undefined;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : undefined;
      };

      const settings = {
        autoBackup: (get('AutoBackup') || '').toLowerCase() === 'true',
        autoFormat: (get('AutoFormat') || '').toLowerCase() === 'true',
        autoSave: (get('AutoSave') || '').toLowerCase() === 'true',
        codeTheme: get('CodeTheme') || get('codeTheme') || '',
        ideTheme2: get('IdeTheme2') || get('ideTheme2') || '',
        fileMonitorInterval: parseIntOrUndefined(get('FileMonitorInterval')),
        fontName2: get('FontName2') || '',
        fontSize2: parseIntOrUndefined(get('FontSize2')),
      };
      await context.workspaceState.update('b4x.systemIni', settings);
      console.log('B4X: persisted system INI settings', settings);

      // Defer applying AutoSave/AutoFormat and font/theme hints until a project is opened.
      // Persisted `b4x.systemIni` will be read and applied during a project-scoped reload.
      try {
        console.log('B4X: persisted system INI settings (application deferred until project-open)', settings);
      } catch (err) {
        console.warn('B4X: failed to persist system INI settings', err);
      }

      // Theme import from B4A install deferred until a project-scoped reload
    }
  } catch (err) {
    console.warn('B4X: error persisting system INI', err);
  }

  // Auto-backup monitor: schedule periodic backups when AutoBackup=True in system INI
  try {
    const systemSettings = context.workspaceState.get<any>('b4x.systemIni');
    if (systemSettings && systemSettings.autoBackup && hasOpenedProject) {
      // Prefer extension config `autoBackupInterval` (ms), then system INI `FileMonitorInterval`, then default 10 minutes
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const cfgInterval = cfg.get<number>('autoBackupInterval');
      const intervalMs = typeof cfgInterval === 'number' && Number.isFinite(cfgInterval) && cfgInterval > 0
        ? cfgInterval
        : (typeof systemSettings.fileMonitorInterval === 'number' ? systemSettings.fileMonitorInterval : 10 * 60 * 1000);

      const monitorTimers = new Map<string, NodeJS.Timeout>();
      const runningBackups = new Set<string>();

      const scheduleBackupForFolder = (folder: vscode.WorkspaceFolder) => {
        const key = folder.uri.fsPath;
        if (monitorTimers.has(key)) return;
        const timeout = setInterval(() => {
          if (runningBackups.has(key)) return; // skip if a backup is already running
          const b4aPath = path.join(folder.uri.fsPath, 'B4A');
          if (!fs.existsSync(b4aPath)) return;
          runningBackups.add(key);
          const backupChannel = vscode.window.createOutputChannel(`B4X AutoBackup - ${folder.name}`);
          backupChannel.show(false);
          backupChannel.appendLine(`Auto-backup triggered for: ${b4aPath}`);
          const scriptPath = context.asAbsolutePath(path.join('src', 'backup.ps1'));
          const backupRoot = path.join(folder.uri.fsPath, '_backups');
          const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
          const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-SourcePath', b4aPath, '-BackupRoot', backupRoot];
          backupChannel.appendLine(`${runner} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
          const proc = cp.spawn(runner, args, { windowsHide: true });
          proc.stdout.on('data', (b) => backupChannel.append(b.toString()));
          proc.stderr.on('data', (b) => backupChannel.append(b.toString()));
          proc.on('error', (err) => {
            backupChannel.appendLine('Auto-backup failed to start: ' + String(err));
            runningBackups.delete(key);
          });
          proc.on('close', (code) => {
            backupChannel.appendLine('\nAuto-backup script exited with code ' + code);
            if (code === 0) {
              backupChannel.appendLine('Auto-backup completed successfully.');
            } else {
              backupChannel.appendLine('Auto-backup may have failed.');
            }
            runningBackups.delete(key);
          });
        }, intervalMs);

        monitorTimers.set(key, timeout);
        // ensure timers are cleared on extension deactivation
        context.subscriptions.push(new vscode.Disposable(() => { clearInterval(timeout); monitorTimers.delete(key); }));
      };

      const folders = vscode.workspace.workspaceFolders ?? [];
      for (const f of folders) {
        scheduleBackupForFolder(f);
      }

      // Watch for workspace folder changes to add/remove monitors
      context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((ev) => {
        for (const added of ev.added) {
          scheduleBackupForFolder(added);
        }
        for (const removed of ev.removed) {
          const key = removed.uri.fsPath;
          const t = monitorTimers.get(key);
          if (t) {
            clearInterval(t);
            monitorTimers.delete(key);
          }
        }
      }));
    }
  } catch (err) {
    console.warn('B4X: failed to start auto-backup monitors', err);
  }

  // The language server will be started after the user explicitly opens a project
  // in `initializeAfterProjectOpen()` to ensure heavy initialization does not run
  // during activation or before the user selects a .b4a file.
  console.log('B4X: LSP client start deferred until explicit project open');

  const selector: vscode.DocumentSelector = [
    { language: 'b4x', scheme: 'file' },
    { language: 'b4x', scheme: 'untitled' },
  ];
  const completionTriggers = ['.', '_', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];

  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.openB4aProject', async (uri?: vscode.Uri) => {
      trace('openB4aProject.enter');
      const selectedProjectFile = uri ?? await promptForB4aProjectFile();
      if (!selectedProjectFile) {
        trace('openB4aProject.exit.no-selection');
        return;
      }

      const projectRoot = getProjectRootFromProjectFile(selectedProjectFile.fsPath);
      // set current project directory so watchers and scoped scans use the project root
      currentProjectDirectory = projectRoot;
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const autoAdd = cfg.get<boolean>('autoAddProjectFolderOnOpen', true);
      const autoOpen = cfg.get<boolean>('autoOpenProjectFolderOnOpen', false);
      trace('openB4aProject.projectRoot', projectRoot, { autoAdd, autoOpen });

      // Load project folder into the IDE according to user settings.
      try {
        if (autoOpen) {
          trace('openB4aProject.openFolderCommand', projectRoot);
          // This will open the folder in the current window (close existing workspace)
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectRoot), false);
          // No need to call ensureWorkspaceFolder when we opened the folder.
          trace('openB4aProject.openFolderCommand.done', projectRoot);
        } else if (autoAdd) {
          trace('openB4aProject.ensureWorkspaceFolder', projectRoot);
          ensureWorkspaceFolder(vscode.Uri.file(projectRoot));
          // Wait briefly for the workspace folder to be registered by VS Code
          try {
            await waitForWorkspaceFolderLoad(projectRoot, 3000);
            trace('openB4aProject.workspaceFolderRegistered');
          } catch {
            trace('openB4aProject.workspaceFolderRegistration.waitTimeout');
          }
        }
      } catch (err) {
        console.warn('B4X: failed to load project folder into IDE', err);
      }

      const document = await vscode.workspace.openTextDocument(selectedProjectFile);
      await vscode.window.showTextDocument(document, { preview: false });
      // Remember the last opened .b4a so installProject can default to it
      await context.workspaceState.update('b4x.lastOpenedProjectFile', selectedProjectFile.fsPath);

      // ...existing code...

      // INI/theme application deferred until workspace is fully loaded.
      trace('openB4aProject.deferQuickApplyIni');

      // Clear all existing intellisense state except Core.xml/XUI.xml (which we keep in memory)
      try {
        void vscode.window.showInformationMessage('B4X: Clearing intellisense caches (preserving Core.xml)...');
        const corePath = context.workspaceState.get<string>('b4x.coreXmlPath');
        const xuiPath = context.workspaceState.get<string>('b4x.xuiXmlPath');
        // reset API index to empty
        apiIndex = ApiIndexStore.empty();
        // clear workspace classes and external classes
        try { workspaceClasses.clear(); } catch (err) { console.warn('B4X: failed to clear workspaceClasses', err); }
          // restore Core.xml, XUI.xml and B4XPages.b4xlib into xmlLibraries if available
        try {
          const toRestore: string[] = [];
          if (corePath && fs.existsSync(corePath)) toRestore.push(corePath);
          if (xuiPath && fs.existsSync(xuiPath)) toRestore.push(xuiPath);
          const b4xlibPath = context.workspaceState.get<string>('b4x.b4xlibPath');
          if (b4xlibPath && fs.existsSync(b4xlibPath)) toRestore.push(b4xlibPath);
          trace('openB4aProject.restoreXmlCandidates', { toRestore });
          console.log('B4X: openB4aProject -> persisted core/xui paths', { corePath, xuiPath });

          // If persisted core/xui paths are missing, attempt to discover them
          // from a persisted platform libraries folder or the configured B4A
          // install `Libraries` folder and persist discovered paths.
          if (toRestore.length === 0) {
            try {
              const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
              const b4aInstall = cfg.get<string>('b4aInstallPath', '') ?? '';
              const candidatesFolders: string[] = [];
              const persistedLibs = context.workspaceState.get<string>('b4x.platformLibrariesFolder');
              if (persistedLibs) candidatesFolders.push(persistedLibs);
              if (b4aInstall) candidatesFolders.push(path.join(b4aInstall, 'Libraries'));

              console.log('B4X: openB4aProject -> fallback search folders=', candidatesFolders);

              for (const folder of candidatesFolders) {
                try {
                  const stat = await fs.promises.stat(folder).catch(() => undefined);
                  if (!stat || !stat.isDirectory()) continue;
                  const entries = await fs.promises.readdir(folder).catch(() => []);
                  const lower = entries.map((e) => e.toLowerCase());
                  const coreIdx = lower.indexOf('core.xml');
                  const xuiIdx = lower.indexOf('xui.xml');
                  if (coreIdx >= 0) {
                    const candidate = path.join(folder, entries[coreIdx]!);
                    if (fs.existsSync(candidate)) {
                      toRestore.push(candidate);
                      await context.workspaceState.update('b4x.coreXmlPath', candidate);
                      await context.workspaceState.update('b4x.platformLibrariesFolder', folder);
                      console.log('B4X: discovered and persisted Core.xml ->', candidate);
                    }
                  }
                  if (xuiIdx >= 0) {
                    const candidate = path.join(folder, entries[xuiIdx]!);
                    if (fs.existsSync(candidate)) {
                      toRestore.push(candidate);
                      await context.workspaceState.update('b4x.xuiXmlPath', candidate);
                      await context.workspaceState.update('b4x.platformLibrariesFolder', folder);
                      console.log('B4X: discovered and persisted XUI.xml ->', candidate);
                    }
                  }
                  // If no direct matches, try a shallow recursive search for Core.xml/XUI.xml
                  if (toRestore.length === 0) {
                    try {
                      const targets = new Set(['core.xml', 'xui.xml']);
                      const queue = [folder];
                      const maxDepth = 3;
                      const visited: Set<string> = new Set();
                      let depth = 0;
                      while (queue.length > 0 && depth < maxDepth && toRestore.length === 0) {
                        const level = queue.splice(0, queue.length);
                        for (const dir of level) {
                          if (visited.has(dir)) continue;
                          visited.add(dir);
                          let children: string[] = [];
                          try {
                            const ents = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
                            for (const e of ents) {
                              try {
                                if (e.isDirectory()) {
                                  queue.push(path.join(dir, e.name));
                                } else if (e.isFile()) {
                                  const name = e.name.toLowerCase();
                                  if (targets.has(name)) {
                                    const candidate = path.join(dir, e.name);
                                    if (fs.existsSync(candidate)) {
                                      toRestore.push(candidate);
                                      // persist whichever we found
                                      if (name === 'core.xml') await context.workspaceState.update('b4x.coreXmlPath', candidate);
                                      if (name === 'xui.xml') await context.workspaceState.update('b4x.xuiXmlPath', candidate);
                                      await context.workspaceState.update('b4x.platformLibrariesFolder', folder);
                                      console.log('B4X: discovered via recursive search', name, '->', candidate);
                                      break;
                                    }
                                  }
                                }
                              } catch (inner2) {
                                // ignore entry errors
                              }
                            }
                          } catch (innerRead) {
                            // ignore
                          }
                        }
                        depth += 1;
                      }
                    } catch (recErr) {
                      console.warn('B4X: recursive search failed', recErr);
                    }
                  }
                  if (toRestore.length > 0) break;
                } catch (inner) {
                  console.warn('B4X: openB4aProject fallback search failed for folder', folder, inner);
                }
              }
            } catch (err) {
              console.warn('B4X: openB4aProject -> fallback discovery failed', err);
            }
          }

          if (toRestore.length > 0) {
            await xmlLibraries.replaceXmlFiles(toRestore);
            console.log('B4X: preserved XML libraries after clearing intellisense', toRestore);
            try {
              const names = toRestore.map((p) => path.basename(p));
              const short = `B4X: Loaded XML libraries into intellisense (${names.length})`;
              const details = `Loaded XML libraries:\n${names.map((n) => `- ${n}`).join('\n')}`;
              try {
                const ch = vscode.window.createOutputChannel('B4X Intellisense');
                ch.show(true);
                ch.appendLine(short);
                ch.appendLine('');
                ch.appendLine(details);
              } catch (uiErr) {
                // ignore
              }
            } catch (msgErr) {
              // ignore messaging errors
            }
            try {
              const xmlCountNow = xmlLibraries.findClassesByPrefix('').length;
              const sampleXml = xmlLibraries.findClassesByPrefix('').slice(0, 10).map((c) => c.name);
              console.log(`B4X: xmlLibraries contains ${xmlCountNow} classes after restore; samples=`, sampleXml);
            } catch (err) {
              console.warn('B4X: failed to log xmlLibraries after XML restore', err);
            }
          } else {
            await xmlLibraries.replaceXmlFiles([]);
            console.log('B4X: cleared xmlLibraries (no Core.xml/XUI.xml available)');
          }
        } catch (err) {
          console.warn('B4X: failed to reset xmlLibraries', err);
        }
      } catch (err) {
        console.warn('B4X: error clearing intellisense state', err);
      }

      // Intellisense report generation removed from automatic project-open flow.

      // Initialize heavy extension features now that a project is opened
      try {
        await (async function initializeAfterProjectOpen(): Promise<void> {
          trace('initializeAfterProjectOpen.enter');
          if (initializedForProject) {
            trace('initializeAfterProjectOpen.exit.alreadyInitialized');
            return;
          }
          initializedForProject = true;
          trace('initializeAfterProjectOpen.after.setInitialized');
          // create watchers if missing (scope workspace watcher to project root top-level files when known)
          if (!workspaceWatcher) {
            const wsPattern = currentProjectDirectory
              ? new vscode.RelativePattern(currentProjectDirectory, '*.{bas,b4x}')
              : '**/*.{bas,b4x}';
            workspaceWatcher = vscode.workspace.createFileSystemWatcher(wsPattern as any);
          }
          if (!projectFileWatcher) {
            const projPattern = currentProjectDirectory
              ? new vscode.RelativePattern(currentProjectDirectory, '*.b4a')
              : '**/*.b4a';
            projectFileWatcher = vscode.workspace.createFileSystemWatcher(projPattern as any);
          }

          // register watcher handlers (only once)
          if (workspaceWatcher) {
            context.subscriptions.push(
              workspaceWatcher,
              workspaceWatcher.onDidCreate(async () => { trace('workspaceWatcher.onDidCreate'); await workspaceClasses.refresh(currentAllowedModuleBasePaths, currentProjectDirectory); }),
              workspaceWatcher.onDidDelete((uri) => { trace('workspaceWatcher.onDidDelete'); workspaceClasses.delete(uri); }),
              workspaceWatcher.onDidChange(async (uri) => {
                trace('workspaceWatcher.onDidChange');
                const document = await vscode.workspace.openTextDocument(uri);
                workspaceClasses.upsertDocument(document);
              }),
            );
          }

          if (projectFileWatcher) {
            context.subscriptions.push(
              projectFileWatcher,
              projectFileWatcher.onDidCreate(() => { trace('projectFileWatcher.onDidCreate'); schedulePlatformReload(); }),
              projectFileWatcher.onDidDelete(() => { trace('projectFileWatcher.onDidDelete'); schedulePlatformReload(); }),
              projectFileWatcher.onDidChange(() => { trace('projectFileWatcher.onDidChange'); schedulePlatformReload(); }),
            );
          }

          trace('initializeAfterProjectOpen.setupComplete');
          // Optionally auto-load project assets and start LSP immediately after project-open.
        })();
      } catch (err) {
        console.warn('B4X: initialization after project open failed', err);
      }

      // After initialization, optionally wait for the workspace folder to be loaded
      // and then perform full platform reload + LSP start (config: autoLoadProjectAssets)
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        const autoLoad = cfg.get<boolean>('autoLoadProjectAssets', true);
        if (autoLoad) {
          trace('openB4aProject.autoLoad.enabled -> waiting for workspace to load');
          await waitForWorkspaceFolderLoad(projectRoot);
          trace('openB4aProject.workspaceLoaded -> applying INI hints and starting reloadPlatformAssets');
          try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'B4X: Loading project assets...', cancellable: false }, async (progress) => {
              try {
                const platformSettings = getPlatformSettings();
                const loadedPlatforms = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
                // Apply persisted system INI settings (auto-save, fonts) now that workspace is loaded
                await applyPersistedSystemIniSettings();
                // Apply platform INI theme/font hints (if any)
                await applyPlatformIniHints(loadedPlatforms);
              } catch (iniErr) {
                console.warn('B4X: failed to apply INI/theme hints before reload', iniErr);
              }

              await reloadPlatformAssets(undefined, progress);
            });

            void vscode.window.showInformationMessage('B4X: Project assets loaded completely.');
            trace('openB4aProject.reloadPlatformAssets.done');
            try {
              const lspDisposable = await startLanguageClient(context);
              if (lspDisposable) { context.subscriptions.push(lspDisposable); lspClientDisposable = lspDisposable; }
              trace('openB4aProject.lspStarted');
              void vscode.window.showInformationMessage('B4X: Language Server Client loaded...');
            } catch (lspErr) {
              console.warn('B4X: failed to start language client during autoLoad after workspace load', lspErr);
            }
          } catch (err) {
            console.warn('B4X: auto-load after workspace load failed', err);
          }
        } else {
          trace('openB4aProject.autoLoad.disabled');
        }
      } catch (err) {
        console.warn('B4X: auto-load after workspace load failed', err);
      }
    }),
    // Library DB: refresh/inspect/clear commands
    vscode.commands.registerCommand('b4xIntellisense.refreshLibraryIndex', async () => {
      try {
        if (currentProjectDirectory) libraryIndex.touchProject(currentProjectDirectory);
        await workspaceClasses.refresh(currentAllowedModuleBasePaths, currentProjectDirectory);
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
    // Helper test command: simulate opening a .b4a by entering a path (bypasses file-picker)
    vscode.commands.registerCommand('b4xIntellisense.simulateOpen', async () => {
      try {
        const input = await vscode.window.showInputBox({ prompt: 'Enter path to .b4a to simulate open (full path)' });
        if (!input) return;
        const filePath = path.resolve(input);
        if (!fs.existsSync(filePath)) {
          void vscode.window.showErrorMessage(`File not found: ${filePath}`);
          return;
        }
        const uri = vscode.Uri.file(filePath);
        // Invoke the real command handler with the URI to bypass the open dialog.
        await vscode.commands.executeCommand('b4xIntellisense.openB4aProject', uri);
      } catch (err) {
        console.error('B4X: simulateOpen failed', err);
      }
    }),
    // Manual command to perform full platform reload and start LSP when the user is ready
    vscode.commands.registerCommand('b4xIntellisense.loadProjectAssets', async () => {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'B4X: Loading project assets and starting language server...', cancellable: false }, async (progress) => {
          // Only load allowed XML/.b4xlib modules, matching allowedLibraries logic
          let allowedModuleNames: string[] = [];
          try {
            // Attempt to get allowed module names from .b4a project file
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
              const projectDir = folders[0]!.uri.fsPath;
              const b4aFiles = await fs.promises.readdir(projectDir);
              const projectFile = b4aFiles.find((f) => f.toLowerCase().endsWith('.b4a'));
              if (projectFile) {
                const projectPath = path.join(projectDir, projectFile);
                const projectContents = await fs.promises.readFile(projectPath, 'utf8');
                // Parse allowed libraries from .b4a file
                const libMatch = projectContents.match(/<Libraries>([\s\S]*?)<\/Libraries>/i);
                if (libMatch && libMatch[1]) {
                  allowedModuleNames = libMatch[1]
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && !line.startsWith('<'));
                }
              }
            }
          } catch (libErr) {
            console.warn('B4X: Failed to parse allowed libraries from .b4a', libErr);
          }

          // Filter XML/.b4xlib loading to only allowed modules (project config used internally)
          await reloadPlatformAssets({ applyIniOnly: false }, progress);
        });

        void vscode.window.showInformationMessage('B4X: Project assets loaded completely.');
        const lspDisposable = await startLanguageClient(context);
        if (lspDisposable) { context.subscriptions.push(lspDisposable); lspClientDisposable = lspDisposable; }
        void vscode.window.showInformationMessage('B4X: Project assets loaded and language server started');
      } catch (err) {
        console.error('B4X: loadProjectAssets failed', err);
        void vscode.window.showErrorMessage('B4X: Failed to load project assets. See console for details.');
      }
    }),
    // Debug command: show persisted workspace state keys and some values
    vscode.commands.registerCommand('b4xIntellisense.debugState', async () => {
      try {
        const keys = await context.workspaceState.keys();
        const sysIni = context.workspaceState.get('b4x.systemIni');
        const last = context.workspaceState.get('b4x.lastOpenedProjectFile');
        const core = context.workspaceState.get('b4x.coreXmlPath');
        console.log('B4X: debugState -> workspaceState keys=', keys);
        console.log('B4X: debugState -> b4x.systemIni=', sysIni);
        console.log('B4X: debugState -> b4x.lastOpenedProjectFile=', last);
        console.log('B4X: debugState -> b4x.coreXmlPath=', core);
        void vscode.window.showInformationMessage(`B4X: workspaceState keys: ${keys.join(', ')}`);
      } catch (err) {
        console.error('B4X: debugState failed', err);
      }
    }),
    // Debug command: show counts of in-memory stores (API, workspace, XML)
    vscode.commands.registerCommand('b4xIntellisense.printStores', async () => {
      try {
        const apiCount = apiIndex.allClasses.length;
        const workspaceCount = workspaceClasses.findClassesByPrefix('').length;
        const xmlCount = xmlLibraries.findClassesByPrefix('').length;
        console.log(`B4X: store counts -> api=${apiCount}, workspace=${workspaceCount}, xml=${xmlCount}`);
        void vscode.window.showInformationMessage(`B4X: stores api=${apiCount}, workspace=${workspaceCount}, xml=${xmlCount}`);
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

        const apiCount = apiIndex.allClasses.length;
        const workspaceCount = workspaceClasses.findClassesByPrefix('').length;
        const xmlCount = xmlLibraries.findClassesByPrefix('').length;

        const allowedModules = Array.from(currentAllowedModuleBasePaths ?? []);
        const workspaceFiles = (await vscode.workspace.findFiles('**/*.{bas,b4x}', '**/node_modules/**')).map((u) => u.fsPath);
        const workspaceFilesNormalized = workspaceFiles.map((p) => path.join(path.parse(p).dir, path.parse(p).name).toLowerCase());

        const stateKeys = await context.workspaceState.keys();
        const state: Record<string, unknown> = {};
        for (const k of stateKeys) state[k] = context.workspaceState.get(k);

        const report = {
          generated: new Date().toISOString(),
          apiCount,
          workspaceCount,
          xmlCount,
          allowedModuleBasePaths: allowedModules,
          workspaceFilesCount: workspaceFiles.length,
          workspaceFilesSample: workspaceFiles.slice(0, 200),
          workspaceFilesNormalizedSample: workspaceFilesNormalized.slice(0, 200),
          workspaceState: state,
        };

        await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
        void vscode.window.showInformationMessage(`B4X: diagnostics written to ${outPath}`);
      } catch (err) {
        console.error('B4X: dumpDiagnostics failed', err);
        void vscode.window.showErrorMessage('B4X: Failed to write diagnostics. See console for details.');
      }
    }),
    // Run installer script for the active workspace using configured B4A install path
    vscode.commands.registerCommand('b4xIntellisense.installProject', async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          void vscode.window.showErrorMessage('No workspace folder is open. Open a B4A workspace and try again.');
          return;
        }

        let chosenFolder = folders[0];
        if (folders.length > 1) {
          const pick = await vscode.window.showQuickPick(folders.map((f) => f.name), { placeHolder: 'Select workspace to install' });
          if (!pick) { return; }
          chosenFolder = folders.find((f) => f.name === pick) ?? folders[0];
        }

        const b4aPath = path.join(chosenFolder!.uri.fsPath, 'B4A');
        if (!fs.existsSync(b4aPath)) {
          void vscode.window.showErrorMessage(`B4A folder not found in workspace: ${b4aPath}`);
          return;
        }

        // find .b4a project file; default to last opened project if it belongs to this workspace
        const candidates = fs.readdirSync(b4aPath).filter((n) => n.toLowerCase().endsWith('.b4a'));
        if (candidates.length === 0) {
          void vscode.window.showErrorMessage('No .b4a project file found in B4A folder.');
          return;
        }
        let projectFileName: string | undefined;
        const lastOpened = context.workspaceState.get<string>('b4x.lastOpenedProjectFile', '');
        if (lastOpened) {
          const normalizedLast = path.resolve(lastOpened).toLowerCase();
          const normalizedB4a = path.resolve(b4aPath).toLowerCase();
          if (normalizedLast === path.join(normalizedB4a, path.basename(normalizedLast)).toLowerCase() || normalizedLast.startsWith(normalizedB4a + path.sep)) {
            const candidateName = path.basename(lastOpened);
            if (candidates.includes(candidateName)) {
              projectFileName = candidateName;
            }
          }
        }

        if (!projectFileName) {
          projectFileName = candidates[0];
          if (candidates.length > 1) {
            const pick = await vscode.window.showQuickPick(candidates, { placeHolder: 'Select .b4a project file to build' });
            if (!pick) { return; }
            projectFileName = pick;
          }
        }

        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        let b4aInstall = cfg.get<string>('b4aInstallPath', '');
        if (!b4aInstall || !fs.existsSync(b4aInstall)) {
          const setNow = 'Set install folder';
          const choice = await vscode.window.showInformationMessage('B4A install path is not configured or missing. Set it now?', setNow, 'Cancel');
          if (choice !== setNow) { return; }
          const foldersPick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select B4A install folder' });
          if (!foldersPick || foldersPick.length === 0) { return; }
          b4aInstall = foldersPick[0]!.fsPath;
          await cfg.update('b4aInstallPath', b4aInstall, vscode.ConfigurationTarget.Workspace);
        }

        const builderExe = path.join(b4aInstall, 'B4ABuilder.exe');
        const scriptPath = context.asAbsolutePath(path.join('src', 'install.ps1'));

        const projectFilePath = path.join(b4aPath, projectFileName!);

        const term = vscode.window.createTerminal({ name: 'B4X Install' });
        term.show(true);

        const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
        // Build command line with quoted paths
        // Attempt to resolve adb path from configured platform INI -> PlatformFolder, or from config, or prompt user.
        let adbPath = '';
        try {
          const platformSettings = getPlatformSettings();
          const loaded = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
          const preferred = loaded.find((p) => p.platform === 'b4a') ?? loaded[0];
          if (preferred && preferred.iniPath) {
            try {
              const iniRaw = fs.readFileSync(preferred.iniPath, 'utf8');
              const m = iniRaw.match(/^[ \t]*PlatformFolder[ \t]*=[ \t]*(.+)$/im);
              if (m && m[1]) {
                const platformFolder = m[1].trim();
                // SDK root is two levels up from the platform folder (..\..)
                const sdkRoot = path.normalize(path.join(platformFolder, '..', '..'));
                const candidate = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
                if (fs.existsSync(candidate)) {
                  adbPath = candidate;
                }
              }
            } catch (err) {
              // ignore and fallback
            }
          }

          if (!adbPath) {
            const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
            adbPath = cfg.get<string>('adbPath', '') ?? '';
          }

          if (!adbPath || !fs.existsSync(adbPath)) {
            const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Select adb.exe', filters: { 'Executables': ['exe', ''] } });
            if (pick && pick.length > 0) {
              adbPath = pick[0]!.fsPath;
              await vscode.workspace.getConfiguration('b4xIntellisense').update('adbPath', adbPath, vscode.ConfigurationTarget.Workspace);
            }
          }
        } catch (err) {
          console.warn('Failed to auto-detect adb path', err);
        }

        const cmd = `${runner} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -BuilderPath "${builderExe}"${adbPath ? ` -AdbPath "${adbPath}"` : ''} -ProjectFile "${projectFilePath}"`;
        term.sendText(cmd, true);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to start install process.');
        console.error('installProject failed', err);
      }
    }),
    // Prompt user to set B4A install folder (used by installer scripts)
    vscode.commands.registerCommand('b4xIntellisense.setB4aInstallPath', async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        const current = cfg.get<string>('b4aInstallPath', '');
        const defaultUri = current ? vscode.Uri.file(current) : undefined;
        const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri, openLabel: 'Select B4A Install Folder' });
        if (!folders || folders.length === 0) { return; }
        const chosenFolder = folders[0];
        if (!chosenFolder) { return; }
        const chosen = chosenFolder.fsPath;
        await cfg.update('b4aInstallPath', chosen, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`B4A install path set to ${chosen}`);
      } catch (err) {
        void vscode.window.showErrorMessage('Failed to set B4A install path.');
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
    // Import a .vssettings from the configured B4A install Themes folder
    // (the standalone `importVsSettings` command was removed in favor of importing from the
    // B4A install which better matches workspace/theme hints)
    // Import a .vssettings from the configured B4A install Themes folder
    vscode.commands.registerCommand('b4xIntellisense.importThemeFromInstall', async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
        let b4aInstall = cfg.get<string>('b4aInstallPath', '') ?? '';
        if (!b4aInstall || !fs.existsSync(b4aInstall)) {
          const setNow = 'Set install folder';
          const choice = await vscode.window.showInformationMessage('B4A install path is not configured. Set it now?', setNow, 'Cancel');
          if (choice !== setNow) return;
          const foldersPick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select B4A install folder' });
          if (!foldersPick || foldersPick.length === 0) return;
          b4aInstall = foldersPick[0]!.fsPath;
          await cfg.update('b4aInstallPath', b4aInstall, vscode.ConfigurationTarget.Workspace);
        }

        const themesDir = path.join(b4aInstall, 'Themes');
        const stat = await fs.promises.stat(themesDir).catch(() => undefined);
        if (!stat || !stat.isDirectory()) {
          void vscode.window.showInformationMessage('No Themes folder found in B4A install.');
          return;
        }

        const entries = await fs.promises.readdir(themesDir, { withFileTypes: true });
        const candidates = entries.filter((e) => e.isFile() && (e.name.toLowerCase().endsWith('.vssettings') || e.name.toLowerCase().endsWith('.xml'))).map((e) => e.name);
        if (candidates.length === 0) {
          void vscode.window.showInformationMessage('No .vssettings files found in B4A Themes folder.');
          return;
        }

        const pick = await vscode.window.showQuickPick(candidates, { placeHolder: 'Select a theme to import from B4A install' });
        if (!pick) return;
        const pickedPath = path.join(themesDir, pick);

        const applyNow = 'Import and Apply';
        const importOnly = 'Import Only';
        const choice = await vscode.window.showInformationMessage(`Import theme '${pick}' from B4A install?`, applyNow, importOnly, 'Cancel');
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
    vscode.commands.registerCommand('b4xIntellisense.openB4X', async () => {
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
    // Backup active workspace B4A folder (runs bundled PowerShell script with confirmation)
    vscode.commands.registerCommand('b4xIntellisense.backupWorkspace', async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          void vscode.window.showErrorMessage('No workspace folder is open. Open a B4A workspace and try again.');
          return;
        }

        let chosenFolder = folders[0];
        if (folders.length > 1) {
          const pick = await vscode.window.showQuickPick(folders.map((f) => f.name), { placeHolder: 'Select workspace for backup' });
          if (!pick) { return; }
          chosenFolder = folders.find((f) => f.name === pick) ?? folders[0];
        }

        const b4aPath = path.join(chosenFolder!.uri.fsPath, 'B4A');
        if (!fs.existsSync(b4aPath)) {
          void vscode.window.showErrorMessage(`B4A folder not found in workspace: ${b4aPath}`);
          return;
        }

        const confirm = await vscode.window.showInformationMessage(
          `Create a backup of the B4A folder for '${chosenFolder!.name}'?`,
          { modal: true },
          'Backup',
        );
        if (confirm !== 'Backup') { return; }

        const backupChannel = vscode.window.createOutputChannel('B4X Backup');
        backupChannel.show(true);
        backupChannel.appendLine(`Backing up: ${b4aPath}`);

        const scriptPath = context.asAbsolutePath(path.join('src', 'backup.ps1'));
        const backupRoot = path.join(chosenFolder!.uri.fsPath, '_backups');

        const runner = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-SourcePath', b4aPath, '-BackupRoot', backupRoot];

        backupChannel.appendLine(`${runner} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'B4X: Creating backup...', cancellable: false }, async (progress) => {
          progress.report({ message: 'Starting backup...' });
          await new Promise((resolve, reject) => {
            const proc = cp.spawn(runner, args, { windowsHide: true });
            proc.stdout.on('data', (b) => backupChannel.append(b.toString()));
            proc.stderr.on('data', (b) => backupChannel.append(b.toString()));
            proc.on('error', (err) => {
              backupChannel.appendLine('Failed to start backup script: ' + String(err));
              void vscode.window.showErrorMessage('Failed to start backup script. See B4X Backup output.');
              reject(err);
            });
            proc.on('close', (code) => {
              backupChannel.appendLine('\nBackup script exited with code ' + code);
              if (code === 0) {
                void vscode.window.showInformationMessage('Backup complete. See B4X Backup output for details.');
              } else {
                void vscode.window.showErrorMessage('Backup failed. See B4X Backup output for details.');
              }
              resolve(code);
            });
          });
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

          const folders = vscode.workspace.workspaceFolders;
          if (!folders || folders.length === 0) {
            void vscode.window.showErrorMessage('No workspace folder is open. Open a B4A workspace and try again.');
            return;
          }

          let chosenFolder = folders[0];
          if (folders.length > 1) {
            const pick = await vscode.window.showQuickPick(folders.map((f) => f.name), { placeHolder: 'Select workspace for GIF capture' });
            if (!pick) { return; }
            chosenFolder = folders.find((f) => f.name === pick) ?? folders[0];
          }

          // detect adb and ffmpeg similar to installProject
          let adbPath = '';
          let ffmpegPath = '';
          try {
            const platformSettings = getPlatformSettings();
            const loaded = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
            const preferred = loaded.find((p) => p.platform === 'b4a') ?? loaded[0];
            if (preferred && preferred.iniPath) {
              try {
                const iniRaw = fs.readFileSync(preferred.iniPath, 'utf8');
                const m = iniRaw.match(/^[ \t]*PlatformFolder[ \t]*=[ \t]*(.+)$/im);
                if (m && m[1]) {
                  const platformFolder = m[1].trim();
                  const sdkRoot = path.normalize(path.join(platformFolder, '..', '..'));
                  const candidate = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
                  if (fs.existsSync(candidate)) {
                    adbPath = candidate;
                  }
                }
              } catch (err) { /* ignore */ }
            }

            if (!adbPath) {
              const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
              adbPath = cfg.get<string>('adbPath', '') ?? '';
            }

            if (!adbPath || !fs.existsSync(adbPath)) {
              const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Select adb executable' });
              if (pick && pick.length > 0) {
                adbPath = pick[0]!.fsPath;
                await vscode.workspace.getConfiguration('b4xIntellisense').update('adbPath', adbPath, vscode.ConfigurationTarget.Workspace);
              }
            }

            // ffmpeg detection: check config then common locations
            const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
            ffmpegPath = cfg.get<string>('ffmpegPath', '') ?? '';
            const ffCandidates = [
              path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
              'C:\\ffmpeg\\bin\\ffmpeg.exe',
              'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
              'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
            ];
            if (!ffmpegPath) {
              for (const c of ffCandidates) {
                if (c && fs.existsSync(c)) { ffmpegPath = c; break; }
              }
            }
            if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
              const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Select ffmpeg executable' });
              if (pick && pick.length > 0) {
                ffmpegPath = pick[0]!.fsPath;
                await cfg.update('ffmpegPath', ffmpegPath, vscode.ConfigurationTarget.Workspace);
              }
            }
          } catch (err) {
            console.warn('Failed to auto-detect adb/ffmpeg', err);
          }

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

          const folders = vscode.workspace.workspaceFolders;
          if (!folders || folders.length === 0) {
            void vscode.window.showErrorMessage('No workspace folder is open. Open a B4A workspace and try again.');
            return;
          }

          let chosenFolder = folders[0];
          if (folders.length > 1) {
            const pick = await vscode.window.showQuickPick(folders.map((f) => f.name), { placeHolder: 'Select workspace for screenshots' });
            if (!pick) { return; }
            chosenFolder = folders.find((f) => f.name === pick) ?? folders[0];
          }

          // detect adb path
          let adbPath = '';
          try {
            const platformSettings = getPlatformSettings();
            const loaded = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
            const preferred = loaded.find((p) => p.platform === 'b4a') ?? loaded[0];
            if (preferred && preferred.iniPath) {
              try {
                const iniRaw = fs.readFileSync(preferred.iniPath, 'utf8');
                const m = iniRaw.match(/^[ \t]*PlatformFolder[ \t]*=[ \t]*(.+)$/im);
                if (m && m[1]) {
                  const platformFolder = m[1].trim();
                  const sdkRoot = path.normalize(path.join(platformFolder, '..', '..'));
                  const candidate = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
                  if (fs.existsSync(candidate)) {
                    adbPath = candidate;
                  }
                }
              } catch (err) { /* ignore */ }
            }

            if (!adbPath) {
              const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
              adbPath = cfg.get<string>('adbPath', '') ?? '';
            }

            if (!adbPath || !fs.existsSync(adbPath)) {
              const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Select adb executable' });
              if (pick && pick.length > 0) {
                adbPath = pick[0]!.fsPath;
                await vscode.workspace.getConfiguration('b4xIntellisense').update('adbPath', adbPath, vscode.ConfigurationTarget.Workspace);
              }
            }
          } catch (err) {
            console.warn('Failed to auto-detect adb', err);
          }

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
      new B4xCompletionProvider(apiIndex, workspaceClasses, xmlLibraries),
      ...completionTriggers,
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new B4xDefinitionProvider(apiIndex, workspaceClasses, xmlLibraries),
    ),
    vscode.languages.registerHoverProvider(
      selector,
      new B4xHoverProvider(apiIndex, workspaceClasses, xmlLibraries, context),
    ),
    new vscode.Disposable(() => {
      if (pendingPlatformReload) {
        clearTimeout(pendingPlatformReload);
      }

      disposePlatformWatchers();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('b4xIntellisense.b4aIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4iIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4jIniPath')
        || event.affectsConfiguration('b4xIntellisense.b4rIniPath')
      ) {
        schedulePlatformReload();
      }
    }),
    
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === 'b4x') {
        workspaceClasses.upsertDocument(document);
        return;
      }

      if (document.uri.fsPath.toLowerCase().endsWith('.b4a')) {
        schedulePlatformReload();
      }
      // If a generated Main module was edited, sync changes back to the .b4a
      void syncGeneratedMainBack(document);
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
      new B4xSignatureHelpProvider(apiIndex, workspaceClasses, xmlLibraries),
      '(',
      ',',
    ),
    // Type diagnostics: warn when `Type` is declared outside Class_Globals / Process_Globals
    registerTypeDiagnostics(context),
    // Code actions: quick-fix to move Type blocks into Class_Globals/Process_Globals
    vscode.languages.registerCodeActionsProvider(selector, new TypeCodeActionProvider(), { providedCodeActionKinds: TypeCodeActionProvider.providedCodeActionKinds }),
    vscode.languages.registerCodeActionsProvider(selector, new ExtractMethodCodeActionProvider(), { providedCodeActionKinds: ExtractMethodCodeActionProvider.providedCodeActionKinds }),
    // Semantic tokens: mark globals (from `Sub Class_Globals` and `Sub Process_Globals`) as `variable` with modifiers
    // so themes can color them differently when used inside methods. Modifiers emitted: static, private, public, process
    ((): vscode.Disposable => {
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
              for (const [name, info] of globals) {
                const regex = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
                let match: RegExpExecArray | null;
                while ((match = regex.exec(text)) !== null) {
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
  // Register file watchers and their handlers only if they were created (project-open)
  if (workspaceWatcher) {
            context.subscriptions.push(
              workspaceWatcher,
              workspaceWatcher.onDidCreate(async () => { await workspaceClasses.refresh(currentAllowedModuleBasePaths, currentProjectDirectory); }),
              workspaceWatcher.onDidDelete((uri) => { workspaceClasses.delete(uri); }),
              workspaceWatcher.onDidChange(async (uri) => {
                const document = await vscode.workspace.openTextDocument(uri);
                workspaceClasses.upsertDocument(document);
              }),
            );
  }

  if (projectFileWatcher) {
    context.subscriptions.push(
      projectFileWatcher,
      projectFileWatcher.onDidCreate(() => schedulePlatformReload()),
      projectFileWatcher.onDidDelete(() => schedulePlatformReload()),
      projectFileWatcher.onDidChange(() => schedulePlatformReload()),
    );
  }
}

function dedupePaths(filePaths: readonly string[]): string[] {
  return [...new Set(filePaths.map((filePath) => filePath.toLowerCase()))];
}

async function promptForB4aProjectFile(): Promise<vscode.Uri | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Open B4A Project',
    filters: {
      'B4A Project Files': ['b4a'],
    },
  });

  return selection?.[0];
}

function ensureWorkspaceFolder(projectRoot: vscode.Uri): void {
  const existingFolders = vscode.workspace.workspaceFolders ?? [];
  const normalizedProjectRoot = path.resolve(projectRoot.fsPath).toLowerCase();
  const alreadyOpen = existingFolders.some((folder) => path.resolve(folder.uri.fsPath).toLowerCase() === normalizedProjectRoot);
  if (alreadyOpen) {
    return;
  }

  vscode.workspace.updateWorkspaceFolders(existingFolders.length, 0, {
    uri: projectRoot,
    name: path.basename(projectRoot.fsPath),
  });
}

async function waitForWorkspaceFolderLoad(projectRootFsPath: string, timeoutMs = 5000): Promise<void> {
  const normalized = path.resolve(projectRootFsPath).toLowerCase();
  const existing = vscode.workspace.workspaceFolders ?? [];
  if (existing.some((f) => path.resolve(f.uri.fsPath).toLowerCase() === normalized)) {
    return;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      resolve();
    }, timeoutMs);

    const disposable = vscode.workspace.onDidChangeWorkspaceFolders((ev) => {
      const now = vscode.workspace.workspaceFolders ?? [];
      if (now.some((f) => path.resolve(f.uri.fsPath).toLowerCase() === normalized)) {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      }
    });
  });
}

function isAllowedLibraryFile(filePath: string, allowedLibraries?: ReadonlySet<string>): boolean {
  // If the project did not declare any libraries, do NOT load any library
  // files. Only allow a library when `allowedLibraries` is present and
  // contains the library's base name.
  if (!allowedLibraries || allowedLibraries.size === 0) {
    return false;
  }

  return allowedLibraries.has(path.basename(filePath, path.extname(filePath)).toLowerCase());
}

function isAllowedModuleFile(filePath: string, allowedModuleBasePaths?: ReadonlySet<string>): boolean {
  if (!allowedModuleBasePaths || allowedModuleBasePaths.size === 0) {
    return true;
  }

  const parsed = path.parse(filePath);
  const normalized = path.join(parsed.dir, parsed.name).toLowerCase();
  return allowedModuleBasePaths.has(normalized);
}

export function deactivate(): void {
  try {
    if (pendingSuggestRequest) {
      clearTimeout(pendingSuggestRequest);
      pendingSuggestRequest = undefined;
    }

    if (pendingPlatformReload) {
      clearTimeout(pendingPlatformReload);
      pendingPlatformReload = undefined;
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

export function getExtensionFontCss(): string {
  const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
  const fontFamily = cfg.get<string>('fontFamily', 'Fira Code Retina');
  const fontSize = cfg.get<number>('fontSize', 12);
  const wordWrap = cfg.get<boolean>('wordWrap', true);
  const tabSize = cfg.get<number>('tabSize', 4);
  const whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
  // Basic CSS snippet consumers (webviews) can include to honor user's extension settings.
  return `body, code, pre { font-family: ${fontFamily}; font-size: ${fontSize}px; white-space: ${whiteSpace}; } .b4x-extension-editor { tab-size: ${tabSize}; -moz-tab-size: ${tabSize}; }`;
}

class B4xCompletionProvider implements vscode.CompletionItemProvider {
  public constructor(
    private readonly apiIndex: ApiIndexStore,
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
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
      const ownerClass = inferCompletionOwnerClass(document, position, this.apiIndex, this.workspaceClasses, this.xmlLibraries);
      if (ownerClass) {
        return createMemberCompletionItems(ownerClass, memberAccess.expression, memberAccess.memberPrefix, memberRange);
      }

      const inferredTypes = inferVariableTypes(document, this.apiIndex, this.workspaceClasses, this.xmlLibraries);
      const ownerType = resolveExpressionType(
        memberAccess.expression,
        document,
        this.apiIndex,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
      );
      const localType = getLocalTypeDefinition(document, ownerType);
      if (localType) {
        return createLocalTypeMemberCompletionItems(localType, memberAccess.expression, memberAccess.memberPrefix, memberRange);
      }

      return [];
    }

    const prefix = getCompletionPrefix(document, position);
    return createGeneralCompletionItems(this.apiIndex, this.workspaceClasses, this.xmlLibraries, collectLocalSymbols(document), prefix);
  }
}

class B4xHoverProvider implements vscode.HoverProvider {
  public constructor(
    private readonly apiIndex: ApiIndexStore,
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
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

    // Quick health check: if all intellisense stores are empty, attempt an
    // on-demand xml restore (Core/XUI) and return early if still empty. This
    // avoids wasted hover work when intellisense hasn't been initialized.
    try {
      const apiCountNow = this.apiIndex.allClasses.length;
      const workspaceCountNow = this.workspaceClasses.findClassesByPrefix('').length;
      const xmlDiag = this.xmlLibraries.getDiagnostics();
      const xmlCountNow = xmlDiag.count;
      if (apiCountNow === 0 && workspaceCountNow === 0 && xmlCountNow === 0) {
        console.log('B4X: hover -> intellisense empty (api=0, workspace=0, xml=0) — attempting on-demand xml restore');
        try {
          const corePathPersisted = this.context.workspaceState.get<string>('b4x.coreXmlPath');
          const xuiPathPersisted = this.context.workspaceState.get<string>('b4x.xuiXmlPath');
          const candidates: string[] = [];
          if (corePathPersisted && fs.existsSync(corePathPersisted)) candidates.push(corePathPersisted);
          if (xuiPathPersisted && fs.existsSync(xuiPathPersisted)) candidates.push(xuiPathPersisted);
          if (candidates.length > 0) {
            console.log('B4X: hover -> on-demand restoring xmlLibraries from persisted paths', candidates);
            await this.xmlLibraries.replaceXmlFiles(candidates);
          }
        } catch (inner) {
          console.warn('B4X: hover -> failed on-demand xml restore', inner);
        }

        // re-check counts
        const apiAfter = this.apiIndex.allClasses.length;
        const wsAfter = this.workspaceClasses.findClassesByPrefix('').length;
        const xmlAfter = this.xmlLibraries.getDiagnostics().count;
        if (apiAfter === 0 && wsAfter === 0 && xmlAfter === 0) {
          console.log('B4X: hover -> intellisense still empty after on-demand restore; skipping hover');
          return undefined;
        }
      }
    } catch (err) {
      // ignore diagnostics errors and continue
    }

    const memberReference = getMemberReferenceAtPosition(document, position);
    if (memberReference) {
      const inferredTypes = inferVariableTypes(document, this.apiIndex, this.workspaceClasses, this.xmlLibraries);
      const ownerType = resolveExpressionType(
        memberReference.expression,
        document,
        this.apiIndex,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
      );
      const ownerClass = this.workspaceClasses.getDefinitionByName(ownerType)
        ?? this.xmlLibraries.getClassByName(ownerType)
        ?? this.apiIndex.getClassByName(ownerType);
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
    const classInfoWorkspace = this.workspaceClasses.getDefinitionByName(hoveredWord);
    let classInfoXml = this.xmlLibraries.getClassByName(hoveredWord);
    const classInfoApi = this.apiIndex.getClassByName(hoveredWord);
    // If xml store is empty, attempt an on-demand restore from persisted Core/XUI
    try {
      const diag = this.xmlLibraries.getDiagnostics();
      if (diag.count === 0) {
        try {
          const corePathPersisted = this.context.workspaceState.get<string>('b4x.coreXmlPath');
          const xuiPathPersisted = this.context.workspaceState.get<string>('b4x.xuiXmlPath');
          const candidates: string[] = [];
          if (corePathPersisted && fs.existsSync(corePathPersisted)) candidates.push(corePathPersisted);
          if (xuiPathPersisted && fs.existsSync(xuiPathPersisted)) candidates.push(xuiPathPersisted);
          if (candidates.length > 0) {
            console.log('B4X: hover -> on-demand restoring xmlLibraries from persisted paths', candidates);
            await this.xmlLibraries.replaceXmlFiles(candidates);
            classInfoXml = this.xmlLibraries.getClassByName(hoveredWord);
          }
        } catch (inner) {
          console.warn('B4X: hover -> failed on-demand xml restore', inner);
        }
      }
    } catch (e) {
      // ignore diagnostics errors
    }
    const classInfo = classInfoWorkspace ?? classInfoXml ?? classInfoApi;
    // Diagnostic logging to help debug missing hover data for Core.xml classes
    try {
      console.log('B4X: hover -> hoveredWord=', hoveredWord, 'workspace=', Boolean(classInfoWorkspace), 'xml=', Boolean(classInfoXml), 'api=', Boolean(classInfoApi));
      // If xml lookup missed for a likely core class (e.g. XUI/Core), log a small
      // sample of XML library class names to help debug timing/restore issues.
      const _hovered = hoveredWord ?? '';
      if (!classInfoXml && /^(XUI|Core|XUIViews|XUITheme)$/i.test(_hovered)) {
        try {
          const sample = this.xmlLibraries.findClassesByPrefix('').slice(0, 30).map((c) => c.name);
          console.log('B4X: hover -> xml library sample keys (first 30)=', sample);
        } catch (innerErr) {
          console.warn('B4X: hover -> failed to sample xmlLibraries', innerErr);
        }
      }
      // Additional diagnostics for any xml misses: show prefix matches and
      // attempt capitalized lookup to catch naming differences (e.g. 'xui' vs 'XUI').
      if (!classInfoXml) {
        try {
          const prefixMatches = this.xmlLibraries.findClassesByPrefix(_hovered).slice(0, 30).map((c) => c.name);
          const cap = _hovered.length > 0 ? _hovered.substring(0, 1).toUpperCase() + _hovered.substring(1) : _hovered;
          const capMatch = this.xmlLibraries.getClassByName(cap);
          const diag = this.xmlLibraries.getDiagnostics(_hovered);
          console.log('B4X: hover -> xml prefixMatches=', prefixMatches);
          console.log('B4X: hover -> xml getClassByName(capitalized)=', Boolean(capMatch), capMatch?.name);
          console.log('B4X: hover -> xmlDiagnostics=', { count: diag.count, hasExact: diag.hasExact, sampleFirst30: diag.sample.slice(0, 30) });
        } catch (dErr) {
          console.warn('B4X: hover -> failed xml miss diagnostics', dErr);
        }
      }
    } catch (e) {
      // ignore logging errors
    }

    if (!classInfo) {
      // If token isn't a class, try global member lookup across workspace, xml, and API
      try {
        const memberName = hoveredWord;
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

        const apiMember = this.apiIndex.findMemberByName(memberName);
        if (apiMember) {
          const owner = apiMember.ownerClass;
          const member: B4xMemberEntry = apiMember.kind === 'method'
            ? { kind: 'method', item: apiMember.item as any }
            : { kind: 'property', item: apiMember.item as any };
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
  try {
    const cfg = await loadWorkspaceProjectConfig([], preferredDocumentUri);
    const projectFile = cfg.projectFilePath;
    if (projectFile) {
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
    private readonly apiIndex: ApiIndexStore,
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
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
      const inferredTypes = inferVariableTypes(document, this.apiIndex, this.workspaceClasses, this.xmlLibraries);
      const ownerType = resolveExpressionType(
        memberReference.expression,
        document,
        this.apiIndex,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
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
    return this.workspaceClasses.getDefinitionByName(word)?.location
      ?? this.xmlLibraries.getClassByName(word)?.location;
  }
}

class B4xSignatureHelpProvider implements vscode.SignatureHelpProvider {
  public constructor(
    private readonly apiIndex: ApiIndexStore,
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
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
      const inferredTypes = inferVariableTypes(document, this.apiIndex, this.workspaceClasses, this.xmlLibraries);
      const ownerType = resolveExpressionType(
        callContext.expression,
        document,
        this.apiIndex,
        this.workspaceClasses,
        this.xmlLibraries,
        inferredTypes,
      );
      const ownerClass = this.workspaceClasses.getDefinitionByName(ownerType)
        ?? this.xmlLibraries.getClassByName(ownerType)
        ?? this.apiIndex.getClassByName(ownerType);
      if (!ownerClass) {
        return [];
      }

      return ownerClass.methods
        .filter((item) => item.name.toLowerCase() === methodName)
        .map((method) => ({ ownerClass, method }));
    }

    return this.apiIndex.allMethods.filter((item) => item.method.name.toLowerCase() === methodName);
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

function createGeneralCompletionItems(
  apiIndex: ApiIndexStore,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
  localSymbols: readonly B4xLocalSymbol[],
  prefix: string,
): vscode.CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();
  const preferLive = vscode.workspace.getConfiguration('b4xIntellisense').get<boolean>('preferLiveSources', true);
  const localItems = localSymbols
    .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
    .map((item) => createLocalSymbolCompletionItem(item));
  // Workspace and XML-backed classes are available regardless of preference.
  const workspaceClassItems = workspaceClasses
    .findClassesByPrefix(normalizedPrefix)
    .map((item) => createClassCompletionItem(item));
  const xmlClassItems = xmlLibraries
    .findClassesByPrefix(normalizedPrefix)
    .map((item) => createClassCompletionItem(item));
  const apiClassCandidates = apiIndex.findClassesByPrefix(normalizedPrefix);
  const existingClassNames = new Set<string>([
    ...workspaceClassItems.map((c) => (typeof c.label === 'string' ? c.label : c.label.label).toLowerCase()),
    ...xmlClassItems.map((c) => (typeof c.label === 'string' ? c.label : c.label.label).toLowerCase()),
  ]);
  const classItems = preferLive
    ? apiClassCandidates.filter((item) => !existingClassNames.has(item.name.toLowerCase())).map((item) => createClassCompletionItem(item))
    : apiClassCandidates.map((item) => createClassCompletionItem(item));

  if (!normalizedPrefix) {
    return dedupeCompletionItems([
      ...localItems,
      ...classItems,
      ...workspaceClassItems,
      ...xmlClassItems,
    ]);
  }

  const shouldIncludeGlobalMembers = normalizedPrefix.length >= 2
    && (classItems.length + workspaceClassItems.length + xmlClassItems.length) <= 10;
  const methodItems = shouldIncludeGlobalMembers
    ? apiIndex
      .findMethodsByPrefix(normalizedPrefix)
      .filter((entry) => preferLive ? !existingClassNames.has(entry.ownerClass.name.toLowerCase()) : true)
      .slice(0, 25)
      .map((item) => createMethodCompletionItem(item))
    : [];
  const propertyItems = shouldIncludeGlobalMembers
    ? apiIndex
      .findPropertiesByPrefix(normalizedPrefix)
      .filter((entry) => preferLive ? !existingClassNames.has(entry.ownerClass.name.toLowerCase()) : true)
      .slice(0, 15)
      .map((item) => createPropertyCompletionItem(item))
    : [];

  return dedupeCompletionItems([
    ...localItems,
    ...workspaceClassItems,
    ...xmlClassItems,
    ...classItems,
    ...methodItems,
    ...propertyItems,
  ]);
}

function createMemberCompletionItems(
  ownerClass: B4xClass,
  ownerExpression: string,
  prefix: string,
  range: vscode.Range,
): vscode.CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return dedupeCompletionItems([
    ...ownerClass.methods
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => createMethodCompletionItem({ ownerClass, method: item }, range, ownerExpression)),
    ...ownerClass.properties
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => createPropertyCompletionItem({ ownerClass, property: item }, range, ownerExpression)),
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
  completion.label = {
    label: item.name,
    description: item.libraryName,
  };
  completion.detail = `${item.libraryName} library`;
  completion.documentation = createClassDocumentation(item);
  completion.sortText = `1_${item.name.toLowerCase()}`;
  // Hidden unique id for deduping across multiple sources
  (completion as any).__uniqueId = `class:${item.name.toLowerCase()}`;
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
  markdown.appendCodeblock(item.name, 'b4x');
  markdown.appendMarkdown(`Library: ${item.libraryName}\n\n`);
  markdown.appendMarkdown(`Methods: ${item.methods.length} | Properties: ${item.properties.length}\n\n`);

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

  return markdown;
}

function createLocalSymbolDocumentation(item: B4xLocalSymbol): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);

  if (item.kind === 'sub') {
    markdown.appendCodeblock(`Sub ${item.name}`, 'b4x');
    markdown.appendMarkdown('Local sub declared in the current document.\n');
    return markdown;
  }

  if (item.kind === 'type') {
    markdown.appendCodeblock(`Type ${item.name}(...)`, 'b4x');
    markdown.appendMarkdown('Local type declared in the current document.\n');
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

  return markdown;
}

function createLocalTypeMemberDocumentation(
  localType: B4xLocalTypeDefinition,
  field: B4xLocalTypeDefinition['fields'][number],
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  const declaration = field.typeName
    ? `${localType.name}.${field.name} As ${field.typeName}`
    : `${localType.name}.${field.name}`;

  markdown.appendCodeblock(declaration, 'b4x');
  markdown.appendMarkdown(`Local type field declared in ${localType.name}.\n`);
  return markdown;
}

function createClassHoverDocumentation(item: B4xClass, product: 'b4a' | 'b4i' | 'b4j' | 'b4r' = 'b4a'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendCodeblock(item.name, 'b4x');
  markdown.appendMarkdown(`Class: ${item.name}\n\n`);
  markdown.appendMarkdown(`Library: ${item.libraryName}\n\n`);

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }
  // Add a quick "Search Online" link to B4X forum for this class/keyword.
  try {
    const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(item.name)}&ide=true&product=${product}`;
    markdown.appendMarkdown(`\n[Search Online](${url})`);
  } catch (e) {
    // ignore
  }

  return markdown;
}

function createMethodDocumentation(ownerClass: B4xClass, item: B4xMethod): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendCodeblock(`${ownerClass.name}.${item.signature}`, 'b4x');

  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

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

  markdown.appendCodeblock(`${ownerClass.name}.${item.signature}`, 'b4x');
  markdown.appendMarkdown(`Access: ${item.access}\n\n`);
  if (item.doc ?? item.description) {
    markdown.appendMarkdown(`${item.doc ?? item.description}\n`);
  }

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

  if (member.kind === 'method') {
    markdown.appendCodeblock(member.item.signature, 'b4x');
    markdown.appendMarkdown(`Class: ${ownerClass.name}\n\n`);
    markdown.appendMarkdown(`Library: ${ownerClass.libraryName}\n\n`);

    if (member.item.doc ?? member.item.description) {
      markdown.appendMarkdown(`${member.item.doc ?? member.item.description}\n`);
    }

    try {
      const query = `${ownerClass.name} ${member.item.name}`;
      const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(query)}&ide=true&product=${product}`;
      markdown.appendMarkdown(`\n[Search Online](${url})`);
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
  try {
    const query = `${ownerClass.name} ${member.item.name}`;
    const url = `https://www.b4x.com/android/forum/pages/results/?query=${encodeURIComponent(query)}&ide=true&product=${product}`;
    markdown.appendMarkdown(`\n[Search Online](${url})`);
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

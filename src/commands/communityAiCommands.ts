/**
 * Community AI & MCP Tooling Integration Commands for B4X.
 * Synthesizes capabilities from B4XMcpServer, b4x_context, BXPP, and MCP-B4A/B4J:
 * 1. B4X: Copy AI Context Bundle (Token-Optimized)
 * 2. B4X: Remap Java Stack Trace to Source
 * 3. B4X: Doctor / Environment Health Check
 * 4. B4X: Package as .b4xlib
 * 5. B4X: Export Layout as JSON
 * 6. B4X: Import Layout from JSON
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { generateContextBundle, generateJsonContextBundle, saveCodeBundleToWorkspace, ProjectFileEntry } from '../b4xContextBundleCore';
import { loadWorkspaceProjectConfig } from '../projectFile';
import { remapJavaStackTrace } from '../runtimeErrorMapper';
import { runB4xDoctor } from '../b4xDoctorCore';
import { packageB4xLib, detectProjectName, detectProjectPlatform, resolveAdditionalLibrariesFolder } from '../b4xLibPackagerCore';
import { getPlatformSettings, B4xPlatformName } from '../platformConfig';
import { loadConfiguredPlatforms } from '../platformIni';
import { exportLayoutToJsonFile, importLayoutFromJsonFile } from '../cli/b4xLayoutCli';


async function getIniAdditionalLibrariesFolder(platform: B4xPlatformName): Promise<string | undefined> {
  try {
    const platformSettings = getPlatformSettings(platform);
    const loaded = await loadConfiguredPlatforms(platformSettings.configuredPlatforms);
    if (loaded && loaded.length > 0) {
      return loaded[0]?.folders.additionalLibrariesFolder;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function registerCommunityAiCommands(context: vscode.ExtensionContext): void {
  // 1. Copy / Package AI Context Bundle (Token-Optimized or Erel JSON)
  const handleCodeBundle = async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('B4X: No workspace folder open.');
        return;
      }

      const choice = await vscode.window.showQuickPick([
        {
          label: '$(sparkle) Markdown (Token-Optimized)',
          description: 'Lean skeletonized view (~70% fewer tokens), ideal for Claude, ChatGPT, Gemini, DeepSeek',
          format: 'markdown',
        },
        {
          label: '$(json) B4X IDE JSON (Erel-Compatible)',
          description: 'Official B4X IDE Code Bundle format (Ctrl+R) with full modules & caret data',
          format: 'json',
        },
        {
          label: '$(files) Both Formats (Markdown & JSON)',
          description: 'Saves both .md and .json to CodeBundle/ folder and copies Markdown to clipboard',
          format: 'both',
        },
      ], {
        placeHolder: 'Select Code Bundle format to package & copy to clipboard',
      });
      if (!choice) return;

      const rootPath = workspaceFolders[0]!.uri.fsPath;
      const activeDoc = vscode.window.activeTextEditor?.document;
      const activeFsPath = activeDoc?.uri.fsPath;

      // Determine active cursor sub and line
      let activeSub: string | undefined;
      let activeLine: number | undefined;
      if (activeDoc && vscode.window.activeTextEditor) {
        const cursorLine = vscode.window.activeTextEditor.selection.active.line;
        activeLine = cursorLine + 1;
        for (let l = cursorLine; l >= 0; l--) {
          const lineText = activeDoc.lineAt(l).text.trim();
          const subMatch = /^(?:Public\s+|Private\s+)?Sub\s+([a-zA-Z0-9_]+)\b/i.exec(lineText);
          if (subMatch && subMatch[1]) {
            activeSub = subMatch[1];
            break;
          }
        }
      }

      // 1. Resolve project file (.b4a / .b4j) to load strictly referenced modules & libraries
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      const sharedFolder = cfg.get<string>('sharedModulesFolder', '');
      const sharedFolders = sharedFolder ? [sharedFolder] : [];
      const projectConfig = await loadWorkspaceProjectConfig(sharedFolders, activeDoc?.uri);

      const files: ProjectFileEntry[] = [];
      const addedFilePaths = new Set<string>();
      let projectName = path.basename(rootPath);
      let platform = context.globalState.get<string>('b4x.lastOpenedProjectPlatform', 'b4a');
      let libraries: string[] = [];

      if (projectConfig && projectConfig.projectFilePath) {
        projectName = path.basename(projectConfig.projectFilePath).replace(/\.[^/.]+$/, '');
        platform = projectConfig.platform || platform;
        libraries = Array.from(projectConfig.allowedLibraries || []);

        const projectDir = projectConfig.projectDirectory || rootPath;
        const moduleFiles = projectConfig.allowedModuleFiles || [];

        // Add all modules explicitly referenced via ModuleN= (including shared/external modules)
        for (const modPath of moduleFiles) {
          const norm = path.normalize(modPath).toLowerCase();
          if (addedFilePaths.has(norm)) continue;
          addedFilePaths.add(norm);

          let content: string | undefined;
          try {
            content = fs.readFileSync(modPath, 'utf8');
          } catch {
            // ignore unreadable module
          }

          const rel = path.relative(projectDir, modPath).replace(/\\/g, '/');
          const isFocused = activeFsPath ? path.normalize(modPath).toLowerCase() === path.normalize(activeFsPath).toLowerCase() : false;
          files.push({
            relPath: rel,
            kind: 'bas',
            content,
            isFocused,
            focusSub: isFocused ? activeSub : undefined,
          });
        }

        // Add Main module code if embedded inside the .b4a/.b4j project file after @EndOfDesignText@
        try {
          const projContent = fs.readFileSync(projectConfig.projectFilePath, 'utf8');
          const marker = '@EndOfDesignText@';
          const markerIdx = projContent.indexOf(marker);
          if (markerIdx !== -1) {
            const mainBody = projContent.substring(markerIdx + marker.length).trim();
            if (mainBody && !files.some(f => f.relPath.toLowerCase() === 'main.bas')) {
              const isFocused = activeFsPath ? path.normalize(projectConfig.projectFilePath).toLowerCase() === path.normalize(activeFsPath).toLowerCase() : false;
              files.unshift({
                relPath: 'Main.bas',
                kind: 'bas',
                content: mainBody,
                isFocused,
                focusSub: isFocused ? activeSub : undefined,
              });
            }
          }
        } catch {
          // ignore
        }

        // Add project layout files (.bal, .bjl, .bil) from Files/ directory
        const filesDir = path.join(projectDir, 'Files');
        if (fs.existsSync(filesDir)) {
          try {
            const layoutFiles = fs.readdirSync(filesDir);
            for (const lf of layoutFiles) {
              const ext = path.extname(lf).toLowerCase();
              if (ext === '.bal' || ext === '.bjl' || ext === '.bil') {
                files.push({
                  relPath: `Files/${lf}`,
                  kind: ext.slice(1) as any,
                  content: `[Binary Layout File: ${lf}]`,
                });
              }
            }
          } catch {
            // ignore
          }
        }
      } else {
        // Fallback: scan workspace folder for loose .bas and layout files
        const pattern = new vscode.RelativePattern(workspaceFolders[0]!, '**/*.{bas,b4a,b4j,b4i,bal,bjl}');
        const uris = await vscode.workspace.findFiles(pattern, '**/Objects/**');

        for (const u of uris) {
          const rel = path.relative(rootPath, u.fsPath).replace(/\\/g, '/');
          const ext = path.extname(u.fsPath).toLowerCase().replace('.', '') as any;
          let content: string | undefined;

          try {
            if (ext === 'bas' || ext === 'b4a' || ext === 'b4j' || ext === 'b4i') {
              content = fs.readFileSync(u.fsPath, 'utf8');
            } else {
              content = `[Binary Layout File: ${path.basename(u.fsPath)}]`;
            }
          } catch {
            // ignore read error
          }

          const isFocused = activeFsPath ? u.fsPath.toLowerCase() === activeFsPath.toLowerCase() : false;
          files.push({
            relPath: rel,
            kind: ext,
            content,
            isFocused,
            focusSub: isFocused ? activeSub : undefined,
          });
        }
      }

      const activeFileRel = activeFsPath ? path.relative(rootPath, activeFsPath).replace(/\\/g, '/') : undefined;

      const savedFiles: string[] = [];
      let clipboardContent = '';
      let primaryOutputPath = '';

      if (choice.format === 'markdown' || choice.format === 'both') {
        const mdBundle = generateContextBundle({
          projectName,
          platform,
          projectRoot: rootPath,
          files,
          activeFile: activeFileRel,
          activeSub,
          activeLine,
          libraries,
        });
        const saved = saveCodeBundleToWorkspace(rootPath, projectName, 'markdown', mdBundle);
        savedFiles.push(saved.relativePath);
        clipboardContent = mdBundle;
        primaryOutputPath = saved.outputPath;
      }

      if (choice.format === 'json' || choice.format === 'both') {
        const jsonBundle = generateJsonContextBundle({
          projectName,
          platform,
          projectRoot: rootPath,
          files,
          activeFile: activeFileRel,
          activeSub,
          activeLine,
          libraries,
        });
        const saved = saveCodeBundleToWorkspace(rootPath, projectName, 'json', jsonBundle);
        savedFiles.push(saved.relativePath);
        if (!clipboardContent) {
          clipboardContent = jsonBundle;
          primaryOutputPath = saved.outputPath;
        }
      }

      await vscode.env.clipboard.writeText(clipboardContent);

      const filesLabel = savedFiles.join(' & ');
      void vscode.window.showInformationMessage(
        `B4X: Code Bundle saved to ${filesLabel} and copied to clipboard!`,
        'Open File',
        'Open Folder'
      ).then(action => {
        if (action === 'Open File' && primaryOutputPath) {
          vscode.workspace.openTextDocument(primaryOutputPath).then(doc => vscode.window.showTextDocument(doc));
        } else if (action === 'Open Folder' && primaryOutputPath) {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(primaryOutputPath));
        }
      });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.copyAiContextBundle', handleCodeBundle),
    vscode.commands.registerCommand('b4xIntellisense.packageCodeBundle', handleCodeBundle)
  );

  // 2. Remap Java Stack Trace to Source
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.remapJavaStackTrace', async () => {
      // 1. Check selection or clipboard
      let trace = vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection);
      if (!trace || trace.trim().length === 0) {
        trace = await vscode.env.clipboard.readText();
      }

      if (!trace || !trace.includes('at ')) {
        trace = await vscode.window.showInputBox({
          prompt: 'Paste Java / Android Logcat stack trace to remap to B4X source',
          placeHolder: 'java.lang.NullPointerException: ... at b4a.example.main._appstart...',
        });
      }

      if (!trace || trace.trim().length === 0) {
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0]!.uri.fsPath : undefined;

      const result = remapJavaStackTrace(trace, (mod) => {
        if (!rootPath) return undefined;
        // Search in Objects/src/ for <mod>.java
        const candidate1 = path.join(rootPath, 'Objects', 'src', `${mod.toLowerCase()}.java`);
        if (fs.existsSync(candidate1)) return fs.readFileSync(candidate1, 'utf8');

        const objectsSrc = path.join(rootPath, 'Objects', 'src');
        if (fs.existsSync(objectsSrc)) {
          // Recursive find
          const findInDir = (dir: string): string | undefined => {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of list) {
              const full = path.join(dir, item.name);
              if (item.isDirectory()) {
                const f = findInDir(full);
                if (f) return f;
              } else if (item.name.toLowerCase() === `${mod.toLowerCase()}.java`) {
                return fs.readFileSync(full, 'utf8');
              }
            }
            return undefined;
          };
          return findInDir(objectsSrc);
        }
        return undefined;
      });

      if (result.frames.length === 0) {
        vscode.window.showWarningMessage('B4X: No matching stack frames found in input.');
        return;
      }

      // Display quick pick of frames
      interface FrameItem extends vscode.QuickPickItem {
        frame: typeof result.frames[0];
      }

      const items: FrameItem[] = result.frames.map((f) => {
        const title = f.b4xFile && f.b4xLine
          ? `📍 ${f.b4xFile}:${f.b4xLine} — Sub ${f.subName || f.javaMethod}`
          : `⚡ ${f.javaMethod} (${f.javaFile || 'Unknown'}:${f.javaLine || '?'})`;
        const desc = f.isProjectFrame ? 'Project Source' : 'System / Framework';
        return {
          label: title,
          description: desc,
          detail: f.javaMethod,
          frame: f,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: result.suspectedCause
          ? `Root Cause: ${result.suspectedCause}`
          : 'Select a frame to navigate to source',
      });

      if (picked && picked.frame.b4xFile && rootPath) {
        const b4xFiles = await vscode.workspace.findFiles(`**/${picked.frame.b4xFile}`);
        if (b4xFiles.length > 0) {
          const doc = await vscode.workspace.openTextDocument(b4xFiles[0]!);
          const editor = await vscode.window.showTextDocument(doc);
          const lineNum = (picked.frame.b4xLine || 1) - 1;
          const pos = new vscode.Position(Math.max(0, lineNum), 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      }
    })
  );

  // 3. B4X Doctor / Environment Health Check
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.doctor', async () => {
      const config = vscode.workspace.getConfiguration('b4xIntellisense');
      const javaHome = config.get<string>('javaHome');
      const b4aBuilderPath = config.get<string>('b4aBuilderPath');
      const b4jBuilderPath = config.get<string>('b4jBuilderPath');
      const additionalLibs = config.get<string>('additionalLibrariesPath');

      const report = runB4xDoctor({
        javaHome,
        b4aBuilderPath,
        b4jBuilderPath,
        additionalLibsFolder: additionalLibs,
      });

      const channel = vscode.window.createOutputChannel('B4X Doctor');
      channel.clear();
      channel.appendLine(report.markdown);
      channel.show();

      if (report.overallHealthy) {
        vscode.window.showInformationMessage('B4X Doctor: Environment is healthy! Output channel opened with details.');
      } else {
        vscode.window.showWarningMessage('B4X Doctor: Environment issues detected. See Output channel for recommendations.');
      }
    })
  );

  // 4. Package as .b4xlib
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.packageB4XLib', async (uri?: vscode.Uri) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('B4X: No workspace folder open to package.');
        return;
      }

      const rootPath = (uri && uri.fsPath) ? uri.fsPath : workspaceFolders[0]!.uri.fsPath;
      const projectDir = fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory() ? rootPath : path.dirname(rootPath);
      const projectName = detectProjectName(projectDir);
      const platformKey = detectProjectPlatform(projectDir) || 'b4a';

      const config = vscode.workspace.getConfiguration('b4xIntellisense');
      const iniMap = new Map<string, string>();
      for (const p of ['b4a', 'b4j', 'b4i', 'b4r'] as const) {
        const folder = await getIniAdditionalLibrariesFolder(p);
        if (folder) iniMap.set(p, folder);
      }

      const targetDir = resolveAdditionalLibrariesFolder({
        projectDir,
        platform: platformKey,
        getSetting: (key) => config.get<string>(key),
        getIniAdditionalFolder: (p) => iniMap.get(p),
      }) || projectDir;

      const outPath = path.join(targetDir, `${projectName}.b4xlib`);
      const res = packageB4xLib(projectDir, outPath);
      if (res.success) {
        void vscode.window.showInformationMessage(
          `B4X Packager: Packaged '${projectName}.b4xlib' into '${targetDir}'.`,
          'Open Folder'
        ).then(action => {
          if (action === 'Open Folder') {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outPath));
          }
        });
      } else {
        vscode.window.showErrorMessage(`B4X Packager: ${res.message}`);
      }
    })
  );

  // 5. Export Layout as JSON
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.exportLayoutJson', async (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || !/\.(bal|bjl|bil)$/i.test(targetUri.fsPath)) {
        vscode.window.showWarningMessage('B4X: Please select or open a binary layout file (.bal, .bjl, .bil).');
        return;
      }

      try {
        const jsonPath = await exportLayoutToJsonFile(targetUri.fsPath);
        const doc = await vscode.workspace.openTextDocument(jsonPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`B4X: Layout exported to '${path.basename(jsonPath)}'.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`B4X: Failed to export layout: ${err?.message || err}`);
      }
    })
  );

  // 6. Import Layout from JSON
  context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.importLayoutJson', async (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || !/\.json$/i.test(targetUri.fsPath)) {
        vscode.window.showWarningMessage('B4X: Please select or open a .layout.json file.');
        return;
      }

      try {
        const balPath = await importLayoutFromJsonFile(targetUri.fsPath);
        vscode.window.showInformationMessage(`B4X: Layout binary compiled to '${path.basename(balPath)}'.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`B4X: Failed to import layout: ${err?.message || err}`);
      }
    })
  );
}

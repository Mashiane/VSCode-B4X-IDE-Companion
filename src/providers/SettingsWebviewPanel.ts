import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as child_process from 'node:child_process';

export class SettingsWebviewPanel {
  public static currentPanel: SettingsWebviewPanel | undefined;
  public static readonly viewType = 'b4xSettings';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): SettingsWebviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel._panel.reveal(column);
      SettingsWebviewPanel.currentPanel.refresh();
      return SettingsWebviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsWebviewPanel.viewType,
      'B4X Companion Settings',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    SettingsWebviewPanel.currentPanel = new SettingsWebviewPanel(panel, extensionUri);
    return SettingsWebviewPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set panel icon
    const iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'apple-icon.svg');
    if (fs.existsSync(iconPath.fsPath)) {
      this._panel.iconPath = iconPath;
    }

    // Set HTML content
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Listen for messages from webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleWebviewMessage(message);
      },
      null,
      this._disposables
    );

    // Listen for configuration changes from outside (e.g. manual settings.json edits)
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('b4xIntellisense')) {
          this.pushCurrentSettings();
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public refresh(): void {
    this.pushCurrentSettings();
  }

  public dispose(): void {
    SettingsWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _resolveAdbPath(customAdbPath?: string): string {
    if (customAdbPath && customAdbPath.trim() && fs.existsSync(customAdbPath.trim())) {
      return customAdbPath.trim();
    }
    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const fromConfig = config.get<string>('adbPath', '').trim();
    if (fromConfig && fs.existsSync(fromConfig)) {
      return fromConfig;
    }
    const b4aIni = this._readPlatformIni('Basic4android', config.get<string>('b4aIniPath', ''));
    if (b4aIni['platformfolder']) {
      const candidate = path.resolve(b4aIni['platformfolder'], '..', '..', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
      if (fs.existsSync(candidate)) return candidate;
    }
    if (b4aIni['toolsfolder']) {
      const candidate = path.resolve(b4aIni['toolsfolder'], '..', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
      if (fs.existsSync(candidate)) return candidate;
    }
    if (fs.existsSync('C:\\b4a\\sdk\\platform-tools\\adb.exe')) {
      return 'C:\\b4a\\sdk\\platform-tools\\adb.exe';
    }
    return 'adb';
  }

  private _resolveJavaPath(customJavaPath?: string, platform: string = 'B4J'): string {
    if (customJavaPath && customJavaPath.trim() && fs.existsSync(customJavaPath.trim())) {
      return customJavaPath.trim();
    }
    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const settingKey = platform === 'B4J' ? 'b4jJavaPath' : (platform === 'B4i' ? 'b4iJavaPath' : 'b4aJavaPath');
    const fromConfig = config.get<string>(settingKey, '').trim();
    if (fromConfig && fs.existsSync(fromConfig)) {
      return fromConfig;
    }
    const b4jIni = this._readPlatformIni('B4J', config.get<string>('b4jIniPath', ''));
    if (b4jIni['javabin']) {
      const c1 = path.join(b4jIni['javabin'], process.platform === 'win32' ? 'javac.exe' : 'javac');
      if (fs.existsSync(c1)) return c1;
      const c2 = path.join(b4jIni['javabin'], process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(c2)) return c2;
    }
    const b4aIni = this._readPlatformIni('Basic4android', config.get<string>('b4aIniPath', ''));
    if (b4aIni['javabin']) {
      const c1 = path.join(b4aIni['javabin'], process.platform === 'win32' ? 'javac.exe' : 'javac');
      if (fs.existsSync(c1)) return c1;
      const c2 = path.join(b4aIni['javabin'], process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(c2)) return c2;
    }
    if (fs.existsSync('C:\\b4a\\jdk19\\bin\\javac.exe')) return 'C:\\b4a\\jdk19\\bin\\javac.exe';
    return 'java';
  }

  private _readPlatformIni(platformDirName: string, customIniPath?: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (process.platform !== 'win32') return result;

    const appData = process.env.APPDATA || '';
    const candidates: string[] = [];
    if (customIniPath && customIniPath.trim()) candidates.push(customIniPath.trim());
    if (appData) {
      candidates.push(path.join(appData, 'Anywhere Software', platformDirName, 'b4xV5.ini'));
      if (platformDirName === 'Basic4android') {
        candidates.push(path.join(appData, 'Anywhere Software', 'B4A', 'b4xV5.ini'));
      }
    }

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        try {
          const raw = fs.readFileSync(file, 'utf8');
          for (const line of raw.split(/\r?\n/)) {
            const idx = line.indexOf('=');
            if (idx > 0) {
              const k = line.slice(0, idx).trim().toLowerCase();
              let v = line.slice(idx + 1).trim();
              if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
              result[k] = v;
            }
          }
          break;
        } catch { /* ignore */ }
      }
    }
    return result;
  }

  private pushCurrentSettings(): void {
    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const b4aIni = this._readPlatformIni('Basic4android', config.get<string>('b4aIniPath', ''));
    const b4jIni = this._readPlatformIni('B4J', config.get<string>('b4jIniPath', ''));
    const b4iIni = this._readPlatformIni('B4i', config.get<string>('b4iIniPath', ''));
    const b4rIni = this._readPlatformIni('B4R', config.get<string>('b4rIniPath', ''));

    const b4aInstall = config.get<string>('b4aInstallPath', 'C:\\Program Files\\Anywhere Software\\B4A');
    const b4jInstall = config.get<string>('b4jInstallPath', 'C:\\Program Files\\Anywhere Software\\B4J');
    const b4iInstall = config.get<string>('b4iInstallPath', 'C:\\Program Files (x86)\\Anywhere Software\\B4i');
    const b4rInstall = config.get<string>('b4rInstallPath', 'C:\\Program Files\\Anywhere Software\\B4R');

    const detectedB4aBuilder = fs.existsSync(path.join(b4aInstall, 'B4ABuilder.exe')) ? path.join(b4aInstall, 'B4ABuilder.exe') : '';
    const detectedB4jBuilder = fs.existsSync(path.join(b4jInstall, 'B4JBuilder.exe')) ? path.join(b4jInstall, 'B4JBuilder.exe') : '';
    const detectedB4aJava = b4aIni['javabin'] ? path.join(b4aIni['javabin'], 'javac.exe') : '';
    const detectedB4jJava = b4jIni['javabin'] ? (fs.existsSync(path.join(b4jIni['javabin'], 'javac.exe')) ? path.join(b4jIni['javabin'], 'javac.exe') : path.join(b4jIni['javabin'], 'java.exe')) : '';
    const detectedB4iJava = b4iIni['javabin'] ? path.join(b4iIni['javabin'], 'javac.exe') : '';
    const detectedAdb = b4aIni['platformfolder'] ? path.resolve(b4aIni['platformfolder'], '..', '..', 'platform-tools', 'adb.exe') : '';

    const allSettings: Record<string, any> = {
      // Universal - Appearance
      fontFamily: config.get<string>('fontFamily', 'Fira Code Retina'),
      fontSize: config.get<number>('fontSize', 12),
      wordWrap: config.get<boolean>('wordWrap', true),
      tabSize: config.get<number>('tabSize', 4),

      // Universal - Auto-Backup
      autoBackupEnabled: config.get<boolean>('autoBackupEnabled', false),
      autoBackupInterval: config.get<number>('autoBackupInterval', 600000),

      // Universal - Workspace & Automation
      autoRestoreWorkspace: config.get<boolean>('autoRestoreWorkspace', true),
      autoOpenProjectFolderOnOpen: config.get<boolean>('autoOpenProjectFolderOnOpen', false),
      autoAddProjectFolderOnOpen: config.get<boolean>('autoAddProjectFolderOnOpen', true),
      autoLoadProjectAssets: config.get<boolean>('autoLoadProjectAssets', true),
      projectsViewName: config.get<string>('projectsViewName', 'Projects'),
      autoApplyIni: config.get<string>('autoApplyIni', 'prompt'),

      // Universal - Diagnostics
      enableUnusedSubDiagnostics: config.get<boolean>('enableUnusedSubDiagnostics', true),
      enableUnusedLibraryDiagnostics: config.get<boolean>('enableUnusedLibraryDiagnostics', true),
      'extractMethod.previewBehavior': config.get<string>('extractMethod.previewBehavior', 'prompt'),

      // Universal - Logging & Diagnostics
      debug: config.get<boolean>('debug', false),
      disableConsoleOutput: config.get<boolean>('disableConsoleOutput', true),
      enableTelemetry: config.get<boolean>('enableTelemetry', false),

      // Universal - Integrations
      ffmpegPath: config.get<string>('ffmpegPath', ''),
      googleSheetUrl: config.get<string>('googleSheetUrl', ''),

      // Platform - B4A
      b4aInstallPath: b4aInstall,
      b4aBuilderPath: config.get<string>('b4aBuilderPath', '') || detectedB4aBuilder,
      b4aJavaPath: config.get<string>('b4aJavaPath', '') || detectedB4aJava,
      b4aAdditionalLibrariesFolder: config.get<string>('b4aAdditionalLibrariesFolder', '') || b4aIni['additionallibrariesfolder'] || '',
      b4aSharedFolder: config.get<string>('b4aSharedFolder', '') || b4aIni['sharedmodulesfolder'] || '',
      b4aIniPath: config.get<string>('b4aIniPath', ''),
      b4aWorkspaceFolder: config.get<string>('b4aWorkspaceFolder', '') || b4aIni['newprojectdefaultfolder'] || '',
      adbPath: config.get<string>('adbPath', '') || (fs.existsSync(detectedAdb) ? detectedAdb : ''),
      emulatorPath: config.get<string>('emulatorPath', ''),

      // Platform - B4J
      b4jInstallPath: b4jInstall,
      b4jBuilderPath: config.get<string>('b4jBuilderPath', '') || detectedB4jBuilder,
      b4jJavaPath: config.get<string>('b4jJavaPath', '') || detectedB4jJava,
      b4jAdditionalLibrariesFolder: config.get<string>('b4jAdditionalLibrariesFolder', '') || b4jIni['additionallibrariesfolder'] || '',
      b4jSharedFolder: config.get<string>('b4jSharedFolder', '') || b4jIni['sharedmodulesfolder'] || '',
      b4jIniPath: config.get<string>('b4jIniPath', ''),
      b4jWorkspaceFolder: config.get<string>('b4jWorkspaceFolder', '') || b4jIni['newprojectdefaultfolder'] || '',

      // Platform - B4i
      b4iInstallPath: b4iInstall,
      b4iJavaPath: config.get<string>('b4iJavaPath', '') || detectedB4iJava,
      b4iAdditionalLibrariesFolder: config.get<string>('b4iAdditionalLibrariesFolder', '') || b4iIni['additionallibrariesfolder'] || '',
      b4iSharedFolder: config.get<string>('b4iSharedFolder', '') || b4iIni['sharedmodulesfolder'] || '',
      b4iIniPath: config.get<string>('b4iIniPath', ''),
      b4iWorkspaceFolder: config.get<string>('b4iWorkspaceFolder', '') || b4iIni['newprojectdefaultfolder'] || '',

      // Platform - B4R
      b4rInstallPath: b4rInstall,
      b4rAdditionalLibrariesFolder: config.get<string>('b4rAdditionalLibrariesFolder', '') || b4rIni['additionallibrariesfolder'] || '',
      b4rSharedFolder: config.get<string>('b4rSharedFolder', '') || b4rIni['sharedmodulesfolder'] || '',
      b4rIniPath: config.get<string>('b4rIniPath', ''),
      b4rWorkspaceFolder: config.get<string>('b4rWorkspaceFolder', '') || b4rIni['newprojectdefaultfolder'] || ''
    };

    void this._panel.webview.postMessage({
      type: 'loadSettings',
      settings: allSettings
    });
  }

  private async _handleWebviewMessage(message: any): Promise<void> {
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'webviewReady': {
        this.pushCurrentSettings();
        break;
      }

      case 'updateSetting': {
        const { key, value } = message;
        if (typeof key === 'string') {
          try {
            await vscode.workspace.getConfiguration('b4xIntellisense').update(
              key,
              value,
              vscode.ConfigurationTarget.Global
            );
            void this._panel.webview.postMessage({
              type: 'saveSuccess',
              key
            });
            if (typeof key === 'string' && key.endsWith('IniPath')) {
              this.pushCurrentSettings();
            }
          } catch (err) {
            void vscode.window.showErrorMessage(`Failed to update setting ${key}: ${String(err)}`);
          }
        }
        break;
      }

      case 'browsePath': {
        const { key, mode, title } = message;
        const options: vscode.OpenDialogOptions = {
          canSelectFiles: mode === 'file',
          canSelectFolders: mode === 'folder',
          canSelectMany: false,
          openLabel: 'Select',
          title: title || (mode === 'folder' ? 'Select Folder' : 'Select File')
        };

        if (key === 'b4aIniPath' || key === 'b4jIniPath' || key === 'b4iIniPath' || key === 'b4rIniPath') {
          options.filters = { 'Configuration Files': ['ini'] };
        } else if (key === 'b4jJavaPath' || key === 'b4aJavaPath' || key === 'b4iJavaPath' || key === 'b4aBuilderPath' || key === 'b4jBuilderPath' || key === 'adbPath' || key === 'emulatorPath' || key === 'ffmpegPath') {
          options.filters = { 'Executables': ['exe'] };
        }

        const selected = await vscode.window.showOpenDialog(options);
        if (selected && selected.length > 0 && selected[0]) {
          const chosenPath = selected[0].fsPath;
          await vscode.workspace.getConfiguration('b4xIntellisense').update(
            key,
            chosenPath,
            vscode.ConfigurationTarget.Global
          );
          void this._panel.webview.postMessage({
            type: 'settingUpdated',
            key,
            value: chosenPath
          });
          if (typeof key === 'string' && key.endsWith('IniPath')) {
            this.pushCurrentSettings();
          }
        }
        break;
      }

      case 'autoDetectIni': {
        const { platform, key } = message;
        const appData = process.env.APPDATA || '';
        let detected = '';

        if (platform === 'b4a') {
          const candidate = path.join(appData, 'Anywhere Software', 'Basic4android', 'b4xV5.ini');
          if (fs.existsSync(candidate)) detected = candidate;
        } else if (platform === 'b4j') {
          const candidate = path.join(appData, 'Anywhere Software', 'B4J', 'b4xV5.ini');
          if (fs.existsSync(candidate)) detected = candidate;
        } else if (platform === 'b4i') {
          const candidate = path.join(appData, 'Anywhere Software', 'B4i', 'b4xV5.ini');
          if (fs.existsSync(candidate)) detected = candidate;
        } else if (platform === 'b4r') {
          const candidate = path.join(appData, 'Anywhere Software', 'B4R', 'b4xV5.ini');
          if (fs.existsSync(candidate)) detected = candidate;
        }

        if (detected) {
          await vscode.workspace.getConfiguration('b4xIntellisense').update(
            key,
            detected,
            vscode.ConfigurationTarget.Global
          );
          void this._panel.webview.postMessage({
            type: 'settingUpdated',
            key,
            value: detected
          });
          void vscode.window.showInformationMessage(`Auto-detected ${platform.toUpperCase()} INI: ${detected}`);
          this.pushCurrentSettings();
        } else {
          void vscode.window.showWarningMessage(`Could not locate default INI for ${platform.toUpperCase()} in %APPDATA%\\Anywhere Software.`);
        }
        break;
      }

      case 'testAdb': {
        const adbCmd = this._resolveAdbPath(message.path);

        child_process.execFile(adbCmd, ['version'], (err, stdout, stderr) => {
          if (err) {
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'adb',
              success: false,
              message: `ADB test failed: ${stderr || err.message}`
            });
          } else {
            const firstLine = stdout.split('\n')[0] || 'ADB operational';
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'adb',
              success: true,
              message: `${firstLine.trim()} [${adbCmd}]`
            });
            const config = vscode.workspace.getConfiguration('b4xIntellisense');
            if (!config.get<string>('adbPath', '').trim() && adbCmd !== 'adb') {
              void config.update('adbPath', adbCmd, vscode.ConfigurationTarget.Global);
            }
          }
        });
        break;
      }

      case 'installBridge': {
        const adbCmd = this._resolveAdbPath();

        const bridgeApk = vscode.Uri.joinPath(this._extensionUri, 'media', 'bridge.apk').fsPath;
        if (!fs.existsSync(bridgeApk)) {
          void this._panel.webview.postMessage({
            type: 'testResult',
            target: 'bridge',
            success: false,
            message: 'B4A-Bridge APK not found in extension assets.'
          });
          return;
        }

        child_process.execFile(adbCmd, ['devices'], (err, stdout, stderr) => {
          if (err) {
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'bridge',
              success: false,
              message: `ADB error: ${stderr || err.message}`
            });
            return;
          }

          const lines = stdout.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('List of devices'));
          const onlineDevices = lines.filter(l => l.includes('device') && !l.includes('offline') && !l.includes('unauthorized'));

          if (onlineDevices.length === 0) {
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'bridge',
              success: false,
              message: 'No authorized Android device or emulator detected. Connect a device with USB Debugging enabled or start an emulator.'
            });
            void vscode.window.showWarningMessage('No authorized Android device found via ADB to install B4A-Bridge.');
            return;
          }

          child_process.execFile(adbCmd, ['install', '-r', bridgeApk], (installErr, installStdout, installStderr) => {
            const out = (installStdout || installStderr || '').trim();
            if (out.includes('INSTALL_FAILED_VERSION_DOWNGRADE')) {
              void this._panel.webview.postMessage({
                type: 'testResult',
                target: 'bridge',
                success: true,
                message: 'B4A-Bridge is already installed on the connected device (newer or equal version).'
              });
              void vscode.window.showInformationMessage('B4A-Bridge is already installed on the connected device with a newer or equal version.');
            } else if (installErr || out.includes('Failure')) {
              void this._panel.webview.postMessage({
                type: 'testResult',
                target: 'bridge',
                success: false,
                message: `Installation failed: ${out || installErr?.message}`
              });
              void vscode.window.showErrorMessage(`Failed to install B4A-Bridge: ${out}`);
            } else {
              void this._panel.webview.postMessage({
                type: 'testResult',
                target: 'bridge',
                success: true,
                message: 'B4A-Bridge successfully installed to connected device!'
              });
              void vscode.window.showInformationMessage('B4A-Bridge installed successfully on connected Android device!');
            }
          });
        });
        break;
      }

      case 'saveBridgeApk': {
        const bridgeApk = vscode.Uri.joinPath(this._extensionUri, 'media', 'bridge.apk');
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('b4a_bridge.apk'),
          filters: { 'Android Package': ['apk'] },
          saveLabel: 'Save APK'
        });
        if (saveUri) {
          fs.copyFileSync(bridgeApk.fsPath, saveUri.fsPath);
          void vscode.window.showInformationMessage(`B4A-Bridge APK exported to: ${saveUri.fsPath}`);
        }
        break;
      }

      case 'startEmulator': {
        try {
          await vscode.commands.executeCommand('b4xIntellisense.startEmulator');
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to launch Android Emulator: ${String(err)}`);
        }
        break;
      }

      case 'testJava': {
        const javaCmd = this._resolveJavaPath(message.path, 'B4J');

        child_process.execFile(javaCmd, ['-version'], (err, stdout, stderr) => {
          // java -version outputs to stderr
          const output = (stderr || stdout || '').trim();
          if (err && !output) {
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'java',
              success: false,
              message: `Java test failed: ${err.message}`
            });
          } else {
            const firstLine = output.split('\n')[0] || 'Java runtime detected';
            void this._panel.webview.postMessage({
              type: 'testResult',
              target: 'java',
              success: true,
              message: `${firstLine.trim()} [${javaCmd}]`
            });
            const config = vscode.workspace.getConfiguration('b4xIntellisense');
            if (!config.get<string>('b4jJavaPath', '').trim() && javaCmd !== 'java') {
              void config.update('b4jJavaPath', javaCmd, vscode.ConfigurationTarget.Global);
            }
          }
        });
        break;
      }

      case 'openStandardSettings': {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'b4xIntellisense');
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const mediaUri = vscode.Uri.joinPath(this._extensionUri, 'media');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.min.css'));
    const twUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'tailwind.min.js'));
    const remixiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'remixicon.css'));

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${cssUri}" rel="stylesheet" type="text/css">
    <link href="${remixiconCssUri}" rel="stylesheet" type="text/css">
    <script nonce="${nonce}" src="${twUri}"></script>
    <style>
        :root {
            color-scheme: dark light;
        }
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 13px);
            margin: 0;
            padding: 0;
            user-select: none;
        }
        input, select, textarea {
            user-select: text;
        }
        .b4x-container {
            max-width: 1040px;
            margin: 0 auto;
            padding: 1.5rem 2rem 4rem 2rem;
        }
        .b4x-card {
            background: var(--vscode-sideBar-background, rgba(255, 255, 255, 0.02));
            border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
            border-radius: 8px;
            padding: 1.25rem;
            margin-bottom: 1.25rem;
        }
        .b4x-input {
            background: var(--vscode-input-background) !important;
            color: var(--vscode-input-foreground) !important;
            border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3)) !important;
            border-radius: 4px;
        }
        .b4x-input:focus {
            outline: 1px solid var(--vscode-focusBorder) !important;
            border-color: var(--vscode-focusBorder) !important;
        }
        .b4x-select {
            background: var(--vscode-dropdown-background, var(--vscode-input-background)) !important;
            color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)) !important;
            border: 1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.3)) !important;
            border-radius: 4px;
        }
        .b4x-btn-secondary {
            background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.15));
            color: var(--vscode-button-secondaryForeground, inherit);
            border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
        }
        .b4x-btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.25));
        }
        .b4x-btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .b4x-btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .toast-save {
            position: fixed;
            bottom: 1.5rem;
            right: 1.5rem;
            z-index: 100;
            display: none;
        }
    </style>
</head>
<body>
    <div class="b4x-container">
        <!-- Header -->
        <div class="flex items-center justify-between pb-4 border-b border-base-300/40 mb-6">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold">
                    <i class="ri-settings-4-line"></i>
                </div>
                <div>
                    <h1 class="text-xl font-bold tracking-tight">B4X Companion Settings</h1>
                    <p class="text-xs opacity-70">Customize universal options, platform directories, diagnostics, and workspace lifecycle</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button id="btnOpenStandard" class="btn btn-sm b4x-btn-secondary gap-2" title="Open VS Code Settings JSON Editor">
                    <i class="ri-external-link-line"></i> VS Code Settings UI
                </button>
            </div>
        </div>

        <!-- Tabs Navigation -->
        <div role="tablist" class="tabs tabs-box bg-base-300/20 p-1 rounded-lg mb-6 flex flex-wrap">
            <button role="tab" class="tab tab-active gap-2 font-medium" data-tab="tab-universal">
                <i class="ri-global-line"></i> Universal & Core
            </button>
            <button role="tab" class="tab gap-2 font-medium" data-tab="tab-b4a">
                <i class="ri-android-line text-green-500"></i> B4A (Android)
            </button>
            <button role="tab" class="tab gap-2 font-medium" data-tab="tab-b4j">
                <i class="ri-cup-line text-orange-500"></i> B4J (Java / Desktop)
            </button>
            <button role="tab" class="tab gap-2 font-medium" data-tab="tab-b4i">
                <i class="ri-apple-line text-sky-400"></i> B4i (iOS)
            </button>
            <button role="tab" class="tab gap-2 font-medium" data-tab="tab-b4r">
                <i class="ri-cpu-line text-emerald-400"></i> B4R (Embedded)
            </button>
        </div>

        <!-- ================= TAB 1: UNIVERSAL & CORE ================= -->
        <div id="tab-universal" class="tab-content active space-y-6">
            
            <!-- Auto-Backup Card (NEW) -->
            <div class="b4x-card">
                <div class="flex items-start justify-between">
                    <div>
                        <h2 class="text-base font-semibold flex items-center gap-2">
                            <i class="ri-history-line text-primary"></i> Workspace Auto-Backup
                        </h2>
                        <p class="text-xs opacity-70 mt-1">Automatically create periodic background timestamped archives of the workspace</p>
                    </div>
                    <label class="cursor-pointer label p-0 gap-3">
                        <span class="text-xs font-medium">Enable Auto-Backup</span>
                        <input type="checkbox" id="autoBackupEnabled" class="toggle toggle-primary toggle-sm">
                    </label>
                </div>
                <div class="mt-4 pt-4 border-t border-base-300/30 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">Backup Interval (Minutes)</label>
                        <input type="number" id="autoBackupIntervalMinutes" min="1" step="1" class="input input-sm w-full b4x-input" placeholder="10">
                        <span class="text-[11px] opacity-60 mt-1 block">Default: 10 minutes. Silent backup timer starts immediately when enabled.</span>
                    </div>
                </div>
            </div>

            <!-- Editor & Previews -->
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-3">
                    <i class="ri-font-size text-primary"></i> Editor & Preview Appearance
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">Preview Font Family</label>
                        <input type="text" id="fontFamily" class="input input-sm w-full b4x-input" placeholder="Fira Code Retina">
                    </div>
                    <div>
                        <label class="text-xs font-semibold block mb-1">Preview Font Size (px)</label>
                        <input type="number" id="fontSize" min="8" max="32" class="input input-sm w-full b4x-input" placeholder="12">
                    </div>
                    <div>
                        <label class="text-xs font-semibold block mb-1">Tab Indentation Size</label>
                        <input type="number" id="tabSize" min="1" max="8" class="input input-sm w-full b4x-input" placeholder="4">
                    </div>
                    <div class="flex items-center gap-3 pt-6">
                        <input type="checkbox" id="wordWrap" class="checkbox checkbox-primary checkbox-sm">
                        <label for="wordWrap" class="text-xs cursor-pointer">Word wrap code in extension webviews and previews</label>
                    </div>
                </div>
            </div>

            <!-- Workspace Automation -->
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-3">
                    <i class="ri-folder-settings-line text-primary"></i> Workspace & Lifecycle Automation
                </h2>
                <div class="space-y-3">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="autoRestoreWorkspace" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Automatically restore last active B4X project file into empty window</span>
                    </label>
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="autoAddProjectFolderOnOpen" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Add project folder to workspace folders when opening B4X project</span>
                    </label>
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="autoOpenProjectFolderOnOpen" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Replace entire workspace window with project folder when opening project</span>
                    </label>
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="autoLoadProjectAssets" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Auto-load libraries, modules, and language server after project open</span>
                    </label>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-base-300/30">
                    <div>
                        <label class="text-xs font-semibold block mb-1">Projects View Title</label>
                        <input type="text" id="projectsViewName" class="input input-sm w-full b4x-input" placeholder="Projects">
                    </div>
                    <div>
                        <label class="text-xs font-semibold block mb-1">Auto Apply Platform INI Hints</label>
                        <select id="autoApplyIni" class="select select-sm w-full b4x-select">
                            <option value="prompt">Prompt with dialog</option>
                            <option value="always">Always apply silently</option>
                            <option value="never">Never apply</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Diagnostics & Code Intelligence -->
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-3">
                    <i class="ri-bug-line text-primary"></i> Diagnostics & Refactoring
                </h2>
                <div class="space-y-3">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="enableUnusedSubDiagnostics" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Detect and highlight unused Subroutines (Subs)</span>
                    </label>
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="enableUnusedLibraryDiagnostics" class="checkbox checkbox-primary checkbox-sm">
                        <span class="text-xs">Detect and highlight unused Libraries</span>
                    </label>
                </div>
                <div class="mt-4 pt-4 border-t border-base-300/30">
                    <label class="text-xs font-semibold block mb-1">Extract Method Preview Behavior</label>
                    <select id="extractMethod.previewBehavior" class="select select-sm w-full max-w-md b4x-select">
                        <option value="prompt">Prompt with preview dialog</option>
                        <option value="autoApply">Auto apply changes directly</option>
                        <option value="alwaysPreview">Always open diff preview</option>
                    </select>
                </div>
            </div>

            <!-- Logging & Integrations -->
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-3">
                    <i class="ri-tools-line text-primary"></i> Logging & External Integrations
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-3">
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="debug" class="checkbox checkbox-primary checkbox-sm">
                            <span class="text-xs">Enable timestamped debug log file (b4x-log-*.txt)</span>
                        </label>
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="disableConsoleOutput" class="checkbox checkbox-primary checkbox-sm">
                            <span class="text-xs">Disable console logging in favor of log files</span>
                        </label>
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="enableTelemetry" class="checkbox checkbox-primary checkbox-sm">
                            <span class="text-xs">Enable anonymous telemetry for feature usage</span>
                        </label>
                    </div>
                    <div class="space-y-3">
                        <div>
                            <label class="text-xs font-semibold block mb-1">FFmpeg Path (GIF / Screen recording)</label>
                            <div class="flex gap-2">
                                <input type="text" id="ffmpegPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detect or custom path">
                                <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="ffmpegPath" data-mode="file">Browse</button>
                            </div>
                        </div>
                        <div>
                            <label class="text-xs font-semibold block mb-1">Google Sheet URL (Library Indexing)</label>
                            <input type="text" id="googleSheetUrl" class="input input-sm w-full b4x-input" placeholder="https://docs.google.com/spreadsheets/...">
                        </div>
                    </div>
                </div>
            </div>

        </div>

        <!-- ================= TAB 2: B4A (ANDROID) ================= -->
        <div id="tab-b4a" class="tab-content space-y-6">
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-4">
                    <i class="ri-android-line text-green-500"></i> B4A Environment & Directories
                </h2>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">B4A INI Path (b4xV5.ini)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aIniPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detects from %APPDATA%\Anywhere Software\Basic4android\b4xV5.ini">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aIniPath" data-mode="file">Browse...</button>
                            <button class="btn btn-sm b4x-btn-secondary btn-autodetect" data-platform="b4a" data-key="b4aIniPath">Auto-detect</button>
                        </div>
                        <span class="text-[11px] opacity-60">Primary configuration file. Java compiler, libraries, and SDK directories below are derived from this file.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4A Installation Path</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aInstallPath" class="input input-sm flex-1 b4x-input" placeholder="C:\Program Files\Anywhere Software\B4A">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aInstallPath" data-mode="folder">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Used to locate Themes, asset templates, and core libraries.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4A Builder Executable (B4ABuilder.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aBuilderPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4A installation directory">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aBuilderPath" data-mode="file">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Command-line compiler used to package and build B4A projects.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Java JDK Compiler (javac.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aJavaPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4A INI (JavaBin)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aJavaPath" data-mode="file">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">JDK javac.exe used for Android Java bytecode compilation.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Additional Libraries Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aAdditionalLibrariesFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4A INI (AdditionalLibrariesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aAdditionalLibrariesFolder" data-mode="folder">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Directory for custom, community, and downloaded libraries (.jar, .xml, .b4xlib).</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Shared Modules Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aSharedFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4A INI (SharedModulesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aSharedFolder" data-mode="folder">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Directory for code modules shared across multiple projects.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Default Workspace Directory</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4aWorkspaceFolder" class="input input-sm flex-1 b4x-input" placeholder="Optional default directory for creating new B4A projects">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4aWorkspaceFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-4">
                    <i class="ri-smartphone-line text-green-500"></i> Android Tools & Emulator
                </h2>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">ADB Executable (adb.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="adbPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from Android SDK or system PATH">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="adbPath" data-mode="file">Browse...</button>
                            <button id="btnTestAdb" class="btn btn-sm b4x-btn-primary gap-1">
                                <i class="ri-check-line"></i> Test ADB
                            </button>
                        </div>
                        <div id="adbStatus" class="mt-2 text-xs hidden"></div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4A-Bridge Utility (b4a_bridge.apk)</label>
                        <div class="flex gap-2 items-center flex-wrap">
                            <button id="btnInstallBridge" class="btn btn-sm b4x-btn-primary gap-1">
                                <i class="ri-smartphone-line"></i> Install B4A-Bridge to Device
                            </button>
                            <button id="btnSaveBridgeApk" class="btn btn-sm b4x-btn-secondary gap-1">
                                <i class="ri-download-2-line"></i> Export APK...
                            </button>
                        </div>
                        <div id="bridgeStatus" class="mt-2 text-xs hidden"></div>
                        <span class="text-[11px] opacity-60">Installs the latest official B4A-Bridge app directly onto connected devices or emulators via ADB.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Emulator Executable (emulator.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="emulatorPath" class="input input-sm flex-1 b4x-input" placeholder="Leave empty for Android SDK default emulator">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="emulatorPath" data-mode="file">Browse...</button>
                            <button id="btnStartEmulator" class="btn btn-sm b4x-btn-primary gap-1">
                                <i class="ri-play-circle-line"></i> Start Android Emulator
                            </button>
                        </div>
                        <span class="text-[11px] opacity-60">Path to emulator.exe. Auto-detected from Android SDK if left blank.</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ================= TAB 3: B4J (JAVA / DESKTOP) ================= -->
        <div id="tab-b4j" class="tab-content space-y-6">
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-4">
                    <i class="ri-cup-line text-orange-500"></i> B4J Environment & Runtime
                </h2>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">B4J INI Path (b4xV5.ini)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jIniPath" class="input input-sm flex-1 b4x-input" placeholder="Optional path to B4J b4xV5.ini">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jIniPath" data-mode="file">Browse...</button>
                            <button class="btn btn-sm b4x-btn-secondary btn-autodetect" data-platform="b4j" data-key="b4jIniPath">Auto-detect</button>
                        </div>
                        <span class="text-[11px] opacity-60">Primary configuration file. Java runtime, libraries, and module directories below are derived from this file.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4J Installation Path</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jInstallPath" class="input input-sm flex-1 b4x-input" placeholder="C:\Program Files\Anywhere Software\B4J">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jInstallPath" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4J Builder Executable (B4JBuilder.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jBuilderPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4J installation directory">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jBuilderPath" data-mode="file">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Command-line compiler used to build B4J desktop and server applications.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Java Runtime / JDK Executable (java.exe / javac.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jJavaPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4J INI (JavaBin)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jJavaPath" data-mode="file">Browse...</button>
                            <button id="btnTestJava" class="btn btn-sm b4x-btn-primary gap-1">
                                <i class="ri-check-line"></i> Verify Java
                            </button>
                        </div>
                        <div id="javaStatus" class="mt-2 text-xs hidden"></div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Additional Libraries Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jAdditionalLibrariesFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4J INI (AdditionalLibrariesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jAdditionalLibrariesFolder" data-mode="folder">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Folder for custom and downloaded B4J libraries (.jar, .xml, .b4xlib).</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Shared Modules Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jSharedFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4J INI (SharedModulesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jSharedFolder" data-mode="folder">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">Directory for code modules shared across projects.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Default Workspace Directory</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4jWorkspaceFolder" class="input input-sm flex-1 b4x-input" placeholder="Optional default directory for creating new B4J projects">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4jWorkspaceFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ================= TAB 4: B4i (iOS) ================= -->
        <div id="tab-b4i" class="tab-content space-y-6">
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-4">
                    <i class="ri-apple-line text-sky-400"></i> B4i (iOS) Directories
                </h2>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">B4i INI Path (b4xV5.ini)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iIniPath" class="input input-sm flex-1 b4x-input" placeholder="Optional path to B4i b4xV5.ini">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iIniPath" data-mode="file">Browse...</button>
                            <button class="btn btn-sm b4x-btn-secondary btn-autodetect" data-platform="b4i" data-key="b4iIniPath">Auto-detect</button>
                        </div>
                        <span class="text-[11px] opacity-60">Primary configuration file. Java compiler, keys, and library directories below are derived from this file.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4i Installation Path</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iInstallPath" class="input input-sm flex-1 b4x-input" placeholder="C:\Program Files (x86)\Anywhere Software\B4i">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iInstallPath" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Java JDK Compiler (javac.exe)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iJavaPath" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4i INI (JavaBin)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iJavaPath" data-mode="file">Browse...</button>
                        </div>
                        <span class="text-[11px] opacity-60">JDK javac.exe used for B4i bytecode generation.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Additional Libraries Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iAdditionalLibrariesFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4i INI (AdditionalLibrariesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iAdditionalLibrariesFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Shared Modules Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iSharedFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4i INI (SharedModulesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iSharedFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Default Workspace Directory</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4iWorkspaceFolder" class="input input-sm flex-1 b4x-input" placeholder="Optional default directory for creating new B4i projects">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4iWorkspaceFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ================= TAB 5: B4R (EMBEDDED) ================= -->
        <div id="tab-b4r" class="tab-content space-y-6">
            <div class="b4x-card">
                <h2 class="text-base font-semibold flex items-center gap-2 mb-4">
                    <i class="ri-cpu-line text-emerald-400"></i> B4R (Embedded / Arduino) Directories
                </h2>
                <div class="space-y-4">
                    <div>
                        <label class="text-xs font-semibold block mb-1">B4R INI Path (b4xV5.ini)</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4rIniPath" class="input input-sm flex-1 b4x-input" placeholder="Optional path to B4R b4xV5.ini">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4rIniPath" data-mode="file">Browse...</button>
                            <button class="btn btn-sm b4x-btn-secondary btn-autodetect" data-platform="b4r" data-key="b4rIniPath">Auto-detect</button>
                        </div>
                        <span class="text-[11px] opacity-60">Primary configuration file. Library, shared module, and project directories below are derived from this file.</span>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">B4R Installation Path</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4rInstallPath" class="input input-sm flex-1 b4x-input" placeholder="C:\Program Files\Anywhere Software\B4R">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4rInstallPath" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Additional Libraries Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4rAdditionalLibrariesFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4R INI (AdditionalLibrariesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4rAdditionalLibrariesFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Shared Modules Folder</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4rSharedFolder" class="input input-sm flex-1 b4x-input" placeholder="Auto-detected from B4R INI (SharedModulesFolder)">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4rSharedFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>

                    <div>
                        <label class="text-xs font-semibold block mb-1">Default Workspace Directory</label>
                        <div class="flex gap-2">
                            <input type="text" id="b4rWorkspaceFolder" class="input input-sm flex-1 b4x-input" placeholder="Optional default directory for creating new B4R projects">
                            <button class="btn btn-sm b4x-btn-secondary btn-browse" data-key="b4rWorkspaceFolder" data-mode="folder">Browse...</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>

    <!-- Save Notification Toast -->
    <div id="saveToast" class="toast toast-end toast-save">
        <div class="alert alert-success py-2 px-3 text-xs shadow-lg flex items-center gap-2">
            <i class="ri-check-line text-base"></i>
            <span>Setting saved</span>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let activeTab = 'tab-universal';
        let currentSettings = {};

        // Tab Switching
        document.querySelectorAll('.tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('tab-active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                tab.classList.add('tab-active');
                const target = tab.getAttribute('data-tab');
                const content = document.getElementById(target);
                if (content) {
                    content.classList.add('active');
                    activeTab = target;
                }
            });
        });

        // Show save toast
        let toastTimeout;
        function showSavedToast() {
            const toast = document.getElementById('saveToast');
            if (!toast) return;
            toast.style.display = 'block';
            clearTimeout(toastTimeout);
            toastTimeout = setTimeout(() => {
                toast.style.display = 'none';
            }, 1800);
        }

        // Send setting change
        function saveSetting(key, value) {
            currentSettings[key] = value;
            vscode.postMessage({
                type: 'updateSetting',
                key: key,
                value: value
            });
        }

        // Auto-backup interval helper (minutes <-> ms)
        const autoBackupMinutesInput = document.getElementById('autoBackupIntervalMinutes');
        autoBackupMinutesInput.addEventListener('change', () => {
            const mins = parseFloat(autoBackupMinutesInput.value) || 10;
            const ms = Math.max(1, Math.round(mins * 60000));
            saveSetting('autoBackupInterval', ms);
        });

        // Wire inputs
        const stringInputIds = [
            'fontFamily', 'projectsViewName', 'ffmpegPath', 'googleSheetUrl',
            'b4aInstallPath', 'b4aBuilderPath', 'b4aJavaPath', 'b4aAdditionalLibrariesFolder', 'b4aSharedFolder', 'b4aIniPath', 'b4aWorkspaceFolder', 'adbPath', 'emulatorPath',
            'b4jInstallPath', 'b4jBuilderPath', 'b4jJavaPath', 'b4jAdditionalLibrariesFolder', 'b4jSharedFolder', 'b4jIniPath', 'b4jWorkspaceFolder',
            'b4iInstallPath', 'b4iJavaPath', 'b4iAdditionalLibrariesFolder', 'b4iSharedFolder', 'b4iIniPath', 'b4iWorkspaceFolder',
            'b4rInstallPath', 'b4rAdditionalLibrariesFolder', 'b4rSharedFolder', 'b4rIniPath', 'b4rWorkspaceFolder'
        ];

        stringInputIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                saveSetting(id, el.value.trim());
            });
        });

        const numberInputIds = ['fontSize', 'tabSize'];
        numberInputIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                saveSetting(id, parseInt(el.value, 10) || 0);
            });
        });

        const checkboxIds = [
            'autoBackupEnabled', 'wordWrap', 'autoRestoreWorkspace',
            'autoAddProjectFolderOnOpen', 'autoOpenProjectFolderOnOpen',
            'autoLoadProjectAssets', 'enableUnusedSubDiagnostics',
            'enableUnusedLibraryDiagnostics', 'debug', 'disableConsoleOutput',
            'enableTelemetry'
        ];

        checkboxIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                saveSetting(id, el.checked);
            });
        });

        const selectIds = ['autoApplyIni', 'extractMethod.previewBehavior'];
        selectIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                saveSetting(id, el.value);
            });
        });

        // Browse Buttons
        document.querySelectorAll('.btn-browse').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                const mode = btn.getAttribute('data-mode') || 'file';
                vscode.postMessage({
                    type: 'browsePath',
                    key: key,
                    mode: mode
                });
            });
        });

        // Auto-detect INI buttons
        document.querySelectorAll('.btn-autodetect').forEach(btn => {
            btn.addEventListener('click', () => {
                const platform = btn.getAttribute('data-platform');
                const key = btn.getAttribute('data-key');
                vscode.postMessage({
                    type: 'autoDetectIni',
                    platform: platform,
                    key: key
                });
            });
        });

        // B4A-Bridge Buttons
        const btnInstallBridge = document.getElementById('btnInstallBridge');
        const bridgeStatus = document.getElementById('bridgeStatus');
        if (btnInstallBridge && bridgeStatus) {
            btnInstallBridge.addEventListener('click', () => {
                bridgeStatus.className = 'mt-2 text-xs opacity-75';
                bridgeStatus.innerText = 'Installing B4A-Bridge to connected device via ADB...';
                bridgeStatus.classList.remove('hidden');
                vscode.postMessage({ type: 'installBridge' });
            });
        }

        const btnSaveBridgeApk = document.getElementById('btnSaveBridgeApk');
        if (btnSaveBridgeApk) {
            btnSaveBridgeApk.addEventListener('click', () => {
                vscode.postMessage({ type: 'saveBridgeApk' });
            });
        }

        // Start Android Emulator Button
        const btnStartEmulator = document.getElementById('btnStartEmulator');
        if (btnStartEmulator) {
            btnStartEmulator.addEventListener('click', () => {
                vscode.postMessage({ type: 'startEmulator' });
            });
        }

        // Test ADB Button
        const btnTestAdb = document.getElementById('btnTestAdb');
        const adbStatus = document.getElementById('adbStatus');
        btnTestAdb.addEventListener('click', () => {
            adbStatus.className = 'mt-2 text-xs opacity-75';
            adbStatus.innerText = 'Testing ADB connection...';
            adbStatus.classList.remove('hidden');
            const pathVal = document.getElementById('adbPath')?.value?.trim() || '';
            vscode.postMessage({ type: 'testAdb', path: pathVal });
        });

        // Test Java Button
        const btnTestJava = document.getElementById('btnTestJava');
        const javaStatus = document.getElementById('javaStatus');
        btnTestJava.addEventListener('click', () => {
            javaStatus.className = 'mt-2 text-xs opacity-75';
            javaStatus.innerText = 'Testing Java runtime...';
            javaStatus.classList.remove('hidden');
            const pathVal = document.getElementById('b4jJavaPath')?.value?.trim() || '';
            vscode.postMessage({ type: 'testJava', path: pathVal });
        });

        // Open Standard VS Code Settings UI
        document.getElementById('btnOpenStandard').addEventListener('click', () => {
            vscode.postMessage({ type: 'openStandardSettings' });
        });

        // Listen for messages from Extension Host
        window.addEventListener('message', event => {
            const msg = event.data;
            if (!msg) return;

            if (msg.type === 'loadSettings' && msg.settings) {
                currentSettings = msg.settings;
                // Populate all fields
                stringInputIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && msg.settings[id] !== undefined) el.value = msg.settings[id] || '';
                });
                numberInputIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && msg.settings[id] !== undefined) el.value = msg.settings[id];
                });
                checkboxIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && msg.settings[id] !== undefined) el.checked = !!msg.settings[id];
                });
                selectIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && msg.settings[id] !== undefined) el.value = msg.settings[id];
                });

                // Auto-backup interval in minutes
                if (msg.settings.autoBackupInterval !== undefined) {
                    const mins = Math.max(1, Math.round(msg.settings.autoBackupInterval / 60000));
                    autoBackupMinutesInput.value = mins;
                }
            } else if (msg.type === 'settingUpdated') {
                const el = document.getElementById(msg.key);
                if (el) {
                    if (el.type === 'checkbox') el.checked = !!msg.value;
                    else el.value = msg.value || '';
                }
                showSavedToast();
            } else if (msg.type === 'saveSuccess') {
                showSavedToast();
            } else if (msg.type === 'testResult') {
                if (msg.target === 'adb') {
                    adbStatus.innerText = msg.message;
                    adbStatus.className = msg.success ? 'mt-2 text-xs text-green-500 font-medium' : 'mt-2 text-xs text-red-400 font-medium';
                } else if (msg.target === 'java') {
                    javaStatus.innerText = msg.message;
                    javaStatus.className = msg.success ? 'mt-2 text-xs text-green-500 font-medium' : 'mt-2 text-xs text-red-400 font-medium';
                } else if (msg.target === 'bridge') {
                    if (bridgeStatus) {
                        bridgeStatus.innerText = msg.message;
                        bridgeStatus.className = msg.success ? 'mt-2 text-xs text-green-500 font-medium' : 'mt-2 text-xs text-red-400 font-medium';
                        bridgeStatus.classList.remove('hidden');
                    }
                }
            }
        });

        // Notify extension host we are ready
        vscode.postMessage({ type: 'webviewReady' });
    </script>
</body>
</html>
    `;
  }
}

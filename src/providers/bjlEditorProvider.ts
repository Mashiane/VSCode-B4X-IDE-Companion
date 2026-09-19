import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Minimal implementation of CustomDocument to satisfy VS Code's CustomEditorProvider.
 */
export class BjlDocument implements vscode.CustomDocument {
  constructor(public uri: vscode.Uri) {}
  dispose() {}
}

/**
 * Minimal implementation of CustomDocumentBackup to satisfy VS Code's CustomEditorProvider.
 */
export class BjlBackup implements vscode.CustomDocumentBackup {
  constructor(public uri: vscode.Uri) {
    this.id = uri.fsPath;
  }
  public readonly id: string;
  dispose() {}
  async delete(): Promise<void> {}
}

/**
 * Opens BJL layout files in a visual designer webview.
 * Implements vscode.CustomEditorProvider to be the default editor for .bjl, .bil, and .bal files.
 */
export class BjlEditorProvider implements vscode.CustomEditorProvider<BjlDocument> {
  public static readonly viewType = 'b4x-bjl-editor';
  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BjlDocument>>();
  private readonly _documentData = new Map<string, Uint8Array>();
  private readonly _panels = new Map<string, vscode.WebviewPanel>();

  constructor(private extensionUri: vscode.Uri) {}

  /**
   * This method is called to initialize the webview for the custom editor.
   * Note: The panel is provided by VS Code, we just configure its HTML and messages.
   */
  public async resolveCustomEditor(
    document: BjlDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editorDir = vscode.Uri.joinPath(this.extensionUri, 'media', 'bjl-editor');
    const mediaDir  = vscode.Uri.joinPath(this.extensionUri, 'media');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [editorDir, mediaDir],
    };
    webviewPanel.iconPath = vscode.ThemeIcon.File;
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    this._panels.set(document.uri.fsPath, webviewPanel);

    // Setup communication
    const messageHandler = (msg: any) => this.handleMessage(msg, webviewPanel, document.uri);
    webviewPanel.webview.onDidReceiveMessage(messageHandler);

    // Load the initial file data
    await this.pushFileData(webviewPanel, document.uri);
  }

  public async openCustomDocument(uri: vscode.Uri): Promise<BjlDocument> {
    return new BjlDocument(uri);
  }

  public async backupCustomDocument(
    document: BjlDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken
  ): Promise<BjlBackup> {
    return new BjlBackup(document.uri);
  }

  public async saveCustomDocument(document: BjlDocument): Promise<void> {
    const data = this._documentData.get(document.uri.fsPath);
    if (!data) {
      throw new Error('No data to save');
    }
    await fs.promises.writeFile(document.uri.fsPath, data);

    const panel = this._panels.get(document.uri.fsPath);
    if (panel) {
      panel.webview.postMessage({ type: 'saveComplete' });
    }
  }

  public async saveCustomDocumentAs(document: BjlDocument, uri: vscode.Uri): Promise<void> {
    const data = this._documentData.get(document.uri.fsPath);
    if (!data) {
      throw new Error('No data to save');
    }
    await fs.promises.writeFile(uri.fsPath, data);
  }

  public async revertCustomDocument(document: BjlDocument): Promise<void> {
    const panel = this._panels.get(document.uri.fsPath);
    if (panel) {
      await this.pushFileData(panel, document.uri);
    }
  }

  public async reloadEditor(uri: vscode.Uri): Promise<void> {
    const panel = this._panels.get(uri.fsPath);
    if (panel) {
      await this.pushFileData(panel, uri);
    }
  }

  public get onDidChangeCustomDocument() {
    return this._onDidChangeCustomDocument.event;
  }

  // ---- File I/O ----

  private async readFile(filePath: string): Promise<{ type: 'binary'; base64: string } | { type: 'json'; text: string }> {
    const content = await fs.promises.readFile(filePath);
    const text = content.toString('utf-8').trim();
    if (text.startsWith('{')) {
      return { type: 'json', text };
    }
    return { type: 'binary', base64: content.toString('base64') };
  }

  // ---- Message handling ----

  private handleMessage(msg: { type: string; [key: string]: unknown }, panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    if (msg.type === 'ready') {
      void this.pushFileData(panel, uri);
    } else if (msg.type === 'contentChanged' && typeof msg.binaryData === 'string') {
      const buffer = Buffer.from(msg.binaryData, 'base64');
      this._documentData.set(uri.fsPath, new Uint8Array(buffer));
    } else if (msg.type === 'saveRequest') {
      void vscode.window.showInformationMessage('BJL Editor: Save triggered.');
    } else if (msg.type === 'showInfo' && typeof msg.text === 'string') {
      void vscode.window.showInformationMessage(msg.text);
    } else if (msg.type === 'showError' && typeof msg.text === 'string') {
      void vscode.window.showErrorMessage(msg.text);
    }
  }

  private async pushFileData(panel: vscode.WebviewPanel, uri: vscode.Uri): Promise<void> {
    try {
      const fileData = await this.readFile(uri.fsPath);
      const fileName = path.basename(uri.fsPath) || 'layout.bjl';

      panel.webview.postMessage({
        type: 'loadFile',
        fileName,
        fileType: fileData.type,
        fileData: fileData.type === 'binary'
          ? (fileData as { type: 'binary'; base64: string }).base64
          : (fileData as { type: 'json'; text: string }).text,
      });
    } catch (err) {
      console.error('[BjlEditorProvider] Failed to push file data:', err);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const editorDir = vscode.Uri.joinPath(this.extensionUri, 'media', 'bjl-editor');
    const mediaDir  = vscode.Uri.joinPath(this.extensionUri, 'media');

    const getUri = (relPath: string) => webview.asWebviewUri(vscode.Uri.joinPath(editorDir, relPath));
    const getMediaUri = (relPath: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, relPath));

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sithaso B4A/BJL Editor</title>
    <link rel="icon" type="image/svg+xml" href="${getUri('favicon.svg')}">
    <link href="${getMediaUri('daisyui.min.css')}" rel="stylesheet" type="text/css" />
    <link href="${getMediaUri('remixicon.css')}" rel="stylesheet">
    <link href="${getUri('styles/jse-theme-dark.css')}" rel="stylesheet" type="text/css" />
    <script nonce="${nonce}" src="${getUri('scripts/sweetalert2.js')}"></script>
    <script nonce="${nonce}" src="${getMediaUri('tailwind.min.js')}"></script>
    <script nonce="${nonce}" src="${getUri('scripts/pako.min.js')}"></script>
    <script nonce="${nonce}" src="${getUri('scripts/SithasoLayoutEngine.js')}"></script>
    <script nonce="${nonce}" src="${getUri('scripts/SithasoBJLTree.js')}"></script>
    <script nonce="${nonce}" type="module" src="${getUri('scripts/vanilla-jsoneditor-bridge.js')}"></script>
    <script nonce="${nonce}" src="${getUri('scripts/SithasoBJLDesigner.js')}"></script>
    <style>
        body {
            margin: 0;
            padding: 0px;
            overflow: hidden;
            box-sizing: border-box;
        }
    </style>
</head>
<body>
    <bjl-designer id="designer"
        style="width: 100vw; height: 100vh;"></bjl-designer>
    <script nonce="${nonce}" src="${getUri('bjl-designer-bridge.js')}"></script>
</body>
</html>`;
  }
}

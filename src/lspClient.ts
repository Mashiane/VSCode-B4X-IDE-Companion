// Lightweight LSP client starter. Uses runtime require to avoid hard TypeScript deps.
import * as path from 'node:path';
import * as vscode from 'vscode';

let _client: any = null;

export async function startLanguageClient(context: vscode.ExtensionContext): Promise<vscode.Disposable | undefined> {
  try {
    // Dynamically require to avoid compile-time type dependency on vscode-languageclient
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lc = require('vscode-languageclient/node');
    const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));

    const serverOptions = {
      run: { module: serverModule, transport: lc.TransportKind.stdio },
      debug: { module: serverModule, transport: lc.TransportKind.stdio, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
    };

    const clientOptions = {
      documentSelector: [{ scheme: 'file', language: 'b4x' }, { scheme: 'untitled', language: 'b4x' }],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bas,b4x}'),
      },
    };

    _client = new lc.LanguageClient('b4xLanguageServer', 'B4X Language Server', serverOptions, clientOptions);
    const disposable = _client.start();
    console.log('B4X LSP client started');
    return {
      dispose: () => {
        try {
          if (_client) {
            _client.stop();
            _client = null;
          }
        } catch (err) {
          console.warn('Failed to stop LSP client', err);
        }
      },
    };
  } catch (err) {
    console.warn('B4X LSP: vscode-languageclient not available. Install it to enable LSP client.', String(err));
    return undefined;
  }
}

export async function stopLanguageClient(): Promise<void> {
  if (_client) {
    try { await _client.stop(); } catch { /* ignore */ }
    _client = null;
  }
}

export function sendRequest(method: string, params: any): Promise<any> | undefined {
  if (!_client) return undefined;
  try {
    return _client.sendRequest(method, params);
  } catch (err) {
    console.warn('LSP client sendRequest failed', String(err));
    return undefined;
  }
}

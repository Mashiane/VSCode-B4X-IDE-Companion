// Lightweight LSP client starter. Uses runtime require to avoid hard TypeScript deps.
import * as path from 'node:path';
import * as vscode from 'vscode';

// Module-level reference to the currently active client.
// Used only by sendRequest() so callers don't need to hold their own reference.
let _client: any = null;

/**
 * Start the B4X language server client.
 *
 * If a client is already running it is stopped first, preventing orphaned
 * server processes from accumulating when the user opens multiple projects
 * in the same session.
 *
 * The returned Disposable captures the specific client instance that was
 * just started (not the module-level variable) so concurrent or sequential
 * dispose calls can never stop the wrong process.
 */
export async function startLanguageClient(context: vscode.ExtensionContext, onNotification?: (method: string, params: any) => void): Promise<vscode.Disposable | undefined> {
  // Stop any currently running client before creating a new one.
  await stopLanguageClient();

  try {
    // Dynamically require to avoid compile-time type dependency on vscode-languageclient
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lc = require('vscode-languageclient/node');
    // In a packaged .vsix, node_modules is excluded, so the server is bundled
    // (self-contained) into dist/server.js by scripts/bundle.js.
    const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

    const serverOptions = {
      run: { module: serverModule, transport: lc.TransportKind.stdio },
      debug: { module: serverModule, transport: lc.TransportKind.stdio, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
    };

    const clientOptions = {
      documentSelector: [{ scheme: 'file', language: 'b4x' }, { scheme: 'untitled', language: 'b4x' }],
    };

    const client = new lc.LanguageClient('b4xLanguageServer', 'B4X Language Server', serverOptions, clientOptions);
    // Keep the module-level reference up-to-date for sendRequest().
    _client = client;

    // start() is asynchronous in vscode-languageclient v9.
    // It will resolve when the server confirms initialization and buffers any notifications sent during this period.
    await client.start();
    console.log('B4X LSP client started');

    // If the caller provided a notification handler, register for the
    // server-side indexing notifications now that client is ready.
    if (typeof onNotification === 'function') {
      try {
        client.onNotification('b4x/indexing', (params: any) => {
          try { onNotification('b4x/indexing', params); } catch { /* ignore */ }
        });
      } catch (err) {
        console.error('ERROR registering notification:', err);
      }
    }

    // Capture the specific instance in the closure — not the module variable —
    // so this disposable always stops exactly the client it started.
    return {
      dispose: () => {
        try { client.stop(); } catch { /* ignore */ }
        // Clear the module reference if it still points to this instance.
        if (_client === client) {
          _client = null;
        }
      },
    };
  } catch (err) {
    console.warn('B4X LSP: vscode-languageclient not available or failed to start.', String(err));
    return undefined;
  }
}

/** Stop the currently running language client, if any. */
export async function stopLanguageClient(): Promise<void> {
  const client = _client;
  _client = null;

  if (client) {
    try { await client.stop(); } catch { /* ignore */ }
    // Also clear any internal state the client may hold
    try { if (typeof client.dispose === 'function') { await client.dispose(); } } catch { /* ignore — stop() is usually sufficient */ }
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

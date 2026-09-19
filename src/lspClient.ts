// Lightweight LSP client starter. Uses runtime require to avoid hard TypeScript deps.
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';

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
export interface StartLanguageClientOptions {
  /** Explicit project root directory for LSP indexing. When provided, the server
   *  indexes this directory instead of relying on VS Code's workspace rootPath/rootUri.
   *  This ensures indexing works even when the project folder is not in the workspace. */
  projectRoot?: string;
}

export async function startLanguageClient(context: vscode.ExtensionContext, onNotification?: (method: string, params: any) => void, options?: StartLanguageClientOptions): Promise<vscode.Disposable | undefined> {
  // Stop any currently running client before creating a new one.
  await stopLanguageClient();

  try {
    // Dynamically require to avoid compile-time type dependency on vscode-languageclient
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lc = require('vscode-languageclient/node');

    // Resolve the server module path. Use context.asAbsolutePath() which
    // correctly handles extension installation paths including sandboxed
    // environments where the extension may be loaded from a restricted location.
    const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

    // Verify the server module exists before attempting to fork — provides a
    // clear error message instead of a silent child-process spawn failure.
    // Use async fs.access() to avoid blocking the extension host event loop.
    try {
      await fs.access(serverModule);
    } catch {
      const msg = `B4X LSP server module not found or inaccessible. The extension installation may be incomplete or the sandboxed environment is blocking file access.`;
      console.error(msg, serverModule);
      void vscode.window.showErrorMessage(msg);
      return undefined;
    }

    const serverOptions = {
      run: { module: serverModule, transport: lc.TransportKind.stdio },
      debug: { module: serverModule, transport: lc.TransportKind.stdio, options: { execArgv: ['--nolazy', '--inspect=127.0.0.1:6009'] } },
    };

    // Build initializationOptions — pass projectRoot when available so the LSP
    // server indexes the correct B4X project directory regardless of which
    // workspace folders VS Code currently has open.
    const initializationOptions: Record<string, unknown> = {};
    if (options?.projectRoot) {
      initializationOptions.projectRoot = options.projectRoot;
    }

    const clientOptions = {
      documentSelector: [{ scheme: 'file', language: 'b4x' }, { scheme: 'untitled', language: 'b4x' }],
      initializationOptions,
      // Custom error handler:
      // - Errors: continue (don't shut down on transient errors)
      // - Close: allow limited restarts (up to 5 within 5 minutes) so transient
      //   crashes get a second chance, but infinite loops are prevented.
      // ErrorAction.Continue = 2, CloseAction.Restart = 2, CloseAction.DoNotRestart = 1
      errorHandler: {
        error: () => ({ action: 2 }), // ErrorAction.Continue
        closed: (() => {
          let restartCount = 0;
          let firstRestartTime: number | undefined;
          const maxRestarts = 5;
          const restartWindowMs = 5 * 60 * 1000; // 5 minutes
          return () => {
            const now = Date.now();
            if (!firstRestartTime) { firstRestartTime = now; }
            // Reset counter if outside the restart window
            if (now - firstRestartTime > restartWindowMs) {
              restartCount = 0;
              firstRestartTime = now;
            }
            restartCount++;
            if (restartCount <= maxRestarts) {
              console.warn(`B4X LSP: Server closed — restarting (attempt ${restartCount}/${maxRestarts})`);
              return { action: 2 }; // CloseAction.Restart
            }
            console.error(`B4X LSP: Server closed — exceeded ${maxRestarts} restarts in ${restartWindowMs / 1000}s, giving up`);
            void vscode.window.showErrorMessage('B4X: Language server stopped and could not be restarted. Please reload the window.');
            return { action: 1 }; // CloseAction.DoNotRestart
          };
        })(),
      },
    };

    const client = new lc.LanguageClient('b4xLanguageServer', 'B4X Language Server', serverOptions, clientOptions);
    // Keep the module-level reference up-to-date for sendRequest().
    _client = client;

    // start() is asynchronous in vscode-languageclient v9.
    // It will resolve when the server confirms initialization and buffers any notifications sent during this period.
    await client.start();

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
      try {
        client.onNotification('b4x/indexingFailed', (params: any) => {
          try {
            const msg = params && params.error ? String(params.error) : 'Unknown indexing error';
            void vscode.window.showErrorMessage(`B4X: Workspace indexing failed — ${msg}`);
          } catch { /* ignore */ }
        });
      } catch (err) {
        console.error('ERROR registering indexingFailed notification:', err);
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
    // Show a user-visible message when the LSP server fails to start,
    // rather than silently swallowing the error. This is critical for
    // diagnosing sandboxed environments where fork/spawn may be blocked.
    const errMessage = err instanceof Error ? err.message : String(err);
    const isSandboxError = /EACCES|EPERM|ENOENT/i.test(errMessage)
      || (/spawn|fork/i.test(errMessage) && !/ForkJoin/i.test(errMessage));
    const userMessage = isSandboxError
      ? 'B4X: Language server failed to start — the sandboxed environment may be blocking process creation. Try trusting the workspace and reloading.'
      : 'B4X: Language server failed to start. Check the developer console for details.';
    console.error('B4X LSP: Failed to start language client.', err);
    void vscode.window.showErrorMessage(userMessage);
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

export function sendRequest(method: string, params: any): Promise<any> {
  if (!_client) {
    return Promise.reject(new Error('B4X LSP client not initialized'));
  }
  return _client.sendRequest(method, params);
}
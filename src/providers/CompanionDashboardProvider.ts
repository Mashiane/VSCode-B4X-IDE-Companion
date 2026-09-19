import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectFileEntry } from '../projectFile';
import { LibraryCatalog, LibraryEntry, extractB4xlibVersion } from '../libraryCatalog';

/** Extract version from an XML library file. */
function extractXmlVersion(xmlPath: string): string {
    try {
        const content = fs.readFileSync(xmlPath, 'utf8');
        const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
        const match = contentWithoutComments.match(/<version>([^<]+)<\/version>/i);
        return match ? match[1]!.trim() : '';
    } catch {
        return '';
    }
}

// Debug logging function
function debugLog(...args: any[]) {
    console.log(`[CompanionDashboard] ${new Date().toISOString()}`, ...args);
}

export class CompanionDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'b4x-companion-dashboard';
    private _view: vscode.WebviewView | undefined = undefined;
    private _pendingLibraries: { name: string; version: string; onlineVersion: string; source: string; path: string; used: boolean; forum_thread?: string; library_file?: string }[] = [];
    private _rawLibraries: { name: string; version: string; onlineVersion: string; source: string; path: string; used: boolean }[] = [];
    private _pendingProjectFiles: ProjectFileEntry[] = [];
    private _libraryCatalog: LibraryCatalog | undefined;
    private _catalogDisposable: vscode.Disposable | undefined;
    private _webviewReady: boolean = false;
    private _internalLibrariesFolder: string = '';
    private _additionalLibrariesFolder: string = '';

    constructor(private readonly extensionUri: vscode.Uri) {
        debugLog('Constructor called');
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        debugLog('resolveWebviewView called');
        this._view = webviewView;
        // Reset ready flag — the webview is being (re)created and its JS needs to
        // send a fresh 'webviewReady' message before we can push data.
        this._webviewReady = false;

        const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaUri]
        };

        // IMPORTANT: Register the message handler BEFORE setting webview.html.
        // If we set the HTML first, the webview JS can execute and send
        // 'webviewReady' before this handler is registered, causing the message
        // to be lost and the dashboard to remain empty.
        webviewView.webview.onDidReceiveMessage(async (message: { type: string; path?: string; forum_thread?: string; libraries?: { name: string; forum_thread: string }[]; text?: string; name?: string; names?: string[] }) => {
            if (message.type === 'webviewReady') {
                debugLog('Received webviewReady — webview scripts are loaded');
                this._webviewReady = true;
                this.pushStoredData();
            }
            if (message.type === 'openFile' && message.path) {
                try {
                    const lowerPath = message.path.toLowerCase();
                    if (lowerPath.endsWith('.bjl') || lowerPath.endsWith('.bil') || lowerPath.endsWith('.bal') || lowerPath.endsWith('.bjl.json') || lowerPath.endsWith('.bil.json') || lowerPath.endsWith('.bal.json')) {
                        // Open BJL/BIL/BAL layout files in the visual designer
                        await vscode.commands.executeCommand('b4xIntellisense.openBjlEditor', message.path);
                    } else {
                        const uri = vscode.Uri.file(message.path);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    void vscode.window.showErrorMessage(`Unable to open file: ${message.path}`);
                }
            }
            if (message.type === 'openForumThread' && message.forum_thread) {
                try {
                    const uri = vscode.Uri.parse(message.forum_thread);
                    await vscode.commands.executeCommand('vscode.open', uri);
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    void vscode.window.showErrorMessage(`Unable to open forum thread: ${message.forum_thread}`);
                }
            }
            if (message.type === 'searchMissingLibrary' && message.name) {
                try {
                    const query = encodeURIComponent(message.name);
                    const uri = vscode.Uri.parse(`https://www.b4x.com/android/forum/pages/results/?query=${query}&ide=true`);
                    await vscode.commands.executeCommand('vscode.open', uri);
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    void vscode.window.showErrorMessage(`Unable to search B4X website for: ${message.name}`);
                }
            }
            if (message.type === 'searchMissingLibraries' && message.names) {
                try {
                    for (const name of message.names) {
                        const query = encodeURIComponent(name);
                        const uri = vscode.Uri.parse(`https://www.b4x.com/android/forum/pages/results/?query=${query}&ide=true`);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    void vscode.window.showErrorMessage(`Unable to search B4X website: ${errorMessage}`);
                }
            }
            if (message.type === 'showInfo' && message.text) {
                void vscode.window.showInformationMessage(message.text as string);
            }
            if (message.type === 'updateLibraries' && message.libraries) {
                const libs = message.libraries as { name: string; source?: string; forum_thread?: string; library_file?: string; path?: string }[];
                const downloadable = libs.filter((l): l is { name: string; source: string; forum_thread?: string; library_file: string; path: string } => !!(l.library_file));
                const forumOnly = libs.filter(l => !l.library_file && l.forum_thread);

                if (downloadable.length > 0) {
                    let cancelled = false;
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Updating libraries', cancellable: true },
                        async (progress, token) => {
                            token.onCancellationRequested(() => { cancelled = true; });
                            let i = 0;
                            let downloaded = 0;
                            let skipped = 0;
                            const downloadedFiles: string[] = [];
                            const updatedVersions: { name: string; version: string }[] = [];
                            for (const lib of downloadable) {
                                if (cancelled) break;
                                i++;
                                progress.report({ message: `Checking ${lib.name} (${i}/${downloadable.length})`, increment: 0 });
                                const downloadUrl = lib.library_file;
                                const source = lib.source || 'Internal';
                                const destFolder = source === 'External' && this._additionalLibrariesFolder
                                    ? this._additionalLibrariesFolder
                                    : this._internalLibrariesFolder || os.homedir();
                                const urlPath = new URL(downloadUrl).pathname;
                                const fileName = decodeURIComponent(urlPath.split('/').pop() || lib.name);
                                const destPath = path.join(destFolder, fileName);
                                // Validate URL before downloading (with timeout)
                                const isValid = await new Promise<boolean>((resolve) => {
                                    const req = https.request(downloadUrl, { method: 'HEAD', timeout: 8000 }, (res) => {
                                        const code = res.statusCode ?? 0;
                                        if (code >= 300 && code < 400 && res.headers.location) {
                                            const redirectUrl = res.headers.location;
                                            const req2 = https.request(redirectUrl, { method: 'HEAD', timeout: 8000 }, (res2) => {
                                                resolve((res2.statusCode ?? 0) >= 200 && (res2.statusCode ?? 0) < 400);
                                                res2.resume();
                                            });
                                            req2.on('error', () => resolve(false));
                                            req2.setTimeout(8000, () => { req2.destroy(); resolve(false); });
                                            req2.end();
                                        } else {
                                            resolve(code >= 200 && code < 400);
                                        }
                                        res.resume();
                                    });
                                    req.on('error', () => resolve(false));
                                    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
                                    req.end();
                                });
                                if (!isValid || cancelled) {
                                    skipped++;
                                    continue;
                                }
                                progress.report({ message: `Downloading ${lib.name} (${i}/${downloadable.length})`, increment: Math.round(100 / downloadable.length) });
                                const downloadOk = await new Promise<boolean>((resolve) => {
                                    const file = fs.createWriteStream(destPath);
                                    const req = https.get(downloadUrl, { timeout: 30000 }, (res) => {
                                        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
                                            const redirectUrl = res.headers.location;
                                            const req2 = https.get(redirectUrl, { timeout: 30000 }, (res2) => {
                                                res2.pipe(file);
                                                file.on('finish', () => { file.close(() => { resolve(true); }); });
                                            });
                                            req2.on('error', () => { file.close(); fs.unlink(destPath, () => {}); resolve(false); });
                                            req2.setTimeout(30000, () => { req2.destroy(); file.close(); fs.unlink(destPath, () => {}); resolve(false); });
                                        } else {
                                            res.pipe(file);
                                            file.on('finish', () => { file.close(() => { resolve(true); }); });
                                        }
                                    });
                                    req.on('error', () => { file.close(); fs.unlink(destPath, () => {}); resolve(false); });
                                    req.setTimeout(30000, () => { req.destroy(); file.close(); fs.unlink(destPath, () => {}); resolve(false); });
                                });
                                if (!downloadOk) {
                                    skipped++;
                                    continue;
                                }
                                // For XML-based libraries, also download the companion .jar file
                                if (fileName.toLowerCase().endsWith('.xml')) {
                                    const jarUrl = downloadUrl.replace(/\.xml$/i, '.jar');
                                    const jarFileName = fileName.replace(/\.xml$/i, '.jar');
                                    const jarDest = path.join(destFolder, jarFileName);
                                    const jarOk = await new Promise<boolean>((resolve) => {
                                        const jarFile = fs.createWriteStream(jarDest);
                                        const jarReq = https.get(jarUrl, { timeout: 30000 }, (jarRes) => {
                                            if ((jarRes.statusCode ?? 0) >= 300 && (jarRes.statusCode ?? 0) < 400 && jarRes.headers.location) {
                                                const jarRedirect = https.get(jarRes.headers.location, { timeout: 30000 }, (jarRes2) => {
                                                    jarRes2.pipe(jarFile);
                                                    jarFile.on('finish', () => { jarFile.close(() => { resolve(true); }); });
                                                });
                                                jarRedirect.on('error', () => { jarFile.close(); fs.unlink(jarDest, () => {}); resolve(false); });
                                                jarRedirect.setTimeout(30000, () => { jarRedirect.destroy(); jarFile.close(); fs.unlink(jarDest, () => {}); resolve(false); });
                                            } else {
                                                jarRes.pipe(jarFile);
                                                jarFile.on('finish', () => { jarFile.close(() => { resolve(true); }); });
                                            }
                                        });
                                        jarReq.on('error', () => { jarFile.close(); fs.unlink(jarDest, () => {}); resolve(false); });
                                        jarReq.setTimeout(30000, () => { jarReq.destroy(); jarFile.close(); fs.unlink(jarDest, () => {}); resolve(false); });
                                    });
                                    if (!jarOk) {
                                        fs.unlink(destPath, () => {});
                                        skipped++;
                                        continue;
                                    }
                                }
                                if (cancelled) break;
                                downloaded++;
                                downloadedFiles.push(fileName);
                                if (fileName.toLowerCase().endsWith('.xml')) {
                                    downloadedFiles.push(fileName.replace(/\.xml$/i, '.jar'));
                                }
                                // Extract version from the downloaded file
                                const ext = fileName.toLowerCase();
                                let version = '';
                                if (ext.endsWith('.b4xlib')) {
                                    version = await extractB4xlibVersion(destPath);
                                } else if (ext.endsWith('.xml')) {
                                    version = extractXmlVersion(destPath);
                                }
                                if (version) {
                                    updatedVersions.push({ name: lib.name, version });
                                    const rawLib = this._rawLibraries.find(l => l.name.toLowerCase() === lib.name.toLowerCase());
                                    if (rawLib) { rawLib.version = version; }
                                }
                            }
                            // Update catalog entries with extracted versions (single batch, fires onDidChange once)
                            if (updatedVersions.length > 0 && this._libraryCatalog) {
                                for (const { name, version } of updatedVersions) {
                                    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                                    this._libraryCatalog.updateEntryVersionSilent(key, version);
                                }
                                this._libraryCatalog.fireChanged();
                            }
                            if (cancelled) {
                                let msg = `Cancelled. Downloaded ${downloaded} librar${downloaded === 1 ? 'y' : 'ies'} before cancellation.`;
                                if (downloadedFiles.length > 0) { msg += '\n' + downloadedFiles.map(f => `• ${f}`).join('\n'); }
                                if (skipped > 0) { msg += `\n${skipped} skipped.`; }
                                void vscode.window.showInformationMessage(msg);
                            } else if (downloaded > 0) {
                                let msg = `Updated ${downloaded} librar${downloaded === 1 ? 'y' : 'ies'}.`;
                                if (downloadedFiles.length > 0) { msg += '\n' + downloadedFiles.map(f => `• ${f}`).join('\n'); }
                                if (skipped > 0) { msg += `\n${skipped} skipped (unavailable).`; }
                                void vscode.window.showInformationMessage(msg);
                            } else {
                                void vscode.window.showWarningMessage(`No libraries could be downloaded.${skipped > 0 ? ` ${skipped} skipped.` : ''}`);
                            }
                        }
                    );
                }
                for (const lib of forumOnly) {
                    if (lib.forum_thread) {
                        const uri = vscode.Uri.parse(lib.forum_thread);
                        await vscode.env.openExternal(uri);
                    }
                }
                if (downloadable.length === 0 && forumOnly.length > 0) {
                    void vscode.window.showInformationMessage(`Opened ${forumOnly.length} forum page${forumOnly.length > 1 ? 's' : ''} for download.`);
                }
            }
        });

        // Now set the HTML — the message handler is already registered so
        // the webviewReady message will be received.
        const html = this._getHtmlForWebview(webviewView.webview, this._pendingLibraries, this._pendingProjectFiles);
        debugLog('Setting webview HTML (length:', html.length, 'chars)');
        webviewView.webview.html = html;
        debugLog('HTML set, waiting for webview to load...');

        // Re-push stored data whenever the webview becomes visible again
        // (VS Code may destroy and recreate sidebar webviews when switching tabs)
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Skip re-sending if the data hasn't changed since last delivery
                const libSig = this._dataSignature(this._pendingLibraries);
                const fileSig = this._dataSignature(this._pendingProjectFiles);
                if (libSig === this._lastDeliveredLibSignature && fileSig === this._lastDeliveredFilesSignature) {
                    debugLog('onDidChangeVisibility: data unchanged, skipping re-send');
                    return;
                }
                this.pushStoredData();
            }
        });

        // Push any pending data immediately after HTML is set.
        // This will be a no-op if webviewReady hasn't been received yet, but
        // the onDidChangeVisibility and webviewReady handlers will push data later.
        debugLog('Before pushStoredData, pendingLibraries:', this._pendingLibraries.length, 'pendingProjectFiles:', this._pendingProjectFiles.length);
        this.pushStoredData();

        // Safety fallback: if webviewReady never arrives (e.g. script load failure),
        // force data through after 3 seconds so the dashboard isn't permanently empty.
        setTimeout(() => {
            if (!this._webviewReady && this._view) {
                debugLog('webviewReady fallback: forcing pushStoredData after 3s timeout');
                this._webviewReady = true;
                this.pushStoredData();
            }
        }, 3000);

        debugLog('resolveWebviewView complete');
    }

    /** Re-send both libraries and project files to the webview. */
    private pushStoredData(): void {
        debugLog('pushStoredData called, webviewReady:', this._webviewReady);
        if (!this._view) {
            debugLog('pushStoredData: no view available');
            return;
        }
        if (!this._webviewReady) {
            debugLog('pushStoredData: webview not ready yet, will push when ready');
            return;
        }
        debugLog('pushStoredData: sending', this._pendingLibraries.length, 'libs,', this._pendingProjectFiles.length, 'files');
        this._safePostMessage({ type: 'updateLibraries', libraries: this._pendingLibraries });
        this._safePostMessage({ type: 'updateProjectFiles', files: this._pendingProjectFiles });
        // Mark as delivered so onDidChangeVisibility doesn't re-send unchanged data
        this._lastDeliveredLibSignature = this._dataSignature(this._pendingLibraries);
        this._lastDeliveredFilesSignature = this._dataSignature(this._pendingProjectFiles);
    }

    /** Cheap signature for change detection — avoids re-sending identical data on visibility changes. */
    private _dataSignature(data: unknown[]): string {
        return `${data.length}:${data.length > 0 ? JSON.stringify(data[0]).length : 0}`;
    }

    private _lastDeliveredLibSignature: string = '';
    private _lastDeliveredFilesSignature: string = '';

    private _safePostMessage(message: unknown): void {
        try {
            if (!this._view) {
                debugLog('_safePostMessage: no view available');
                return;
            }
            debugLog('_safePostMessage:', JSON.stringify(message).substring(0, 100));
            this._view.webview.postMessage(message).then(
                (result) => debugLog('_safePostMessage success:', result),
                (error) => debugLog('_safePostMessage error:', error)
            );
        } catch (err) {
            debugLog('_safePostMessage exception:', err);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, initialLibraries: { name: string; version: string; onlineVersion: string; source: string; path: string; used: boolean; forum_thread?: string; library_file?: string }[] = [], initialProjectFiles: ProjectFileEntry[] = []): string {
        const nonce = crypto.randomBytes(16).toString('hex');

        const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.min.css'));
        const twUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'tailwind.min.js'));
        const remixiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'remixicon.css'));

        // CSP: allow only local resources + nonce-gated inline script
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
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
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 0;
            margin: 0;
        }
        /* Override DaisyUI table to match VS Code theme */
        .table { background: transparent; color: inherit; }
        .table tr:nth-child(even) td { background: var(--vscode-list-hoverBackground); }
        .table thead th {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tabs { background: var(--vscode-editorGroupHeader-tabsBackground); border-radius: 0; }
        .empty-msg { padding: 1rem; opacity: 0.6; }
        /* Auto-fit table columns: checkbox/version/online/source shrink to content,
           Library column takes remaining space */
        .table.table-sm { table-layout: auto; }
        .table.table-sm th, .table.table-sm td { padding: 0.375rem 0.5rem; }
        .table.table-sm .col-library { width: 100%; }
        .table.table-sm .col-shrink { width: 1px; white-space: nowrap; }
        /* DaisyUI menu-sm styles are in @layer which VS Code overrides.
           Re-declare at root specificity so sizing actually applies. */
        .menu.menu-sm li:not(.menu-title) > :not(ul, details, .menu-title),
        .menu.menu-sm li:not(.menu-title) > details > summary:not(.menu-title) {
            padding-block: 0.25rem;
            padding-inline: 0.625rem;
            border-radius: var(--radius-field, 4px);
        }
        /* DaisyUI tabs-box fallback: ensure only the checked tab's content is visible.
           The bundled daisyui.css may not include the full tabs module in webviews. */
        .tabs-box > .tab-content {
            display: none;
            width: 100%;
        }
        .tabs-box > input[type="radio"].tab:checked + .tab-content {
            display: block;
        }
    </style>
</head>
<body>
    <div class="tabs tabs-box w-full rounded-none">
        <input id="tab-libraries" type="radio" checked="checked" name="dashboard-tabs" class="tab" aria-label="Libraries" />
        <div class="tab-content p-2">
            <div class="flex items-center gap-2 mb-2">
                <input id="lib-search" type="search" placeholder="Filter libraries…" class="input input-bordered input-sm flex-1" />
                <button id="lib-update-btn" class="btn btn-sm" disabled title="Download updated versions of libraries with newer online versions">
                    Update <span id="lib-update-count" class="badge badge-sm badge-warning ml-1">0</span>
                </button>
                <button id="lib-missing-btn" class="btn btn-sm" disabled title="Search B4X website for missing libraries">
                    Missing <span id="lib-missing-count" class="badge badge-sm badge-error ml-1">0</span>
                </button>
            </div>
            <div class="overflow-x-auto">
                <table class="table table-sm w-full">
                    <thead>
                        <tr>
                            <th class="col-shrink"></th>
                            <th class="col-library">Library</th>
                            <th class="col-shrink" style="text-align:right">Version</th>
                            <th class="col-shrink" style="text-align:right">Online</th>
                            <th class="col-shrink">Source</th>
                        </tr>
                    </thead>
                    <tbody id="library-tbody">
                        <tr><td colspan="5" class="empty-msg">No project loaded.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <input id="tab-files" type="radio" name="dashboard-tabs" class="tab" aria-label="Files" />
        <div class="tab-content p-2">
            <ul class="menu menu-sm bg-base-200 rounded-box w-full" id="files-tree">
                <li><p class="empty-msg">No project loaded.</p></li>
            </ul>
        </div>
    </div>

    <!-- Hidden input to persist the selected tab across webview reloads -->
    <input type="hidden" id="dashboard-selected-tab" value="tab-libraries" />

    <script nonce="${nonce}">
        // Webview debug logging
        function webviewDebugLog() {
            var args = Array.prototype.slice.call(arguments);
            console.log.apply(console, ['[Webview] ' + new Date().toISOString()].concat(args));
        }

        webviewDebugLog('Webview script starting...');

        // Acquire the VS Code API and notify the extension host immediately.
        // This MUST happen before any other JS so the handshake works even if
        // later code throws. acquireVsCodeApi() can only be called once.
        var vscode;
        try {
            vscode = acquireVsCodeApi();
            vscode.postMessage({ type: 'webviewReady' });
            webviewDebugLog('webviewReady message sent');
        } catch (e) {
            console.error('[Webview] Failed to acquire VS Code API or send ready message:', e);
        }

        var initialLibraries = ${JSON.stringify(initialLibraries)};
        var initialProjectFiles = ${JSON.stringify(initialProjectFiles)};
        webviewDebugLog('initialLibraries:', initialLibraries.length, 'initialProjectFiles:', initialProjectFiles.length);

        // State for libraries toolbar (search + update)
        var allLibraries = [];
        var currentSearchTerm = '';

        function updateUpdateButton() {
            var count = 0;
            for (var i = 0; i < allLibraries.length; i++) {
                var lib = allLibraries[i];
                var localVer = parseFloat(lib.version) || 0;
                var onlineVer = parseFloat(lib.onlineVersion) || 0;
                if (onlineVer > localVer && onlineVer > 0) {
                    count++;
                }
            }
            var btn = document.getElementById('lib-update-btn');
            var badge = document.getElementById('lib-update-count');
            if (btn && badge) {
                badge.textContent = count;
                btn.disabled = (count === 0);
            }
        }

        function updateMissingButton() {
            var count = 0;
            for (var i = 0; i < allLibraries.length; i++) {
                if (allLibraries[i].source === 'Missing') {
                    count++;
                }
            }
            var btn = document.getElementById('lib-missing-btn');
            var badge = document.getElementById('lib-missing-count');
            if (btn && badge) {
                badge.textContent = count;
                btn.disabled = (count === 0);
            }
        }

        function filterLibraries() {
            if (!currentSearchTerm) {
                renderLibraries(allLibraries, false);
            } else {
                var term = currentSearchTerm.toLowerCase();
                var filtered = [];
                for (var i = 0; i < allLibraries.length; i++) {
                    var lib = allLibraries[i];
                    if (lib.name.toLowerCase().indexOf(term) !== -1 ||
                        (lib.source && lib.source.toLowerCase().indexOf(term) !== -1)) {
                        filtered.push(lib);
                    }
                }
                renderLibraries(filtered, false);
            }
        }

        // Explicit tab-switching fallback: when a radio changes, ensure only its
        // adjacent content div is visible. This compensates for DaisyUI tabs-box
        // CSS not always working inside VS Code webviews.
        (function() {
            const tabs = document.getElementsByName('dashboard-tabs');
            const updateTabVisibility = function() {
                for (let i = 0; i < tabs.length; i++) {
                    const tab = tabs[i];
                    const content = tab.nextElementSibling;
                    if (content && content.classList.contains('tab-content')) {
                        content.style.display = tab.checked ? 'block' : 'none';
                    }
                }
            };
            for (let i = 0; i < tabs.length; i++) {
                tabs[i].addEventListener('change', function() {
                    localStorage.setItem('b4xDashboardActiveTab', this.id);
                    updateTabVisibility();
                });
            }
            // Restore the last selected tab from localStorage
            const lastTab = localStorage.getItem('b4xDashboardActiveTab');
            if (lastTab) {
                const target = document.getElementById(lastTab);
                if (target) {
                    target.checked = true;
                }
            }
            updateTabVisibility();
        })();

        // Wire up search input
        var libSearchInput = document.getElementById('lib-search');
        if (libSearchInput) {
            libSearchInput.addEventListener('input', function() {
                currentSearchTerm = libSearchInput.value;
                filterLibraries();
            });
        }

        // Wire up update button
        var libUpdateBtn = document.getElementById('lib-update-btn');
        if (libUpdateBtn) {
            libUpdateBtn.addEventListener('click', function() {
                var toUpdate = [];
                for (var i = 0; i < allLibraries.length; i++) {
                    var lib = allLibraries[i];
                    var localVer = parseFloat(lib.version) || 0;
                    var onlineVer = parseFloat(lib.onlineVersion) || 0;
                    if (onlineVer > localVer && onlineVer > 0) {
                        toUpdate.push({ name: lib.name, forum_thread: lib.forum_thread || '', library_file: lib.library_file || '', path: lib.path || '', source: lib.source || '' });
                    }
                }
                if (toUpdate.length > 0) {
                    vscode.postMessage({ type: 'updateLibraries', libraries: toUpdate });
                }
            });
        }

        // Wire up missing button
        var libMissingBtn = document.getElementById('lib-missing-btn');
        if (libMissingBtn) {
            libMissingBtn.addEventListener('click', function() {
                var missing = [];
                for (var i = 0; i < allLibraries.length; i++) {
                    if (allLibraries[i].source === 'Missing') {
                        missing.push(allLibraries[i].name);
                    }
                }
                if (missing.length > 0) {
                    vscode.postMessage({ type: 'searchMissingLibraries', names: missing });
                }
            });
        }

        // Store project files in localStorage for persistence across webview reloads
        function storeProjectFiles(files) {
            if (files && files.length > 0) {
                localStorage.setItem('b4xDashboardProjectFiles', JSON.stringify(files));
            }
        }

        // Restore project files from localStorage
        function restoreProjectFiles() {
            const stored = localStorage.getItem('b4xDashboardProjectFiles');
            if (stored) {
                try {
                    return JSON.parse(stored);
                } catch (e) {
                    localStorage.removeItem('b4xDashboardProjectFiles');
                }
            }
            return null;
        }

        // Clear stored project files (call when project changes)
        function clearProjectFilesStorage() {
            localStorage.removeItem('b4xDashboardProjectFiles');
        }

        function renderLibraries(libs, isFullSet) {
            webviewDebugLog('=== renderLibraries START ===');
            webviewDebugLog('renderLibraries called with', libs ? libs.length : 0, 'libraries');
            if (isFullSet) {
                allLibraries = libs ? libs.slice() : [];
                updateUpdateButton();
                updateMissingButton();
            }
            if (libs && libs.length > 0) {
                webviewDebugLog('renderLibraries: first lib sample:', JSON.stringify(libs[0]).substring(0, 200));
            }
            var tbody = document.getElementById('library-tbody');
            webviewDebugLog('renderLibraries: tbody element:', tbody ? 'FOUND' : 'NOT FOUND');
            if (!tbody) {
                webviewDebugLog('renderLibraries: ABORT - tbody not found in DOM');
                return;
            }
            webviewDebugLog('renderLibraries: clearing tbody, current childCount:', tbody.childNodes.length);
            while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
            // Sort: checked (used) libraries first, then unchecked
            if (libs && libs.length > 0) {
                libs = libs.slice().sort(function(a, b) {
                    if (a.used && !b.used) { return -1; }
                    if (!a.used && b.used) { return 1; }
                    return a.name.localeCompare(b.name);
                });
            }
            if (!libs || libs.length === 0) {
                webviewDebugLog('renderLibraries: no libs, rendering empty message');
                var emptyTr = document.createElement('tr');
                var emptyTd = document.createElement('td');
                emptyTd.colSpan = 5;
                emptyTd.className = 'empty-msg';
                emptyTd.textContent = 'No libraries found for this project.';
                emptyTr.appendChild(emptyTd);
                tbody.appendChild(emptyTr);
                return;
            }
            webviewDebugLog('renderLibraries: rendering', libs.length, 'library rows...');
            for (var i = 0; i < libs.length; i++) {
                var lib = libs[i];
                var tr = document.createElement('tr');

                var checkTd = document.createElement('td');
                checkTd.className = 'col-shrink';
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'checkbox checkbox-sm';
                checkbox.checked = !!lib.used;
                checkbox.title = lib.used ? 'Library is referenced in project' : 'Library found on disk but not referenced in project';
                checkbox.disabled = true;
                checkTd.appendChild(checkbox);
                tr.appendChild(checkTd);

                var nameTd = document.createElement('td');
                nameTd.className = 'col-library';
                // Make library name clickable to open forum thread
                var nameSpan = document.createElement('span');
                nameSpan.textContent = lib.name;
                if (lib.source === 'Missing' && lib.forum_thread) {
                    nameSpan.className = 'link link-hover';
                    nameSpan.addEventListener('click', (function(ft) {
                        return function(e) {
                            e.stopPropagation();
                            vscode.postMessage({ type: 'openForumThread', forum_thread: ft });
                        };
                    })(lib.forum_thread));
                    nameSpan.title = 'Click to open forum thread';
                } else if (lib.source === 'Missing') {
                    nameSpan.className = 'link link-hover';
                    nameSpan.addEventListener('click', (function(ln) {
                        return function(e) {
                            e.stopPropagation();
                            vscode.postMessage({ type: 'searchMissingLibrary', name: ln });
                        };
                    })(lib.name));
                    nameSpan.title = 'Click to search B4X website';
                } else if (lib.forum_thread) {
                    nameSpan.className = 'link link-hover';
                    nameSpan.addEventListener('click', (function(ft) {
                        return function(e) {
                            e.stopPropagation();
                            vscode.postMessage({ type: 'openForumThread', forum_thread: ft });
                        };
                    })(lib.forum_thread));
                    nameSpan.title = 'Click to open forum thread';
                }
                nameTd.appendChild(nameSpan);
                tr.appendChild(nameTd);

                var versionTd = document.createElement('td');
                versionTd.className = 'col-shrink';
                versionTd.style.textAlign = 'right';
                versionTd.textContent = lib.version || '—';
                tr.appendChild(versionTd);

                var onlineTd = document.createElement('td');
                onlineTd.className = 'col-shrink';
                onlineTd.style.textAlign = 'right';
                var onlineVersion = lib.onlineVersion || '';
                var localVer = parseFloat(lib.version) || 0;
                var onlineVer = parseFloat(onlineVersion) || 0;
                if (onlineVer > localVer && onlineVer > 0) {
                    var onlineBadge = document.createElement('span');
                    onlineBadge.className = 'badge badge-sm badge-warning';
                    onlineBadge.textContent = onlineVersion;
                    onlineTd.appendChild(onlineBadge);
                } else if (onlineVersion) {
                    var onlineSpan = document.createElement('span');
                    onlineSpan.textContent = onlineVersion;
                    onlineTd.appendChild(onlineSpan);
                } else {
                    var emptyTd = document.createElement('span');
                    emptyTd.textContent = '—';
                    emptyTd.style.color = 'var(--vscode-descriptionForeground)';
                    onlineTd.appendChild(emptyTd);
                }
                tr.appendChild(onlineTd);

                var sourceTd = document.createElement('td');
                sourceTd.className = 'col-shrink';
                if (lib.source === 'Missing') {
                    var sourceBadge = document.createElement('span');
                    sourceBadge.className = 'badge badge-sm badge-error';
                    sourceBadge.textContent = 'Missing';
                    sourceTd.appendChild(sourceBadge);
                } else {
                    sourceTd.textContent = lib.source || '—';
                }
                sourceTd.title = lib.path || '';
                tr.appendChild(sourceTd);

                tbody.appendChild(tr);
            }
            webviewDebugLog('renderLibraries: DONE, tbody childCount:', tbody.childNodes.length);
        }

        var CODE_EXTS = ['bal', 'xml', 'json', 'html', 'css', 'js', 'ts', 'java', 'kt', 'gradle', 'yaml', 'yml', 'toml', 'properties', 'txt', 'md', 'cs', 'py', 'sh', 'bat', 'xaml', 'axml', 'manifest', 'cfg', 'ini', 'conf', 'gradle', 'pro', 'cmake', 'make', 'dockerfile', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'm', 'mm', 'swift', 'dart', 'lua', 'rb', 'php', 'pl', 'r', 'sql', 'vue', 'svelte', 'astro'];
        var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'tif', 'avif', 'svg', 'heic', 'heif', 'raw', 'psd', 'ai', 'eps'];
        var AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'midi', 'mid', 'opus', 'aiff', 'aif'];
        var VIDEO_EXTS = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v', 'mpg', 'mpeg', 'vob'];
        var FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'eot'];
        var DATA_EXTS = ['csv', 'xls', 'xlsx', 'mdb', 'db', 'sqlite', 'sql', 'tsv', 'dbf', 'accdb', 'jsonl', 'ndjson', 'parquet'];
        var ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar', 'apk', 'aab', 'war', 'ear', 'tgz', 'zst'];
        var PDF_EXTS = ['pdf'];

        function getIconClass(ext) {
            if (CODE_EXTS.indexOf(ext) !== -1) return 'ri-file-code-line';
            if (IMAGE_EXTS.indexOf(ext) !== -1) return 'ri-image-line';
            if (AUDIO_EXTS.indexOf(ext) !== -1) return 'ri-music-line';
            if (VIDEO_EXTS.indexOf(ext) !== -1) return 'ri-video-line';
            if (PDF_EXTS.indexOf(ext) !== -1) return 'ri-file-pdf-line';
            if (FONT_EXTS.indexOf(ext) !== -1) return 'ri-file-line';
            if (DATA_EXTS.indexOf(ext) !== -1) return 'ri-database-2-line';
            if (ARCHIVE_EXTS.indexOf(ext) !== -1) return 'ri-archive-line';
            return 'ri-file-line';
        }

        function createIconSpan(iconClass) {
            var span = document.createElement('span');
            span.className = 'inline-flex items-center mr-1';
            var icon = document.createElement('i');
            icon.className = iconClass;
            icon.style.fontSize = '14px';
            icon.style.lineHeight = '1';
            span.appendChild(icon);
            return span;
        }

        // Render any data that was available when the view first resolved.
        webviewDebugLog('initialLibraries count:', initialLibraries.length);
        webviewDebugLog('initialProjectFiles count:', initialProjectFiles.length);
        if (initialLibraries.length > 0) { renderLibraries(initialLibraries, true); }
        if (initialProjectFiles.length > 0) {
            renderProjectFiles(initialProjectFiles);
            storeProjectFiles(initialProjectFiles);
        } else {
            // No initial files provided - try to restore from localStorage
            webviewDebugLog('No initial files, checking localStorage for project files');
            var restoredFiles = restoreProjectFiles();
            if (restoredFiles) {
                webviewDebugLog('Restored', restoredFiles.length, 'files from localStorage');
                renderProjectFiles(restoredFiles);
            } else {
                webviewDebugLog('No files in localStorage either');
            }
        }

        function renderProjectFiles(files) {
            webviewDebugLog('=== renderProjectFiles START ===');
            webviewDebugLog('renderProjectFiles called with', files ? files.length : 0, 'files');
            if (files && files.length > 0) {
                webviewDebugLog('renderProjectFiles: first file sample:', JSON.stringify(files[0]).substring(0, 200));
            }
            var tree = document.getElementById('files-tree');
            webviewDebugLog('renderProjectFiles: tree element:', tree ? 'FOUND' : 'NOT FOUND');
            if (!tree) {
                webviewDebugLog('renderProjectFiles: ABORT - files-tree not found in DOM');
                return;
            }
            webviewDebugLog('renderProjectFiles: clearing tree, current childCount:', tree.childNodes.length);
            while (tree.firstChild) { tree.removeChild(tree.firstChild); }

            if (!files || files.length === 0) {
                webviewDebugLog('renderProjectFiles: no files, rendering empty message');
                var emptyP = document.createElement('p');
                emptyP.className = 'empty-msg';
                emptyP.textContent = 'No project files found.';
                var emptyLi = document.createElement('li');
                emptyLi.appendChild(emptyP);
                tree.appendChild(emptyLi);
                return;
            }

            var groups = {};
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var ext = f.extension || 'other';
                if (!groups[ext]) groups[ext] = [];
                groups[ext].push(f);
            }

            var sortedExts = Object.keys(groups).sort();
            var totalFiles = files.length;
            var totalGroups = sortedExts.length;
            webviewDebugLog('renderProjectFiles: grouped into', totalGroups, 'extensions, total files:', totalFiles);
            for (var ei = 0; ei < sortedExts.length; ei++) {
                var ext = sortedExts[ei];
                var items = groups[ext].sort(function(a, b) { return a.name.localeCompare(b.name); });
                var iconClass = getIconClass(ext);

                var details = document.createElement('details');
                details.open = false;
                var summary = document.createElement('summary');
                summary.appendChild(createIconSpan(iconClass));
                summary.appendChild(document.createTextNode(ext + ' (' + items.length + ')'));
                details.appendChild(summary);

                var subUl = document.createElement('ul');
                for (var fi = 0; fi < items.length; fi++) {
                    var item = items[fi];
                    var li = document.createElement('li');
                    if (!item.exists) { li.className = 'menu-disabled'; }

                    var a = document.createElement('a');
                    a.appendChild(createIconSpan(iconClass));
                    a.appendChild(document.createTextNode(' ' + item.name));
                    a.href = '#';
                    a.addEventListener('click', (function(filePath) {
                        return function(e) {
                            e.preventDefault();
                            vscode.postMessage({ type: 'openFile', path: filePath });
                        };
                    })(item.absolutePath));

                    li.appendChild(a);
                    subUl.appendChild(li);
                }

                details.appendChild(subUl);
                var outerLi = document.createElement('li');
                outerLi.appendChild(details);
                tree.appendChild(outerLi);
            }

            webviewDebugLog('renderProjectFiles: DONE, tree childCount:', tree.childNodes.length);
            vscode.postMessage({ type: 'showInfo', text: 'B4X: ' + totalFiles + ' files loaded (' + totalGroups + ' groups)' });
        }

        webviewDebugLog('Registering message listener on window...');
        window.addEventListener('message', (event) => {
            try {
                const message = event.data;
                webviewDebugLog('>>> Message received, type:', message.type, 'keys:', Object.keys(message).join(','));
                if (message.type === 'updateLibraries') {
                    webviewDebugLog('updateLibraries: count=', message.libraries ? message.libraries.length : 0);
                    if (message.libraries && message.libraries.length > 0) {
                        webviewDebugLog('updateLibraries: first entry:', JSON.stringify(message.libraries[0]).substring(0, 300));
                    }
                    renderLibraries(message.libraries, true);
                    webviewDebugLog('updateLibraries: renderLibraries call completed');
                }
                if (message.type === 'updateProjectFiles') {
                    webviewDebugLog('updateProjectFiles: count=', message.files ? message.files.length : 0);
                    if (message.files && message.files.length > 0) {
                        webviewDebugLog('updateProjectFiles: first entry:', JSON.stringify(message.files[0]).substring(0, 300));
                    }
                    renderProjectFiles(message.files);
                    webviewDebugLog('updateProjectFiles: renderProjectFiles call completed');
                    storeProjectFiles(message.files);
                }
                if (message.type === 'clearProjectFilesStorage') {
                    clearProjectFilesStorage();
                }
            } catch (err) {
                webviewDebugLog('Message handler error:', err.message || err, 'stack:', err.stack || 'no stack');
            }
        });
        webviewDebugLog('=== Webview script fully loaded, message listener registered ===');
    </script>
</body>
</html>`;
    }

    /** Reveal the view in the secondary sidebar. */
    public show(): void {
        if (this._view) {
            this._view.show(true);
            // Ensure data is pushed when user explicitly opens the dashboard
            this.pushStoredData();
        } else {
            // View not ready - silent fail
        }
    }

    /** Push library data into the webview. Safe to call before the view resolves. */
    public postLibraries(libs: { name: string; version: string; onlineVersion: string; source: string; path: string; used: boolean; forum_thread?: string; library_file?: string }[]): void {
        debugLog('postLibraries called with', libs.length, 'libraries');
        // Store raw libraries for re-enrichment when catalog changes
        this._rawLibraries = libs.map(lib => ({ name: lib.name, version: lib.version, onlineVersion: lib.onlineVersion, source: lib.source, path: lib.path, used: lib.used }));
        if (this._libraryCatalog) {
            debugLog('Library catalog has', this._libraryCatalog.getEntries().length, 'entries');
        } else {
            debugLog('Library catalog is NOT set!');
        }
        // Enrich libraries with catalog info (Google Sheet version and forum thread)
        const enrichedLibs = libs.map(lib => {
            if (this._libraryCatalog) {
                // Find matching entry in catalog
                const entries = this._libraryCatalog.getEntries();
                for (const entry of entries) {
                    if (entry.name.toLowerCase() === lib.name.toLowerCase()) {
                        // Update: onlineVersion = version from Google Sheet (or empty if not found)
                        // The forum_thread is also added if available
                        return {
                            ...lib,
                            onlineVersion: entry.version || '',
                            forum_thread: entry.forum_thread,
                            library_file: entry.library_file || ''
                        };
                    }
                }
            }
            return lib;
        });
        this._pendingLibraries = enrichedLibs;
        debugLog('postLibraries: enriched libs count:', enrichedLibs.length);
        debugLog('First few enriched libs:', enrichedLibs.slice(0, 3).map(l => ({ name: l.name, onlineVersion: l.onlineVersion, forum_thread: l.forum_thread ? 'yes' : 'no' })));
        this.pushStoredData();
    }

    /** Push project file data into the webview. Safe to call before the view resolves. */
    public postProjectFiles(files: ProjectFileEntry[]): void {
        debugLog('postProjectFiles called with', files.length, 'files');
        this._pendingProjectFiles = files;
        this.pushStoredData();
    }

    /** Clear stored project files from localStorage. */
    public clearProjectFilesStorage(): void {
        this._safePostMessage({ type: 'clearProjectFilesStorage' });
    }

    /** Set the library catalog reference for fetching library info. */
    public setLibraryCatalog(catalog: LibraryCatalog): void {
        this._libraryCatalog = catalog;
        this._catalogDisposable?.dispose();
        this._catalogDisposable = catalog.onDidChange(() => {
            debugLog('Catalog changed — re-enriching libraries');
            if (this._rawLibraries.length > 0) {
                this.postLibraries(this._rawLibraries);
            }
        });
    }

    /** Set the library folder paths so downloads are routed to the correct location. */
    public setLibraryFolders(internal: string, additional: string): void {
        this._internalLibrariesFolder = internal;
        this._additionalLibrariesFolder = additional;
    }

}

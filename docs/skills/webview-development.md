# B4X IntelliSense — Webview Development Skill

> Comprehensive guide for building, debugging, and extending webviews in this extension.
> Covers event trapping, real-time updates, lessons learned, loopholes, and patterns for
> adding new JavaScript-based tools as webviews.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Webview Types in This Extension](#2-webview-types-in-this-extension)
3. [Content Security Policy (CSP)](#3-content-security-policy-csp)
4. [Message Protocol — Extension ↔ Webview](#4-message-protocol--extension--webview)
5. [Event Trapping & Handling](#5-event-trapping--handling)
6. [Real-Time Updates](#6-real-time-updates)
7. [State Persistence & Restoration](#7-state-persistence--restoration)
8. [Styling & Theming](#8-styling--theming)
9. [Lessons Learned](#9-lessons-learned)
10. [Known Loopholes & Pitfalls](#10-known-loopholes--pitfalls)
11. [Adding a New JavaScript Tool as a Webview](#11-adding-a-new-javascript-tool-as-a-webview)
12. [Checklist — New Webview Pre-Flight](#12-checklist--new-webview-pre-flight)

---

## 1. Architecture Overview

This extension uses **two distinct webview patterns**:

| Pattern | Class | Location | Webview Type | Container |
|---------|-------|----------|-------------|-----------|
| Sidebar Dashboard | `CompanionDashboardProvider` | `src/providers/CompanionDashboardProvider.ts` | `WebviewView` (sidebar) | Secondary sidebar |
| Editor Panel | `LibraryBrowserProvider` | `src/providers/libraryBrowserProvider.ts` | `WebviewPanel` (editor tab) | Editor area |

Both follow the same fundamental architecture:

```
┌─────────────────────────────────────────────────────────┐
│  Extension Host (Node.js)                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Provider Class                                    │  │
│  │  • Holds state (_pendingLibraries, etc.)           │  │
│  │  • Registers message handler BEFORE setting HTML   │  │
│  │  • Manages lifecycle (dispose, visibility)          │  │
│  │  • postMessage() → sends data to webview           │  │
│  │  • onDidReceiveMessage() → receives events          │  │
│  └──────────────┬──────────────────────┬──────────────┘  │
│                 │ postMessage           │ onDidReceiveMessage
│                 ▼                       ▲                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Webview (Browser context)                         │  │
│  │  • acquireVsCodeApi() — called ONCE                │  │
│  │  • Sends 'webviewReady' / 'ready' handshake         │  │
│  │  • window.addEventListener('message', handler)      │  │
│  │  • vscode.postMessage({type, ...data})              │  │
│  │  • DOM rendering (DaisyUI + Tailwind)              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: The extension host and webview run in **separate JavaScript contexts**. They can only communicate through `postMessage` / `onDidReceiveMessage`. There is no shared memory, no shared DOM, and no direct function calls between them.

---

## 2. Webview Types in This Extension

### 2.1 CompanionDashboardProvider — Sidebar WebviewView

- **Registration**: `vscode.window.registerWebviewViewProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })`
- **Lifecycle**: VS Code creates/destroys the view as needed. The `resolveWebviewView()` method is called when the view first becomes visible.
- **Key difference from WebviewPanel**: The sidebar view can be **destroyed and recreated** by VS Code when switching tabs or when the sidebar is hidden/shown. This means:
  - The `_webviewReady` flag must be reset to `false` in `resolveWebviewView()`
  - All state must be stored in the provider (not in the webview JS)
  - A fallback timeout (3 seconds) forces data through if `webviewReady` never arrives

### 2.2 LibraryBrowserProvider — Editor WebviewPanel

- **Creation**: `vscode.window.createWebviewPanel(viewType, title, column, options)`
- **Lifecycle**: Created on-demand via command (`b4xIntellisense.browseLibraries`). Can be revealed if already open.
- **Key difference from WebviewView**: The panel persists until explicitly closed. `retainContextWhenHidden: true` preserves the DOM when the tab is in the background.

### 2.3 When to Use Which

| Use Case | Type | Why |
|----------|------|-----|
| Always-visible sidebar tool | `WebviewView` | Lives in sidebar, auto-managed by VS Code |
| On-demand editor tool | `WebviewPanel` | Opens in editor area, user controls when to open/close |
| Full-screen interactive tool | `WebviewPanel` | Needs more screen real estate than sidebar |

---

## 3. Content Security Policy (CSP)

### 3.1 Current CSP Patterns

**CompanionDashboardProvider** (strict):
```typescript
const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
].join('; ');
```

**LibraryBrowserProvider** (minimal):
```typescript
const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;
```

### 3.2 CSP Rules for This Extension

| Directive | Value | Reason |
|-----------|-------|--------|
| `default-src` | `'none'` | Block everything by default |
| `style-src` | `${webview.cspSource} 'unsafe-inline'` | DaisyUI/Tailwind require inline styles |
| `font-src` | `${webview.cspSource}` | Codicon fonts loaded via webview URI |
| `script-src` | `'nonce-${nonce}'` | Only nonce-tagged scripts execute |
| `img-src` | *(not set — blocked by default-src 'none')* | No images needed currently |

### 3.3 Adding a New Resource Type

If your new webview needs to load images, audio, or other resources:

```typescript
const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data: https:`,  // ← Add this for images
].join('; ');
```

**⚠️ CRITICAL**: Every resource the webview loads MUST be listed in `localResourceRoots` AND in the CSP. Missing either one will cause silent failures.

```typescript
webview.options = {
    enableScripts: true,
    localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'media'),
        vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        // Add any new resource directories here
    ]
};
```

---

## 4. Message Protocol — Extension ↔ Webview

### 4.1 Handshake Protocol

Both webviews implement a **ready handshake** to prevent data loss:

```
Extension Host                          Webview (Browser)
     │                                       │
     │  resolveWebviewView() / show()        │
     │  Register onDidReceiveMessage()       │
     │  Set webview.html                     │
     │                                       │
     │          ◄─── { type: 'webviewReady' } │  ← JS loads, acquireVsCodeApi()
     │                                       │
     │  _webviewReady = true                 │
     │  pushStoredData() ──────────────────► │  ← Data flows only after ready
     │                                       │
```

**Why this matters**: If the extension sends `postMessage` before the webview's JS has loaded and called `acquireVsCodeApi()`, the message is **silently dropped**. The handshake ensures data is only sent after the webview can receive it.

### 4.2 Message Types — CompanionDashboardProvider

#### Extension → Webview

| `type` | Payload | Purpose |
|--------|---------|---------|
| `updateLibraries` | `{ libraries: LibraryInfo[] }` | Push library list to dashboard |
| `updateProjectFiles` | `{ files: ProjectFileEntry[] }` | Push project file tree |
| `clearProjectFilesStorage` | *(none)* | Clear localStorage cache |

#### Webview → Extension

| `type` | Payload | Purpose |
|--------|---------|---------|
| `webviewReady` | *(none)* | Handshake: webview JS has loaded |
| `openFile` | `{ path: string }` | Open a file in VS Code editor |
| `openForumThread` | `{ forum_thread: string }` | Open URL in external browser |
| `showInfo` | `{ text: string }` | Show information message |
| `updateLibraries` | `{ libraries: DownloadableLib[] }` | Download/update selected libraries |

### 4.3 Message Types — LibraryBrowserProvider

#### Extension → Webview

| `type` | Payload | Purpose |
|--------|---------|---------|
| `refresh` | `{ entries: LibraryEntry[] }` | Full data refresh |
| `selectLibrary` | `{ key: string }` | Highlight/select a library |
| `updateVersion` | `{ key, version, versionStatus }` | Update single library version |

#### Webview → Extension

| `type` | Payload | Purpose |
|--------|---------|---------|
| `ready` | *(none)* | Handshake: webview JS has loaded |
| `openExternal` | `{ url: string }` | Open URL in external browser |
| `openReadme` | `{ url: string }` | Fetch and display README |
| `openForum` | `{ url, title }` | Open forum thread |
| `downloadFile` | `{ url: string }` | Download a file |
| `copySnippet` | `{ snippet: string }` | Copy code snippet to clipboard |
| `fetchVersion` | `{ key: string }` | Request version lookup for a library |

### 4.4 Message Design Guidelines

1. **Always include a `type` field** — it's the only way to route messages
2. **Use past-tense for events** (`webviewReady`, not `webviewIsReady`)
3. **Keep payloads flat** — avoid deeply nested objects; they serialize poorly
4. **Validate on both sides** — never trust data from the webview; never trust data from the extension
5. **Use discriminated unions** in TypeScript for type safety:

```typescript
// Extension → Webview messages
type ExtensionMessage =
    | { type: 'updateLibraries'; libraries: LibraryInfo[] }
    | { type: 'updateProjectFiles'; files: ProjectFileEntry[] }
    | { type: 'clearProjectFilesStorage' };

// Webview → Extension messages
type WebviewMessage =
    | { type: 'webviewReady' }
    | { type: 'openFile'; path: string }
    | { type: 'openForumThread'; forum_thread: string };
```

---

## 5. Event Trapping & Handling

### 5.1 The Registration Order Bug (CRITICAL)

**Problem**: If you set `webview.html` BEFORE registering `onDidReceiveMessage`, the webview JS can execute and send the `webviewReady` message before the handler is registered. The message is **silently lost**, and the dashboard stays empty.

**Solution** (already implemented in CompanionDashboardProvider):

```typescript
public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    this._webviewReady = false;

    // 1. Set options FIRST
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [...] };

    // 2. Register message handler BEFORE setting HTML
    webviewView.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'webviewReady') {
            this._webviewReady = true;
            this.pushStoredData();
        }
        // ... other handlers
    });

    // 3. NOW set the HTML — handler is ready to receive webviewReady
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, ...);
}
```

**⚠️ NEVER reverse steps 2 and 3.** This is the #1 cause of "empty webview" bugs.

### 5.2 Safe postMessage Pattern

`postMessage` returns a `Thenable<boolean>`, but the webview can be disposed between the null-check and the actual send, causing an exception:

```typescript
// ❌ UNSAFE — can throw if panel is disposed mid-call
this.panel.webview.postMessage(message);

// ✅ SAFE — catches disposal errors
private safePostMessage(message: unknown): void {
    try {
        this.panel?.webview.postMessage(message);
    } catch {
        // webview may have been disposed between the null-check and postMessage
    }
}
```

### 5.3 The 3-Second Fallback Timer

If the `webviewReady` message never arrives (e.g., script load failure, CSP blocking), the dashboard would remain permanently empty. The CompanionDashboardProvider includes a safety net:

```typescript
setTimeout(() => {
    if (!this._webviewReady && this._view) {
        debugLog('webviewReady fallback: forcing pushStoredData after 3s timeout');
        this._webviewReady = true;
        this.pushStoredData();
    }
}, 3000);
```

**When to use**: Any webview that relies on a handshake should include a fallback timer. 3 seconds is a reasonable default.

### 5.4 Visibility Change Handling

Sidebar webviews can be destroyed and recreated when switching tabs. The `onDidChangeVisibility` handler re-sends data:

```typescript
webviewView.onDidChangeVisibility(() => {
    if (webviewView.visible) {
        // Skip re-sending if data hasn't changed
        const libSig = this._dataSignature(this._pendingLibraries);
        const fileSig = this._dataSignature(this._pendingProjectFiles);
        if (libSig === this._lastDeliveredLibSignature &&
            fileSig === this._lastDeliveredFilesSignature) {
            return; // Data unchanged, skip
        }
        this.pushStoredData();
    }
});
```

**Optimization**: The `_dataSignature()` method creates a cheap hash (`count:firstItemLength`) to avoid re-serializing large data sets on every visibility change.

### 5.5 Event Handler Cleanup

Always dispose event handlers to prevent memory leaks:

```typescript
// In the provider constructor or activation
this._disposables = [];

// When registering handlers
this._disposables.push(
    webviewView.webview.onDidReceiveMessage(handler)
);
this._disposables.push(
    webviewView.onDidChangeVisibility(handler)
);

// In dispose()
this._disposables.forEach(d => d.dispose());
```

---

## 6. Real-Time Updates

### 6.1 Push-Based Architecture

Both webviews use a **push model** — the extension pushes data to the webview whenever it changes. The webview never polls.

```
Data Source Change
       │
       ▼
Provider.postLibraries() / .postProjectFiles()
       │
       ▼
pushStoredData()
       │
       ├─► _safePostMessage({ type: 'updateLibraries', libraries })
       └─► _safePostMessage({ type: 'updateProjectFiles', files })
```

### 6.2 Catalog Change Propagation

The `LibraryCatalog` fires an `onDidChange` event when its data updates. The dashboard provider listens and re-enriches:

```typescript
public setLibraryCatalog(catalog: LibraryCatalog): void {
    this._libraryCatalog = catalog;
    this._catalogDisposable?.dispose();
    this._catalogDisposable = catalog.onDidChange(() => {
        // Re-enrich libraries with updated catalog info
        if (this._rawLibraries.length > 0) {
            this.postLibraries(this._rawLibraries);
        }
    });
}
```

**Pattern**: Store raw data, enrich on-the-fly, push enriched data. This ensures the webview always has the latest merged view.

### 6.3 Incremental Updates vs. Full Refresh

| Approach | When to Use | This Extension Uses |
|----------|-------------|-------------------|
| Full refresh (`refresh` / `updateLibraries`) | Data set is small (< 1000 items) or completely replaced | ✅ Both webviews |
| Incremental update (`updateVersion`) | Single item changed in a large data set | ✅ LibraryBrowserProvider |
| Delta patch | Very large data sets with frequent small changes | ❌ Not used |

The LibraryBrowserProvider supports incremental version updates:

```typescript
// Extension sends only the changed entry
this.safePostMessage({ type: 'updateVersion', key, version, versionStatus });

// Webview updates in-place without re-rendering the entire grid
window.addEventListener('message', (ev) => {
    if (m.type === 'updateVersion') {
        for (var i = 0; i < all.length; i++) {
            if (all[i].key === m.key) {
                all[i].version = m.version;
                all[i].versionStatus = m.versionStatus;
                // Update just the badge element
                var vb = document.querySelector('span[data-key="' + m.key + '"]');
                if (vb && m.version) { vb.textContent = m.version; }
                break;
            }
        }
    }
});
```

### 6.4 Pending Data Pattern

When data arrives before the webview is ready, it's stored as "pending" and delivered once the handshake completes:

```typescript
public postLibraries(libs: LibraryInfo[]): void {
    this._rawLibraries = libs;
    const enrichedLibs = this.enrichLibraries(libs);
    this._pendingLibraries = enrichedLibs;  // Store for later
    this.pushStoredData();                  // Try to send now
}

private pushStoredData(): void {
    if (!this._view || !this._webviewReady) {
        return; // Will be sent when webviewReady arrives or visibility changes
    }
    this._safePostMessage({ type: 'updateLibraries', libraries: this._pendingLibraries });
    this._safePostMessage({ type: 'updateProjectFiles', files: this._pendingProjectFiles });
}
```

**Flow**:
1. Data arrives → stored in `_pendingLibraries`
2. `pushStoredData()` called → if not ready, returns early
3. `webviewReady` received → `pushStoredData()` called again → data delivered
4. Visibility changes → `pushStoredData()` called again → data re-delivered if changed

---

## 7. State Persistence & Restoration

### 7.1 localStorage for Webview State

The CompanionDashboardProvider uses `localStorage` to persist the selected tab and project files across webview recreations:

```javascript
// Save tab selection
localStorage.setItem('b4xDashboardActiveTab', this.id);

// Restore tab selection on load
const lastTab = localStorage.getItem('b4xDashboardActiveTab');
if (lastTab && lastTab !== 'tab-libraries') {
    // Switch to the previously selected tab
}

// Save project files
localStorage.setItem('b4xDashboardProjectFiles', JSON.stringify(files));

// Restore project files
const stored = localStorage.getItem('b4xDashboardProjectFiles');
if (stored) { return JSON.parse(stored); }
```

**⚠️ Warning**: `localStorage` in a webview is scoped to the webview's origin. If the webview is destroyed and recreated with a different origin (which happens when `retainContextWhenHidden` is not set), localStorage data is **lost**.

### 7.2 Extension-Side State (vscode.workspace.getState)

For state that must survive across VS Code sessions, use `context.workspaceState` or `context.globalState`:

```typescript
// Save
await context.workspaceState.update('b4xDashboardLibraries', libs);

// Restore
const libs = context.workspaceState.get<LibraryInfo[]>('b4xDashboardLibraries', []);
```

**This extension does NOT currently use workspaceState for webview data** — it re-derives data from the project on each activation. This is a valid pattern when the data source is always available.

### 7.3 retainContextWhenHidden

Both webviews use `retainContextWhenHidden: true`:

```typescript
// Sidebar webview
vscode.window.registerWebviewViewProvider(viewType, provider, {
    webviewOptions: { retainContextWhenHidden: true }
});

// Editor panel webview
vscode.window.createWebviewPanel(viewType, title, column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [...]
});
```

**What it does**: Preserves the webview's DOM and JS state when the view is hidden. Without it, the webview is completely destroyed and must be rebuilt from scratch when shown again.

**Trade-off**: Uses more memory. Only use it when the webview has significant state that would be expensive to reconstruct.

---

## 8. Styling & Theming

### 8.1 VS Code Theme Integration

Both webviews use CSS custom properties to match the user's VS Code theme:

```css
body {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}
```

**Available theme variables** (most useful ones):

| Variable | Purpose |
|----------|---------|
| `--vscode-editor-background` | Main background |
| `--vscode-editor-foreground` | Main text color |
| `--vscode-font-family` | User's configured font |
| `--vscode-font-size` | User's configured font size |
| `--vscode-panel-border` | Border color |
| `--vscode-list-hoverBackground` | Hover row background |
| `--vscode-descriptionForeground` | Secondary/muted text |
| `--vscode-editorGroupHeader-tabsBackground` | Tab bar background |

### 8.2 DaisyUI + Tailwind in Webviews

Both webviews load DaisyUI CSS and Tailwind Browser JS from the `media/` folder:

```typescript
const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.css'));
const twUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'tailwind-browser.js'));
```

```html
<link href="${cssUri}" rel="stylesheet" type="text/css">
<script nonce="${nonce}" src="${twUri}" defer></script>
```

**⚠️ The `defer` attribute on the Tailwind script is important** — it ensures the DOM is ready before Tailwind processes class names.

### 8.3 Codicon Fonts in Webviews

The CompanionDashboardProvider loads VS Code's codicon icons:

```typescript
const codiconsUri = vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(codiconsUri, 'codicon.css'));
const codiconTtfUri = webview.asWebviewUri(vscode.Uri.joinPath(codiconsUri, 'codicon.ttf'));
```

**Critical fix**: The codicon CSS uses a relative `./codicon.ttf` path that doesn't resolve inside a webview. You must redeclare the `@font-face`:

```css
@font-face {
    font-family: "codicon";
    font-display: block;
    src: url("${codiconTtfUri}") format("truetype");
}
```

### 8.4 Extension Settings in Webviews

The `getExtensionFontCss()` function in `extension.ts` generates CSS that honors user settings:

```typescript
export function getExtensionFontCss(): string {
    const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
    const fontFamily = cfg.get<string>('fontFamily', 'Fira Code Retina');
    const fontSize = cfg.get<number>('fontSize', 12);
    const wordWrap = cfg.get<boolean>('wordWrap', true);
    const tabSize = cfg.get<number>('tabSize', 4);
    const whiteSpace = wordWrap ? 'pre-wrap' : 'pre';
    return `body, code, pre { font-family: ${fontFamily}; font-size: ${fontSize}px; white-space: ${whiteSpace}; } .b4x-extension-editor { tab-size: ${tabSize}; -moz-tab-size: ${tabSize}; }`;
}
```

**Usage**: Inject this CSS into any webview that displays code or respects user font preferences.

---

## 9. Lessons Learned

### 9.1 The Empty Dashboard Bug

**Symptom**: The Companion Dashboard showed "No project loaded" even when a project was open.

**Root cause**: The message handler was registered AFTER setting `webview.html`. The webview JS executed immediately and sent `webviewReady` before the handler was listening.

**Fix**: Register `onDidReceiveMessage` BEFORE setting `webview.html`. This is now documented with an `IMPORTANT` comment in the code.

**Lesson**: **Always register message handlers before setting webview HTML.** This is the single most important rule for webview development.

### 9.2 The Codicon Font Path Issue

**Symptom**: Codicon icons showed as empty squares in the dashboard.

**Root cause**: The `codicon.css` file references `./codicon.ttf` with a relative path. Inside a webview, relative paths don't resolve to the filesystem — they resolve to the webview's virtual URI scheme.

**Fix**: Manually redeclare the `@font-face` with a webview-resolvable URI:

```css
@font-face {
    font-family: "codicon";
    src: url("${codiconTtfUri}") format("truetype");
}
```

**Lesson**: **Any font or resource loaded by CSS must use `webview.asWebviewUri()` to convert the path.** Relative paths in CSS files don't work in webviews.

### 9.3 The Sidebar Recreation Problem

**Symptom**: Dashboard data disappeared when switching between sidebar tabs.

**Root cause**: VS Code can destroy and recreate sidebar webviews when switching tabs. The new webview instance has no memory of the previous state.

**Fix**: Store all state in the provider class (not in the webview JS). Re-push data on `resolveWebviewView()` and `onDidChangeVisibility()`. Use `localStorage` for UI state (like selected tab).

**Lesson**: **Never store important state only in the webview's JavaScript context.** Always keep a copy in the extension host.

### 9.4 The postMessage Timing Problem

**Symptom**: Data sent via `postMessage` was sometimes lost.

**Root cause**: `postMessage` is asynchronous. If the webview is disposed between the call and delivery, the message is lost. Also, calling `postMessage` before the webview's JS has loaded results in silent failure.

**Fix**: 
1. Use the `webviewReady` handshake pattern
2. Wrap `postMessage` in try/catch (the `safePostMessage` pattern)
3. Store pending data and re-send on visibility changes

**Lesson**: **`postMessage` is fire-and-forget with no delivery guarantee.** Always design for the possibility that messages are lost.

### 9.5 The DaisyUI Layer Specificity Issue

**Symptom**: DaisyUI's `menu-sm` styles didn't apply correctly in the dashboard.

**Root cause**: DaisyUI uses `@layer` for its styles, but VS Code's CSS custom properties override layer-specificity rules.

**Fix**: Re-declare the styles at root specificity:

```css
.menu.menu-sm li:not(.menu-title) > :not(ul, details, .menu-title),
.menu.menu-sm li:not(.menu-title) > details > summary:not(.menu-title) {
    padding-block: 0.25rem;
    padding-inline: 0.625rem;
    border-radius: var(--radius-field, 4px);
}
```

**Lesson**: **CSS layers and VS Code theme variables can conflict.** When using component libraries in webviews, you may need to re-declare styles at higher specificity.

### 9.6 The Library Download with Redirects

**Symptom**: Some library downloads failed silently.

**Root cause**: The download URLs sometimes return HTTP 3xx redirects. The initial `https.get()` doesn't follow redirects by default.

**Fix**: Handle redirects explicitly:

```typescript
const req = https.get(downloadUrl, (res) => {
    if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        const req2 = https.get(redirectUrl, (res2) => {
            res2.pipe(file);
        });
    } else {
        res.pipe(file);
    }
});
```

**Lesson**: **Always handle HTTP redirects in webview-initiated downloads.** Node.js `https` module doesn't follow redirects automatically.

---

## 10. Known Loopholes & Pitfalls

### 10.1 `acquireVsCodeApi()` Can Only Be Called Once

The VS Code API object returned by `acquireVsCodeApi()` can only be obtained **once per webview session**. Subsequent calls return `undefined`.

```javascript
// ✅ CORRECT — acquire once, store, reuse
var vscode;
try {
    vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'webviewReady' });
} catch (e) {
    console.error('Failed to acquire VS Code API:', e);
}

// ❌ WRONG — calling again returns undefined
function sendMessage(msg) {
    const vscode2 = acquireVsCodeApi(); // Returns undefined!
    vscode2.postMessage(msg); // TypeError: Cannot read property 'postMessage' of undefined
}
```

**Loophole**: If the webview is destroyed and recreated (sidebar without `retainContextWhenHidden`), `acquireVsCodeApi()` can be called again in the new context. But within a single context, it's one-shot.

### 10.2 Webview HTML Must Be Set in Full

Setting `webview.html` replaces the **entire** HTML content. There is no way to incrementally update the DOM from the extension side. Every update must be a complete HTML document.

**Implication**: For large webviews, consider sending data via `postMessage` and letting the webview JS update the DOM, rather than regenerating the entire HTML.

### 10.3 `localResourceRoots` Security

The `localResourceRoots` option restricts which files the webview can load. If you add a new resource directory (e.g., for a new JS tool), you MUST add it to `localResourceRoots`:

```typescript
webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        // ADD: vscode.Uri.joinPath(this.extensionUri, 'scripts'),  // ← New tool scripts
    ]
};
```

**Loophole**: If you forget to add a directory, resources from that directory will silently fail to load. No error message, no console warning — just nothing.

### 10.4 CSP Blocks External Resources

The CSP `default-src 'none'` directive blocks ALL external resource loading. This means:
- No external CSS (Google Fonts, CDNs)
- No external JS (CDN libraries)
- No external images
- No `fetch()` to external APIs
- No WebSocket connections

**If your new tool needs external resources**, you must:
1. Bundle the resources locally (in `media/` or `scripts/`)
2. Add the directory to `localResourceRoots`
3. Add the appropriate CSP directive

### 10.5 The `asWebviewUri` Requirement

All local file paths must be converted using `webview.asWebviewUri()` before being used in HTML:

```typescript
// ✅ CORRECT
const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.css'));
// → vscode-webview-resource://.../daisyui.css

// ❌ WRONG — filesystem paths don't work in webviews
const cssPath = path.join(mediaPath, 'daisyui.css');
// → /Users/.../media/daisyui.css (won't load)
```

### 10.6 Nonce-Based Script Security

Every `<script>` tag must include the nonce:

```html
<script nonce="${nonce}">
    // ... webview JS code
</script>
<script nonce="${nonce}" src="${twUri}" defer></script>
```

**Without the nonce, scripts will be blocked by the CSP.** This is a common source of "my webview JS doesn't execute" bugs.

### 10.7 Debugging Webviews

Webview content runs in a separate browser context. To debug:

1. Run the **Developer: Open Webview Developer Tools** command from the Command Palette
2. This opens Chrome DevTools for the webview
3. You can set breakpoints, inspect the DOM, and view console.log output

**Tip**: The CompanionDashboardProvider includes `webviewDebugLog()` calls that output to the webview console. These are invaluable for debugging message flow issues.

### 10.8 The `defer` Attribute on External Scripts

When loading Tailwind Browser JS:

```html
<script nonce="${nonce}" src="${twUri}" defer></script>
```

The `defer` attribute ensures the DOM is fully parsed before the script executes. Without it, Tailwind may try to process class names before the DOM elements exist, resulting in unstyled content.

**However**, inline scripts that depend on Tailwind-processed classes must run AFTER Tailwind. The CompanionDashboardProvider solves this by putting all inline JS after the Tailwind script tag and using `defer` on the Tailwind script.

### 10.9 Sidebar Webview Sizing

Sidebar webviews have limited horizontal space (~300px default). Design your UI for narrow viewports:
- Use vertical layouts
- Avoid wide tables (use compact tables with `table-sm`)
- Use `overflow-x-auto` for any tables
- Test at 280-350px width

### 10.10 The `onDidDispose` Pattern

Always clean up when a WebviewPanel is disposed:

```typescript
this.panel.onDidDispose(() => {
    this.panel = undefined;
    this.webviewReady = false;
    // Clean up any other resources
});
```

For WebviewView (sidebar), VS Code manages disposal, but you should still handle the `resolveWebviewView` being called again (which means the view was recreated).

---

## 11. Adding a New JavaScript Tool as a Webview

This section provides a step-by-step guide for adding a new JavaScript-based tool as a webview in this extension.

### 11.1 Decision: Sidebar vs. Editor Panel

| Criteria | Sidebar (WebviewView) | Editor Panel (WebviewPanel) |
|----------|----------------------|---------------------------|
| Always visible | ✅ Yes | ❌ No |
| Large screen area | ❌ No (~300px) | ✅ Yes |
| On-demand | ❌ Always present | ✅ Yes |
| Complex UI | ❌ Limited | ✅ Full editor area |
| State persistence | Must handle recreation | Can use `retainContextWhenHidden` |

**Recommendation**: If the tool needs significant screen space or complex interaction, use a **WebviewPanel**. If it's a supplementary tool that benefits from always being visible, use a **WebviewView**.

### 11.2 Step-by-Step: Creating a New Webview

#### Step 1: Create the Provider Class

Create a new file in `src/providers/`:

```typescript
// src/providers/myToolProvider.ts
import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class MyToolProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'b4x-my-tool';
    private _view: vscode.WebviewView | undefined;
    private _webviewReady = false;
    private _pendingData: unknown[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        this._webviewReady = false;

        // 1. Set options (including localResourceRoots for your tool's resources)
        const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaUri]  // Add more roots as needed
        };

        // 2. Register message handler BEFORE setting HTML
        webviewView.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });

        // 3. Set HTML
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 4. Visibility change handler
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.pushData();
            }
        });

        // 5. Fallback timer
        setTimeout(() => {
            if (!this._webviewReady && this._view) {
                this._webviewReady = true;
                this.pushData();
            }
        }, 3000);
    }

    private handleMessage(message: { type: string; [key: string]: unknown }): void {
        switch (message.type) {
            case 'webviewReady':
                this._webviewReady = true;
                this.pushData();
                break;
            case 'myAction':
                // Handle your custom action
                break;
        }
    }

    private pushData(): void {
        if (!this._view || !this._webviewReady) return;
        this._safePostMessage({ type: 'updateData', data: this._pendingData });
    }

    private _safePostMessage(message: unknown): void {
        try {
            this._view?.webview.postMessage(message);
        } catch {
            // Webview may have been disposed
        }
    }

    public postData(data: unknown[]): void {
        this._pendingData = data;
        this.pushData();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.css'));
        const twUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'tailwind-browser.js'));

        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
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
    <script nonce="${nonce}" src="${twUri}" defer></script>
    <style>
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 0;
            margin: 0;
        }
    </style>
</head>
<body>
    <div id="app" class="p-4">
        <p class="text-sm opacity-60">Loading...</p>
    </div>
    <script nonce="${nonce}">
        var vscode;
        try {
            vscode = acquireVsCodeApi();
            vscode.postMessage({ type: 'webviewReady' });
        } catch (e) {
            console.error('Failed to acquire VS Code API:', e);
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'updateData') {
                // Render your data
                document.getElementById('app').innerHTML =
                    '<p class="text-sm">Data received: ' + message.data.length + ' items</p>';
            }
        });
    </script>
</body>
</html>`;
    }
}
```

#### Step 2: Register in package.json

Add the view contribution:

```json
{
    "viewsContainers": {
        "secondarySidebar": [
            {
                "id": "b4x-companion-dashboard-container",
                "title": "B4X Companion",
                "icon": "images/b4xlogo.png"
            }
        ]
    },
    "views": {
        "b4x-companion-dashboard-container": [
            {
                "id": "b4x-my-tool",
                "name": "My Tool",
                "type": "webview"
            }
        ]
    }
}
```

For an editor panel, add a command instead:

```json
{
    "commands": [
        {
            "command": "b4xIntellisense.openMyTool",
            "title": "B4X: Open My Tool"
        }
    ]
}
```

#### Step 3: Register in extension.ts

```typescript
// For sidebar webview:
const myToolProvider = new MyToolProvider(context.extensionUri);
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MyToolProvider.viewType, myToolProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    })
);

// For editor panel:
const myToolProvider = new MyToolProvider(context.extensionUri, context);
context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.openMyTool', () => myToolProvider.show())
);
```

#### Step 4: Add Your JavaScript Tool

Place your tool's JS in the `media/` or `scripts/` directory and reference it:

```typescript
const toolScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, 'scripts', 'my-tool.js')
);
```

```html
<script nonce="${nonce}" src="${toolScriptUri}"></script>
```

**⚠️ Remember**: The script must be loaded with a nonce, and the `scripts/` directory must be in `localResourceRoots`.

#### Step 5: Wire Up the Message Protocol

Define your message types and implement handlers on both sides:

**Extension side** (`myToolProvider.ts`):
```typescript
private handleMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
        case 'webviewReady':
            this._webviewReady = true;
            this.pushData();
            break;
        case 'toolAction':
            // Handle action from the tool
            void vscode.window.showInformationMessage(`Tool action: ${message.actionName}`);
            break;
    }
}
```

**Webview side** (in the HTML or external JS):
```javascript
// Send action to extension
function sendAction(actionName, data) {
    vscode.postMessage({
        type: 'toolAction',
        actionName: actionName,
        data: data
    });
}

// Receive updates from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'updateData') {
        renderData(message.data);
    }
});
```

### 11.3 Conditional Webview Activation

If you want to show a webview tool only under specific conditions (e.g., when a particular file type is open):

```typescript
// In extension.ts
let myToolProvider: MyToolProvider | undefined;

// Register the provider unconditionally (VS Code handles lazy loading)
myToolProvider = new MyToolProvider(context.extensionUri);
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MyToolProvider.viewType, myToolProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    })
);

// Push data only when conditions are met
vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.fileName.endsWith('.b4a')) {
        myToolProvider?.postData(extractToolData(doc));
    }
});
```

For a **conditional command** that opens a panel only when appropriate:

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('b4xIntellisense.openMyTool', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.b4a')) {
            void vscode.window.showWarningMessage('My Tool is only available for B4X files.');
            return;
        }
        myToolProvider.show();
    })
);
```

### 11.4 Integrating an Existing JavaScript Tool

To integrate an existing JS tool (e.g., a standalone HTML/JS app) into a webview:

1. **Bundle the tool's JS** into a single file or place it in `scripts/`
2. **Add the script directory** to `localResourceRoots`
3. **Add the CSP directives** needed (e.g., `connect-src` if the tool makes API calls)
4. **Wrap the tool's initialization** in a function that receives the `vscode` API object
5. **Add message handlers** for any actions the tool needs to send to the extension
6. **Test thoroughly** — CSP violations are the #1 source of "it works standalone but not in a webview" bugs

Example wrapper for an existing tool:

```html
<script nonce="${nonce}">
    // Acquire VS Code API first
    var vscode;
    try {
        vscode = acquireVsCodeApi();
        vscode.postMessage({ type: 'webviewReady' });
    } catch (e) {
        console.error('Failed to acquire VS Code API:', e);
    }

    // Initialize the existing tool, passing the vscode API
    // so it can send messages back to the extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'updateData') {
            MyExistingTool.init(message.data, {
                // Bridge: tool calls these to communicate with extension
                onAction: (action) => vscode.postMessage({ type: 'toolAction', action }),
                onRequest: (request) => vscode.postMessage({ type: 'toolRequest', request }),
            });
        }
    });
</script>
<script nonce="${nonce}" src="${toolScriptUri}"></script>
```

---

## 12. Checklist — New Webview Pre-Flight

Before shipping a new webview, verify every item:

### CSP & Security
- [ ] CSP includes all required directives (`default-src 'none'`, `style-src`, `script-src`, `font-src`, `img-src`, etc.)
- [ ] Every `<script>` tag has `nonce="${nonce}"`
- [ ] No inline event handlers (`onclick`, `onload`, etc.) — use `addEventListener` instead
- [ ] No `eval()`, `new Function()`, or `innerHTML` with user content (XSS risk)
- [ ] `localResourceRoots` includes all directories the webview loads resources from
- [ ] All resource URIs use `webview.asWebviewUri()` (not filesystem paths)

### Message Protocol
- [ ] Message handler registered BEFORE `webview.html` is set
- [ ] `webviewReady` handshake implemented
- [ ] 3-second fallback timer for missing `webviewReady`
- [ ] All `postMessage` calls wrapped in try/catch (`safePostMessage`)
- [ ] Pending data pattern implemented for pre-ready data
- [ ] Message types documented in the provider class

### State Management
- [ ] Important state stored in the provider (not just in webview JS)
- [ ] `onDidChangeVisibility` handler re-sends data when needed
- [ ] `onDidDispose` handler cleans up resources
- [ ] `localStorage` used only for UI preferences (tab selection, etc.)
- [ ] Data signature check prevents unnecessary re-renders on visibility changes

### Styling
- [ ] VS Code theme variables used for colors (`--vscode-editor-background`, etc.)
- [ ] DaisyUI/Tailwind loaded from `media/` directory
- [ ] Codicon fonts redeclared with `@font-face` using `asWebviewUri`
- [ ] UI tested at sidebar width (~300px) if using WebviewView
- [ ] Dark and light themes both look correct

### Performance
- [ ] No unnecessary full re-renders when incremental updates suffice
- [ ] Large data sets paginated or virtualized
- [ ] `retainContextWhenHidden: true` used when webview has significant state
- [ ] Debug logging removed or gated behind a development flag

### Testing
- [ ] Webview works after closing and reopening the sidebar
- [ ] Webview works after switching between different VS Code windows
- [ ] Webview works after the extension host restarts
- [ ] Messages are not lost when rapidly switching between tabs
- [ ] CSP violations checked in DevTools console (no red errors)
- [ ] Tested on both light and dark VS Code themes

---

## Appendix A: Quick Reference — Message Flow Diagrams

### Sidebar WebviewView Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│  VS Code activates sidebar                                   │
│                                                              │
│  1. resolveWebviewView() called                               │
│  2. _webviewReady = false                                     │
│  3. Set webview.options (enableScripts, localResourceRoots)   │
│  4. Register onDidReceiveMessage handler                      │
│  5. Set webview.html                                          │
│  6. Start 3-second fallback timer                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Webview JS loads                                         │ │
│  │ 7. acquireVsCodeApi()                                    │ │
│  │ 8. postMessage({ type: 'webviewReady' })                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  9. Handler receives 'webviewReady'                           │
│  10. _webviewReady = true                                     │
│  11. pushStoredData() → sends pending data                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ User hides sidebar                                       │ │
│  │ 12. onDidChangeVisibility(visible: false)                 │ │
│  │     → No action needed                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ User shows sidebar again                                 │ │
│  │ 13. onDidChangeVisibility(visible: true)                  │ │
│  │ 14. Check data signature — if changed, pushStoredData()  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Editor WebviewPanel Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│  User runs command                                           │
│                                                              │
│  1. show() called                                            │
│  2. If panel exists: panel.reveal() + pushData()             │
│  3. If panel doesn't exist:                                  │
│     a. createWebviewPanel()                                  │
│     b. Set webview.html                                       │
│     c. Register onDidReceiveMessage handler                   │
│     d. Register onDidDispose handler                          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Webview JS loads                                         │ │
│  │ 4. acquireVsCodeApi()                                    │ │
│  │ 5. postMessage({ type: 'ready' })                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  6. Handler receives 'ready'                                  │
│  7. webviewReady = true                                       │
│  8. Send pending data + pending entry selection               │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ User closes panel                                        │ │
│  │ 9. onDidDispose fires                                     │ │
│  │ 10. panel = undefined, webviewReady = false               │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Appendix B: Common Error Messages & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Refused to load the script '...' because it violates the following Content Security Policy directive` | Script loaded without nonce or from disallowed source | Add `nonce="${nonce}"` to script tag, add source to CSP |
| `Refused to connect to '...' because it violates the document's Content Security Policy` | Webview trying to make network request | Add `connect-src` to CSP, or proxy through extension |
| `Failed to acquire VS Code API` | `acquireVsCodeApi()` called more than once | Call once at top of script, store result in variable |
| Webview shows blank/empty | Message handler registered after HTML set | Register handler BEFORE setting HTML |
| Webview shows stale data | Data sent before webviewReady handshake | Use pending data pattern + push on ready |
| Codicon icons show as squares | Font file path not resolving in webview | Redeclare `@font-face` with `asWebviewUri` path |
| Styles not applying | Tailwind not loaded or processed | Ensure `tailwind-browser.js` is loaded with `defer` |
| `Cannot read property 'postMessage' of undefined` | `acquireVsCodeApi()` returned undefined | Check for duplicate calls, ensure scripts have nonce |

---

*This document was generated from analysis of the B4X IntelliSense extension's webview implementations. Last updated: May 2026.*
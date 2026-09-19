# BJL Layout Editor Webview Integration Plan

> **Status**: Planning — not yet implemented  
> **Date**: May 2026  
> **Goal**: Integrate the Sithaso-BJL-JSON-Editor as a VS Code webview custom editor so clicking a `.bjl` file opens it in the visual designer

---

## 1. Executive Summary

The Sithaso-BJL-JSON-Editor is a **pure JavaScript web application** that provides a WYSIWYG visual designer for B4X layout files (`.bjl` binary and `.bjl.json` text formats). It consists of:

- **SithasoBJLDesigner** — Custom HTML element (`<bjl-designer>`) that renders the full designer UI
- **SithasoLayoutEngine** — Binary BJL parser/writer (reads/writes gzip-compressed binary format using `pako`)
- **SithasoBJLTree** — Custom HTML element (`<bjl-tree>`) for the component outline
- **128 component schema JSON files** — Property/event/method definitions for each SDUI5 component
- **Vanilla JSON Editor** — Embedded JSON editor for raw data editing
- **DaisyUI 5 + Tailwind CSS 4** — Styling framework
- **SweetAlert2** — Dialog/alert system
- **Remix Icons** — Icon set
- **Motion.js** — Animation library

**Key insight**: The entire app is **pure browser JavaScript** with no server dependencies. It uses `localStorage` for auto-save, `pako` for gzip compression, and custom elements for UI. This makes it an **excellent candidate** for webview integration — the main challenges are CSP compliance and file I/O bridging.

---

## 2. Architecture Decision: Custom Editor vs. Webview Panel

### Option A: Custom Editor (Recommended ✅)

VS Code's `vscode.window.registerCustomEditorProvider` API provides exactly what we need:

```typescript
vscode.window.registerCustomEditorProvider(
    'b4xIntellisense.bjlEditor',
    new BjlEditorProvider(context),
    { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } }
);
```

**Why Custom Editor is the right choice**:

| Feature | Custom Editor | Webview Panel |
|---------|--------------|---------------|
| Opens on file click | ✅ Automatic via `package.json` | ❌ Requires manual command |
| File save (Ctrl+S) | ✅ Built-in — VS Code handles it | ❌ Must implement manually |
| Dirty state tracking | ✅ Built-in — `onDidChange` | ❌ Must implement manually |
| Tab shows filename | ✅ Automatic | ❌ Must set manually |
| Multiple files | ✅ One tab per file | ❌ Must manage panels |
| Hot exit / restore | ✅ VS Code handles it | ❌ Must implement |
| Editor groups | ✅ Split editor support | ❌ Single panel |

**This is the standard VS Code pattern for file editors** — used by image editors, Markdown preview, CSV editors, etc.

### Option B: Webview Panel (Not recommended)

A standalone `WebviewPanel` opened via command would require us to:
- Manually track which file is open
- Implement our own save/dirty state
- Handle multiple files ourselves
- No integration with VS Code's tab system

**Verdict**: Use **Custom Editor Provider**.

---

## 3. Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  BjlEditorProvider (CustomEditorProvider)                  │  │
│  │                                                             │  │
│  │  • resolveCustomEditor() → creates webview, loads HTML      │  │
│  │  • save() → reads webview data, writes to disk             │  │
│  │  • revert() → re-reads file, pushes to webview             │  │
│  │  • backup() → creates backup for hot exit                  │  │
│  │  • onDidChange → tracks dirty state from webview edits     │  │
│  │                                                             │  │
│  │  Message handlers:                                          │  │
│  │  • 'ready'          → webview JS loaded, push file data     │  │
│  │  • 'contentChanged' → mark document dirty                  │  │
│  │  • 'saveRequest'    → trigger VS Code save                 │  │
│  │  • 'exportBjl'      → convert JSON → binary, write to disk │  │
│  │  • 'importBjl'      → read binary file, push JSON to webview│  │
│  │  • 'readFile'       → read a schema JSON from disk          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  BJL Binary Converter (Node.js side)                        │  │
│  │                                                             │  │
│  │  • Uses pako (Node.js) for gzip/ungzip                     │  │
│  │  • Reads .bjl binary → JSON for webview                    │  │
│  │  • Writes JSON → .bjl binary for save                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Schema File Server                                         │  │
│  │                                                             │  │
│  │  • Serves 128 SDUI5*.json files via webview URIs            │  │
│  │  • No fetch() needed — all local resources                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

         │ postMessage / onDidReceiveMessage
         ▼

┌─────────────────────────────────────────────────────────────────┐
│  Webview (Browser Context)                                       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  <bjl-designer> Custom Element                              │  │
│  │                                                             │  │
│  │  • Full visual designer (drag, resize, snap, etc.)          │  │
│  │  • SithasoLayoutEngine for BJL binary ↔ JSON conversion    │  │
│  │  • SithasoBJLTree for outline view                         │  │
│  │  • Vanilla JSON Editor for raw JSON editing                 │  │
│  │  • Auto-save → postMessage to extension (not localStorage) │  │
│  │  • File operations → postMessage to extension               │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. File-by-File Changes

### 4.1 New Files to Create

| File | Purpose |
|------|---------|
| `src/providers/bjlEditorProvider.ts` | CustomEditorProvider implementation |
| `src/bjl/bjlConverter.ts` | Node.js BJL binary ↔ JSON converter (port from SithasoLayoutEngine.js) |
| `media/bjl-editor/` | Directory for webview assets |
| `media/bjl-editor/index.html` | Webview HTML (adapted from Sithaso index.html) |
| `media/bjl-editor/bjl-designer-bridge.js` | Bridge between webview JS and VS Code API |

### 4.2 Files to Copy (from Sithaso project → `media/bjl-editor/`)

| Source | Destination | Notes |
|--------|-------------|-------|
| `scripts/SithasoBJLDesigner.js` | `media/bjl-editor/SithasoBJLDesigner.js` | Modify: replace `localStorage` auto-save with `postMessage` |
| `scripts/SithasoLayoutEngine.js` | `media/bjl-editor/SithasoLayoutEngine.js` | Modify: remove `download()` method (save via extension) |
| `scripts/SithasoBJLTree.js` | `media/bjl-editor/SithasoBJLTree.js` | Minimal changes |
| `scripts/pako.min.js` | `media/bjl-editor/pako.min.js` | As-is |
| `scripts/sweetalert2.js` | `media/bjl-editor/sweetalert2.js` | As-is |
| `scripts/motion.min.js` | `media/bjl-editor/motion.min.js` | As-is |
| `scripts/vanilla-jsoneditor.standalone.js` | `media/bjl-editor/vanilla-jsoneditor.standalone.js` | As-is |
| `scripts/vanilla-jsoneditor-bridge.js` | `media/bjl-editor/vanilla-jsoneditor-bridge.js` | Modify: remove ES module import, use global |
| `scripts/jsoneditor.min.js` | `media/bjl-editor/jsoneditor.min.js` | As-is |
| `styles/daisyui.min.css` | Already in `media/daisyui.css` | Reuse existing |
| `styles/remixicon.css` | `media/bjl-editor/remixicon.css` | As-is |
| `styles/remixicon.ttf` | `media/bjl-editor/remixicon.ttf` | As-is |
| `styles/remixicon.woff` | `media/bjl-editor/remixicon.woff` | As-is |
| `styles/remixicon.woff2` | `media/bjl-editor/remixicon.woff2` | As-is |
| `styles/jse-theme-dark.css` | `media/bjl-editor/jse-theme-dark.css` | As-is |
| `styles/jsoneditor.min.css` | `media/bjl-editor/jsoneditor.min.css` | As-is |
| `styles/quill.snow.css` | `media/bjl-editor/quill.snow.css` | As-is |
| `json/*.json` (128 files) | `media/bjl-editor/json/*.json` | As-is, served via webview URIs |

### 4.3 Existing Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `customEditors` contribution point, file icon associations |
| `src/extension.ts` | Register `BjlEditorProvider`, add activation events |
| `media/daisyui.css` | May need to update if DaisyUI version differs |

---

## 5. Detailed Implementation Plan

### Phase 1: Foundation (Custom Editor Provider)

#### 1.1 Create `BjlEditorProvider`

```typescript
// src/providers/bjlEditorProvider.ts
export class BjlEditorProvider implements vscode.CustomEditorProvider<BjlDocument> {
    public static readonly viewType = 'b4xIntellisense.bjlEditor';
    
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocument<BjlDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    
    constructor(
        private readonly context: vscode.ExtensionContext,
    ) {}
    
    async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<vscode.CustomDocument<BjlDocument>> {
        // Read the .bjl or .bjl.json file
        // If binary .bjl: convert to JSON using BJL converter
        // If .bjl.json: parse directly
        const content = await vscode.workspace.fs.readFile(uri);
        const layoutData = uri.path.endsWith('.bjl') 
            ? await BjlConverter.binaryToJson(content)  // Node.js pako
            : JSON.parse(new TextDecoder().decode(content));
        return { uri, layoutData, isDirty: false };
    }
    
    async resolveCustomEditor(document: vscode.CustomDocument<BjlDocument>, webviewPanel: vscode.WebviewPanel): Promise<void> {
        // 1. Set webview options (enableScripts, localResourceRoots)
        // 2. Register message handler BEFORE setting HTML
        // 3. Set webview HTML
        // 4. Push initial data on 'ready' message
    }
    
    async save(document: vscode.CustomDocument<BjlDocument>, cancellation: vscode.CancellationToken): Promise<void> {
        // Get current layout data from webview
        // If .bjl: convert JSON → binary using BJL converter, write to disk
        // If .bjl.json: serialize JSON, write to disk
    }
    
    async revert(document: vscode.CustomDocument<BjlDocument>): Promise<void> {
        // Re-read file from disk, push to webview
    }
    
    async backup(document: vscode.CustomDocument<BjlDocument>, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        // Copy file to backup location for hot exit
    }
}
```

#### 1.2 Register in `package.json`

```json
{
    "contributes": {
        "customEditors": [
            {
                "viewType": "b4xIntellisense.bjlEditor",
                "displayName": "B4X Layout Editor",
                "selector": [
                    { "filenamePattern": "*.bjl" },
                    { "filenamePattern": "*.bjl.json" }
                ],
                "priority": "default"
            }
        ]
    }
}
```

#### 1.3 Register in `extension.ts`

```typescript
const bjlEditor = new BjlEditorProvider(context);
context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
        BjlEditorProvider.viewType,
        bjlEditor,
        { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } }
    )
);
```

### Phase 2: Webview HTML Adaptation

#### 2.1 CSP Considerations

The Sithaso editor uses several features that need CSP adjustments:

| Feature | Current (standalone) | Required (webview) |
|---------|---------------------|-------------------|
| Scripts | `<script src="...">` | `<script nonce="${nonce}" src="${webview.asWebviewUri(...)}">` |
| Styles | `<link href="...">` | `<link href="${webview.asWebviewUri(...)}">` |
| Fonts | `@font-face` with relative paths | `@font-face` with `webview.asWebviewUri()` paths |
| Dynamic imports | `import("./vanilla-jsoneditor-bridge.js")` | Must be pre-loaded or use nonce'd script |
| `fetch()` for schemas | `fetch('./json/SDUI5Button.json')` | Load via `webview.asWebviewUri()` or extension host |
| `localStorage` | Auto-save drafts | Replace with `postMessage` to extension |
| `Swal.fire()` | SweetAlert2 dialogs | Works in webview (no CSP issue) |

**Proposed CSP**:

```typescript
const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `connect-src ${webview.cspSource}`,  // For schema fetches via webview URIs
].join('; ');
```

#### 2.2 Schema Loading Strategy

The standalone app uses `fetch('./json/SDUI5Button.json')` to load 128 component schemas. In a webview, `fetch()` with relative paths doesn't work. Two options:

**Option A (Recommended): Pre-load schemas via extension host**

```typescript
// In resolveCustomEditor():
const schemaUris = componentNames.map(name => ({
    name,
    uri: webview.asWebviewUri(vscode.Uri.joinPath(schemasDir, `${name}.json`))
}));
// Pass URIs to webview in initial data push
```

```javascript
// In webview JS:
async function loadSchemas(engine, schemaUris) {
    const urls = schemaUris.map(s => s.uri);
    // fetch() works with webview URIs because connect-src allows them
    await engine.addSchemas(urls);
}
```

**Option B: Embed schemas in HTML**

Embed all 128 JSON files as a single JSON object in the HTML. This avoids `fetch()` entirely but increases HTML size (~500KB).

**Recommendation**: Option A. It keeps the HTML lean and leverages the webview's `connect-src` CSP directive.

#### 2.3 Dynamic Import Fix

The `SithasoBJLDesigner.js` uses a dynamic import:

```javascript
await import("./vanilla-jsoneditor-bridge.js");
```

This won't work in a webview because:
1. CSP `script-src` with nonce doesn't allow dynamic imports
2. Relative paths don't resolve in webview context

**Fix**: Pre-load the bridge script in the HTML `<head>`:

```html
<script nonce="${nonce}" src="${bridgeUri}"></script>
<script nonce="${nonce}" src="${vanillaJsonEditorUri}"></script>
```

Then modify `SithasoBJLDesigner.js` to check if `window.VanillaJsonEditor` already exists before attempting the dynamic import:

```javascript
// In _loadVanillaJsonEditorModule():
if (window.VanillaJsonEditor && typeof window.VanillaJsonEditor.createJSONEditor === "function") {
    return window.VanillaJsonEditor; // Already loaded via <script> tag
}
// Only attempt dynamic import as fallback
try { await import("./vanilla-jsoneditor-bridge.js"); } catch (e) { ... }
```

### Phase 3: File I/O Bridge

#### 3.1 Reading BJL Files

When a `.bjl` binary file is opened, the extension host must convert it to JSON before sending to the webview:

```typescript
// src/bjl/bjlConverter.ts
import * as pako from 'pako';

export class BjlConverter {
    static binaryToJson(bytes: Uint8Array): any {
        const reader = new BinaryReader(bytes);
        // ... (port from SithasoLayoutEngine.js BJLConverter.convertBjlToJsonFromBytes)
        // Uses pako.ungzip for decompression
    }
    
    static jsonToBinary(layoutJson: any): Uint8Array {
        const writer = new BinaryWriter();
        // ... (port from SithasoLayoutEngine.js BJLConverter.convertJsonToBjlToBytes)
        // Uses pako.gzip for compression
    }
}
```

**Important**: The BJL binary format conversion MUST happen on the extension host side (Node.js) because:
1. The webview CSP restricts binary file access
2. `vscode.workspace.fs.readFile()` returns `Uint8Array` — perfect for binary parsing
3. `pako` works in Node.js — no need for a browser polyfill

#### 3.2 Saving BJL Files

When the user presses Ctrl+S:

```typescript
async save(document: vscode.CustomDocument<BjlDocument>, cancellation: vscode.CancellationToken): Promise<void> {
    // 1. Request current layout data from webview
    const layoutData = await this.getLayoutFromWebview(document);
    
    // 2. Convert based on file extension
    if (document.uri.path.endsWith('.bjl')) {
        const binaryData = BjlConverter.jsonToBinary(layoutData);
        await vscode.workspace.fs.writeFile(document.uri, binaryData);
    } else {
        const textData = new TextEncoder().encode(JSON.stringify(layoutData, null, 2));
        await vscode.workspace.fs.writeFile(document.uri, textData);
    }
}
```

#### 3.3 Dirty State Tracking

The webview must notify the extension when content changes:

```typescript
// In resolveCustomEditor():
webviewPanel.webview.onDidReceiveMessage((message) => {
    switch (message.type) {
        case 'contentChanged':
            // Mark document as dirty so VS Code shows the unsaved indicator
            document.isDirty = true;
            this._onDidChangeCustomDocument.fire(document);
            break;
        case 'saveRequest':
            // User pressed Ctrl+S in the webview — delegate to VS Code
            vscode.commands.executeCommand('workbench.action.files.save');
            break;
    }
});
```

```javascript
// In webview JS bridge:
// Override the designer's auto-save to notify VS Code instead of localStorage
designer._autoSave = function() {
    const layout = this._engine.getLayout();
    vscode.postMessage({
        type: 'contentChanged',
        data: layout
    });
};
```

### Phase 4: Webview HTML Template

The webview HTML will be generated in TypeScript (like our existing providers), not served as a static file. This allows us to inject the nonce, CSP, and webview URIs:

```typescript
private _getHtmlForWebview(webview: vscode.Webview, schemaUris: {name: string, uri: vscode.Uri}[]): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Convert all resource paths to webview URIs
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'bjl-editor');
    const cssUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, name));
    const jsUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, name));
    
    const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${webview.cspSource}`,
        `img-src ${webview.cspSource} data:`,
        `connect-src ${webview.cspSource}`,  // For schema fetches
    ].join('; ');

    return /* html */`
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BJL Layout Editor</title>
    <link href="${cssUri('daisyui.min.css')}" rel="stylesheet" type="text/css">
    <link href="${cssUri('remixicon.css')}" rel="stylesheet" type="text/css">
    <link href="${cssUri('jsoneditor.min.css')}" rel="stylesheet" type="text/css">
    <link href="${cssUri('jse-theme-dark.css')}" rel="stylesheet" type="text/css">
    <link href="${cssUri('quill.snow.css')}" rel="stylesheet" type="text/css">
    <style>
        @font-face {
            font-family: "remixicon";
            src: url("${cssUri('remixicon.woff2')}") format("woff2"),
                 url("${cssUri('remixicon.woff')}") format("woff"),
                 url("${cssUri('remixicon.ttf')}") format("truetype");
        }
        body { margin: 0; padding: 0; overflow: hidden; }
    </style>
</head>
<body>
    <bjl-designer id="designer" class="card shadow-md"
        style="width: calc(100vw - 0px); height: calc(100vh - 0px);"></bjl-designer>

    <script nonce="${nonce}" src="${jsUri('pako.min.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('sweetalert2.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('motion.min.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('SithasoLayoutEngine.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('SithasoBJLTree.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('jsoneditor.min.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('vanilla-jsoneditor.standalone.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('vanilla-jsoneditor-bridge.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('SithasoBJLDesigner.js')}"></script>
    <script nonce="${nonce}" src="${jsUri('bjl-designer-bridge.js')}"></script>
</body>
</html>`;
}
```

### Phase 5: Bridge Script (`bjl-designer-bridge.js`)

This is the **critical glue** between the webview JS and the VS Code extension:

```javascript
// media/bjl-editor/bjl-designer-bridge.js
(function() {
    'use strict';
    
    // Acquire VS Code API (can only be called once)
    var vscode;
    try {
        vscode = acquireVsCodeApi();
    } catch (e) {
        console.error('Failed to acquire VS Code API:', e);
        return;
    }

    var designer = document.getElementById('designer');
    var engine = new window.SithasoLib.Engine();
    designer.engine = engine;

    // Schema URIs will be injected by the extension
    var schemaUris = /* INJECTED_BY_EXTENSION */ [];

    // Load schemas
    async function loadSchemas() {
        try {
            await engine.addSchemas(schemaUris);
            console.log('Loaded ' + schemaUris.length + ' component schemas.');
        } catch (err) {
            console.error('Failed to load schemas:', err);
        }
    }

    // Override auto-save to notify VS Code instead of localStorage
    var originalAutoSave = designer._autoSave.bind(designer);
    designer._autoSave = function() {
        if (!engine) return;
        var layout = engine.getLayout();
        vscode.postMessage({
            type: 'contentChanged',
            data: {
                filename: designer._currentFilename,
                layoutData: layout.Data,
                variants: layout.Variants,
                fontAwesome: layout.FontAwesome,
                materialIcons: layout.MaterialIcons,
                layoutHeader: layout.LayoutHeader
            }
        });
        
        // Update save status indicator
        var status = designer.querySelector('#saveStatus');
        if (status) {
            status.innerHTML = '<i class="ri-checkbox-circle-fill text-success"></i> <span>Saved</span>';
            setTimeout(function() { status.style.opacity = '0.3'; }, 2000);
        }
    };

    // Override _restoreDraft to not use localStorage
    designer._restoreDraft = function() {
        // Draft restoration will come from the extension via postMessage
        // Do nothing here — the extension will push initial data
    };

    // Notify extension that webview is ready
    vscode.postMessage({ type: 'ready' });

    // Load schemas
    loadSchemas();

    // Listen for messages from extension
    window.addEventListener('message', function(event) {
        var message = event.data;
        
        switch (message.type) {
            case 'loadLayout':
                // Load layout data from file
                if (message.layoutData) {
                    engine.layout = message.layoutData;
                    designer._currentFilename = message.filename || 'layout.bjl';
                    var titleEl = designer.querySelector('#toolbarTitle');
                    if (titleEl) titleEl.innerText = designer._currentFilename;
                    designer.refresh();
                }
                break;
                
            case 'saveComplete':
                // VS Code confirmed save
                var status = designer.querySelector('#saveStatus');
                if (status) {
                    status.innerHTML = '<i class="ri-checkbox-circle-fill text-success"></i> <span>Saved</span>';
                    setTimeout(function() { status.style.opacity = '0.3'; }, 2000);
                }
                break;
                
            case 'revert':
                // File was reverted — reload data
                if (message.layoutData) {
                    engine.layout = message.layoutData;
                    designer.refresh();
                }
                break;
        }
    });
})();
```

### Phase 6: Theme Integration

The standalone app uses DaisyUI themes (`data-theme="light"` / `data-theme="dark"`). We need to sync with VS Code's theme:

```javascript
// In bridge script — detect VS Code theme
function getVsCodeTheme() {
    // VS Code sets CSS custom properties on the body
    var bgColor = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    // Dark themes typically have backgrounds like #1e1e1e, #282828, etc.
    return bgColor && bgColor.indexOf('#') === 0 && 
           parseInt(bgColor.slice(1,3), 16) < 128 ? 'dark' : 'light';
}

// Apply theme
document.documentElement.setAttribute('data-theme', getVsCodeTheme());
```

For a more robust approach, listen for VS Code theme changes:

```typescript
// In extension host:
vscode.window.onDidChangeActiveColorTheme((theme) => {
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || 
                   theme.kind === vscode.ColorThemeKind.HighContrast;
    webviewPanel.webview.postMessage({ 
        type: 'themeChanged', 
        theme: isDark ? 'dark' : 'light' 
    });
});
```

---

## 6. Challenges & Mitigations

### 6.1 Challenge: Dynamic `import()` in Webview

**Problem**: `SithasoBJLDesigner.js` uses `await import("./vanilla-jsoneditor-bridge.js")` which is blocked by CSP.

**Mitigation**: Pre-load all scripts via `<script>` tags with nonces. Modify the `_loadVanillaJsonEditorModule()` method to check `window.VanillaJsonEditor` first (already loaded) before attempting dynamic import.

### 6.2 Challenge: Schema Fetch via `fetch()`

**Problem**: The engine's `addSchemas()` method uses `fetch()` to load 128 JSON files. In a webview, `fetch()` with relative paths doesn't work.

**Mitigation**: Convert schema paths to `webview.asWebviewUri()` URIs and pass them to the engine. The CSP `connect-src ${webview.cspSource}` directive allows `fetch()` to webview-resolvable URIs.

### 6.3 Challenge: `localStorage` for Auto-Save

**Problem**: The designer uses `localStorage.setItem('bjl_draft', ...)` for auto-save. In a webview, `localStorage` is scoped to the webview's origin and may be cleared unexpectedly.

**Mitigation**: Override `_autoSave()` and `_restoreDraft()` in the bridge script to use `postMessage` to the extension host instead. The extension host manages persistence via `vscode.workspace.fs`.

### 6.4 Challenge: SweetAlert2 Dialogs

**Problem**: SweetAlert2 creates modal dialogs. In a webview, these work fine but may need z-index adjustments.

**Mitigation**: SweetAlert2 works in webviews without modification. The CSP allows `style-src 'unsafe-inline'` which SweetAlert2 needs for its inline styles.

### 6.5 Challenge: Binary BJL File Handling

**Problem**: `.bjl` files are gzip-compressed binary format. The webview can't read binary files directly.

**Mitigation**: All binary conversion happens on the extension host side using a Node.js port of `BJLConverter`. The webview only works with JSON objects.

### 6.6 Challenge: Large Asset Size

**Problem**: The editor assets total ~3MB (vanilla-jsoneditor: 1.2MB, daisyui CSS: 950KB, jsoneditor: 1MB, etc.).

**Mitigation**: 
- VS Code webviews cache resources — they're loaded once per session
- `retainContextWhenHidden: true` prevents re-loading when switching tabs
- Consider lazy-loading the JSON editor (only load when user toggles to JSON view)

### 6.7 Challenge: Remix Icon Font Path

**Problem**: `remixicon.css` uses relative paths (`./remixicon.woff2`) which don't resolve in webviews.

**Mitigation**: Same pattern as codicon fonts — redeclare `@font-face` with `webview.asWebviewUri()` paths:

```css
@font-face {
    font-family: "remixicon";
    src: url("${iconWoff2Uri}") format("woff2"),
         url("${iconWoffUri}") format("woff"),
         url("${iconTtfUri}") format("truetype");
}
```

### 6.8 Challenge: Tailwind Browser JS

**Problem**: The standalone app uses `tailwind.min.js` (browser version) which scans the DOM for class names. This is already used in our existing webviews.

**Mitigation**: Already solved — we have `media/tailwind-browser.js` in the extension. Reuse it or use the Sithaso version.

---

## 7. Implementation Order

| Phase | Task | Effort | Risk |
|-------|------|--------|------|
| **1** | Create `BjlEditorProvider` skeleton with CustomEditorProvider registration | 2h | Low |
| **2** | Port `BJLConverter` to TypeScript (Node.js side) | 4h | Medium — binary format parsing |
| **3** | Create webview HTML template with CSP, nonces, resource URIs | 3h | Low |
| **4** | Copy and adapt Sithaso JS/CSS assets to `media/bjl-editor/` | 2h | Low |
| **5** | Create `bjl-designer-bridge.js` (VS Code ↔ webview glue) | 4h | Medium — override patterns |
| **6** | Implement file open (binary → JSON → webview) | 3h | Medium |
| **7** | Implement file save (webview → JSON → binary) | 3h | Medium |
| **8** | Implement dirty state tracking | 2h | Low |
| **9** | Theme integration (VS Code dark/light sync) | 1h | Low |
| **10** | Schema loading via webview URIs | 2h | Medium — fetch in webview |
| **11** | Fix dynamic import issue (vanilla-jsoneditor-bridge) | 1h | Low |
| **12** | Fix font paths (remixicon, quill) | 1h | Low |
| **13** | Override localStorage auto-save → postMessage | 2h | Low |
| **14** | Testing with real .bjl files | 4h | Medium |
| **15** | Testing with .bjl.json files | 2h | Low |
| **16** | Edge cases: revert, backup, hot exit | 3h | Medium |
| **17** | Performance optimization (lazy loading) | 2h | Low |
| | **Total estimated effort** | **~36h** | |

---

## 8. Testing Strategy

### 8.1 Unit Tests

- `BJLConverter.binaryToJson()` — round-trip test with known .bjl files
- `BJLConverter.jsonToBinary()` — verify binary output matches original
- Message protocol — verify all message types serialize/deserialize correctly

### 8.2 Integration Tests

- Open a `.bjl` file → webview loads with correct data
- Open a `.bjl.json` file → webview loads with correct data
- Edit in designer → Ctrl+S → file saved correctly
- Edit in designer → switch to JSON view → edit → switch back → data preserved
- Close unsaved file → VS Code prompts "Save changes?"
- Revert file → webview shows original content

### 8.3 Manual Tests

- [ ] Click `.bjl` file → opens in custom editor (not text editor)
- [ ] Click `.bjl.json` file → opens in custom editor
- [ ] Drag-and-drop components works
- [ ] Resize components works
- [ ] Snap-to-grid works
- [ ] Undo/Redo works
- [ ] Copy/Cut/Paste works
- [ ] JSON editor toggle works
- [ ] Outline tree syncs with canvas
- [ ] Dark theme matches VS Code
- [ ] Light theme matches VS Code
- [ ] Schema loading completes (all 128 components available)
- [ ] Binary BJL import works
- [ ] Binary BJL export/save works
- [ ] JSON BJL import works
- [ ] JSON BJL export/save works
- [ ] SweetAlert2 dialogs display correctly
- [ ] Remix icons render correctly
- [ ] No CSP violations in DevTools console

---

## 9. Rollback Plan

If the custom editor integration proves too complex or unstable:

1. **Fallback**: Register a command `b4xIntellisense.openBjlEditor` that opens a `WebviewPanel` (like the Library Browser) instead of a Custom Editor
2. **Minimal version**: Strip the visual designer and provide only the JSON editor view for `.bjl.json` files
3. **External launch**: Open the standalone `index.html` in the system browser (simplest, but loses VS Code integration)

---

## 10. Key Decisions to Make

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Editor type | Custom Editor vs. Webview Panel | **Custom Editor** — proper file integration |
| 2 | BJL conversion location | Extension host vs. Webview | **Extension host** — Node.js pako, no CSP issues |
| 3 | Schema loading | fetch() with webview URIs vs. embedded JSON | **fetch() with webview URIs** — keeps HTML lean |
| 4 | Auto-save mechanism | localStorage vs. postMessage | **postMessage** — proper VS Code integration |
| 5 | Theme sync | Manual toggle vs. auto-detect | **Auto-detect** from VS Code theme |
| 6 | Asset bundling | Copy to media/ vs. npm package | **Copy to media/** — simpler, no build step |
| 7 | JSON editor | Include vs. lazy-load | **Include** — already in Sithaso project |
| 8 | Tailwind | Reuse existing vs. Sithaso version | **Reuse existing** `media/tailwind-browser.js` |

---

*This plan is ready for review. Once approved, implementation can begin with Phase 1 (Custom Editor Provider skeleton) and Phase 2 (BJL Converter port) in parallel.*
# VS Code B4X IDE Companion

> **Comprehensive IDE companion for the B4X family (B4A, B4i, B4J, B4R)** — IntelliSense · LSP · Type Inference · Diagnostics · Code Actions · Theme Import · Project Management

![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.95-blue)
![Version](https://img.shields.io/badge/version-0.1.248-green)
![Platforms](https://img.shields.io/badge/platforms-B4A%20%7C%20B4i%20%7C%20B4J%20%7C%20B4R-orange)

---

## Overview

**VS Code B4X IDE Companion** brings the B4X development experience into Visual Studio Code. It provides a full developer toolkit including a local Language Server Protocol (LSP) backend, fast workspace indexer, cross-file type inference, persistent SQLite-backed library caching, and server-side refactoring — all designed to work offline-first with your existing B4X installation.

The extension **auto-discovers** platform INI configuration files for all four B4X platforms from `%APPDATA%\Anywhere Software\`, so library paths, additional libraries folders, fonts, and themes are picked up automatically without manual settings.

---

## Features

### Language Intelligence

| Feature | Description |
|---|---|
| **Contextual Completions** | Smart auto-complete for classes, methods, properties, and local symbols |
| **Language Keywords** | Completions for `If`, `For`, `Select`, `Try`, `Dim`, and 70+ other B4X keywords |
| **Primitive Type Hover** | Hover over `String`, `Int`, `Boolean`, etc. for type documentation |
| **Member Completions after `.`** | Typing `obj.` resolves the owner class via type inference and shows members |
| **Cross-file Type Inference** | Infers variable types across workspace files to power completions and hover |
| **Go to Definition** | `Ctrl+Click` / `F12` to jump to class, method, or member definitions |
| **Find All References** | `Shift+F12` to find all usages of a symbol across files |
| **Hover Documentation** | Hover to see signatures, descriptions, parameters, and return types |
| **Signature Help** | Parameter hints inside Sub/function calls (triggered by `(` and `,`) |
| **Semantic Token Highlighting** | Globals from `Class_Globals` and `Process_Globals` are colorized in methods |
| **Local Symbol Completions** | Variables and Subs declared in the current file |
| **Workspace Class Completions** | Classes and modules found across all open workspace `.bas` files |

### Syntax & Editing

| Feature | Description |
|---|---|
| **B4X Syntax Highlighting** | Full TextMate grammar for all B4X keywords, types, and language constructs |
| **Auto-Close Keywords** | Automatically inserts `End If`, `Next`, `End Select`, `End Try`, `End Sub` on Enter |
| **Code Folding** | Fold Sub/If/For/Select/Try/Do/While/Type/Region blocks |
| **100+ Code Snippets** | Type prefixes like `select`, `foreach`, `try`, `b4xpage`, `customview` + Tab |
| **Indentation Rules** | Automatic indentation for nested blocks and statements |

### Library Support

| Feature | Description |
|---|---|
| **XML Library Parsing** | Parses XML library descriptors for classes, methods, properties, and fields |
| **`.b4xlib` Archive Extraction** | Extracts `.bas`/`.b4x` modules from `.b4xlib` ZIP archives for IntelliSense |
| **Project-scoped Filtering** | Reads the project's `<Libraries>` section; only allowed libraries are loaded |
| **Persistent SQLite Index** | Caches library metadata on disk with safe atomic writes and migrations |
| **Install + Additional Libraries** | Scans both the platform installation Libraries folder and AdditionalLibrariesFolder from INI |

### Diagnostics & Code Actions

| Feature | Description |
|---|---|
| **Type Diagnostics** | Warns when `Type` is declared outside `Class_Globals` / `Process_Globals` |
| **Quick-fix Code Actions** | Moves misplaced `Type` blocks into the correct scope with one click |
| **Extract Method** | Select code and extract it into a new Sub with inferred parameters (preview) |

### LSP Backend

| Feature | Description |
|---|---|
| **Local Language Server** | Runs a Node.js LSP server via stdio for server-side analysis |
| **Worker Pool Indexer** | Background file indexer with worker threads for fast symbol parsing |
| **Rename Support** | Server-side rename refactoring across files |

### Project Management

| Feature | Description |
|---|---|
| **Open B4X Project** | File picker for `.b4a`, `.b4i`, `.b4j`, `.b4r` — loads workspace and libraries |
| **Auto Workspace Setup** | Automatically adds/opens project folder in VS Code on project open |
| **Session Persistence** | Remembers last opened project and auto-reloads IntelliSense on next launch |
| **Build & Install** | One-command build for B4A/B4J (auto-detects platform, installs APK on device) |
| **Auto-backup** | Periodic backup of project folder when AutoBackup=True in system INI |
| **Main Module Sync** | Edits to generated Main `.b4x` are synced back to the project file |

### Platform INI & Theme Integration

| Feature | Description |
|---|---|
| **Multi-platform Auto-discovery** | Finds `b4xV5.ini` for B4A, B4i, B4J, B4R from `%APPDATA%\Anywhere Software\` |
| **Font & Theme Hints** | Applies IDE font family, font size, and color theme from INI settings |
| **`.vssettings` Theme Import** | Import B4A themes from the install's Themes folder into VS Code |
| **AutoSave / AutoFormat** | Applies `files.autoSave` and `editor.formatOnSave` per system INI flags |

### Developer Tools

| Feature | Description |
|---|---|
| **Capture GIF from Device** | Record a GIF from a connected Android device via adb + ffmpeg |
| **Capture Screenshots** | Capture a sequence of screenshots from a connected device |
| **IntelliSense Diagnostics** | Dump full diagnostic JSON showing loaded libraries, classes, and resolution |
| **IntelliSense Report** | Generate an HTML report of all loaded classes, methods, and properties |

---

## Quick Start

1. **Install** the extension from the VS Code Marketplace (or load the `.vsix` manually).
2. Open VS Code and run **`Ctrl+Shift+P`** → **B4X IntelliSense: Open B4X Project…**
3. Select your `.b4a`, `.b4i`, `.b4j`, or `.b4r` project file.
4. The extension will:
   - Add the project folder to your workspace
   - Discover platform INI files and library paths automatically
   - Load allowed XML libraries and `.b4xlib` archives
   - Extract and index `.bas` modules from `.b4xlib` files
   - Start the LSP language server
   - Apply font and theme hints from your B4X IDE configuration

> **Tip:** You don't need to configure any paths manually. The extension reads `b4xV5.ini` from `%APPDATA%\Anywhere Software\` for each platform and discovers library folders automatically. Override paths in Settings only if your installation is non-standard.

---

## Commands

| Command | Keybinding | Description |
|---|---|---|
| **Open B4X Project…** | | Select and open a B4X project file |
| **Load Project Assets** | | Manually trigger library and module loading |
| **Build & Install Project** | | Build via B4ABuilder.exe and install to device via adb |
| **Import Theme From B4A Install** | | Pick and import a `.vssettings` theme from B4A Themes/ |
| **Open Extension Settings** | | Open VS Code Settings filtered to B4X IntelliSense |
| **Open Documentation** | `Ctrl+Shift+H` | Open the README or User Manual |
| **Open B4X Website** | | Open b4x.com in an embedded webview |
| **Capture GIF from Device** | | Record a GIF from a connected Android device |
| **Capture Screenshots (Scroll)** | | Capture screenshot sequence from device |
| **Run All Diagnostics** | | Dump state, stores, and diagnostics to JSON |
| **List Registered Commands** | | Show all registered b4x\* commands in output channel |

---

## Extension Settings

All settings are prefixed with `b4xIntellisense.` in VS Code.

| Setting | Default | Description |
|---|---|---|
| `b4aIniPath` | *(auto-detected)* | Path to B4A `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4iIniPath` | *(auto-detected)* | Path to B4i `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4jIniPath` | *(auto-detected)* | Path to B4J `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4rIniPath` | *(auto-detected)* | Path to B4R `b4xV5.ini`. Leave empty for auto-discovery. |
| `preferLiveSources` | `true` | Prefer live workspace/XML/.b4xlib sources over the bundled API index. |
| `b4aInstallPath` | `C:\Program Files\Anywhere Software\B4A` | B4A installation folder (for theme import and builder). |
| `autoApplyIni` | `prompt` | Font/theme hint application: `prompt`, `always`, or `never`. |
| `autoAddProjectFolderOnOpen` | `true` | Add project folder as workspace folder on Open B4X Project. |
| `autoOpenProjectFolderOnOpen` | `false` | Replace workspace with project folder on Open B4X Project. |
| `autoLoadProjectAssets` | `true` | Automatically load libraries and start LSP after opening a project. |
| `autoBackupInterval` | `600000` | Auto-backup interval in ms (default 10 minutes). |
| `extractMethod.previewBehavior` | `prompt` | Extract Method: `prompt`, `autoApply`, or `alwaysPreview`. |
| `fontFamily` | `Fira Code Retina` | Font family for extension webviews. |
| `fontSize` | `12` | Font size (px) for extension webviews. |
| `tabSize` | `4` | Tab size for extension webviews. |
| `wordWrap` | `true` | Word wrap in extension webviews. |
| `disableConsoleOutput` | `true` | Suppress console output; use log file instead. |
| `debug` | `false` | Append a timestamped debug log file for extension actions. |
| `enableTelemetry` | `false` | Opt-in anonymous telemetry for basic feature usage. |

---

## How It Works

### Platform Discovery

On activation (or when a project is opened), the extension scans `%APPDATA%\Anywhere Software\` for each platform's INI file:

| Platform | AppData Folder | INI File |
|---|---|---|
| B4A | `Basic4android\` | `b4xV5.ini` |
| B4i | `B4i\` | `b4xV5.ini` |
| B4J | `B4J\` | `b4xV5.ini` |
| B4R | `B4R\` | `b4xV5.ini` |

From each INI file, the extension reads:

- **LibrariesFolder** — path to installed platform libraries (XML descriptors)
- **AdditionalLibrariesFolder** — path to user-added libraries (XML and `.b4xlib`)
- **PlatformFolder** — used to derive the Android SDK path for adb
- **FontName2 / FontSize2** — editor font hints
- **CodeTheme / IdeTheme2** — color theme hints

### Library Loading

1. The opened project file (`.b4a`, `.b4i`, `.b4j`, `.b4r`) is parsed for its `<Libraries>` section.
2. Only libraries declared in the project are loaded (project-scoped filtering).
3. For each library name, the extension searches installation and additional library folders for:
   - `.xml` descriptors → parsed for classes, methods, properties, and fields
   - `.b4xlib` archives → extracted via `node-stream-zip`; contained `.bas`/`.b4x` modules are indexed
4. Extracted module metadata is cached in a persistent SQLite database.

### IntelliSense Stores

The extension maintains three in-memory class stores:

- **API Index** — bundled/generated API classes (optional, graceful fallback if absent)
- **Workspace Classes** — classes from `.bas`/`.b4x` files in the workspace (updated on save/edit)
- **XML Libraries** — classes parsed from XML library descriptors

All three stores are queried for completions, hover, go-to-definition, and signature help.

---

## Syntax Highlighting & Snippets

- **TextMate Grammar** — Full B4X syntax highlighting for keywords, types, strings, comments, regions, preprocessor directives, and more.
- **Snippets** — Common B4X patterns: `Sub`, `If/Then`, `For/Next`, `Select Case`, `Try/Catch`, `Type`, and more.
- **Semantic Tokens** — Variables from `Class_Globals` / `Process_Globals` receive additional semantic coloring when used inside methods.

---

## Requirements

- **VS Code** `≥ 1.95`
- **Node.js** (bundled with VS Code)
- A B4X project with `.bas` / `.b4x` source files
- For full library IntelliSense: an installed B4X platform (B4A, B4i, B4J, or B4R) with XML library descriptors

---

## Project Structure

```
src/
  extension.ts                – Main extension entry: activation, commands, providers
  apiIndex.ts                 – Generated/bundled API index store
  b4xDocParser.ts             – Completion/cursor-context utilities
  b4xTypeInference.ts         – Cross-file variable type inference engine
  b4xLocalSymbols.ts          – Local symbol extraction (Dim, Sub, etc.)
  platformConfig.ts           – Multi-platform INI auto-discovery
  platformIni.ts              – INI file parser
  projectFile.ts              – .b4a/.b4i/.b4j/.b4r project parser
  xmlLibraryIndex.ts          – XML library descriptor parser
  workspaceClassIndex.ts      – Workspace .bas/.b4x file indexer
  b4xLibStore.ts              – .b4xlib archive handling
  typeDiagnostics.ts          – Type placement diagnostics
  typeCodeAction.ts           – Quick-fix code action for Type blocks
  extractMethodCodeAction.ts  – Extract Method refactoring
  lspClient.ts                – LSP client (connects to server/)
  vssettingsImporter.ts       – .vssettings theme file import
  types.ts                    – Shared B4X type definitions
  storage/
    libraryIndexSqlite.ts     – Persistent SQLite library cache

server/
  server.js                   – LSP server (stdio transport)
  logger.js                   – Server-side logging
  indexer/
    fileSymbolParser.js       – .bas/.b4x file symbol extraction
    globalSymbolTable.js      – Cross-file symbol table
    extractMethod.js          – Server-side Extract Method logic
    inferParams.js            – Parameter inference for extracted methods
    workerPool.js             – Background worker thread pool
    workerTask.js             – Worker task definitions

snippets/
  b4x.json                   – B4X code snippets

syntaxes/
  b4x.tmLanguage.json        – TextMate grammar for B4X
```

---

## Known Issues

- The XML parser does not currently handle `<event>`, `<objectwrapper>`, or `<owner>` elements from library descriptors.
- Theme import from `.vssettings` files performs a best-effort color mapping; some B4A themes may not translate perfectly.

---

## Release Notes

See [CHANGELOG.md](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/CHANGELOG.md) for full release history.

### 0.1.248

- Multi-platform auto-discovery for B4A, B4i, B4J, and B4R INI files
- LSP backend with worker pool indexer
- `.b4xlib` archive extraction via `node-stream-zip`
- Extract Method code action with preview
- Type diagnostics and quick-fix code actions
- Persistent SQLite library index
- Theme import from B4A install
- Build & Install to device
- GIF/Screenshot capture tools
- Semantic token highlighting for globals
- Session persistence and auto-reload

### 0.1.0

Initial release with core IntelliSense features.

---

## Contributing

See [CONTRIBUTING.md](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/CONTRIBUTING.md) for development setup and guidelines.

## License

See [LICENSE](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/LICENSE) for details.

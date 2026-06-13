# VS Code B4X IDE Companion

> **Comprehensive IDE companion for the B4X family (B4A, B4i, B4J, B4R)** — IntelliSense · LSP · Type Inference · Diagnostics · Code Actions · Formatting · Theme Import · Project Management

![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.95-blue)
![Version](https://img.shields.io/badge/version-0.1.418-green)
![Platforms](https://img.shields.io/badge/platforms-B4A%20%7C%20B4i%20%7C%20B4J%20%7C%20B4R-orange)

---

## Overview

**VS Code B4X IDE Companion** brings the B4X development experience into Visual Studio Code. It provides a full developer toolkit including a local Language Server Protocol (LSP) backend, fast workspace indexer, cross-file type inference, structural code formatting, persistent SQLite-backed library caching, and server-side refactoring — all designed to work offline-first with your existing B4X installation.

The extension **auto-discovers** platform INI configuration files for all four B4X platforms from `%APPDATA%\Anywhere Software\`, so library paths, additional libraries folders, fonts, and themes are picked up automatically without manual settings.

---

## Features

### Language Intelligence

| Feature | Description |
|---|---|
| **Contextual Completions** | Smart auto-complete for classes, methods, properties, and local symbols |
| **Language Keywords** | Completions for `If`, `For`, `Select`, `Try`, `Dim`, and 70+ other B4X keywords |
| **Preprocessor Directive Completions** | Type `#` for `#If B4A`, `#Region`, `AdditionalJar:`, `Event:`, and more |
| **Primitive Type Hover** | Hover over `String`, `Int`, `Boolean`, etc. for type documentation |
| **Member Completions after `.`** | Typing `obj.` resolves the owner class via type inference and shows members |
| **Cross-file Type Inference** | Infers variable types across workspace files to power completions and hover |
| **Go to Definition** | `F12` to jump to Sub, Type, class, or member definitions — across modules and XML libraries |
| **Peek Definition** | `Alt+F12` for inline definition peek without leaving your current position |
| **Find All References** | `Shift+F12` to find all usages of a symbol across all project files on disk |
| **Rename Symbol** | `F2` to rename a symbol with case preservation across all project files |
| **Hover Documentation** | Hover to see signatures, descriptions, parameters, and return types |
| **Signature Help** | Parameter hints inside Sub/function calls (triggered by `(` and `,`) |
| **Ghost Text Completions** | Inline tab-acceptable completions for Sub calls with parameter hints |
| **Semantic Token Highlighting** | Globals from `Class_Globals` and `Process_Globals` are colorized in methods |
| **Local Symbol Completions** | Variables and Subs declared in the current file |
| **Workspace Class Completions** | Classes and modules found across all open workspace `.bas` files |
| **Document Symbol Outline** | `Ctrl+Shift+O` — jump to any Sub, Type, Region, or global variable in the current file |
| **Workspace Symbol Search** | `Ctrl+T` — fuzzy-search any Sub, method, property, or class across the entire workspace |
| **Go to Definition in Hover** | Hover box includes actionable links for Go to Definition, Find All References, and Search Online |

### Code Formatting

| Feature | Description |
|---|---|
| **Structural Formatting** | Block-aware indentation for `Sub/End Sub`, `If/End If`, `For/Next`, `Select/End Select`, `Try/Catch/End Try`, `Do/Loop`, `#Region/#End Region`, `#If/#End If` |
| **Keyword Casing** | Normalizes keyword casing (`end sub` → `End Sub`) with ALLCAPS preservation |
| **Blank Line Management** | Collapses consecutive blank lines; ensures spacing between Subs |
| **Un-Format Document** | Strip all leading indentation — left-align every line |
| **Un-Format Selection** | Strip leading indentation from the selected lines only |
| **Remove Blank Lines** | Delete every empty line, compact to a single code block |
| **`#EndOfDesignText@` Awareness** | Designer header preserved verbatim; formatting starts below it |
| **String & Comment Protection** | Never touches content inside `"strings"` or `'comments` |

### Syntax & Editing

| Feature | Description |
|---|---|
| **B4X Syntax Highlighting** | Full TextMate grammar for all B4X keywords, types, and language constructs |
| **Auto-Close Keywords** | Automatically inserts `End If`, `Next`, `End Select`, `End Try`, `End Sub` on Enter |
| **Auto-Casing on Type** | Fixes keyword casing as you type (space, Enter, colon) |
| **Code Folding** | Fold Sub/If/For/Select/Try/Do/While/Type/Region/Case/Catch blocks |
| **100+ Code Snippets** | Type prefixes like `select`, `foreach`, `try`, `b4xpage`, `customview` + Tab |
| **Indentation Rules** | Automatic indentation for nested blocks and statements |
| **Smart Expand Selection** | Word → Line → Sub Block → Document |
| **Symbol Highlighting** | Highlights all occurrences of the symbol under cursor (read vs. write access) |

### Diagnostics & Code Actions

| Feature | Description |
|---|---|
| **Type Diagnostics** | Warns when `Type` is declared outside `Class_Globals` / `Process_Globals` |
| **CallSub Validation** | Warns when `CallSub`/`CallSubDelayed` references a Sub that doesn't exist |
| **Unused Sub Diagnostics** | Flags Private Subs never called from their own module (Hint) and Public Subs never called from any module (Warning); excludes lifecycle Subs and event handlers; toggle via `enableUnusedSubDiagnostics` |
| **Unused Library Diagnostics** | Flags libraries declared in the project file whose types are never referenced in code (Information); toggle via `enableUnusedLibraryDiagnostics` |
| **Quick-fix Code Actions** | Moves misplaced `Type` blocks into the correct scope with one click |
| **Extract Method** | Select code and extract it into a new Sub with inferred parameters (preview) |
| **Insert Event Handler** | Generate event handler Sub templates |
| **Code Lens** | Inline reference counts above each Sub declaration — click to trigger Find All References |

### Document Links

| Feature | Description |
|---|---|
| **Clickable `#AdditionalJar:` Paths** | Click to jump to the referenced JAR file |
| **Clickable `LoadLayout("Name")` Paths** | Click to jump to the `.bal` layout file |
| **Clickable `B4XPages.ShowPage("Name")` Paths** | Click to jump to the page module |

### LSP Backend

| Feature | Description |
|---|---|
| **Local Language Server** | Runs a Node.js LSP server via stdio for server-side analysis |
| **Worker Pool Indexer** | Background file indexer with worker threads for fast symbol parsing |
| **Rename Support** | Server-side rename refactoring across files |
| **Extract Method** | Server-side method extraction with parameter inference |

### Library Support

| Feature | Description |
|---|---|
| **XML Library Parsing** | Parses XML library descriptors for classes, methods, properties, and fields |
| **`.b4xlib` Archive Extraction** | Extracts `.bas`/`.b4x` modules from `.b4xlib` ZIP archives for IntelliSense |
| **Project-scoped Filtering** | Reads the project's `<Libraries>` section; only allowed libraries are loaded |
| **Persistent SQLite Index** | Caches library metadata on disk with safe atomic writes and migrations |
| **Install + Additional Libraries** | Scans both the platform installation Libraries folder and AdditionalLibrariesFolder from INI |
| **Common Class Extraction** | `Log`, `Msgbox`, `StartActivity`, etc. callable without `Common.` prefix |
| **Library Cache Management** | Refresh, show DB path, and clear cache commands |

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
| **IntelliSense Health** | Check IntelliSense health status in the tree view |
| **Project Statistics** | Interactive dashboard with stat cards, per-module table, and Chart.js charts (line composition, top 10 subroutines, top 10 module size breakdown) |
| **Search Online** | Open B4X forum search for the word under cursor in the right context menu |
| **Open B4X Website** | Open b4x.com in an embedded webview |

---

## B4X Companion Context Menu

Right-click in any `.bas` or `.b4x` editor to access the **B4X Companion** submenu. All items are grouped by function and **only appear** when editing B4X files.

### Navigation

| Item | Shortcut | What it does |
|---|---|---|
| **Go to Definition** | `F12` | Jump to where the symbol is defined (local Sub, other module, or XML library) |
| **Peek Definition** | `Alt+F12` | Open inline definition peek without leaving your current position |
| **Find All References** | `Shift+F12` | Find every occurrence of the symbol across all project files on disk |
| **Rename Symbol** | `F2` | Rename the symbol everywhere with case preservation (`MYVAR` → `NEWNAME`) |
| **Go to Symbol in File** | `Ctrl+Shift+O` | Fuzzy-search for any Sub, Type, or variable in the current file |
| **Go to Implementation** | `Shift+F12` | Jump to the concrete implementation of a Sub in other modules |
| **Go to Type Definition** | — | Jump to the class definition of a type (e.g., `Button` → Button XML class) |

### Formatting

| Item | Shortcut | What it does |
|---|---|---|
| **Format Document** | `Shift+Alt+F` | Apply structural formatting: block indentation, keyword casing, blank line management |
| **Format Selection** | — | Apply formatting to only the selected text range |
| **Un-Format Selection** | — | Strip leading indentation from the selected lines only |
| **Un-Format Document** | — | Strip all leading indentation from every line (left-align everything) |

### Comments & Cleanup

| Item | What it does |
|---|---|
| **Block Comment** | Add `' ` prefix to each selected line (B4X comment style). Skips blank/already-commented lines |
| **Un-Block Comment** | Remove leading `' ` prefix from each selected line. Skips non-comment lines |
| **Remove Blank Lines** | Delete every empty line, compact the file to a single code block |
| **Remove Comments** | Delete every comment-only line (lines starting with `'`), then auto-format |

### Tools

| Item | Shortcut | What it does |
|---|---|---|
| **Quick Fix** | `Ctrl+.` | Show available code actions (Move Type block, Extract Method) |
| **Trigger Suggestions** | `Ctrl+Space` | Manually trigger auto-complete suggestions |
| **Parameter Hints** | `Ctrl+Shift+Space` | Show parameter list for the current Sub call |

### External

| Item | What it does |
|---|---|
| **Search Online** | Opens B4X forum search for the word under cursor, filtered by platform (B4A/B4J/B4i/B4R) |

These items are **hidden from the Command Palette** (`Ctrl+Shift+P`) — they only appear in the right-click context menu.

---

## Quick Start

1. **Install** the extension from the VS Code Marketplace (or load the `.vsix` manually).
2. Open VS Code and run **`Ctrl+Shift+P`** → **B4X Companion: Open B4X Project…**
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
| **Build & Install Project** | | Build via B4ABuilder.exe/B4JBuilder.exe and install to device |
| **Import Theme From B4X Install** | | Pick and import a `.vssettings` theme from B4X Themes/ |
| **Open Extension Settings** | | Open VS Code Settings filtered to B4X Companion |
| **Open Documentation** | `Ctrl+Shift+H` | Open the README or User Manual |
| **Project Statistics** | | Open interactive dashboard with project metrics and charts |
| **IntelliSense Health** | | Check IntelliSense health status |
| **Open B4X Website** | | Open b4x.com in an embedded webview |
| **Capture GIF from Device** | | Record a GIF from a connected Android device |
| **Capture Screenshots (Scroll)** | | Capture screenshot sequence from device |
| **Run All Diagnostics** | | Dump state, stores, and diagnostics to JSON |
| **Backup Workspace** | | Create a backup of the current workspace |
| **Extract Method** | | Extract selected code into a new Sub with inferred parameters |
| **Insert Event Handler** | | Generate event handler Sub templates |

> **Note:** Some commands are hidden from the Command Palette and are only accessible via the editor context menu (right-click → B4X Companion). These include navigation commands (Go to Definition, Find References, etc.), formatting commands, and utility commands. Technical maintenance commands (Refresh Library Index, Clear Library Cache, Set Platform Install Path) are also hidden to reduce clutter.

---

## Extension Settings

All settings are prefixed with `b4xIntellisense.` in VS Code.

| Setting | Default | Description |
|---|---|---|
| `b4aIniPath` | *(auto-detected)* | Path to B4A `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4iIniPath` | *(auto-detected)* | Path to B4i `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4jIniPath` | *(auto-detected)* | Path to B4J `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4rIniPath` | *(auto-detected)* | Path to B4R `b4xV5.ini`. Leave empty for auto-discovery. |
| `b4aInstallPath` | `C:\Program Files\Anywhere Software\B4A` | B4A installation folder (for theme import and builder). |
| `b4iInstallPath` | `C:\Program Files (x86)\Anywhere Software\B4i` | B4i installation folder. |
| `b4jInstallPath` | `C:\Program Files\Anywhere Software\B4J` | B4J installation folder. |
| `b4rInstallPath` | `C:\Program Files\Anywhere Software\B4R` | B4R installation folder. |
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
| `adbPath` | *(auto-detected)* | Path to the adb executable for device operations. |
| `ffmpegPath` | *(auto-detected)* | Path to the ffmpeg executable for GIF capture. |
| `wine.enabled` | `false` | Enable Linux/Wine path resolution for B4X installations. |
| `wine.prefix` | *(auto-detected from `WINEPREFIX` or `~/.wine`)* | Wine prefix used to resolve `b4xV5.ini`, install folders, and Windows-style paths on Linux. |
| `filterExplorerFiles` | `false` | Hide non-project B4X files from the Explorer. Disabled by default to avoid accidentally hiding modules on Linux/Wine. |
| `enableUnusedSubDiagnostics` | `true` | Detect unused Private (Hint) and Public (Warning) Subroutines. |
| `enableUnusedLibraryDiagnostics` | `true` | Detect unused declared libraries (Information severity). |

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

1. The opened project file (`.b4a`, `.b4i`, `.b4j`, `.b4r`) is parsed for its `LibraryN=` entries.
2. Only libraries declared in the project are loaded (project-scoped filtering).
3. For each library name, the extension searches installation and additional library folders for:
   - `.xml` descriptors → parsed for classes, methods, properties, and fields
   - `.b4xlib` archives → extracted via `node-stream-zip`; contained `.bas`/`.b4x` modules are indexed
4. Extracted module metadata is cached in a persistent SQLite database.

### IntelliSense Stores

The extension maintains four in-memory class stores:

- **XML Libraries** (`XmlLibraryStore`) — classes parsed from XML library descriptors
- **Workspace Classes** (`WorkspaceClassStore`) — classes from `.bas`/`.b4x` files in the workspace (updated on save/edit)
- **Common Class** (`CommonClassStore`) — the `Common` class from Core.xml (`Log`, `Msgbox`, `StartActivity`, etc.) callable without prefix
- **Primitive Types** (`PrimitiveTypeStore`) — synthetic class definitions for `Int`, `Float`, `Double`, `Long`, `Byte`, `Short`, `Boolean`, `Char`, `Object`, `String`, `StringBuilder`

All four stores are queried for completions, hover, go-to-definition, and signature help.

### Type Inference

When you type `obj.`, the extension resolves the type of `obj` through:

1. `Dim` declarations in the current file
2. Sub parameter types
3. Local symbol types
4. Primitive type mappings
5. Cross-file inference scanning workspace `.bas` files

The resolved class is then looked up in both `WorkspaceClassStore` and `XmlLibraryStore` to provide member completions.

### Go to Definition Resolution Chain

When you press `F12` on a symbol, the provider resolves in order:

1. **Local Sub/Type** in the current document
2. **Workspace Sub** — searches all `.bas` modules in the project for a matching Sub name
3. **XML Library Method** — searches XML library classes for a matching method
4. **Workspace Class** — user-defined class/module by name
5. **XML Library Class** — SDK class by name

This means `DesignerCreateView` in another `.bas` file will resolve correctly, not just class-level symbols.

### Find All References

Searches the entire current file (no scope filtering) plus all `.bas`/`.b4x` files on disk under your workspace root — not just open tabs. Results appear in VS Code's native References panel, grouped by file.

---

## Syntax Highlighting & Snippets

- **TextMate Grammar** — Full B4X syntax highlighting for keywords, types, strings, comments, regions, preprocessor directives, and more.
- **Snippets** — 100+ common B4X patterns: `Sub`, `If/Then`, `For/Next`, `Select Case`, `Try/Catch`, `Type`, `B4XPage`, `CustomView`, `SQL`, `XUI`, and platform-specific snippets.
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
  extension.ts                        – Main extension entry: activation, commands, providers
  b4xAutoclose.ts                     – Auto-close keywords and 3-line Try block on Enter
  b4xCodeLensProvider.ts              – Reference counts above Subs
  b4xDocParser.ts                     – Completion/cursor-context utilities
  b4xDocumentFormattingProvider.ts    – Structural code formatter (5-phase pipeline)
  b4xDocumentHighlightProvider.ts     – Symbol highlighting (read vs. write access)
  b4xDocumentLinkProvider.ts          – Clickable links (#AdditionalJar, LoadLayout, ShowPage)
  b4xDocumentRangeFormattingProvider.ts – Range formatting delegation
  b4xDocumentSymbolProvider.ts        – Outline view / Ctrl+Shift+O
  b4xFoldingRangeProvider.ts          – Code folding
  b4xImplementationProvider.ts        – Go to Implementation (find Sub definitions)
  b4xInlineCompletionProvider.ts      – Ghost text completions with Tab accept
  b4xLocalSymbols.ts                  – Local symbol extraction (Dim, Sub, Types)
  b4xOnTypeFormattingProvider.ts      – Auto-casing on type (space, Enter, colon)
  b4xReferenceProvider.ts             – Find All References (on-disk search)
  b4xRenameProvider.ts                – F2 rename with case preservation
  b4xSelectionRangeProvider.ts        – Smart Expand Selection (Word → Line → Block → Doc)
  b4xTypeDefinitionProvider.ts        – Go to Type Definition (jump to class definition)
  b4xTypeInference.ts                 – Cross-file variable type inference engine
  b4xWorkspaceSymbolProvider.ts       – Ctrl+T workspace symbol search
  callSubDiagnostics.ts               – CallSub target validation
  commonClassStore.ts                 – Common class extraction (Log, Msgbox, etc.)
  extractMethodCodeAction.ts          – Extract Method refactoring code action
  logging.ts                          – File-based logging with timestamps
  lspClient.ts                        – LSP client (connects to server/)
  platformBuilders.ts                 – Platform builder configuration (B4A/B4J)
  platformConfig.ts                   – Multi-platform INI auto-discovery + Registry lookup
  platformIni.ts                      – INI file parser (LibrariesFolder, AdditionalLibraries, etc.)
  primitiveTypeStore.ts               – Primitive type mappings (Int, String, Boolean, etc.)
  projectFile.ts                      – .b4a/.b4i/.b4j/.b4r project parser
  projectStatisticsCore.ts             – Core logic for project statistics collection
  providers/projectStatisticsProvider.ts – Webview dashboard with Chart.js charts
  typeCodeAction.ts                   – Quick-fix for misplaced Type blocks
  typeDiagnostics.ts                  – Type placement diagnostics registration
  typeDiagnosticsCore.ts              – Core diagnostic logic (findMisplacedTypeRanges)
  types.ts                            – Shared B4X type definitions
  unusedSubDiagnostics.ts             – Unused Sub diagnostic provider
  unusedSubDiagnosticsCore.ts         – Core unused Sub detection logic
  unusedLibraryDiagnostics.ts         – Unused Library diagnostic provider
  unusedLibraryDiagnosticsCore.ts     – Core unused library detection logic
  vssettingsImporter.ts               – .vssettings theme file import
  workspaceClassIndex.ts              – Workspace .bas/.b4x file indexer
  xmlLibraryIndex.ts                  – XML library descriptor parser
  storage/
    libraryIndexSqlite.ts             – Persistent SQLite library cache (3-tier fallback)

server/
  server.js                           – LSP server (stdio transport)
  logger.js                           – Server-side logging
  indexer/
    documentManager.js                – Document/text management with symbol tables
    fileSymbolParser.js               – .bas/.b4x file symbol extraction
    globalSymbolTable.js              – Cross-file symbol table
    extractMethod.js                  – Server-side Extract Method logic
    inferParams.js                    – Parameter inference for extracted methods
    workerPool.js                     – Background worker thread pool
    workerTask.js                     – Worker task definitions

snippets/
  b4x.json                            – 100+ B4X code snippets

syntaxes/
  b4x.tmLanguage.json                 – TextMate grammar for B4X

scripts/
  tests/                              – Test scripts for type diagnostics, library index, etc.

test/
  sample workspace with .bas files    – Sample workspace for testing
```

---

## Known Issues

- The XML parser does not currently handle `<event>`, `<objectwrapper>`, or `<owner>` elements from library descriptors.
- Theme import from `.vssettings` files performs a best-effort color mapping; some B4A themes may not translate perfectly.

---

## Release Notes

See [CHANGELOG.md](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/CHANGELOG.md) for full release history.

### 0.1.418

- **Project Statistics Dashboard** — Interactive webview with stat cards (Total Lines, Code Lines, Comment Lines, Blank Lines, Modules, Subs, Events, Types), per-module table with totals row, and three Chart.js charts: Line Composition doughnut, Subroutines per Module Top 10, Module Size Breakdown Top 10
- **Unused Sub Diagnostics** — Detects unused Private and Public Subs, excluding lifecycle Subs and event handlers
- **Unused Library Diagnostics** — Flags declared libraries whose types are never referenced in project code
- **Chart.js Integration** — Bundled Chart.js v4.5.1 UMD for offline-capable, theme-aware webview charting
- **Improved LSP Resilience** — Server allows limited restarts instead of permanent DoNotRestart state
- **Fixed Extract Method Dim Parsing** — All comma-separated variables in `Dim a, b, c As Int` are now captured
- **Fixed Chart Label Visibility** — Bar chart Y-axis labels no longer skip entries
- **Fixed Cross-platform Module Names** — Platform extensions (`.b4a`, `.b4j`) preserved in chart labels

### 0.1.289

- **New B4X Project from Template** — Scans platform library folders for `.b4xtemplate` files and creates new projects from templates
- **Template Discovery** — Searches both `LibrariesFolder` and `AdditionalLibrariesFolder` with `[PLATFORM]` prefixes
- **Template Listing** — Sorted by platform, subfolder support, file extension hidden

### 0.1.272

- **Fixed trailing space bug** — Case/Return keywords followed by string literals now preserve spacing (`Case "btn"` instead of `Case"btn"`)
- **Fixed ALL-CAPS keyword normalization** — ALL-CAPS keywords now correctly normalize to TitleCase (`END SUB` → `End Sub`)
- **Added B4X primitive type keywords** — `Int`, `String`, `Long`, `Float`, `Double`, `Boolean`, `Byte`, `Short`, `Char`, `Object` get proper casing
- **Fixed #Else / #Else If indentation** — Preprocessor directive branches now indent correctly
- **Fixed # directive corruption** — `#AdditionalJar:`, `#Event:`, and all `#` lines are now preserved verbatim (no keyword casing or spacing changes), preventing Windows path breakage

### 0.1.271

- **Removed JAR-to-XML Generator** - Cleaned out Java bytecode parsing feature from extension scope
- **Command Palette Cleanup** - Hidden technical maintenance commands: Refresh Library Index, Clear Library Cache, Set Platform Install Path
- **Removed "B4X: " prefix** from all command titles for cleaner display

### 0.1.270

- **Go to Implementation** — Jump to concrete Sub implementations across workspace modules
- **Go to Type Definition** — Jump from type name to its class definition (e.g., `Button` → Button XML class)
- **Document Link Provider** — Clickable links for `#AdditionalJar:` paths, `LoadLayout("Name")` → `.bal` files, `B4XPages.ShowPage("Name")` → page modules
- **Inline Completion Provider** — Ghost text completions with Tab accept for Sub calls
- **Document Highlight Provider** — Highlights all occurrences of symbol under cursor with read/write distinction
- **Selection Range Provider** — Smart expand selection: Word → Line → Sub Block → Document
- **On-Type Formatting** — Auto-casing of keywords as you type (space, Enter, colon triggers)
- **Insert Event Handler** — Generate event handler Sub templates via command
- **Range Formatting** — Format only selected text range, not entire document
- **Common Class Store** — Dedicated extraction of Common class globals (`Log`, `Msgbox`, etc.)
- **Primitive Type Store** — Dedicated store for primitive type mappings and synthetic class definitions
- **Block Comment / Un-Block Comment** — Comment/uncomment selected lines with B4X `'` style
- **Format Selection / Un-Format Selection** — Apply/remove formatting to selected range only
- **Command Palette Cleanup** — Hidden technical commands: Refresh Library Index, Clear Library Cache, Set Platform Install Path
- **3-Tier SQLite Fallback** — better-sqlite3 (native) → sql.js (WASM) → in-memory fallback
- **File-based Logging** — Timestamped log files (`b4x-log-YYYYMMDD.txt`) with workspace root or global storage

### 0.1.258

- **Structural Code Formatter** — VB.NET-quality indentation tracking for all B4X block constructs (`Sub/End Sub`, `If/End If`, `For/Next`, `Select/End Select`, `Try/Catch/End Try`, `Do/Loop`, `#Region/#End Region`, `#If/#End If`), keyword casing normalization, blank line management
- **Document Symbol Provider** — Outline view and `Ctrl+Shift+O` for Subs, Types, Regions, and globals
- **Workspace Symbol Provider** — `Ctrl+T` fuzzy search across all workspace modules and XML libraries
- **Rename Provider** — `F2` rename with case preservation across all project files
- **Code Lens** — Reference counts above Sub declarations
- **CallSub Validation** — Diagnostics for `CallSub`/`CallSubDelayed` targeting non-existent Subs
- **Preprocessor Directive Completions** — Type `#` for completions (`#If B4A`, `#Region`, `AdditionalJar:`, etc.)
- **Go to Definition Across Modules** — Resolves Subs in other `.bas` files, not just classes
- **Find All References On-Disk** — Searches all workspace files on disk, not just open tabs
- **Hover Action Links** — Go to Definition, Find All References, and Search Online in hover tooltips
- **Un-Format Document** — Strip all leading indentation
- **Remove Blank Lines** — Compact file to single block
- **B4X Companion Context Menu** — Right-click submenu with commands organized by category (Navigation, Formatting, Comments, Cleanup, Tools, External)
- **Search Online** — B4X forum search from context menu for word under cursor
- **Peek Definition** — `Alt+F12` inline definition peek

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

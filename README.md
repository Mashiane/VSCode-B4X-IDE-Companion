# B4X Code IDE Companion

> **The B4X Development Experience in Visual Studio Code**
>
> **IntelliSense · LSP Backend · Type Inference · Diagnostics · Code Formatting · Theme Import · AI Integration**

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.95-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/visual-studio-code-repo/0.1.334?label=Version&logo=visualstudiocode)](https://github.com/Mashiane/VSCode-B4X-IDE-Companion)
[![Platforms](https://img.shields.io/badge/platforms-B4A%20%7C%20B4i%20%7C%20B4J%20%7C%20B4R-orange?logo=android)](https://www.b4x.com/)


---

<div align="center">
  <img src="https://raw.githubusercontent.com/Mashiane/VSCode-B4X-IDE-Companion/main/images/b4xlogo.png" alt="B4X Code IDE Companion Logo" width="120"/>
</div>

---

## Overview

**B4X Code IDE Companion** brings B4X development to Visual Studio Code with IntelliSense, diagnostics, code formatting, and library management — all fully offline. Built for B4A, B4i, B4J, and B4R developers.

### What Makes This Extension Different?

| Feature | B4X Code IDE Companion |
|---------|------------------------|
| **Smart IntelliSense** | ✓ Cross-file type inference |
| **Local LSP Server** | ✓ Offline-capable language server |
| **Structural Formatting** | ✓ Block-aware indentation for all B4X constructs |
| **Refactoring** | ✓ Extract Method with preview |
| **Diagnostics** | ✓ CallSub validation, Type placement |
| **Theme Import** | ✓ Import B4X themes into VS Code |
| **AI Integration** | ✓ Ollama & DeepSeek support |

---

## What's New in 0.1.334

### Project Resources Dashboard

A brand-new sidebar panel that gives you a live view of your project's libraries and files.

- **Libraries tab** — See every library your project uses, with local and online versions side by side. Outdated libraries are highlighted with an orange badge, and the Update button shows a count of available updates.
- **Files tab** — Browse your project files organized by extension with codicon icons. Click any file to open it directly.
- **Search/filter** — Instantly filter libraries by name in the Libraries tab.

### One-Click Library Updates

Click **Update** to download the latest library versions directly. The extension:

1. Validates each library URL before downloading (skips unavailable files automatically)
2. Downloads the latest `.b4xlib` or `.xml` file directly to the correct folder (Internal or External libraries)
3. Extracts the new version number and updates both the local listing and the online catalog
4. Refreshes the dashboard instantly — outdated badges disappear and version numbers update in place

You can cancel the update at any time via the progress notification. Libraries that downloaded successfully before cancellation are kept.

### Library Browser

A full searchable catalog of every B4X library — accessible via **B4X: Browse Libraries** in the Command Palette.

- Search by name, keyword, or author
- Filter by platform (B4X, B4A, B4J, B4i, B4R) and type (b4xlib, native)
- View library details, version, author, and description
- Open the forum thread for any library with one click

### Refresh Library Catalog

The **B4X: Refresh Library Catalog** command pulls the latest library index from GitHub and merges it with the community Google Sheet. Progress is shown in the status bar as it fetches the index, extracts versions, and merges sheet data. Both the Library Browser and Project Resources dashboard update automatically when the catalog refreshes.

### Version Extraction Reliability

Previous versions could fail to extract version numbers from certain `.b4xlib` files — particularly those with paths containing spaces or special characters that triggered StreamZip's zip-slip detection. This version adds a fallback ZIP parser that reads the central directory directly, ensuring virtually every library file now reports its correct version.

### DaisyUI Components

The dashboard UI is built with DaisyUI — the same component library used by the Library Browser. Search inputs, buttons, badges, tabs, and tables all use DaisyUI classes for consistent styling that adapts to your VS Code theme.

### Native VS Code Notifications

File load counts and other status messages now use VS Code's built-in notifications instead of custom toasts, so they appear in the same place and behave the same way as every other VS Code notification.

### New Commands

| Command | Description |
|---------|-------------|
| **B4X: Focus Dashboard** | Opens and focuses the Project Resources panel |
| **B4X: Browse Libraries** | Opens the full library catalog browser |
| **B4X: Refresh Library Catalog** | Updates the library index from GitHub and Google Sheet |

---

## Features

### 🚀 Language Intelligence

| Feature | Description |
|---|---|
| **Contextual Completions** | Smart auto-complete for classes, methods, properties, and local symbols |
| **70+ Language Keywords** | Completions for `If`, `For`, `Select`, `Try`, `Dim`, and all B4X keywords |
| **Preprocessor Directives** | Type `#` for `#If B4A`, `#Region`, `#AdditionalJar:`, and all directives |
| **Primitive Type Hover** | Hover over `String`, `Int`, `Boolean`, etc. for type documentation |
| **Dot Member Completions** | Typing `obj.` resolves via type inference and shows available members |
| **Cross-file Type Inference** | Infers variable types across workspace files for completions and hover |
| **Go to Definition** | `F12` jumps to Sub, Type, class, or member definitions — across modules and XML libraries |
| **Peek Definition** | `Alt+F12` for inline definition peek without losing your place |
| **Find All References** | `Shift+F12` finds all usages across all project files on disk |
| **Rename Symbol** | `F2` renames symbols with case preservation across all project files |
| **Hover Documentation** | Hover shows signatures, descriptions, parameters, and return types |
| **Signature Help** | Parameter hints appear automatically inside Sub/function calls |
| **Ghost Text Completions** | Inline tab-acceptable completions with parameter hints |
| **Semantic Token Highlighting** | `Class_Globals`/`Process_Globals` variables are colorized in methods |
| **Document Symbol Outline** | `Ctrl+Shift+O` jumps to any Sub, Type, Region, or global variable |
| **Workspace Symbol Search** | `Ctrl+T` fuzzy-searches all Subs, methods, properties across workspace |
| **Hover Action Links** | Clickable links for Go to Definition, Find All References, Search Online |

### 🎨 Code Formatting

| Feature | Description |
|---|---|
| **Structural Formatting** | Block-aware indentation for all B4X constructs (Sub/If/For/Select/Try/Do/Region/If) |
| **Keyword Casing** | Normalizes `end sub` → `End Sub` while preserving ALLCAPS keywords |
| **Blank Line Management** | Collapses consecutive blank lines; ensures proper spacing between Subs |
| **Un-Format Document** | Strip all leading indentation to left-align every line |
| **Un-Format Selection** | Strip leading indentation from selected lines only |
| **Remove Blank Lines** | Delete empty lines and compact to a single code block |
| **Designer Header Protection** | Preserves `#EndOfDesignText@` section verbatim |
| **String & Comment Protection** | Never modifies content inside `"strings"` or `'comments` |

### ✏️ Syntax & Editing

| Feature | Description |
|---|---|
| **B4X Syntax Highlighting** | Full TextMate grammar for keywords, types, strings, comments, regions, directives |
| **Auto-Close Keywords** | Automatically inserts `End If`, `Next`, `End Select`, `End Try`, `End Sub` on Enter |
| **Auto-Casing on Type** | Fixes keyword casing as you type (space, Enter, colon triggers) |
| **Code Folding** | Fold Sub/If/For/Select/Try/Do/While/Type/Region/Case/Catch blocks |
| **100+ Code Snippets** | Type prefixes like `select`, `foreach`, `try`, `b4xpage`, `customview` + Tab |
| **Smart Selection** | Word → Line → Sub Block → Document expand behavior |
| **Symbol Highlighting** | Highlights all occurrences with read/write distinction |

### 🛠️ Diagnostics & Code Actions

| Feature | Description |
|---|---|
| **Type Placement Diagnostics** | Warns when `Type` is declared outside `Class_Globals`/`Process_Globals` |
| **CallSub Validation** | Warns when `CallSub`/`CallSubDelayed` references a non-existent Sub |
| **Quick-Fix Code Actions** | Moves misplaced `Type` blocks with one click |
| **Extract Method** | Select code and extract into a new Sub with inferred parameters (preview) |
| **Insert Event Handler** | Generate event handler Sub templates |
| **Code Lens** | Inline reference counts above Sub declarations — click to find all references |

### 🔌 Library Integration

| Feature | Description |
|---|---|
| **XML Library Parsing** | Parses XML library descriptors for classes, methods, properties, fields |
| **`.b4xlib` Extraction** | Extracts `.bas`/`.b4x` modules from `.b4xlib` ZIP archives |
| **Project-scoped Loading** | Only loads libraries declared in the project |
| **SQLite Persistence** | Caches library metadata on disk with safe atomic writes |
| **Dual Library Scanning** | Scans both installation and additional library folders |
| **Common Class Support** | `Log`, `Msgbox`, `StartActivity` callable without `Common.` prefix |

### 🏗️ Project Management

| Feature | Description |
|---|---|
| **Open B4X Project** | File picker for `.b4a`, `.b4i`, `.b4j`, `.b4r` — loads workspace and libraries |
| **Auto Workspace Setup** | Adds/opens project folder in VS Code automatically |
| **Session Persistence** | Remembers last opened project on VS Code restart |
| **Build & Install** | One-command build for B4A/B4J with automatic APK installation |
| **Auto-backup** | Periodic backup when AutoBackup=True in system INI |
| **Main Module Sync** | Edits to generated Main `.b4x` synced back to project file |

### 🎯 AI Integration

| Feature | Description |
|---|---|
| **Ollama Integration** | Connect to local Ollama models for AI-assisted coding |
| **DeepSeek Support** | Native DeepSeek model integration |
| **VS Code Language Model API** | Full integration with VS Code's LLM chat interface |
| **Offline-capable** | Works with local models only — no cloud required |

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

<div align="center">
  <strong>Get Started in 60 Seconds</strong>
</div>

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AneleMbangaMashy.b4x-intellisense) (or load the `.vsix` manually).
2. Press **`Ctrl+Shift+P`** → **B4X Companion: Open B4X Project…**
3. Select your `.b4a`, `.b4i`, `.b4j`, or `.b4r` project file.
4. The extension automatically:
   - Adds the project folder to your workspace
   - Discovers platform INI files and library paths
   - Loads XML libraries and extracts `.b4xlib` archives
   - Starts the LSP language server
   - Applies font and theme hints from B4X IDE

> **💡 Pro Tip:** No manual configuration needed. The extension reads `b4xV5.ini` from `%APPDATA%\Anywhere Software\` for all platforms. Override paths in Settings only for non-standard installations.

---

## Commands Reference

All commands are accessible via **`Ctrl+Shift+P`** (Command Palette). Type `B4X` to filter.

### Project Commands

| Command | Keybinding | Description |
|---|---|---|
| **Open B4X Project…** | — | Select and open a B4X project file |
| **Build & Install Project** | — | Build via B4ABuilder.exe/B4JBuilder.exe and install to device |
| **Start Android Emulator** | — | Launch the Android emulator from configured SDK |
| **Capture GIF from Device** | — | Record a GIF from connected Android device |
| **Capture Screenshots (Scroll)** | — | Capture screenshot sequence from device |
| **Open B4X Website** | — | Open b4x.com in embedded webview |

### Editor Commands

| Command | Keybinding | Description |
|---|---|---|
| **Go to Definition** | `F12` | Jump to symbol definition |
| **Peek Definition** | `Alt+F12` | Inline definition peek |
| **Find All References** | `Shift+F12` | Find all usages across workspace |
| **Rename Symbol** | `F2` | Rename symbol across all files |
| **Go to Symbol in File** | `Ctrl+Shift+O` | Fuzzy-search symbols in current file |
| **Go to Implementation** | — | Jump to concrete Sub implementation |
| **Go to Type Definition** | — | Jump to type class definition |

### Formatting Commands

| Command | Keybinding | Description |
|---|---|---|
| **Format Document** | `Shift+Alt+F` | Apply structural formatting |
| **Format Selection** | — | Format selected text range |
| **Un-Format Document** | — | Strip all leading indentation |
| **Un-Format Selection** | — | Strip indentation from selection |
| **Block Comment** | — | Add `'` prefix to selected lines |
| **Un-Block Comment** | — | Remove `'` prefix from selected lines |
| **Remove Blank Lines** | — | Delete empty lines, auto-format |
| **Remove Comments** | — | Delete comment-only lines, auto-format |

### Utility Commands

| Command | Keybinding | Description |
|---|---|---|
| **Extract Method** | `Ctrl+.` | Extract selected code into new Sub |
| **Insert Event Handler** | — | Generate event handler template |
| **Quick Fix** | `Ctrl+.` | Show available code actions |
| **Trigger Suggestions** | `Ctrl+Space` | Show auto-complete suggestions |
| **Parameter Hints** | `Ctrl+Shift+Space` | Show function parameters |

### Library Commands

| Command | Keybinding | Description |
|---|---|---|
| **Import Theme From B4X Install** | — | Import `.vssettings` theme from B4X install |
| **Refresh Library Index** | — | Re-scan disk for library files |
| **Clear Library Cache** | — | Clear SQLite library cache |
| **Refresh Library Catalog** | — | Update online library index |

### Dashboard Commands

| Command | Keybinding | Description |
|---|---|---|
| **Project Resources** | — | Open Dashboard view (Libraries/Files) |
| **B4X Library Browser** | — | Browse and search all libraries |
| **Open Extension Settings** | — | Open Settings filtered to B4X Companion |
| **Open Documentation** | `Ctrl+Shift+H` | Open User Manual or README |

---

## Settings Reference

All settings are prefixed with `b4xIntellisense.` in VS Code Settings (`Ctrl+,`).

### 📁 Platform Configuration

| Setting | Default | Description |
|---|---|---|
| `b4aIniPath` | Auto-detected | Path to B4A `b4xV5.ini` |
| `b4iIniPath` | Auto-detected | Path to B4i `b4xV5.ini` |
| `b4jIniPath` | Auto-detected | Path to B4J `b4xV5.ini` |
| `b4rIniPath` | Auto-detected | Path to B4R `b4xV5.ini` |
| `b4aInstallPath` | `C:\Program Files\Anywhere Software\B4A` | B4A install folder for themes |
| `b4iInstallPath` | `C:\Program Files (x86)\Anywhere Software\B4i` | B4i install folder |
| `b4jInstallPath` | `C:\Program Files\Anywhere Software\B4J` | B4J install folder |
| `b4rInstallPath` | `C:\Program Files\Anywhere Software\B4R` | B4R install folder |

### ⚙️ Behavior

| Setting | Default | Description |
|---|---|---|
| `autoApplyIni` | `prompt` | Font/theme hint application: `prompt`, `always`, `never` |
| `autoAddProjectFolderOnOpen` | `true` | Add project folder as workspace folder |
| `autoOpenProjectFolderOnOpen` | `true` | Replace workspace with project folder |
| `autoLoadProjectAssets` | `true` | Auto-load libraries and start LSP |
| `autoBackupInterval` | `600000` | Auto-backup interval (ms, default 10 min) |
| `extractMethod.previewBehavior` | `prompt` | Extract Method preview: `prompt`, `autoApply`, `alwaysPreview` |
| `disableConsoleOutput` | `true` | Suppress console output, use log file |

### 🎨 Editor

| Setting | Default | Description |
|---|---|---|
| `fontFamily` | `Fira Code Retina` | Font family for extension webviews |
| `fontSize` | `12` | Font size (px) for webviews |
| `tabSize` | `4` | Tab size for webviews |
| `wordWrap` | `true` | Word wrap in webviews |

### 🛠️ Diagnostics & Logging

| Setting | Default | Description |
|---|---|---|
| `debug` | `false` | Enable timestamped debug log file |
| `enableTelemetry` | `false` | Opt-in anonymous telemetry |

### 📱 Device Tools

| Setting | Default | Description |
|---|---|---|
| `adbPath` | Auto-detected | Path to adb executable |
| `emulatorPath` | Auto-detected | Path to Android emulator |
| `ffmpegPath` | Auto-detected | Path to ffmpeg for GIF capture |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **`Ctrl+Shift+P`** | Command Palette (type `B4X` to filter) |
| **`Ctrl+Shift+H`** | Open Documentation |
| **`F12`** | Go to Definition |
| **`Alt+F12`** | Peek Definition |
| **`Shift+F12`** | Find All References |
| **`F2`** | Rename Symbol |
| **`Ctrl+Shift+O`** | Go to Symbol in File |
| **`Ctrl+T`** | Go to Symbol in Workspace |
| **`Shift+Alt+F`** | Format Document |
| **`Ctrl+.`** | Quick Fix / Code Action |
| **`Ctrl+Space`** | Trigger Suggestions |
| **`Ctrl+Shift+Space`** | Parameter Hints |
| **`Tab`** | Expand snippet |

## Context Menu

**Right-click in any `.bas` or `.b4x` editor** to access the **B4X Companion** submenu:

### Navigation
| Item | Description |
|---|---|
| Go to Definition | Jump to symbol definition |
| Peek Definition | Inline definition peek |
| Find All References | Find all usages |
| Rename Symbol | Rename across files |
| Go to Symbol in File | Fuzzy-search in current file |
| Go to Implementation | Jump to Sub implementation |
| Go to Type Definition | Jump to type class |

### Formatting
| Item | Description |
|---|---|
| Format Document | Apply structural formatting |
| Format Selection | Format selected text |
| Un-Format Document | Strip all indentation |
| Block Comment | Add `'` prefix |
| Un-Block Comment | Remove `'` prefix |

### Tools
| Item | Description |
|---|---|
| Quick Fix | Show code actions |
| Trigger Suggestions | Show completions |
| Parameter Hints | Show function params |
| Search Online | B4X forum search |

---

## Syntax Highlighting & Snippets

- **TextMate Grammar** — Full B4X syntax highlighting for keywords, types, strings, comments, regions, preprocessor directives, and more.
- **Snippets** — 100+ common B4X patterns: `Sub`, `If/Then`, `For/Next`, `Select Case`, `Try/Catch`, `Type`, `B4XPage`, `CustomView`, `SQL`, `XUI`, and platform-specific snippets.
- **Semantic Tokens** — Variables from `Class_Globals` / `Process_Globals` receive additional semantic coloring when used inside methods.

---

## System Requirements

| Component | Requirement | Notes |
|---|---|---|
| **VS Code** | `≥ 1.95` | Latest stable recommended |
| **Operating System** | Windows 10/11, macOS 12+, Linux | Full cross-platform support |
| **Node.js** | Bundled with VS Code | No separate installation needed |
| **Disk Space** | 200 MB | For library cache and index |
| **Memory** | 512 MB | Recommended for large projects |

### Supported B4X Platforms

| Platform | File Extension | Description |
|---|---|---|
| **B4A** | `.b4a` | Basic4Android - Android app development |
| **B4i** | `.b4i` | Basic4iOS - iOS app development |
| **B4J** | `.b4j` | Basic4Java - Desktop and server applications |
| **B4R** | `.b4r` | Basic4Arduino - Arduino and ESP development |

---

## Project Structure

```
src/
  extension.ts                        – Main extension: activation, commands, providers
  b4xAutoclose.ts                     – Auto-close keywords and 3-line Try blocks
  b4xCodeLensProvider.ts              – Reference counts above Subs
  b4xDocParser.ts                     – Completion/cursor-context utilities
  b4xDocumentFormattingProvider.ts    – Structural code formatter (5-phase pipeline)
  b4xDocumentHighlightProvider.ts     – Symbol highlighting (read vs. write)
  b4xDocumentLinkProvider.ts          – Clickable links (LoadLayout, ShowPage, AdditionalJar)
  b4xDocumentRangeFormattingProvider.ts – Range formatting delegation
  b4xDocumentSymbolProvider.ts        – Outline view / Ctrl+Shift+O
  b4xFoldingRangeProvider.ts          – Code folding
  b4xImplementationProvider.ts        – Go to Implementation
  b4xInlineCompletionProvider.ts      – Ghost text completions with Tab accept
  b4xLocalSymbols.ts                  – Local symbol extraction
  b4xOnTypeFormattingProvider.ts      – Auto-casing on type
  b4xReferenceProvider.ts             – Find All References (on-disk search)
  b4xRenameProvider.ts                – F2 rename with case preservation
  b4xSelectionRangeProvider.ts        – Smart expand selection
  b4xTypeDefinitionProvider.ts        – Go to Type Definition
  b4xTypeInference.ts                 – Cross-file variable type inference
  b4xWorkspaceSymbolProvider.ts       – Ctrl+T workspace symbol search
  callSubDiagnostics.ts               – CallSub target validation
  commonClassStore.ts                 – Common class extraction (Log, Msgbox, etc.)
  extractMethodCodeAction.ts          – Extract Method refactoring
  logging.ts                          – File-based logging
  lspClient.ts                        – LSP client
  platformBuilders.ts                 – Platform builder configuration
  platformConfig.ts                   – Multi-platform INI auto-discovery
  platformIni.ts                      – INI file parser
  primitiveTypeStore.ts               – Primitive type mappings
  projectFile.ts                      – .b4a/.b4i/.b4j/.b4r project parser
  typeCodeAction.ts                   – Quick-fix for Type placement
  typeDiagnostics.ts                  – Type placement diagnostics
  typeDiagnosticsCore.ts              – Core diagnostic logic
  types.ts                            – Shared B4X type definitions
  vssettingsImporter.ts               – .vssettings theme importer
  workspaceClassIndex.ts              – Workspace .bas/.b4x indexer
  xmlLibraryIndex.ts                  – XML library descriptor parser
  storage/
    libraryIndexSqlite.ts             – Persistent SQLite library cache

server/
  server.js                           – LSP server (stdio transport)
  logger.js                           – Server-side logging
  indexer/
    documentManager.js                – Document management with symbol tables
    fileSymbolParser.js               – .bas/.b4x file symbol extraction
    globalSymbolTable.js              – Cross-file symbol table
    extractMethod.js                  – Server-side Extract Method
    workerPool.js                     – Background worker thread pool
    workerTask.js                     – Worker task definitions

snippets/
  b4x.json                            – 100+ B4X code snippets

syntaxes/
  b4x.tmLanguage.json                 – TextMate grammar for B4X
```

---

## Known Issues

| Issue | Status | Workaround |
|---|---|---|
| XML parser doesn't handle `<event>`, `<objectwrapper>`, `<owner>` elements | Open | Library events may not appear in completions |
| Theme import from `.vssettings` may not translate perfectly | Known | Some B4A themes may have color mapping issues |
| Library cache may become stale after external updates | Occasional | Run **Refresh Library Index** command |

---

## Release Notes

See the [CHANGELOG](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/CHANGELOG.md) for complete release history.

### 0.1.334 (Current)

- **Dashboard Updates** — Enhanced Project Resources view with improved Libraries and Files tabs
- **Library Browser** — Added B4X Library Browser command for exploring available libraries
- **Context Menu** — Organized context menu commands into logical groups
- **Performance** — Optimized file scanning and indexing for faster project load times
- **Documentation** — Comprehensive update to User Manual with new sections on AI Integration and Dashboard

### 0.1.306 (Procurement Readiness Release)

- **Performance Optimization** — Implemented `esbuild` bundling, reducing VSIX package size from 69MB to 1.6MB (97% reduction)
- **Quality Assurance** — Added automated Unit and E2E Integration test suites
- **Bug Fixes** — Resolved critical issues with global variable indexing and symbol memory leaks
- **Security** — Completed full security audit for secret leakage and dependency health

### 0.1.300 Series

- **Go to Implementation** — Jump to concrete Sub implementations across workspace modules
- **Go to Type Definition** — Jump from type name to its class definition
- **Document Link Provider** — Clickable links for `#AdditionalJar:`, `LoadLayout()`, `B4XPages.ShowPage()`
- **Inline Completion Provider** — Ghost text completions with Tab accept
- **Document Highlight Provider** — Highlights all occurrences with read/write distinction
- **Selection Range Provider** — Smart expand: Word → Line → Sub Block → Document
- **On-Type Formatting** — Auto-casing of keywords as you type
- **Insert Event Handler** — Generate event handler Sub templates
- **Range Formatting** — Format only selected text range
- **Common Class Store** — Dedicated extraction of Common class globals
- **Primitive Type Store** — Dedicated store for primitive type mappings

### 0.1.270 Series

- **Structural Code Formatter** — Block-aware indentation tracking for all B4X constructs
- **Document Symbol Provider** — Outline view and Ctrl+Shift+O for Subs, Types, Regions
- **Workspace Symbol Provider** — Ctrl+T fuzzy search across all workspace modules and XML libraries
- **Rename Provider** — F2 rename with case preservation across all project files
- **Code Lens** — Reference counts above Sub declarations
- **CallSub Validation** — Diagnostics for CallSub/CallSubDelayed targeting non-existent Subs
- **Preprocessor Directive Completions** — Type `#` for completions
- **Go to Definition Across Modules** — Resolves Subs in other .bas files
- **Find All References On-Disk** — Searches all workspace files on disk
- **Hover Action Links** — Go to Definition, Find All References, Search Online in hover tooltips
- **3-Tier SQLite Fallback** — better-sqlite3 → sql.js → in-memory

### 0.1.250 Series

- **Structural Code Formatter** — Block-aware indentation with keyword casing normalization
- **Un-Format Document** — Strip all leading indentation
- **Remove Blank Lines** — Compact file to single block
- **B4X Companion Context Menu** — Right-click submenu with categorized commands
- **Search Online** — B4X forum search from context menu
- **Peek Definition** — Alt+F12 inline definition peek

### 0.1.248 Series

- **Multi-platform Auto-discovery** — B4A, B4i, B4J, and B4R INI files
- **LSP Backend** — Worker pool indexer for fast symbol parsing
- **`.b4xlib` Archive Extraction** — Extract modules from .b4xlib archives
- **Extract Method Code Action** — With preview support
- **Type Diagnostics** — Quick-fix code actions
- **Persistent SQLite Library Index** — Safe atomic writes and migrations
- **Theme Import** — From B4A install Themes folder
- **Build & Install** — To device with adb
- **GIF/Screenshot Capture** — From connected Android device

### 0.1.0 — Initial Release

- Core IntelliSense features for B4X development in VS Code

---

## Contributing

We welcome contributions from the B4X community! Please see [CONTRIBUTING.md](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/CONTRIBUTING.md) for:

- Development setup and guidelines
- Running tests
- Commit message format
- Pull request process

## License

This extension is available under the MIT License. See [LICENSE](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/blob/HEAD/LICENSE) for details.

---

## Support & Community

| Resource | Description |
|---|---|
| **VS Code Marketplace** | [View on Marketplace](https://marketplace.visualstudio.com/items?itemName=AneleMbangaMashy.b4x-intellisense) |
| **GitHub Repository** | [github.com/Mashiane/VSCode-B4X-IDE-Companion](https://github.com/Mashiane/VSCode-B4X-IDE-Companion) |
| **Issue Tracker** | [Report bugs or request features](https://github.com/Mashiane/VSCode-B4X-IDE-Companion/issues) |
| **B4X Forum** | [Community support and discussions](https://www.b4x.com/) |

---

<div align="center">
  <img src="https://raw.githubusercontent.com/Mashiane/VSCode-B4X-IDE-Companion/main/images/24x24.png" alt="B4X Code IDE Companion" width="24"/>
  <br/>
  <strong>B4X Code IDE Companion</strong> — Built for the B4X Community
  <br/>
  Version 0.1.334
</div>

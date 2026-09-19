# B4X Code IDE Companion — Full Extension Review

> **Version:** 0.1.334  
> **Repository:** https://github.com/Mashy/VSCode-B4X-IDE-Companion  
> **Review Date:** 2026-05-12  
> **Purpose:** Comprehensive context document for AI agents working on this extension.

---

## 1. Overview

**B4X Code IDE Companion** is a VS Code extension providing full IntelliSense and developer tooling for the B4X language family (B4A/Basic4android, B4J, B4i, B4R). It implements a local Language Server Protocol (LSP) backend, workspace indexer, and 20+ VS Code language providers to deliver completion, hover, go-to-definition, rename, signature help, formatting, folding, code lenses, diagnostics, and more — all without requiring the official B4X IDE.

The extension follows an **offline-first** design: when pre-built API indexes are unavailable, it gracefully falls back to live workspace scanning and installed library XML files.

---

## 2. Architecture

### 2.1 High-Level Data Flow

```
User Opens .b4a/.b4i/.b4j/.b4r Project
  │
  ├─► Platform Detection (file extension → platform name)
  │
  ├─► Load Platform INI (b4xV5.ini)
  │     ├─ LibrariesFolder (internal XML/b4xlib files)
  │     ├─ AdditionalLibrariesFolder (user-added libraries)
  │     ├─ SharedModuleFolder (shared .bas modules)
  │     └─ PlatformFolder (SDK path)
  │
  ├─► Parse Project File (LibraryN=, ModuleN=, FileN=)
  │     └─► Resolve allowed libraries and module paths
  │
  ├─► Resolve b4xlib Dependencies (recursive DependsOn resolution)
  │
  ├─► Extract .bas modules from b4xlib archives
  │
  ├─► Load into IntelliSense Stores
  │     ├─ XmlLibraryStore  ← XML library files (Core.xml, SQL.xml, etc.)
  │     ├─ WorkspaceClassStore ← .bas source modules
  │     ├─ CommonClassStore ← Global functions from Core.xml
  │     └─ PrimitiveTypeStore ← Type mappings (String→String2, etc.)
  │
  ├─► Start LSP Server (optional)
  │     └─► DocumentManager → GlobalSymbolTable (trie-based)
  │
  └─► Register Language Providers
        ├─ Completion, Hover, Definition, SignatureHelp
        ├─ References, Folding, Formatting, Rename
        ├─ CodeLens, DocumentLink, DocumentSymbol
        ├─ WorkspaceSymbol, SelectionRange, Highlight
        ├─ Implementation, TypeDefinition, InlineCompletion
        ├─ Diagnostics (Type placement, CallSub validation)
        └─ Code Actions (Move Type, Extract Method)
```

### 2.2 Module Dependency Graph

```
extension.ts (5489 lines — monolithic orchestrator)
  ├─► projectFile.ts         — Project file parsing (.b4a/.b4j/.b4i/.b4r)
  ├─► platformConfig.ts     — Windows Registry & settings discovery
  ├─► platformIni.ts        — INI file parsing (b4xV5.ini)
  ├─► xmlLibraryIndex.ts     — XML library store (Core.xml, etc.)
  ├─► workspaceClassIndex.ts — .bas module store
  ├─► commonClassStore.ts    — Common class globals (Log, Msgbox, etc.)
  ├─► primitiveTypeStore.ts  — Primitive type mappings
  ├─► b4xTypeInference.ts    — Type inference engine
  ├─► b4xDocParser.ts        — B4X documentation parser (''' format)
  ├─► b4xLocalSymbols.ts     — Local symbol collector (Subs, Types, Dims)
  ├─► apiIndex.ts            — Pre-built JSON API index loader
  ├─► lspClient.ts           — Language Server Protocol client
  ├─► typeDiagnostics.ts    — Misplaced Type diagnostics
  ├─► typeDiagnosticsCore.ts — Pure-logic Type placement checker
  ├─► callSubDiagnostics.ts  — CallSub validation diagnostics
  ├─► typeCodeAction.ts      — Quick Fix: Move Type into correct Sub
  ├─► extractMethodCodeAction.ts — Extract Method refactor action
  ├─► platformBuilders.ts   — Build/run configuration (B4A/B4J)
  ├─► vssettingsImporter.ts  — VS Settings theme importer
  ├─► libraryCatalog.ts      — GitHub + Google Sheets library catalog
  ├─► googleSheetCatalog.ts  — Google Sheets CSV fetcher
  ├─► storage/libraryIndexSqlite.ts — SQLite persistence layer
  ├─► logging.ts             — File-based debug logger
  │
  ├─► providers/
  │     ├─ commandsProvider.ts         — Projects sidebar tree
  │     ├─ CompanionDashboardProvider.ts — Webview sidebar (Libraries + Files)
  │     ├─ libraryBrowserProvider.ts   — Full webview library browser
  │     ├─ libraryTreeProvider.ts      — Library sidebar tree
  │     ├─ ollamaProvider.ts           — Ollama LM Chat provider
  │     └─ deepseekProvider.ts         — DeepSeek LM provider
  │
  ├─► Language Providers (all in src/)
  │     ├─ b4xAutoclose.ts             — Auto-close block keywords
  │     ├─ b4xCodeLensProvider.ts      — Reference count CodeLens
  │     ├─ b4xReferenceProvider.ts     — Find All References
  │     ├─ b4xFoldingRangeProvider.ts  — Code folding
  │     ├─ b4xDocumentSymbolProvider.ts — Document outline (Ctrl+Shift+O)
  │     ├─ b4xWorkspaceSymbolProvider.ts — Workspace symbol search (Ctrl+T)
  │     ├─ b4xDocumentFormattingProvider.ts — Full document formatter
  │     ├─ b4xDocumentRangeFormattingProvider.ts — Range formatter
  │     ├─ b4xDocumentHighlightProvider.ts — Highlight occurrences
  │     ├─ b4xDocumentLinkProvider.ts  — Clickable links (#AdditionalJar, LoadLayout)
  │     ├─ b4xOnTypeFormattingProvider.ts — Keyword casing on type
  │     ├─ b4xSelectionRangeProvider.ts — Smart expand selection
  │     ├─ b4xImplementationProvider.ts — Go to Implementation
  │     ├─ b4xTypeDefinitionProvider.ts — Go to Type Definition
  │     ├─ b4xInlineCompletionProvider.ts — Ghost text completions
  │     └─ b4xRenameProvider.ts        — Rename symbol
  │
  └─► utils/
        ├─ b4xFileScanner.ts   — Recursive B4X file finder
        ├─ b4xKeywords.ts      — Keyword casing tables
        └─ b4xTextUtils.ts     — Comment/string detection, regex escape
```

### 2.3 LSP Server (Node.js)

```
server/server.js              — LSP entry point (stdio transport)
  ├─► indexer/documentManager.js — Document tracking + global symbol table
  ├─► indexer/globalSymbolTable.js — Trie-based prefix search symbol index
  ├─► indexer/fileSymbolParser.js  — Line-by-line B4X symbol parser
  ├─► indexer/extractMethod.js    — Extract Method workspace edit builder
  ├─► indexer/workerPool.js       — Worker thread pool (bounded concurrency)
  ├─► indexer/workerTask.js       — Worker entry point (delegates to fileSymbolParser)
  └─► logger.js                   — Async file logger with bounded queue
```

---

## 3. Core Modules — Detailed Reference

### 3.1 `extension.ts` (5489 lines)

The monolithic entry point and orchestrator. Key responsibilities:

- **Activation**: Creates all stores, registers providers, starts LSP, loads library catalog, scans templates, restores last project state.
- **Project Opening**: `openB4xProject` command discovers platform, loads INI, parses project file, resolves libraries and modules, populates stores, starts LSP.
- **Asset Reloading**: `reloadPlatformAssets()` — the central reload pipeline that orchestrates platform discovery → INI parsing → library resolution → b4xlib extraction → store population.
- **Template System**: Scans `.b4xtemplate` files at activation, extracts with `$APPNAME$` placeholder substitution.
- **Build & Run**: `installProject` command compiles and installs B4A/B4J projects via platform builders.
- **Device Tools**: `startEmulator`, `captureGif` (ffmpeg-based), `captureScreenshots` (adb-based).
- **Library Catalog**: Fetches from GitHub JSON + Google Sheets, enriches with version extraction.
- **Companion Dashboard**: Webview sidebar showing project libraries and files.
- **Auto-close Keywords**: Registers `onDidChangeTextDocument` listener for block keyword auto-insertion.
- **35+ Commands**: All registered in `package.json` contributes.commands.

### 3.2 `projectFile.ts`

Parses B4X project files (`.b4a/.b4i/.b4j/.b4r`). Key behaviors:

- Stops parsing at `@EndOfDesignText@` marker — header section contains key=value pairs.
- Extracts `LibraryN=`, `ModuleN=`, `FileN=` entries.
- Strips `|relative|`, `|absolute|`, `|shared|` prefixes from module paths.
- Generates `.vscode/b4x-main/<Project>_Main.b4x` from code after the design text marker.
- Uses a scoring system to select the best project file when multiple exist.
- Module-level cache (`cachedProjectConfig`) for fast-path reuse.

### 3.3 `platformConfig.ts` & `platformIni.ts`

Two-tier discovery for B4X platform installations:

- **platformConfig.ts**: Queries VS Code settings → `%APPDATA%` paths → Windows Registry (via PowerShell). Caches registry results.
- **platformIni.ts**: Parses `b4xV5.ini` for folder paths (`LibrariesFolder`, `AdditionalLibrariesFolder`, `SharedModuleFolder`, `PlatformFolder`, `javacPath`) and IDE settings (`fontName2`, `fontSize2`, `ideTheme2`, `codeTheme`).

### 3.4 `xmlLibraryIndex.ts`

Parses B4X XML library definitions (e.g., `Core.xml`, `SQL.xml`). The `XmlLibraryStore` class provides:

- Case-insensitive class lookup (`getClassByName`)
- Prefix search (`findClassesByPrefix`)
- Cross-class member search (`findMemberByName`)
- Type resolution (`resolveMemberType`)
- Event and field retrieval
- `String2` normalization to `String`
- `DesignerName` attribute preference over raw text content
- Regex caching for repeated tag extraction
- SQLite persistence via `libraryIndex`

### 3.5 `workspaceClassIndex.ts`

Parses B4X `.bas` source modules into class-like structures. The `WorkspaceClassStore` maintains two maps:

- `workspaceClassesByName` — project modules (local workspace)
- `referenceClassesByName` — external/b4xlib modules

Key features:

- Module type detection: `class`, `static`, `service` by scanning for directives.
- `#Event:` directive parsing with parameter types.
- Getter/setter merging (`mergePropertiesWithAccessors`).
- SQLite-based caching to avoid re-parsing unchanged files.
- Private member exclusion from indexing.

### 3.6 `commonClassStore.ts`

Extracts the B4X `Common` class (global keywords like `Log`, `Msgbox`, `CRLF`, `File`) from the XML library store. Both `<field>` and `<property>` elements are collected.

### 3.7 `primitiveTypeStore.ts`

Provides synthetic class definitions for B4X primitives (`Int`, `Float`, `Double`, `Long`, `Byte`, `Short`, `Boolean`, `Char`, `Object`) and type mappings (`string` → `String`, `stringbuilder` → `StringBuilder`). Uses `B4A`-prefixed internal keys to avoid collisions.

### 3.8 `b4xTypeInference.ts`

Resolves `expr.member` completions by chaining:

1. Check inferred types (from `Dim`/`Private`/`Public` declarations and `Sub` parameters)
2. Check local symbols (`b4xLocalSymbols`)
3. Check workspace/XML class definitions
4. Apply primitive type mapping first (e.g., `string` → `String` class)

Supports chained member access (e.g., `EditText1.Text.Length`).

### 3.9 `b4xDocParser.ts`

Shared parsing utility for B4X documentation (`'''` triple-quote format) and source code. Key functions:

- `getLinePrefix`, `stripComment`, `isCommentPosition` — string-aware comment handling
- `getMemberAccessInfo` — parses `expression.memberPrefix` patterns
- `getCallContext` — determines which argument the cursor is in (for signature help)
- `getPostDesignStartLine` — finds content after `@EndOfDesignText@`
- `parseTypedNameList` — parses `Dim x As Int, y As String` with back-propagation
- Complete b4xlib documentation parser state machine with `normalizeLibraries`, `normalizeClasses`, `mergeClasses`

### 3.10 `b4xLocalSymbols.ts`

Collects local symbols (Subs, Types, variables) from a B4X source document. Skips content before `@EndOfDesignText@`. Tracks container context (`Class_Globals`, `Process_Globals`).

### 3.11 `apiIndex.ts`

Loads a pre-built JSON API index (`data/b4x-api-index.json`) for offline use. The `ApiIndexStore` provides filtered queries based on `allowedLibraries`, with `Predefined` always available.

### 3.12 `lspClient.ts`

Manages the LSP client lifecycle. Uses dynamic `require()` for `vscode-languageclient/node` to avoid hard compile-time dependency. Supports `b4x/indexing` notification for progress tracking.

### 3.13 Diagnostics Pipeline

- **`typeDiagnostics.ts` + `typeDiagnosticsCore.ts`**: Detects `Type` declarations outside `Sub Class_Globals` or `Sub Process_Globals`. Pure-logic core for testability.
- **`callSubDiagnostics.ts`**: Validates `CallSub`/`CallSubDelayed` targets against known workspace Sub names. Uses regex pattern matching for all CallSub variants.
- **`typeCodeAction.ts`**: Quick Fix actions to move Type declarations into the correct Sub.
- **`extractMethodCodeAction.ts`**: Thin code action that delegates to the `b4xIntellisense.extractMethod` command.

### 3.14 Language Providers

All 21 providers are registered in `extension.ts` for the `b4x` language selector:

| Provider | Purpose |
|----------|---------|
| CompletionItemProvider | Context-aware completions (classes, methods, properties, keywords, locals) |
| HoverProvider | Markdown hover docs for classes, methods, properties |
| DefinitionProvider | Go-to-definition for classes, methods, properties |
| SignatureHelpProvider | Parameter hints for Sub/method calls |
| ReferenceProvider | Find all references across workspace files |
| FoldingRangeProvider | Code folding for Sub/If/For/Select/Try/Region blocks |
| DocumentSymbolProvider | Outline view (Subs, Types, Regions, globals) |
| WorkspaceSymbolProvider | Workspace-wide symbol search |
| DocumentFormattingProvider | Full document structural formatting |
| DocumentRangeFormattingProvider | Selection-only formatting |
| OnTypeFormattingProvider | Keyword casing auto-correction |
| RenameProvider | Rename symbol across workspace |
| CodeLensProvider | Reference count above Sub declarations |
| DocumentLinkProvider | Clickable links for `#AdditionalJar`, `LoadLayout`, `B4XPages.ShowPage` |
| DocumentHighlightProvider | Highlight all occurrences of symbol |
| SelectionRangeProvider | Smart expand selection |
| ImplementationProvider | Go to Implementation |
| TypeDefinitionProvider | Go to Type Definition (Dim x As TypeName) |
| InlineCompletionProvider | Ghost text for method signatures |
| CodeActionsProvider (Type) | Move Type into correct Sub |
| CodeActionsProvider (Extract) | Extract Method refactor |

### 3.15 `platformBuilders.ts`

Configuration-as-data for B4X platform build tools. Only B4A and B4J have builder executables. B4i and B4R are excluded because they lack Windows-based builders.

### 3.16 `vssettingsImporter.ts`

Imports Visual Studio `.vssettings` theme files. Maps VS color names to VS Code TextMate scopes and `workbench.colorCustomizations`. Handles `#AARRGGBB` to `#RRGGBB` color conversion.

### 3.17 `libraryCatalog.ts` + `googleSheetCatalog.ts`

Three-tier data source for library metadata:

1. Remote GitHub JSON (with ETag caching)
2. Local cache (VS Code `globalState`)
3. Bundled fallback (`libraries_mapping.json`)

Periodic sync every 60 minutes. Merges Google Sheet data for version/forum info.

### 3.18 `storage/libraryIndexSqlite.ts`

Persistent SQLite-backed storage with three-tier fallback:

1. `better-sqlite3` (native, fastest)
2. `sql.js` (WASM, portable)
3. `SimpleInMemoryDB` (pure JS, always available)

Tables: `files` (parsed module cache), `projects` (recent project roots), `xml_classes` (XML class definitions), `b4xlibs` (archive metadata), `b4xlib_inner` (inner files).

### 3.19 Provider Modules

| Module | Purpose |
|--------|---------|
| `commandsProvider.ts` | Tree data provider for Projects sidebar — self-discovers commands from `package.json` |
| `CompanionDashboardProvider.ts` | Webview sidebar with Libraries table + Files tree; uses DaisyUI/Tailwind |
| `libraryBrowserProvider.ts` | Full webview panel for browsing library catalog with search/filters |
| `libraryTreeProvider.ts` | Tree view grouping libraries by platform |
| `ollamaProvider.ts` | VS Code Language Model Chat provider backed by Ollama |
| `deepseekProvider.ts` | DeepSeek model launcher (also via Ollama endpoint) |

### 3.20 Utility Modules

| Module | Purpose |
|--------|---------|
| `b4xFileScanner.ts` | Recursive B4X file finder (skips `objects`, `.git`, `node_modules`, etc.) |
| `b4xKeywords.ts` | Keyword casing tables (`KEYWORD_CASING`) and multi-word patterns (`MULTI_KEYWORDS`) |
| `b4xTextUtils.ts` | `escapeRegex`, `findCommentStart`, `isInsideString` — shared B4X text processing |

---

## 4. LSP Server Architecture

### 4.1 Server Entry (`server/server.js`)

- Uses `vscode-languageserver` with `ProposedFeatures.all`
- Communicates via stdio transport
- Registers handlers for: `onInitialize`, `onCompletion`, `onHover`, `onDefinition`, `onRenameRequest`, custom `b4x/extractMethod`
- Publishes diagnostics for duplicate symbol definitions and misplaced Type declarations

### 4.2 Document Manager (`server/indexer/documentManager.js`)

- Tracks open documents with their text and parsed symbols
- `loadFromDisk()` walks workspace directory, parses `.bas/.b4x` files with bounded concurrency (8 workers)
- Sends `b4x/indexing` notifications (start/progress/done) to the client
- Loads/saves snapshots to `.b4x-index.json` for instant startup

### 4.3 Global Symbol Table (`server/indexer/globalSymbolTable.js`)

- **Trie-based** prefix search (O(prefix-length) instead of O(n) linear scan)
- Supports incremental updates: only affected trie nodes are modified
- Methods: `getByExactName`, `getByPrefix`, `applyFileSymbols`, `removeFile`
- Serialization/deserialization for snapshot persistence

### 4.4 Worker Pool (`server/indexer/workerPool.js`)

- Uses `worker_threads` with bounded pool size (`max(1, min(2, cpus-1))`)
- 30-second timeout per parse request
- Failed files are blacklisted to prevent crash loops
- Round-robin worker assignment

### 4.5 Extract Method (`server/indexer/extractMethod.js`)

- Creates workspace edits for Extract Method refactoring
- Strategy: extract selected text into a new `Sub`, replace selection with call
- Uses B4X's no-parens call syntax for idiomatic code

---

## 5. Commands Reference

The extension registers 40+ commands in `package.json`. Key categories:

| Category | Commands |
|----------|----------|
| **Project Management** | `openB4xProject`, `newB4xProjectFromTemplate`, `reloadProject`, `backupWorkspace`, `setB4aInstallPath` |
| **Navigation** | `gotoDefinition`, `peekDefinition`, `findReferences`, `gotoSymbol`, `gotoImplementation`, `gotoTypeDefinition` |
| **Editing** | `formatDocument`, `unformatDocument`, `formatSelection`, `unformatSelection`, `blockComment`, `unblockComment`, `removeBlankLines`, `removeComments`, `extractMethod`, `insertEventHandler`, `renameSymbol` |
| **Code Assistance** | `triggerSuggest`, `triggerParameterHints`, `quickFix`, `runDiagnostics` |
| **Build & Run** | `installProject`, `startEmulator` |
| **Device** | `captureGif`, `captureScreenshots` |
| **Library** | `refreshLibraryIndex`, `showLibraryDbPath`, `clearLibraryCache`, `browseLibraries`, `openLibraryDetail`, `refreshLibraryCatalog` |
| **Theme & Settings** | `importThemeFromInstall`, `openSettings`, `openDocs`, `openB4x` |
| **AI Integration** | `ollamaLaunchClaude`, `deepseekLaunch` |
| **Dashboard** | `focusDashboard`, `showStatusSummary` |
| **Debug** | `debugState`, `printStores`, `dumpDiagnostics`, `openDiagnostics` |

---

## 6. Configuration Reference

All settings are under the `b4xIntellisense` namespace:

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `b4aIniPath` / `b4iIniPath` / `b4jIniPath` / `b4rIniPath` | string | `""` | Path to platform INI file |
| `b4aInstallPath` / `b4iInstallPath` / `b4jInstallPath` / `b4rInstallPath` | string | Platform-specific | Platform installation folder |
| `b4jJavaPath` | string | `""` | Java executable for B4J |
| `b4aWorkspaceFolder` / `b4iWorkspaceFolder` / `b4jWorkspaceFolder` / `b4rWorkspaceFolder` | string | `""` | Default workspace folder per platform |
| `fontFamily` | string | `"Fira Code Retina"` | Webview/preview font |
| `fontSize` | number | 12 | Webview/preview font size |
| `wordWrap` | boolean | true | Word wrap in webviews |
| `tabSize` | number | 4 | Tab size in webviews |
| `autoApplyIni` | enum | `"prompt"` | INI theme/font auto-apply behavior |
| `autoAddProjectFolderOnOpen` | boolean | true | Add project folder to workspace |
| `autoRestoreWorkspace` | boolean | true | Restore last project on startup |
| `autoOpenProjectFolderOnOpen` | boolean | true | Open project folder in window |
| `autoLoadProjectAssets` | boolean | true | Auto-load libraries after project open |
| `projectsViewName` | string | `"Projects"` | Sidebar view label |
| `disableConsoleOutput` | boolean | true | Suppress console.log output |
| `autoBackupInterval` | number | 600000 | Auto-backup interval (ms) |
| `extractMethod.previewBehavior` | enum | `"prompt"` | Extract Method preview mode |
| `enableTelemetry` | boolean | false | Anonymous telemetry (opt-in) |
| `debug` | boolean | false | Enable debug logging |
| `adbPath` | string | `""` | ADB executable path |
| `emulatorPath` | string | `""` | Android emulator path |
| `ffmpegPath` | string | `""` | ffmpeg executable path |
| `googleSheetUrl` | string | Google Sheets URL | Library catalog data source |

---

## 7. Key Design Patterns

### 7.1 Graceful Degradation

The extension never assumes file existence. Every path is validated with `fs.existsSync()` or `fs.promises.stat()` before loading. Missing libraries, modules, and INI files are logged and silently skipped.

### 7.2 Platform Isolation

A `.b4a` project loads **only** B4A libraries, never B4J/B4i/B4R. Platform detection from file extension ensures strict isolation.

### 7.3 Step Tracker Pattern

`createStepTracker()` creates a generation-scoped status bar tracker. If a newer operation starts, older trackers silently stop writing, preventing concurrent flows from stomping on each other.

### 7.4 Three-Tier Fallback

Multiple subsystems use a three-tier fallback:
- **SQLite**: better-sqlite3 → sql.js → SimpleInMemoryDB
- **Library Catalog**: Remote (GitHub) → Cache (globalState) → Bundled (libraries_mapping.json)
- **Platform Discovery**: VS Code settings → %APPDATA% → Windows Registry

### 7.5 B4X String-Aware Parsing

B4X uses `'` for comments and `""` for escaped double quotes inside strings. The codebase has three independent implementations of this parsing logic (in `b4xTextUtils.ts`, `typeDiagnosticsCore.ts`, `b4xDocParser.ts`).

### 7.6 Dependency Resolution

b4xlib dependency resolution is recursive: for each declared library, the extension extracts `manifest.txt` from the ZIP archive, parses `B4J.DependsOn` (platform-specific), and adds any new dependencies. The process repeats until no new dependencies are found.

---

## 8. Known Architectural Issues

### 8.1 Monolithic Extension Entry Point

`extension.ts` is 5,489 lines. It contains the entire activation flow, all command handlers, provider registration, and helper functions. This is the single biggest maintainability concern.

### 8.2 Duplicate String-Aware Parsing

B4X string/comment parsing is implemented three times: `b4xTextUtils.ts::findCommentStart`, `typeDiagnosticsCore.ts::stripB4xComment`, and `b4xDocParser.ts::stripComment`. These should be unified into a single shared utility.

### 8.3 Synchronous File I/O in Providers

Several providers use `fs.readdirSync` and `fs.existsSync` in hot paths (e.g., `updateBuildCommandContext`, `findB4xFilesOnDisk`). These can block the extension host thread.

### 8.4 Module-Level Mutable State

`extension.ts` uses numerous module-level `let` variables (`currentProjectDirectory`, `currentAllowedModuleBasePaths`, `lastLoadedB4xlibFiles`, `cachedTemplates`, `extContext`, etc.). This makes testing and reasoning about state difficult.

### 8.5 LSP Server is Minimal

The LSP server provides basic completion, hover, definition, rename, and extract method — but most rich IntelliSense features (detailed completions, signature help, type inference) are handled client-side by the VS Code extension providers, not delegated to the LSP.

### 8.6 No Unit Tests for Client-Side Providers

The `test/` directory contains only extension host smoke tests and a single unit test for the indexer. None of the 21+ language providers have dedicated unit tests.

---

## 9. Build & Packaging

- **TypeScript compilation**: `tsc -p .` → outputs to `dist/src/`
- **Bundling**: Custom `scripts/bundle.js` using esbuild
- **LSP Server**: Plain JavaScript (no compilation needed), runs via `node server/server.js`
- **Packaging**: `npm run package:vsix` → builds, bundles, rebuilds native modules (better-sqlite3), then `vsce package`
- **Dependencies**:
  - Runtime: `node-stream-zip`, `sql.js`, `vscode-languageclient`, `vscode-languageserver`, `vscode-languageserver-textdocument`, `@vscode/codicons`
  - Optional: `better-sqlite3` (native)
  - Dev: TypeScript, esbuild, Mocha, `@vscode/test-electron`

---

## 10. File Extension Inventory

| Extension | Language | Purpose |
|-----------|----------|---------|
| `.bas` | B4X | Main source module files |
| `.b4a` | B4X | B4A project files |
| `.b4i` | B4X | B4i project files |
| `.b4j` | B4X | B4J project files |
| `.b4r` | B4X | B4R project files |
| `.b4x` | B4X | Cross-platform module files |
| `.b4xlib` | — | ZIP archives containing library modules |
| `.b4xtemplate` | — | ZIP archives for project templates |
| `.xml` | — | B4X library definition files (Core.xml, SQL.xml, etc.) |

---

## 11. Testing

| Test | Location | Purpose |
|------|----------|---------|
| Extension host smoke test | `src/test/suite/extension.test.ts` | Basic activation test |
| Indexer unit test | `test/unit/indexer.test.js` | Document manager and symbol parsing |
| Type diagnostics test | `scripts/tests/test-type-diagnostics.ts` | Misplaced Type detection |
| E2E mock | `test/mock-e2e.js` | Mock end-to-end test setup |

---

## 12. Extension Host Interactions

The extension contributes:

- **Language**: `b4x` (aliases: B4X, B4A, B4J, B4I, B4R)
- **Grammar**: `syntaxes/b4x.tmLanguage.json` (TextMate grammar)
- **Language Config**: `language-configuration.json` (brackets, comments, folding)
- **Snippets**: `snippets/b4x.json`
- **Webview Views**: `b4x-companion-dashboard` (secondary sidebar), `b4xProjects` + `b4xLibraries` (activity bar)
- **Language Model Provider**: `ollama` (for Copilot Chat integration)
- **Submenus**: Context menu `B4X Companion` subgroup
- **Keybindings**: `Ctrl+Shift+H` for `openDocs`
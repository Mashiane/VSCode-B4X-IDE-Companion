# Project Exploration Summary: B4X VSCode IntelliSense Extension

**Exploration Date:** 2026-05-29  
**Branch:** `audit-decomposition`  
**Version:** 0.1.345  
**Explored By:** Code Explorer Agent

---

## 1. Project Identity & Purpose

The **B4X Code IDE Companion** is a comprehensive VS Code extension that recreates a full IDE experience for B4X development (B4A, B4i, B4J, B4R) inside VS Code. It is a mature, feature-rich project with ~15K+ lines of TypeScript source code and a custom Node.js LSP language server.

**Key Value Propositions:**
- Offline-capable IntelliSense and navigation for B4X languages
- Project management integration (open `.b4a`/`.b4i`/`.b4j`/`.b4r` files)
- Custom webview dashboards and layout editors
- AI integration (Ollama, DeepSeek, VS Code Language Model API)

---

## 2. Directory Structure

```
C:\b4a\b4a-vscode-intellisense
├── src/                          # Main extension TypeScript sources (~15K lines)
│   ├── providers/                # Webview/dashboard providers
│   │   ├── CompanionDashboardProvider.ts   # Project Resources dashboard
│   │   ├── libraryBrowserProvider.ts       # Library catalog browser
│   │   ├── bjlEditorProvider.ts            # BJL/BAL/BIL layout editor
│   │   ├── commandsProvider.ts             # Commands tree view
│   │   ├── ollamaProvider.ts               # Ollama AI integration
│   │   └── deepseekProvider.ts             # DeepSeek AI integration
│   ├── storage/                  # SQLite persistence layer
│   └── test/                     # Extension test entry points
├── server/                       # Node.js LSP language server
│   └── indexer/                  # Document indexing & symbol management
│       ├── documentManager.js    # Document lifecycle & symbol tables
│       ├── fileSymbolParser.js   # .bas/.b4x file symbol extraction
│       ├── globalSymbolTable.js  # Cross-file symbol resolution
│       ├── workerPool.js         # Background worker thread pool
│       ├── workerTask.js         # Worker task definitions
│       └── extractMethod.js      # Server-side extract method logic
├── dist/                         # Compiled JavaScript output (tsc + esbuild)
├── test/                         # Test suites and fixtures
│   ├── suite/                    # E2E integration tests
│   ├── unit/                     # Unit tests for indexer
│   ├── sample-workspace/         # Mock workspace for testing
│   ├── e2e-workspace/            # E2E mock workspace
│   └── *.bas                     # Sample B4X fixture files
├── scripts/                      # Build & utility scripts
│   ├── bundle.js                 # esbuild bundling script
│   ├── bump-version.js           # Version bumping
│   └── tests/                    # Test scripts
├── snippets/                     # Code snippets (b4x.json)
├── syntaxes/                     # TextMate grammar (b4x.tmLanguage.json)
├── media/                        # Webview assets (DaisyUI, Tailwind, Remix Icon)
├── docs/                         # Documentation
├── data/                         # Empty data directory (placeholder)
├── images/                       # Extension icons and logos
├── logs/                         # Runtime logs
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript configuration
├── language-configuration.json   # VS Code language config for B4X
└── libraries_mapping.json        # Library name mappings (~852 KB)
```

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| **Extension Host** | VS Code Extension API (`vscode`) |
| **Language** | TypeScript (strict mode, ES2022, CommonJS) |
| **Build Tool** | `tsc` for compilation, `esbuild` for bundling/minifying |
| **Package Manager** | npm |
| **LSP Server** | `vscode-languageserver` + `vscode-languageserver-textdocument` (stdio transport) |
| **LSP Client** | `vscode-languageclient` |
| **Database** | SQLite via `better-sqlite3` (optional) → fallback `sql.js` (WASM) → in-memory |
| **Parsing** | Custom regex/token-based parsers (no external parser generator) |
| **Webviews** | VS Code Webview API + DaisyUI + Tailwind CSS + Remix Icon |
| **Testing** | Mocha (unit), `@vscode/test-electron` (E2E) |
| **Packaging** | `vsce` for `.vsix` generation |

---

## 4. Core Features Implemented

### 4.1 IntelliSense & Completions
- Contextual completions for classes, methods, properties, local symbols
- 70+ keywords and preprocessor directives
- Dot-member completions via type inference
- Ghost text inline completions

### 4.2 Language Server Protocol (LSP)
- Local, offline-capable Node.js language server
- Document indexing with worker threads
- Cross-file symbol tables

### 4.3 Navigation
- Go to Definition (`F12`)
- Peek Definition (`Alt+F12`)
- Find All References (`Shift+F12`)
- Go to Implementation
- Go to Type Definition
- Rename Symbol (`F2`)
- Document Symbol Outline (`Ctrl+Shift+O`)
- Workspace Symbol Search (`Ctrl+T`)

### 4.4 Diagnostics
- Type placement validation
- CallSub target validation
- Quick-fix code actions

### 4.5 Code Formatting
- 5-phase structural formatter (tokenize → compute indent → format lines → normalize blanks)
- Keyword casing normalization
- Blank line management
- Format selection, un-format, block comment/uncomment
- Auto-casing as you type (on-type formatting)

### 4.6 Refactoring
- Extract Method with preview
- Insert Event Handler

### 4.7 Library Management
- XML library parsing
- `.b4xlib` ZIP extraction
- Project-scoped library loading
- SQLite caching
- Dual library scanning (internal + additional paths)
- Library browser with online catalog integration
- One-click library updates

### 4.8 Project Management
- Open `.b4a`/`.b4i`/`.b4j`/`.b4r` projects
- Auto workspace setup
- Build & install commands
- Android emulator start
- GIF/screenshot capture
- Backup workspace

### 4.9 Webviews & UI
- **Project Resources dashboard** — Libraries & Files tabs (`CompanionDashboardProvider.ts`, 55KB)
- **Library Browser** — Full catalog with search/filter (`libraryBrowserProvider.ts`, 21KB)
- **B4X Layout Editor** — Custom editor for `.bjl`/`.bal`/`.bil` files
- **Commands Tree View** — Quick access to common operations

### 4.10 AI Integration
- Ollama local model support
- DeepSeek TUI launch
- VS Code Language Model API integration

### 4.11 Other Features
- Syntax highlighting (TextMate grammar)
- 100+ code snippets
- Auto-insert `End If`, `Next`, `End Sub`, etc.
- Code folding
- Smart selection expansion
- Theme import from `.vssettings`
- Document links (clickable `LoadLayout`, `ShowPage`, `#AdditionalJar`)
- CodeLens reference counts above Sub declarations

---

## 5. Critical Source Files

### 5.1 Extension Core
| File | Lines | Purpose |
|------|-------|---------|
| `src/extension.ts` | ~5,843 | Central orchestrator — activation, command registration, provider registration, project loading lifecycle |
| `src/projectFile.ts` | ~447 | Parses `.b4a`/`.b4i`/`.b4j`/`.b4r` project files, extracts libraries/modules, handles `@EndOfDesignText@` |
| `src/platformIni.ts` | — | INI file parsing for B4X platform configuration |
| `src/platformConfig.ts` | — | Multi-platform auto-discovery (`b4xV5.ini` from AppData/Registry) |
| `src/logging.ts` | — | File-based debug logging system |

### 5.2 Language Intelligence
| File | Purpose |
|------|---------|
| `src/b4xTypeInference.ts` | Cross-file variable type inference, `Dim`/`Sub` parameter scanning, dot-chain resolution |
| `src/b4xDocParser.ts` | Core tokenizer, comment stripping, expression analysis, cursor-context utilities |
| `src/workspaceClassIndex.ts` | ~899 lines — Indexes user `.bas` modules (Subs, Globals, Types) |
| `src/xmlLibraryIndex.ts` | ~534 lines — Parses XML library descriptors for classes/methods/properties |
| `src/commonClassStore.ts` | Dedicated extraction of `Common` class globals (`Log`, `Msgbox`, `StartActivity`) |
| `src/primitiveTypeStore.ts` | Maps primitive types (e.g., `String` → `String2`) |
| `src/b4xLocalSymbols.ts` | Local symbol extraction for current document |

### 5.3 Language Providers (VS Code API Implementations)
| File | Feature |
|------|---------|
| `src/b4xDocumentFormattingProvider.ts` | Document formatting (5-phase structural) |
| `src/b4xDocumentRangeFormattingProvider.ts` | Range formatting |
| `src/b4xDocumentSymbolProvider.ts` | Document symbol outline |
| `src/b4xWorkspaceSymbolProvider.ts` | Workspace symbol search |
| `src/b4xReferenceProvider.ts` | Find All References |
| `src/b4xRenameProvider.ts` | Rename symbol (case-preserving) |
| `src/b4xImplementationProvider.ts` | Go to Implementation |
| `src/b4xTypeDefinitionProvider.ts` | Go to Type Definition |
| `src/b4xDocumentLinkProvider.ts` | Clickable document links |
| `src/b4xInlineCompletionProvider.ts` | Ghost text completions |
| `src/b4xCodeLensProvider.ts` | Reference counts above Subs |
| `src/b4xFoldingRangeProvider.ts` | Code folding |
| `src/b4xSelectionRangeProvider.ts` | Smart expand selection |
| `src/b4xOnTypeFormattingProvider.ts` | Auto-casing as you type |
| `src/b4xAutoclose.ts` | Auto-insert `End If`, `Next`, `End Sub` |

### 5.4 Diagnostics & Refactoring
| File | Purpose |
|------|---------|
| `src/typeDiagnostics.ts` | Type placement validation (diagnostics collector) |
| `src/typeDiagnosticsCore.ts` | Core type placement validation logic |
| `src/callSubDiagnostics.ts` | CallSub target validation |
| `src/extractMethodCodeAction.ts` | Extract Method refactoring (client-side) |
| `src/typeCodeAction.ts` | Quick-fix for misplaced Type blocks |

### 5.5 LSP Server
| File | Purpose |
|------|---------|
| `server/server.js` | LSP server entry (stdio transport), connection initialization |
| `server/indexer/documentManager.js` | Document management with symbol tables |
| `server/indexer/fileSymbolParser.js` | `.bas`/`.b4x` file symbol extraction |
| `server/indexer/globalSymbolTable.js` | Cross-file symbol table |
| `server/indexer/workerPool.js` | Background worker thread pool for indexing |
| `server/indexer/workerTask.js` | Worker task definitions |
| `server/indexer/extractMethod.js` | Server-side Extract Method logic |
| `server/logger.js` | Server-side logging |

---

## 6. Build & Development Configuration

### 6.1 package.json Scripts
```json
{
  "compile": "tsc -p ./",
  "bundle": "node scripts/bundle.js",
  "build": "npm run compile && npm run bundle",
  "watch": "tsc -watch -p ./",
  "test": "node ./test/runTests.js",
  "test:unit": "node test/unit/indexer.test.js",
  "test:integration": "npm run compile && node ./test/runTests.js",
  "test:storage": "tsc -p tsconfig.tests.json && node dist/scripts/tests/test-library-index.js",
  "vscode:prepublish": "npm run build",
  "package:vsix": "vsce package"
}
```

### 6.2 TypeScript Configuration
- **Target:** ES2022
- **Module:** CommonJS
- **Strict mode:** Enabled
- **Special flags:** `noUncheckedIndexedAccess`
- **Source maps:** Enabled
- **No emit on error:** Enabled

### 6.3 Extension Manifest (package.json)
- 50+ commands registered
- Language contribution: `b4x`
- Custom editors: `.bjl`, `.bal`, `.bil`
- Views: Activity bar + secondary sidebar
- 30+ configuration properties
- Keybindings and menus defined
- Activation events: `onLanguage:b4x`, `onCommand:*`, etc.

---

## 7. Testing Infrastructure

| Test Type | Location | Framework | Command |
|-----------|----------|-----------|---------|
| **Unit Tests** | `test/unit/indexer.test.js` | Node.js assertions | `npm run test:unit` |
| **E2E Integration** | `test/suite/` | `@vscode/test-electron` | `npm test` / `npm run test:integration` |
| **Storage Tests** | `scripts/tests/` | Compiled TS + Node | `npm run test:storage` |

**Fixture Files:**
- `test/*.bas` — Sample B4X files for testing
- `test/sample-workspace/` — Mock workspace with `AppActions.bas`, `Main.bas`, `UserSession.bas`
- `test/e2e-workspace/` — E2E mock workspace with `Main.b4a`

---

## 8. Recent Git Activity

### Current State
- **Branch:** `audit-decomposition`
- **Other branches:** `dune-record`, `main`, `master`
- **Remote:** `origin/main`
- **Stats:** ~1,008 files changed, +3,110 insertions, -297,353 deletions

### Recent Commits
1. `e238cac` — chore: fix TypeScript type annotations for error handling in `focusDashboard` and `openB4X` commands
2. `f145358` — chore: improve error handling for `openB4X` command
3. `d75d9a0` — chore: improve error handling for `focusDashboard` command
4. `dd7d32d` — Upgrade to 0.1.301 advanced architecture baseline (including `B4xApiIndex` compilation fix)
5. `66b9d50` — backup: snapshot 2026-04-17 (compilation fixes + extension enhancements)

### Notable Working Tree Changes
- **Deleted markdown docs at root:** `CHANGELOG.md`, `CONTRIBUTING.md`, `CORE_XML_AUDIT.md`, `MARKETPLACE_RELEASE_NOTES.md`, `NEW_FEATURES.md`, `PLATFORM_BUILDERS.md`, `PRIMITIVE_TYPES_FIX.md`, `PUBLISHING.md`, `QWEN.md`, `RELEASE_NOTES.md`, `TESTING.md`
- **Deleted old VSIX extraction folder:** `b4x-intellisense-0.1.274/` (1000+ files)
- **Modified source files:** Many TypeScript files with LF/CRLF warnings
  - `src/b4xAutoclose.ts`, `src/b4xCodeLensProvider.ts`, `src/b4xDocumentFormattingProvider.ts`, `src/b4xDocumentRangeFormattingProvider.ts`, `src/b4xDocumentSymbolProvider.ts`, `src/b4xFoldingRangeProvider.ts`, `src/b4xImplementationProvider.ts`, `src/b4xInlineCompletionProvider.ts`, `src/b4xOnTypeFormattingProvider.ts`, `src/b4xReferenceProvider.ts`, `src/b4xRenameProvider.ts`, `src/b4xTypeDefinitionProvider.ts`, `src/b4xWorkspaceSymbolProvider.ts`, `src/callSubDiagnostics.ts`, `src/commonClassStore.ts`, `src/lspClient.ts`, `src/platformBuilders.ts`, `src/platformConfig.ts`, and many others
- **Modified configs:** `.gitignore`, `.vscodeignore`, `package.json`, `package-lock.json`, `README.md`

---

## 9. Architecture Patterns

### 9.1 Data Flow
1. **Document Open/Change** → `DocumentManager` (server/indexer)
2. **Parse & Extract Symbols** → `fileSymbolParser.js` + `workerPool.js`
3. **Update Global Tables** → `globalSymbolTable.js`
4. **LSP Requests** → Server queries symbol tables → returns to client
5. **Client-Side Providers** → VS Code API providers use LSP client + local indices

### 9.2 Provider Pattern
- Each VS Code feature is implemented as a separate provider class/file
- Providers are registered in `src/extension.ts` during activation
- Many providers depend on `b4xDocParser.ts` for tokenization

### 9.3 Indexing Strategy
- Worker thread pool for background parsing
- SQLite caching for library metadata
- Dual library scanning (internal B4X libraries + additional user libraries)
- Project-scoped loading (only libraries referenced in `.b4a`/`.b4i`/`.b4j`/`.b4r`)

### 9.4 Database Fallback Chain
1. `better-sqlite3` (native, fastest)
2. `sql.js` (WASM SQLite, no native dependencies)
3. In-memory (fallback when everything else fails)

---

## 10. Known Characteristics & Quirks

1. **Large Files:** Some files are significantly larger than the 800-line target (e.g., `src/extension.ts` at ~5,843 lines, `src/providers/CompanionDashboardProvider.ts` at 55KB, `src/workspaceClassIndex.ts` at ~899 lines, `src/xmlLibraryIndex.ts` at ~534 lines). This may indicate refactoring opportunities.

2. **Custom Parsing:** The project uses hand-rolled regex/token-based parsers rather than an external parser generator (e.g., ANTLR, Tree-sitter). This is a deliberate choice but requires careful maintenance.

3. **LF/CRLF Warnings:** Many modified files show LF/CRLF line ending warnings, suggesting mixed line endings in the codebase.

4. **Line Ending Issues:** Many files in the working tree have line ending warnings, indicating potential `.gitattributes` normalization issues.

5. **No External Grammar:** The TextMate grammar in `syntaxes/b4x.tmLanguage.json` is hand-maintained.

6. **B4X-Specific Concepts:** The extension deals heavily with B4X-specific concepts like `CallSub`, `LoadLayout`, `#AdditionalJar`, `Dim`, `EndOfDesignText`, `@Event`, etc.

7. **Platform-Specific Paths:** The code handles Windows (AppData, Registry) and cross-platform path resolution for B4X IDE installations.

---

## 11. Dependencies & External Integrations

### NPM Dependencies (Key)
- `vscode` — Extension API
- `vscode-languageclient` — LSP client
- `vscode-languageserver` / `vscode-languageserver-textdocument` — LSP server
- `better-sqlite3` — Native SQLite (optional)
- `sql.js` — WASM SQLite fallback
- `esbuild` — Bundling
- `mocha` — Unit testing
- `@vscode/test-electron` — E2E testing
- `vsce` — VSIX packaging

### External Tools/Integrations
- B4X IDE installations (auto-discovered)
- Android SDK / Emulator
- Ollama (local AI models)
- DeepSeek API

---

## 12. Configuration Properties (Key)

The extension exposes 30+ configuration properties under `b4x.*`:
- `b4x.platformPath` — Path to B4X platform
- `b4x.additionalLibraries` — Additional library directories
- `b4x.showDebugOutput` — Enable debug logging
- `b4x.formatOnType` — Enable on-type formatting
- `b4x.enableDiagnostics` — Enable type/CallSub diagnostics
- `b4x.ollamaModel` — Default Ollama model
- Various theme and UI customization options

---

## 13. Risk Areas & Technical Debt Indicators

1. **Monolithic `src/extension.ts`** — At ~5,843 lines, this is a central bottleneck. Any change here has high blast radius.
2. **Large Provider Files** — `CompanionDashboardProvider.ts` (55KB) and `libraryBrowserProvider.ts` (21KB) are substantial webview implementations.
3. **Custom Parser Maintenance** — Hand-rolled parsers require ongoing maintenance as B4X syntax evolves.
4. **Worker Pool Complexity** — Multi-threaded indexing adds concurrency risk.
5. **Database Fallback Chain** — Three-tier fallback is robust but adds complexity.
6. **Platform Auto-Discovery** — Registry/AppData scanning is Windows-centric and fragile.
7. **Line Ending Inconsistency** — Mixed LF/CRLF may cause issues in diff tools and cross-platform collaboration.

---

## 14. Recommended Reading Order for New Agents

1. **Start with `package.json`** — Understand commands, activation, and capabilities
2. **Read `src/extension.ts` (first 200 lines)** — Understand activation flow
3. **Read `src/b4xDocParser.ts`** — Understand the core tokenizer/parser
4. **Read `server/indexer/fileSymbolParser.js`** — Understand how symbols are extracted
5. **Read `src/b4xTypeInference.ts`** — Understand type resolution
6. **Pick a provider** (e.g., `src/b4xDocumentFormattingProvider.ts`) — Understand provider pattern
7. **Read `src/projectFile.ts`** — Understand B4X project structure parsing

---

## 15. Glossary of B4X-Specific Terms

| Term | Meaning |
|------|---------|
| **B4A** | Basic4Android |
| **B4i** | Basic4iOS |
| **B4J** | Basic4Java |
| **B4R** | Basic4Arduino |
| **.bas** | B4X module source file |
| **.b4a/.b4i/.b4j/.b4r** | B4X project files |
| **.b4xlib** | B4X library package (ZIP) |
| **.bjl/.bal/.bil** | B4X layout files |
| **CallSub** | B4X mechanism for cross-module method invocation |
| **Dim** | Variable declaration keyword |
| **EndOfDesignText** | Marker separating designer-generated code from user code |
| **#AdditionalJar** | Preprocessor directive for JAR dependencies |
| **LoadLayout** | Method to load UI layouts |
| **StartActivity** | Android activity launcher (Common class method) |

---

*End of Exploration Summary*

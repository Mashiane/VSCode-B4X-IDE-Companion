# Changelog

All notable changes to this project will be documented in this file.

## [0.1.483] - 2026-09-19

### Release highlights

- **New: Activation Gate** - The extension now scans the workspace for a `.b4a`, `.b4i`, `.b4j`, or `.b4r` file before doing any other work:
  - Checks each workspace folder root first, then one level down, so both platform roots (`B4A/`, `B4i/`, `B4J/`, `B4R/`) and single-platform roots are covered
  - With no platform file, `activate()` hides the status bar item, registers only the `openB4xProject` and `newB4xProjectFromTemplate` commands, and returns
  - Skipped in the idle case: library catalog download, remote catalog and version fetches, library tree and dashboard providers, language providers, file watchers, template scan, and status messages
  - Unreadable folders are treated as empty rather than aborting activation
  - Fixes startup cost and status bar churn in non-B4X windows and empty windows

- **New: Last-Project Sync on Activation** - The first platform file found during the activation scan becomes the remembered project:
  - Persists `b4x.lastOpenedProjectFile` and `b4x.lastOpenedProjectPlatform` to `globalState`
  - Writes only when the found path differs from the stored one, so repeat reloads of the same folder do not churn state
  - `Open Folder`, `Open Recent (Folder)`, window restart, and late activation on an already-open folder now converge on the same behaviour
  - A stale project remembered from another window can no longer win over the folder that is currently open

- **Fixed: Template Scan Stall** - `Loading templates...` could remain in the status bar indefinitely:
  - Occurred when a folder was opened without a B4X project, where no auto-reload step took over the status bar afterwards
  - The scan's `finally` block now resets the status to `$(check) B4X: Ready` when it still owns the `Loading templates` message, and persists that state
  - Replaced blocking `fs.existsSync` calls with async `fs.promises.stat` and `isDirectory()` checks
  - Isolated subdirectory read errors per folder so one unreadable folder cannot stall the scan
  - Started detached via `void scanTemplates().catch(() => {})` so it can never block activation

- **Docs: User Manual and README Refresh** - Both documents now match the shipped extension:
  - All 49 settings documented, adding the four platform install paths, the four workspace folders, the Java, builder, additional library, and shared folder paths, the device tool paths, and the code smell, compiler warning, library catalog, backup, and view name settings
  - Removed the `preferLiveSources` setting, which does not exist in `package.json`
  - All 65 commands documented, grouped into project, build and device, library and layout, diagnostics, editor, cache, theme, and AI assistant tables, plus the hidden context menu commands
  - Corrected command titles (`Capture GIF`, `Capture Screenshot`, `Import B4X Theme`, `Settings`)
  - Added a **Views** section covering the Projects, Libraries, and Project Resources views
  - Rewrote troubleshooting for the activation gate, including the window reload required after adding a project file to a folder that had none

- **Marketplace: Changelog Tab** - `CHANGELOG.md` is no longer excluded by `.vscodeignore`, so `vsce` embeds it and the Marketplace changelog tab is populated instead of empty. `scripts/verify-vsix.js` now warns when the file is missing from a package.

- **Marketplace: License Declared** - `package.json` declares `"license": "CC0-1.0"`, matching the `LICENSE` file that already shipped as `LICENSE.txt`, so the listing can display license information.

- **Notes:** No breaking changes to existing projects. Reload the window after installing to pick up the new activation flow.

---

## [0.1.418] - 2026-06-04

### Release highlights

- **New: Project Statistics Dashboard** — Interactive webview dashboard inspired by jMashProjectProfile, featuring:
  - **Stat Cards** — Total Lines, Code Lines, Comment Lines, Blank Lines, Modules, Subs, Events, and Types displayed in a 3-column grid with locale-aware number formatting
  - **Per-Module Table** — Sortable breakdown of every module with Line, Code, Comment, Blank, Subs, Events, and Types columns, plus a Totals row
  - **Line Composition Doughnut Chart** — Proportional breakdown of code vs. comment vs. blank lines across the project (Chart.js)
  - **Subroutines per Module Top 10** — Horizontal stacked bar chart showing Sub and Event Handler counts for the 10 largest modules (Chart.js)
  - **Module Size Breakdown Top 10** — Horizontal stacked bar chart showing Code, Comment, and Blank line composition for the 10 largest modules (Chart.js)
  - **Empty-state handling** — Graceful fallback when no modules are loaded
  - **Error banner** — User-visible error feedback in the webview
  - **Theme-aware colors** — Charts use VS Code's `--vscode-charts-*` CSS variables for seamless light/dark theme integration
  - Accessible via the **Project Statistics** command in the Command Palette or tree view

- **New: Unused Sub Diagnostics** — Detects unused Subroutines in your B4X project:
  - Flags Private Subs that are never called from within their own module (severity: Hint)
  - Flags Public Subs that are never called from any module in the workspace (severity: Warning)
  - Excludes B4X lifecycle Subs (`Activity_Create`, `B4XPage_Created`, etc.) and event handlers (`ObjectName_EventName` pattern)
  - Excludes Subs called via `CallSub`/`CallSubDelayed` string references
  - Toggle via `b4xIntellisense.enableUnusedSubDiagnostics` setting (default: enabled)

- **New: Unused Library Diagnostics** — Detects libraries declared in your project file that are never referenced in code:
  - Cross-references `<Libraries>` entries against actual type usage in workspace `.bas`/`.b4x` files
  - Flags libraries whose exported types are never used anywhere in the project (severity: Information)
  - Excludes core libraries that provide implicit types (`Core`, `StringUtils`, etc.)
  - Toggle via `b4xIntellisense.enableUnusedLibraryDiagnostics` setting (default: enabled)

- **Improved: LSP Server Restart Handling** — The LSP server no longer enters a permanent `DoNotRestart` state on first failure. Limited restarts (up to 3 attempts) are now allowed before giving up, improving resilience during transient errors.

- **Fixed: Extract Method Dim Parsing** — The LSP extract method handler now correctly captures all comma-separated variables in a single `Dim` declaration (e.g., `Dim a, b, c As Int` now extracts all three parameters).

- **Fixed: Chart Label Visibility** — Bar chart Y-axis labels no longer skip; `autoSkip: false` ensures all module names are displayed.

- **Fixed: Cross-platform Module Names** — Chart labels for modules shared across platforms (`.b4a`, `.b4j`, etc.) now preserve their platform extension to disambiguate, rather than stripping all extensions.

- **Fixed: Number Formatting Consistency** — All numeric values in the Project Statistics dashboard now use locale-aware thousand separators via `.toLocaleString()`.

- **Fixed: Chart Memory Leak** — Charts are properly destroyed before recreation to prevent memory leaks on dashboard refresh.

- **Added: Chart.js v4.5.1 UMD Bundle** — Bundled locally in `media/chart.umd.js` for offline-capable webview chart rendering.

---

## [0.1.289] - 2026-04-15

### Release highlights
- **Version bump:** Package `version` updated to `0.1.289` (see `package.json`).
- **New: New B4X Project from Template:** Added the `b4xIntellisense.newB4xProjectFromTemplate` command and handler which:
	- Scans platform library folders (including subdirectories) for `.b4xtemplate` files.
	- Presents templates prefixed with platform and subpath (e.g., `[B4A] Subfolder/TemplateName`) and sorts by platform then name.
	- Handles template extraction, project naming, and placeholder replacement when creating a new project.
- **Indexing & scanning improvements:** Added compiled indexing utilities (`apiIndex`, `b4aProjectScanner`) and related build artifacts to improve API indexing and workspace scanning performance.
- **Internal refinements:** Multiple internal improvements and build refreshes (see `dist/src` changes) to library indexing, storage, and packaging.
- **Notes:** No breaking changes expected; please report issues if you rely on prebuilt index formats.

## [0.1.287] - 2026-04-12

### Template System Correction
- **Both libraries folders** — New B4X project template selection now searches BOTH `LibrariesFolder` and `AdditionalLibrariesFolder` for `.b4xtemplate` files (as originally requested)
- **Complete template discovery** — Ensures all user-available templates (internal and additional) appear in the selection list
- **Maintains all UX improvements** — Command palette reordering, clean template display, platform-specific workspace folder detection, and sorting unchanged

## [0.1.285] - 2026-04-12

### Template System Refinement
- **Additional libraries only** — New B4X project template selection now exclusively searches the `AdditionalLibrariesFolder` (not internal LibrariesFolder) for `.b4xtemplate` files
- **Focused template discovery** — Ensures only user-added templates appear in the selection list, separating them from built-in platform templates
- **Maintains all UX improvements** — Command palette reordering, clean template display, and platform-specific workspace folder detection unchanged

## [0.1.282] - 2026-04-12

### User Experience Improvements
- **Reordered command palette** — Moved "New B4X Project from Template..." to appear before "Open B4X Project..." for better discoverability
- **Cleaned template picker UI** — Removed file paths from template selection menu items, showing only `[PLATFORM] TemplateName` for cleaner presentation

## [0.1.279] - 2026-04-12

### Template System Enhancement
- **Cleaned template display names** — Removed .b4xtemplate extension from template listing titles for cleaner presentation
- **Sorted template listing** — Templates are now sorted by platform (B4A, B4i, B4J, B4R) then alphabetically by name for consistent, predictable ordering
- **Maintains all previous enhancements** — Platform prefixes, multi-platform discovery, smart workspace folder detection, and fallback systems unchanged

## [0.1.276] - 2026-04-12

### Template System Enhancement
- **Added multi-platform template discovery** — New B4X project creation now searches for `.b4xtemplate` files in ALL configured platform library folders (internal & additional) and displays them with platform prefixes
- **Clear platform identification** — Templates are displayed as `[B4A] filename.b4xtemplate`, `[B4J] filename.b4xtemplate` etc. so users know exactly which platform they're creating a project for
- **Smart fallback system** — If no templates found in library folders, falls back to original file picker for manual template selection
- **Subfolder support** — Discovers templates organized in subdirectories within library folders, showing paths like `[B4A] Subfolder/template.b4xtemplate`

## [0.1.273] - 2026-04-12

### Formatter Fixes
- **Fixed single-line If Then detection** — Resolved issue where trailing spaces after `Then` caused incorrect indentation of subsequent lines. Now treats any content after `Then` (including whitespace) as a single-line If statement.

## [0.1.272] - 2026-04-11

### Formatter Fixes
- **Fixed trailing space bug** — Case/Return/Dim keywords followed by string literals now preserve the space (e.g. `Case "btn"` no longer becomes `Case"btn"`)
- **Fixed ALL-CAPS keyword normalization** — Keywords like `CASE`, `RETURN`, `END SUB` now correctly normalize to TitleCase instead of staying ALL-CAPS
- **Added B4X primitive type keywords** — `Int`, `String`, `Long`, `Float`, `Double`, `Boolean`, `Byte`, `Short`, `Char`, `Object` now get proper casing
- **Fixed #Else / #Else If indent** — Preprocessor directive branches inside `#If...#End If` blocks now maintain correct indentation
- **Fixed # directive corruption** — Lines starting with `#` (e.g. `#AdditionalJar:`, `#Event:`) are now exempt from keyword casing and spacing normalization, preventing Windows path corruption (`C:\` → `C: \`) and preserving directive syntax verbatim

---

## [0.1.271] - 2026-04-09

### Cleanup
- **Removed JAR-to-XML Generator** - Removed Java bytecode parsing feature from extension scope
- **Command Palette Cleanup** - Hidden technical maintenance commands from Command Palette
- **Removed "B4X: " prefix** from all command titles for cleaner display

---

## [0.1.270] - 2026-04-09

### New Language Features
- **Go to Implementation** — Jump to concrete Sub implementations across workspace modules
- **Go to Type Definition** — Jump from type name to its class definition (e.g., `Button` → Button XML class)
- **Document Link Provider** — Clickable links for `#AdditionalJar:` paths, `LoadLayout("Name")` → `.bal` files, `B4XPages.ShowPage("Name")` → page modules
- **Inline Completion Provider** — Ghost text completions with Tab accept for Sub calls
- **Document Highlight Provider** — Highlights all occurrences of symbol under cursor with read/write distinction
- **Selection Range Provider** — Smart expand selection: Word → Line → Sub Block → Document
- **On-Type Formatting** — Auto-casing of keywords as you type (space, Enter, colon triggers)

### Diagnostics & Code Actions
- **Insert Event Handler** — Generate event handler Sub templates via command
- **Range Formatting** — Format only selected text range, not entire document

### Library & Indexing
- **Common Class Store** — Dedicated extraction of Common class globals (`Log`, `Msgbox`, etc.)
- **Primitive Type Store** — Dedicated store for primitive type mappings and synthetic class definitions

### Project Management
- **Backup Workspace** — Create workspace backup with configurable interval
- **AutoLoad Project Assets** — New setting to control automatic library loading
- **Telemetry Opt-In** — New `enableTelemetry` setting for anonymous feature usage

### Editor UX
- **Block Comment / Un-Block Comment** — Comment/uncomment selected lines with B4X `'` style
- **Format Selection / Un-Format Selection** — Apply/remove formatting to selected range only

### Infrastructure
- **File-based Logging** — Timestamped log files (`b4x-log-YYYYMMDD.txt`) with workspace root or global storage
- **3-Tier SQLite Fallback** — better-sqlite3 (native) → sql.js (WASM) → in-memory fallback
- **Expanded Context Menu** — Commands organized in grouped submenu (Navigation, Formatting, Comments, Cleanup, Tools, External)

### Command Palette Improvements
- **Removed "B4X: " prefix** from all command titles for cleaner display
- **Hidden technical commands**: Refresh Library Index, Clear Library Cache, Set Platform Install Path
- Commands remain accessible via context menus or programmatic access
- Cleaner, more user-focused command palette experience

### Settings
- `b4iInstallPath`, `b4jInstallPath`, `b4rInstallPath` — Platform-specific install paths
- `adbPath`, `ffmpegPath` — Tool path overrides for device operations
- `autoLoadProjectAssets` — Control automatic library loading
- `enableTelemetry` — Opt-in anonymous telemetry

---

## [0.1.258] - 2026-04-07

### Structural Code Formatter
- Block-aware indentation tracking for all B4X constructs: `Sub/End Sub`, `If/Else If/Else/End If`, `For/Next`, `Select/Case/Case Else/End Select`, `Try/Catch/End Try`, `Do/Loop`, `#Region/#End Region`, `#If/#End If`
- Keyword casing normalization (`end sub` → `End Sub`) with ALLCAPS preservation (`END SUB` stays `END SUB`)
- Blank line management: collapses consecutive blank lines, ensures spacing before Subs
- `#EndOfDesignText@` awareness: designer header preserved verbatim
- String and comment protection: never modifies content inside `"strings"` or `'comments`
- Spacing normalization for `=`, `,`, `:`

### Navigation Enhancements
- **Document Symbol Provider** — Outline view panel and `Ctrl+Shift+O` (Go to Symbol in Editor) for Subs, Types, Regions, and globals
- **Workspace Symbol Provider** — `Ctrl+T` fuzzy search across all workspace modules and XML libraries (up to 500 results)
- **Go to Definition Across Modules** — Resolves Sub names in other `.bas` files, not just class definitions
- **Find All References On-Disk** — Searches all workspace files on disk (not just open tabs), full-file search without scope filtering
- **Peek Definition** — `Alt+F12` inline definition peek
- **Rename Provider** — `F2` rename with case preservation across all project files

### Diagnostics
- **CallSub Target Validation** — Warns when `CallSub`/`CallSubDelayed`/`CallSub3` references a non-existent Sub, catching runtime crashes at edit time

### Editor UX
- **Code Lens** — Inline reference counts above each Sub declaration (clickable to trigger Find All References)
- **Preprocessor Directive Completions** — Type `#` for completions: `#If B4A`, `#Region`, `AdditionalJar:`, `Event:`, `MinSdkVersion:`, etc.
- **Un-Format Document** — Strip all leading indentation, left-align every line
- **Remove Blank Lines** — Delete every empty line, compact to single block

### Context Menu
- **B4X IntelliSense Submenu** — Right-click submenu with 12 commands: Go to Definition, Peek Definition, Find All References, Rename Symbol, Go to Symbol, Search Online, Format Document, Un-Format Document, Remove Blank Lines, Quick Fix, Trigger Suggestions, Parameter Hints
- Items hidden from Command Palette (`Ctrl+Shift+P`), only appear in B4X editor context

### Hover Enhancements
- **Action Links in Hover Tooltips** — `[Go to Definition] · [Find All References]` on every hover, plus `[Search Online]` for classes and types
- Links are clickable and trigger the corresponding VS Code action

---

## [0.1.248]

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

---

## [0.1.0]

Initial release with core IntelliSense features.

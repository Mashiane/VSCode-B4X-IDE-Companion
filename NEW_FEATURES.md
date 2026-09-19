# New Features Implementation Summary

**Last Updated:** 2026-06-04 (v0.1.418)

This document describes all features added to the VS Code B4X IDE Companion extension, organized by implementation batch.

---

## Batch 10: v0.1.418 - Project Statistics, Unused Diagnostics, Bug Fixes

### **Project Statistics Dashboard**

Inspired by jMashProjectProfile's project profiling reports, the new Project Statistics dashboard provides an interactive overview of your B4X project.

#### **What It Does:**

Opens a webview panel with:

1. **Stat Cards** — 3-column grid showing Total Lines, Code Lines, Comment Lines, Blank Lines, Modules, Subs, Events, and Types with locale-aware number formatting
2. **Per-Module Table** — Every module listed with Line, Code, Comment, Blank, Subs, Events, and Types columns, plus a Totals row
3. **Line Composition Doughnut Chart** — Proportional breakdown of code, comment, and blank lines (Chart.js)
4. **Subroutines per Module Top 10** — Horizontal stacked bar chart showing Sub and Event Handler counts for the 10 largest modules
5. **Module Size Breakdown Top 10** — Horizontal stacked bar chart showing Code, Comment, and Blank line composition for the 10 largest modules

#### **Technical Details:**

- Chart.js v4.5.1 UMD bundle loaded locally from `media/` directory for offline capability
- Theme-aware colors using `--vscode-charts-*` CSS variables
- Cross-platform module names preserve `.b4a`, `.b4j` extensions to disambiguate
- `destroyCharts()` called before recreation to prevent memory leaks
- `autoSkip: false` on Y-axis ticks ensures all labels are visible
- Empty-state handling when no modules are loaded
- Error banner for user-visible feedback
- Debounced refresh counter to discard stale webview updates

#### **Command:** `b4xIntellisense.showProjectStatistics` — accessible from Command Palette and tree view

#### **Files:**
- `src/projectStatisticsCore.ts` — Pure functions for statistics collection (no VS Code dependencies)
- `src/providers/projectStatisticsProvider.ts` — Webview panel provider with Chart.js integration
- `media/chart.umd.js` — Chart.js v4.5.1 UMD bundle

---

### **Unused Sub Diagnostics**

#### **What It Does:**

Detects Subroutines that are never called anywhere in the project:

- **Private Subs** — flagged when not called within their own module (severity: Hint)
- **Public Subs** — flagged when not called from any module in the workspace (severity: Warning)
- **Exclusions:**
  - B4X lifecycle Subs (`Activity_Create`, `B4XPage_Created`, etc.) are never flagged
  - Event handlers (`ObjectName_EventName` pattern) are never flagged
  - Subs referenced via `CallSub`/`CallSubDelayed` strings are not flagged
- **Toggle:** `b4xIntellisense.enableUnusedSubDiagnostics` setting (default: enabled)

#### **Files:**
- `src/unusedSubDiagnosticsCore.ts` — Pure detection logic with no VS Code dependencies
- `src/unusedSubDiagnostics.ts` — VS Code diagnostic provider

---

### **Unused Library Diagnostics**

#### **What It Does:**

Detects libraries declared in the project file whose types are never referenced in code:

- Cross-references `<Libraries>` entries against actual type usage in workspace `.bas`/`.b4x` files
- Flags libraries whose exported types are never used (severity: Information)
- Core libraries that provide implicit types are excluded
- **Toggle:** `b4xIntellisense.enableUnusedLibraryDiagnostics` setting (default: enabled)

#### **Files:**
- `src/unusedLibraryDiagnosticsCore.ts` — Pure analysis logic with no VS Code dependencies
- `src/unusedLibraryDiagnostics.ts` — VS Code diagnostic provider

---

### **Bug Fixes & Improvements**

- **LSP Server Restart Resilience** — Limited restarts (up to 3) instead of permanent `DoNotRestart` state on first failure
- **Extract Method Dim Parsing** — Correctly captures all comma-separated variables in `Dim a, b, c As Int`
- **Chart Label Visibility** — `autoSkip: false` ensures all Y-axis labels are displayed
- **Cross-platform Module Names** — Platform extensions preserved in chart labels
- **Number Formatting Consistency** — All numeric values use `.toLocaleString()` for locale-aware thousand separators
- **Chart Memory Leak** — Charts properly destroyed before recreation
- **VSIX Verification** — `media/chart.umd.js` added to expected webview assets

---

## Batch 9: v0.1.272 - Formatter Bug Fixes

### Structural Code Formatter Fixes
- **Trailing space preservation** — Fixed `formatCodeSegment` removing spaces before string literals (`Case"btn"` → `Case "btn"`)
- **ALL-CAPS keyword normalization** — Changed from preserving ALL-CAPS to always normalizing to TitleCase (`CASE` → `Case`, `END SUB` → `End Sub`)
- **Primitive type keywords** — Added `Int`, `String`, `Long`, `Float`, `Double`, `Boolean`, `Byte`, `Short`, `Char`, `Object` to keyword casing list
- **#Else / #Else If indent** — Added proper indent tracking for preprocessor directive branches inside `#If...#End If` blocks
- **# directive protection** — Lines starting with `#` now bypass keyword casing and spacing normalization entirely, preserving Windows paths, colons, and arbitrary directive syntax verbatim

---

## Batch 8: v0.1.271 - Extension Cleanup

### **Removed JAR-to-XML Generator**

#### **What Changed:**

Removed the JAR-to-XML bytecode parser (`src/jarToXmlGenerator.ts`) from the extension scope.

#### **Why:**

This feature was outside the core scope of the extension and is better handled as a separate tool or external process.

#### **Impact:**

- Cleaner codebase with ~400 lines removed
- Reduced dependencies
- Extension focuses on XML library parsing (not Java bytecode generation)

### **Command Palette Improvements**

- Hidden technical maintenance commands
- Removed redundant "B4X: " prefix from command titles

---

## Batch 7: v0.1.270 - Navigation Providers, UX Enhancements, Infrastructure

### **Go to Implementation Provider**

#### **What It Does:**

`Shift+F12` on a Sub call jumps to the concrete implementation across workspace modules.

#### **How It Works:**

Searches all `.bas`/`.b4x` files in the workspace for Sub definitions matching the symbol name. Returns the first match found.

#### **File:** `src/b4xImplementationProvider.ts`

---

### **Go to Type Definition Provider**

#### **What It Does:**

Jump from a type name to its class definition (e.g., `Button` → Button XML class).

#### **How It Works:**

Looks up the type in both `XmlLibraryStore` and `WorkspaceClassStore` to find the class definition.

#### **File:** `src/b4xTypeDefinitionProvider.ts`

---

### **Document Link Provider**

#### **What It Does:**

Makes paths clickable in B4X files:
- `#AdditionalJar: some.jar` → Click to jump to JAR file
- `LoadLayout("Name")` → Click to jump to `.bal` layout file
- `B4XPages.ShowPage("Name")` → Click to jump to page module

#### **File:** `src/b4xDocumentLinkProvider.ts`

---

### **Inline Completion Provider**

#### **What It Does:**

Provides ghost text completions that can be accepted with Tab. Shows Sub call completions with parameter hints inline.

#### **File:** `src/b4xInlineCompletionProvider.ts`

---

### **Document Highlight Provider**

#### **What It Does:**

Highlights all occurrences of the symbol under cursor with read/write access distinction.

#### **Features:**
- Read access: light highlight
- Write access: different highlight
- Works across entire file

#### **File:** `src/b4xDocumentHighlightProvider.ts`

---

### **Selection Range Provider**

#### **What It Does:**

Smart expand selection following semantic boundaries:
Word → Line → Sub Block → Document

#### **File:** `src/b4xSelectionRangeProvider.ts`

---

### **On-Type Formatting Provider**

#### **What It Does:**

Auto-cases keywords as you type. Triggers on:
- Space bar
- Enter
- Colon

Example: `end sub` + space → `End Sub`

#### **File:** `src/b4xOnTypeFormattingProvider.ts`

---

### **Insert Event Handler Command**

#### **What It Does:**

Generates event handler Sub templates via command palette or code action.

#### **File:** `src/extension.ts` (command handler)

---

### **Range Formatting Provider**

#### **What It Does:**

Formats only the selected text range, not the entire document. Uses same 5-phase pipeline as document formatter.

#### **File:** `src/b4xDocumentRangeFormattingProvider.ts`

---

### **Common Class Store**

#### **What It Does:**

Dedicated extraction of Common class globals (`Log`, `Msgbox`, `StartActivity`, etc.) so they can be called without the `Common.` prefix.

#### **File:** `src/commonClassStore.ts`

---

### **Primitive Type Store**

#### **What It Does:**

Dedicated store for primitive type mappings and synthetic class definitions:
`Int`, `Float`, `Double`, `Long`, `Byte`, `Short`, `Boolean`, `Char`, `Object`, `String`, `StringBuilder`

#### **File:** `src/primitiveTypeStore.ts`

---

### **Block Comment / Un-Block Comment Commands**

#### **What It Does:**

**Block Comment:** Adds `' ` prefix to each selected line (B4X comment style). Skips blank/already-commented lines.

**Un-Block Comment:** Removes leading `' ` prefix from each selected line. Skips non-comment lines.

---

### **Format Selection / Un-Format Selection Commands**

#### **Format Selection:**
Applies structural formatting to only the selected text range.

#### **Un-Format Selection:**
Strips leading indentation from selected lines only.

---

### **File-based Logging**

#### **What It Does:**

Creates timestamped log files (`b4x-log-YYYYMMDD.txt`) in workspace root or global storage. Replaces console output for better diagnostics.

#### **File:** `src/logging.ts`

---

### **3-Tier SQLite Fallback**

#### **What It Does:**

Ensures library caching works across all environments:
1. **Tier 1:** `better-sqlite3` (native Node addon) - fastest
2. **Tier 2:** `sql.js` (WASM) - no native dependencies
3. **Tier 3:** In-memory fallback - no persistence

#### **File:** `src/storage/libraryIndexSqlite.ts`

---

### **Command Palette Improvements**

#### **What Changed:**

1. **Removed "B4X: " prefix** from all command titles
   - VS Code already shows "B4X Companion: " from the category field
   - Eliminates redundant "B4X Companion: B4X: ..." display

2. **Hidden technical commands** from Command Palette:
   - Refresh Library Index
   - Clear Library Cache
   - Set Platform Install Path

   These remain accessible via:
   - Editor context menu (if applicable)
   - Programmatic access
   - Settings UI

3. **Result:** Cleaner, more user-focused command palette experience

---

## Batch 1: Hover Action Links

### **What It Does:**

Every hover tooltip now includes actionable links at the bottom:

```
[Go to Definition] · [Find All References]
```

For classes and types, a third link appears:

```
[Go to Definition] · [Find All References] · [Search Online]
```

### **Implementation:**

Added `Find All References` command link (`editor.action.referenceSearch.trigger`) to all 12 hover documentation functions:

- `createCommonMemberDocumentation`
- `createClassDocumentation`
- `createLocalSymbolDocumentation` (Sub, Type, and Variable variants)
- `createLocalTypeMemberDocumentation`
- `createClassHoverDocumentation`
- `createPrimitiveTypeDocumentation`
- `createMethodDocumentation`
- `createPropertyDocumentation`
- `createMemberHoverDocumentation` (method and property branches)

### **How It Works:**

Uses VS Code's markdown `command:` link syntax:
```markdown
[Find All References](command:editor.action.referenceSearch.trigger "Find All References")
```

Clicking triggers the same References panel as `Shift+F12` for the word under cursor.

---

## Batch 2: Document Symbol, Workspace Symbol, Formatting, Rename, Code Lens

### **Document Symbol Provider (`Ctrl+Shift+O`)**

#### **What It Does:**

Populates VS Code's **Outline view** panel and enables **Go to Symbol in Editor** (`Ctrl+Shift+O`). Extracts Subs, Types, Regions, and global variables from the current file into a navigable tree.

#### **Features:**
- Hierarchical grouping: symbols inside `#Region` blocks appear as children
- Special icons for `Class_Globals`, `Process_Globals`, `_Initialize`
- Type declarations shown with their field lists
- Global variables (`Dim`/`Private`/`Public` in `Class_Globals`/`Process_Globals`)

#### **File:** `src/b4xDocumentSymbolProvider.ts`

---

### **Workspace Symbol Provider (`Ctrl+T`)**

#### **What It Does:**

Enables **Go to Symbol in Workspace** — fuzzy-search for any Sub, method, property, or class across the entire workspace including XML libraries.

#### **Features:**
- Searches both user code (workspace classes) and XML library classes
- Returns up to 500 results for performance
- Fuzzy prefix matching

#### **File:** `src/b4xWorkspaceSymbolProvider.ts`

---

### **Document Formatting Provider (`Shift+Alt+F`)**

#### **What It Does:**

VB.NET-quality structural formatter that tracks block nesting depth and applies proper indentation.

#### **Block Tracking:**

| Block Opener | Closer |
|---|---|
| `Sub` | `End Sub` |
| `If` ... `Then` | `End If` |
| `Else If` | (pops, re-pushes If) |
| `Else` | (pops, stays at If depth) |
| `For` | `Next` |
| `Do` | `Loop` |
| `Select` | `End Select` |
| `Case` / `Case Else` | sub-indent inside Select |
| `Try` | `End Try` |
| `Catch` | (pops, stays at Try depth) |
| `#Region` | `#End Region` |
| `#If` | `#End If` |

#### **Additional Features:**
- Keyword casing normalization (`end sub` → `End Sub`) with ALLCAPS preservation
- Blank line management: collapses 2+ blank lines to 1, ensures spacing before Subs
- `#EndOfDesignText@` awareness: designer header preserved verbatim
- String & comment protection: never touches `"strings"` or `'comments`
- Spacing normalization: `=` → ` = `, `,` → `, `, `:` → `: `

#### **File:** `src/b4xDocumentFormattingProvider.ts`

---

### **Rename Provider (`F2`)**

#### **What It Does:**

Cross-file rename refactoring with case preservation.

#### **Features:**
- Searches all open B4X documents
- Validates new name is a valid identifier
- Preserves case conventions: `MYVAR` → `NEWNAME`, `myVar` → `newName`
- Skips comments and quoted strings

#### **File:** `src/b4xRenameProvider.ts`

---

### **Code Lens Provider**

#### **What It Does:**

Shows inline reference counts above each Sub declaration:

```
Sub MySub
3 references (document) · 8 references (workspace)
```

Clicking the count triggers Find All References.

#### **File:** `src/b4xCodeLensProvider.ts`

---

## Batch 3: CallSub Validation, Preprocessor Completions, Context Menu

### **CallSub Target Validation**

#### **What It Does:**

Warns in the Problems panel when `CallSub("Module", "SubName")`, `CallSubDelayed`, or `CallSub3` references a Sub that doesn't exist in the target module.

#### **Why It Matters:**

`CallSub` uses string-based sub names — a typo causes a **runtime crash**. This diagnostic catches those at edit time.

#### **Severity:** Warning
#### **Source:** `b4x-callsu`

#### **File:** `src/callSubDiagnostics.ts`

---

### **Preprocessor Directive Completions**

#### **What It Does:**

Typing `#` in a B4X file now triggers completions for all preprocessor directives:

| Category | Directives |
|---|---|
| **Conditional Compilation** | `#If B4A`, `#If B4i`, `#If B4J`, `#If B4R`, `#If Debug`, `#If Release`, `#Else`, `#Else If`, `#End If` |
| **Regions** | `#Region`, `#End Region` |
| **Project Config** | `#AdditionalJar:`, `#AdditionalRes:`, `#ExcludeClasses:`, `#Version:`, `#VersionName:`, `#VersionCode:`, `#Package:`, `#MinSdkVersion:`, `#TargetSdkVersion:` |
| **Runtime** | `#BridgeLogger:`, `#Event:`, `#RaisesSynchronousEvents:`, `#Ignore`, `#Defines:` |

Each completion includes a description of what the directive does.

#### **Trigger:** `#` (added to completion triggers)

---

### **B4X IntelliSense Context Submenu**

#### **What It Does:**

Right-click in any `.bas`/`.b4x` editor reveals a **B4X IntelliSense** submenu with 12 commands organized into groups:

```
B4X IntelliSense ▶
├── Go to Definition          (F12)
├── Peek Definition           (Alt+F12)
├── Find All References       (Shift+F12)
├── Rename Symbol             (F2)
├── Go to Symbol in File      (Ctrl+Shift+O)
├── Search Online             (B4X forum search)
├─────────────────────────────
├── Format Document           (Shift+Alt+F)
├── Un-Format Document        (strip all indentation)
├── Remove Blank Lines        (compact to single block)
├── Quick Fix                 (Ctrl+.)
├── Trigger Suggestions       (Ctrl+Space)
└── Parameter Hints           (Ctrl+Shift+Space)
```

These commands **only appear** when editing B4X files and are hidden from the Command Palette (`Ctrl+Shift+P`).

---

## Batch 4: Go to Definition Across Modules

### **What It Does:**

`F12` (Go to Definition) now resolves symbols across all project modules, not just classes.

### **Resolution Chain:**

1. **Local Sub/Type** in the current document
2. **Workspace Sub** — `findMemberByName()` searches all `.bas` modules in the project for a matching public Sub
3. **XML Library Method** — `findMemberByName()` searches XML library classes for a matching method
4. **Workspace Class** — user-defined class/module by name
5. **XML Library Class** — SDK class by name

### **Example:**

```b4x
' In Module1.bas:
Public Sub DesignerCreateView(...)
    ' ...
End Sub

' In Module2.bas:
Sub AddComponent
    DesignerCreateView(mTarget, CustProps)  ' ← F12 on this jumps to Module1.bas line N
End Sub
```

Previously this returned `undefined` because `DesignerCreateView` wasn't a class name.

---

## Batch 5: Find All References On-Disk

### **What Was Wrong:**

The original implementation had two critical bugs:

1. **Scope filtering** — When cursor was inside a Sub, it only searched within that Sub's boundaries, missing the Sub declaration itself and all other call sites in the same file.

2. **Open tabs only** — Cross-file search only scanned `vscode.workspace.textDocuments` (open tabs), silently missing all closed files.

### **What It Does Now:**

1. **Full-file search** — No scope filtering. Every occurrence in the entire current file is found, including the Sub declaration line.

2. **On-disk workspace scan** — Recursively walks `workspaceFolders`, reads all `.bas`/`.b4x` files directly from the filesystem. Skips `Objects/`, `.git/`, and `node_modules/` directories.

3. **Whole-word regex matching** — `\bword\b` with case-insensitive matching.

4. **Comment exclusion** — Lines starting with `'` are skipped.

---

## Batch 6: Un-Format & Remove Blank Lines

### **Un-Format Document**

Strips leading whitespace from every line. Blank lines and comments are preserved. All code becomes left-aligned. Useful before running Format Document to get a clean slate.

### **Remove Blank Lines**

Deletes every empty/whitespace-only line, compacting the file to a single code block. No other content is modified.

---

## File Summary

> Files listed here cover Batches 2, 3, 6, and 10 only. See `README.md` → Project Structure for the complete file listing.

| File | Purpose |
|------|---------|
| `src/b4xDocumentSymbolProvider.ts` | Outline view / Ctrl+Shift+O |
| `src/b4xWorkspaceSymbolProvider.ts` | Workspace symbol search / Ctrl+T |
| `src/b4xDocumentFormattingProvider.ts` | Structural code formatter |
| `src/b4xRenameProvider.ts` | F2 rename refactoring |
| `src/b4xCodeLensProvider.ts` | Reference counts above Subs |
| `src/callSubDiagnostics.ts` | CallSub target validation |
| `src/b4xReferenceProvider.ts` | Find All References (on-disk) |
| `src/b4xFoldingRangeProvider.ts` | Code folding |
| `src/b4xAutoclose.ts` | Auto-close keywords |
| `src/projectStatisticsCore.ts` | Core statistics collection (pure functions) |
| `src/providers/projectStatisticsProvider.ts` | Webview dashboard with Chart.js |
| `src/unusedSubDiagnostics.ts` | Unused Sub diagnostic provider |
| `src/unusedSubDiagnosticsCore.ts` | Core unused Sub detection logic |
| `src/unusedLibraryDiagnostics.ts` | Unused Library diagnostic provider |
| `src/unusedLibraryDiagnosticsCore.ts` | Core unused library detection logic |
| `media/chart.umd.js` | Chart.js v4.5.1 UMD bundle |

---

## Complete Feature Checklist

### Language Intelligence
- [x] Contextual completions
- [x] Language keyword completions
- [x] Preprocessor directive completions (`#`)
- [x] Member completions after `.`
- [x] Cross-file type inference
- [x] Primitive type hover
- [x] Go to Definition (across modules)
- [x] Peek Definition
- [x] Find All References (on-disk)
- [x] Rename Symbol (F2)
- [x] Hover documentation with action links
- [x] Signature help (`(` and `,`)
- [x] Semantic token highlighting
- [x] Local symbol completions
- [x] Document Symbol Outline (Ctrl+Shift+O)
- [x] Workspace Symbol Search (Ctrl+T)

### Code Formatting
- [x] Structural indentation tracking
- [x] Keyword casing normalization
- [x] Blank line management
- [x] Un-Format Document
- [x] Remove Blank Lines
- [x] `#EndOfDesignText@` awareness
- [x] String & comment protection

### Diagnostics & Code Actions
- [x] Type placement diagnostics
- [x] CallSub target validation
- [x] Unused Sub diagnostics
- [x] Unused Library diagnostics
- [x] Quick-fix code actions
- [x] Extract Method refactoring
- [x] Code Lens reference counts

### Syntax & Editing
- [x] B4X syntax highlighting
- [x] Auto-close keywords
- [x] Code folding (all B4X constructs)
- [x] 100+ code snippets
- [x] Indentation rules

### Library & Project
- [x] XML library parsing
- [x] `.b4xlib` extraction
- [x] Project-scoped filtering
- [x] Persistent SQLite index
- [x] Build & Install (B4A/B4J)
- [x] Auto-backup
- [x] Project Statistics dashboard (stat cards, table, Chart.js charts)

### Context Menu
- [x] B4X IntelliSense submenu (organized by category)
- [x] Search Online
- [x] Hidden from Command Palette (navigation and formatting commands)

### v0.1.270 Additions
- [x] Go to Implementation provider
- [x] Go to Type Definition provider
- [x] Document Link Provider (clickable paths)
- [x] Inline Completion Provider (ghost text)
- [x] Document Highlight Provider (read/write distinction)
- [x] Selection Range Provider (smart expand)
- [x] On-Type Formatting (auto-casing)
- [x] Insert Event Handler command
- [x] Range Formatting (selection-only)
- [x] Common Class Store (dedicated)
- [x] Primitive Type Store (dedicated)
- [x] Block Comment / Un-Block Comment commands
- [x] Format Selection / Un-Format Selection commands
- [x] File-based Logging system
- [x] 3-Tier SQLite Fallback
- [x] Command Palette cleanup (hidden technical commands)
- [x] Removed "B4X: " prefix from command titles

### v0.1.418 Additions
- [x] Project Statistics dashboard (stat cards, per-module table, Chart.js charts)
- [x] Unused Sub diagnostics (Private and Public scope analysis)
- [x] Unused Library diagnostics (cross-reference declared vs. used types)
- [x] Chart.js v4.5.1 integration (offline-capable webview charting)
- [x] LSP server restart resilience (limited restarts instead of permanent DoNotRestart)
- [x] Extract Method Dim parsing fix (comma-separated variables)
- [x] Chart label visibility fix (autoSkip: false)
- [x] Cross-platform module name disambiguation in charts
- [x] Locale-aware number formatting in dashboard
- [x] Chart memory leak fix (destroy before recreation)

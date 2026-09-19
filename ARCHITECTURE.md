# B4X IntelliSense Architectural Reference

This document provides a high-level technical blueprint of the B4X IntelliSense extension. It is designed to onboard AI agents and developers to the system's logic and constraints without requiring a full codebase re-analysis.

## 1. Core Philosophy: "The Factual Model"
The extension operates on a strict "factual" basis. It does not assume the existence of symbols or paths.
- **Disk Validation**: Every library or module must be confirmed via `fs.stat()` or `fs.existsSync()` before being added to the index.
- **Strict Isolation**: B4X platforms (B4A, B4J, B4i, B4R) are completely isolated. A project's platform is detected via file extension, and only that platform's INI and libraries are loaded.
- **No Guesswork**: If a library is not explicitly declared in the project file's `LibraryN=` entries, it is not loaded, even if it exists in the library folder.

## 2. The Project Loading Lifecycle
When a project is opened, the extension follows this linear pipeline in `src/extension.ts` (`reloadPlatformAssets`):

1.  **Platform Detection**: Detects platform (e.g., `.b4a` $\rightarrow$ `b4a`) from the project file extension.
2.  **INI Resolution**: Locates the `b4xV5.ini` via a priority chain (User Settings $\rightarrow$ AppData $\rightarrow$ Registry).
3.  **Project Parsing**:
    *   Parses `LibraryN=` and `ModuleN=` entries.
    *   **Hybrid File Handling**: Extracts B4X code following the `@EndOfDesignText@` marker in project files and writes it to `.vscode/b4x-main/` as a standard `.b4x` file for LSP processing.
4.  **Asset Resolution**:
    *   Resolves `.xml` library definitions and `.b4xlib` (ZIP) archives.
    *   Extracts `.bas` files from `.b4xlib` into a persistent cache.
5.  **Indexing**:
    *   Populates `WorkspaceClassStore` (user code) and `XmlLibraryStore` (libraries).
    *   Syncs `CommonClassStore` (global functions like `Log`) and `PrimitiveTypeStore` (type mappings).
6.  **LSP Activation**: Starts the Node.js Language Server and registers all VS Code providers.

## 3. The Intelligence Engine (Symbol Resolution)
To resolve a type or member, the extension uses a tiered resolution chain:

**`Inferred Variable` $\rightarrow$ `Local Symbol` $\rightarrow$ `Workspace Class` $\rightarrow$ `Library XML` $\rightarrow$ `Primitive Mapping`**

- **Type Inference**: The system scans `Dim` and `Sub` parameter declarations to build a map of variable types.
- **Expression Resolution**: `resolveExpressionType` handles dot-chaining (e.g., `User.Address.City`) by recursively resolving each segment through the stores.
- **Primitive Mapping**: B4X primitives (e.g., `String`) are mapped to their internal implementation classes (e.g., `String2`) via the `PrimitiveTypeStore`.

## 4. Key Feature Implementations

### Structural Formatter
The formatter is a multi-phase pipeline:
`Tokenize (Mask Strings)` $\rightarrow$ `Compute Indent (Stack-based)` $\rightarrow$ `Format Lines (Keyword Casing)` $\rightarrow$ `Normalize Blanks`.
- **Block Tracking**: Uses a stack to track nested B4X blocks (`If`, `For`, `Sub`, `Try`, `#Region`).
- **Case Normalization**: Enforces standard B4X casing (e.g., `end sub` $\rightarrow$ `End Sub`) while preserving content inside string literals.

### Project Rooting & Discovery
- **Scoring System**: When multiple project files exist, the extension scores them based on proximity to the active document and module matches to pick the correct project root.
- **Root Calculation**: Recognizes the multi-platform folder structure (e.g., `ProjectRoot/B4A/Main.b4a`) and sets the root to `ProjectRoot`.

### Diagnostics & Refactoring
- **Scope Validation**: Ensures `Type` declarations only exist inside `Class_Globals` or `Process_Globals`.
- **CallSub Validation**: Builds a global map of all defined `Subs` to warn users when a `CallSub` target is missing.
- **Surgical Refactoring**: The `B4xRenameProvider` uses a case-preserving algorithm to ensure that renaming a variable maintains its original casing convention.

## 5. Critical File Map

| File | Responsibility |
| :--- | :--- |
| `src/extension.ts` | Main orchestrator, project loading flow, and provider registration. |
| `src/projectFile.ts` | Project file parsing and workspace root discovery. |
| `src/b4xDocParser.ts` | Tokenization, comment stripping, and expression analysis. |
| `src/b4xTypeInference.ts` | Type resolution and dot-chain expression analysis. |
| `src/lspClient.ts` | Management of the Node.js Language Server process. |
| `src/b4xDocumentFormattingProvider.ts` | Implementation of the structural formatter. |
| `src/workspaceClassIndex.ts` | Indexing and searching of user-defined `.bas` modules. |
| `src/xmlLibraryIndex.ts` | Parsing and storage of XML library definitions. |
| `src/typeDiagnostics.ts` | Validation of B4X language rules (e.g., misplaced Types). |

## 6. Developer Constraints
- **Immutability**: Never mutate existing state objects; always return new copies.
- **Disk-First**: Never assume a file exists. Always verify paths before adding them to the index.
- **No Assumptions**: Do not auto-inject "Core" libraries; they must be declared in the project file.
- **Platform Purity**: Never allow a library from one platform to be indexed in another.

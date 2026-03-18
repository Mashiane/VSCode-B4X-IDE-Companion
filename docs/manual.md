# B4X IntelliSense — User Manual

This manual explains how to use the B4X IntelliSense extension in Visual Studio Code.

## Overview
B4X IntelliSense provides completions, hover information, go-to-definition, rename, and an Extract Method refactor. It indexes:
- the generated API index (from `b4a_libraries.txt`),
- XML library descriptors discovered from platform ini paths, and
- live workspace sources (.bas/.b4x).

Indexing is incremental and persisted to disk to speed up startup.

## Quick Start
1. Install the extension (Marketplace or using the `.vsix` produced by `npx vsce package`).
2. Open a folder with your B4X sources or open a `.b4a` project file.
3. Open a `.bas` or `.b4x` file — the extension will begin indexing. Wait a few seconds for initial indexing.

## Commands
Use the Command Palette (`Ctrl+Shift+P`) to run these commands:
- `B4X: Open B4A Project...` — Choose a `.b4a` file to open the project and set the active project context.
- `B4X: Apply Extension Font Settings` — Apply recommended font and editor settings from the extension configuration.
- `B4X: Import Visual Studio .vssettings Theme` — Convert and apply a Visual Studio `.vssettings` theme if found.
- `B4X: Open Documentation` — Open the extension README/manual inside the editor.

Keybinding: `Ctrl+Shift+H` opens the documentation (can be changed in Keyboard Shortcuts).

## Editor features

### Completions
- Trigger: automatic when typing, and explicitly after `.` or `_`, and letters.
- Scope: completions come from the API index, workspace classes, XML-backed libraries, and local symbols.
- Tips:
  - If suggestions are missing, ensure indexing has completed and that `b4xIntellisense.preferLiveSources` is configured as desired.
  - Workspace modules take precedence over external XML libraries when names conflict.

### Hover
- Hover a symbol (class, method, property) to see documentation or a short snippet showing the definition.
- Hover also falls back to a plaintext scaffold if no documentation is available.

### Go To Definition
- Use `F12` (or the contextual menu) to jump to a symbol definition found in workspace files or XML-backed libraries.

### Rename
- Use the Rename symbol action to perform a workspace rename. The extension uses heuristics to avoid renaming string literals and comments; always review the edits.

### Extract Method
- Select a region in the editor and run `Extract Method` (Command Palette or code action).
- Behavior is controlled by `b4xIntellisense.extractMethod.previewBehavior` (settings):
  - `prompt` (default): show a preview and ask before applying.
  - `autoApply`: apply edits without prompting.
  - `alwaysPreview`: always open a preview diff but do not auto-apply.
- The server attempts to infer parameters used in the selection; you may edit the suggested method signature before applying.
- The refactor may change multiple files (workspace edit). Preview carefully before applying.

## Settings
Open Settings and search for `b4xIntellisense`.
Important settings:
- `b4xIntellisense.preferLiveSources` (boolean) — prefer workspace/XML live sources over the generated API index when both provide symbols.
- `b4xIntellisense.extractMethod.previewBehavior` (string) — `prompt | autoApply | alwaysPreview`.
- `b4xIntellisense.b4aIniPath`, `b4iIniPath`, `b4jIniPath`, `b4rIniPath` (strings) — platform INI paths used to discover XML libraries and shared modules.
- `b4xIntellisense.enableTelemetry` (boolean) — opt-in telemetry for feature usage.

## Troubleshooting
- No completions or hover:
  - Verify `data/b4x-api-index.json` exists (run `npm run build:index` locally for development).
  - Check the `Output` panel (select `B4X IntelliSense` from the dropdown) for indexing or server errors.
- Extract Method failed or produced incorrect edits:
  - The refactor is heuristic-based. Inspect the preview and revert if unexpected.
- Language Server errors:
  - If you run the server manually, use `npm run start-lsp` to start it and check the terminal for logs.

## Advanced: regenerating the API index
If you update `b4a_libraries.txt` or want to refresh the generated API index:

```bash
npm run build:index
```

This writes `data/b4x-api-index.json` consumed by the extension.

## Privacy
The extension includes a configuration `b4xIntellisense.enableTelemetry` (default: false). No telemetry is collected unless you opt-in.

## Known limitations
- Cross-file inference and references are limited and will be improved over time.
- Some XML/.b4xlib package parsing is partial; prefer workspace sources when available.

## Reporting issues
Open an issue on the repository with a short reproduction and relevant logs from the `Output` panel.

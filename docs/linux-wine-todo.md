# Linux + Wine TODO

## Done in the current milestone
- B4X projects open on Linux with a Wine-backed B4J install.
- `ModuleN=` resolution works without changing the B4X project format.
- Workspace modules are indexed and the extension LSP starts.
- B4J XML libraries are discovered and loaded from the Wine install folder.
- Explorer auto-filtering is disabled by default to avoid hiding project files.

## Pending cleanup / stabilization
- Remove or gate the remaining verbose debug logging now that the editor path works.
- Make stale `files.exclude` cleanup more robust across existing workspaces.
- Improve error messages when the configured Wine prefix or `b4xV5.ini` is missing.
- Add regression tests for Wine path translation, `ModuleN=` resolution, and case-insensitive library discovery.
- Validate the same editor flow with at least one B4A project under Wine.

## Next functional milestone
- [x] Initial B4J build/run support on Linux through Wine wired into the existing Build & Install command.
- [ ] B4A build/install support on Linux through Wine.
- [ ] Decide how far PowerShell-based helper scripts should be supported versus left Windows-only.
- [ ] Replace or bypass remaining Windows-only helper flows where needed.

## UX / settings
- Ensure Linux/Wine configuration is comfortably editable from the normal VS Code Settings UI, not only by manually editing `settings.json`.
- Consider adding a guided command or setup wizard for Wine prefix, INI path, and install path selection.

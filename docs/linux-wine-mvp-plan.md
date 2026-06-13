# Linux + Wine MVP Plan

## Goal
Make the editor path work on Linux when B4X lives inside a Wine prefix.

## MVP scope
- Configure a Wine prefix from VS Code settings.
- Open a B4X project from Linux.
- Keep project files visible in the Explorer.
- Resolve B4X project modules and library folders from Wine paths.
- Load project assets and start the LSP.
- Edit `.bas` / `.b4j` / `.b4a` files normally.

## Out of scope for this milestone
- PowerShell helper scripts.
- Build / install / emulator integration.
- GIF / screenshot tooling.

## Milestones

### H1 — Editor usable
- [x] Create feature branch.
- [x] Disable dangerous Explorer auto-filtering by default.
- [x] Add Wine prefix settings.
- [x] Add Wine path translation helpers.
- [x] Translate INI-discovered paths to host paths on Linux.
- [x] Resolve `ModuleN=` values without changing B4X project format.
- [x] Validate project loading + LSP startup with a Wine-backed B4X install.
- [x] Load project XML libraries case-insensitively from Wine-backed B4J installs.
- [ ] Polish error messages for missing Wine/INI paths.

### H2 — Better Linux/Wine ergonomics
- [ ] Improve auto-detection of B4X INI files inside Wine.
- [ ] Cover more absolute-path edge cases.
- [ ] Add regression tests around path translation and module resolution.

### H3 — Secondary tooling
- [ ] Revisit build/install flow.
- [ ] Decide whether PowerShell scripts are replaced, wrapped, or left Windows-only.

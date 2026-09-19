# Release v0.1.289 (2026-04-15)

Short summary
-------------

This release (v0.1.289) contains a small set of user-facing improvements and internal packaging/indexing refreshes.

Highlights
----------

- New command: `New B4X Project from Template` (`b4xIntellisense.newB4xProjectFromTemplate`)
  - Scans configured platform library folders (including subdirectories) for `.b4xtemplate` files.
  - Presents templates with platform prefixes and subpaths (e.g. `[B4A] Subfolder/TemplateName`).
  - Handles extraction, placeholder replacement, and project creation from templates.
- Version bump: `package.json` updated to `0.1.289`.
- Indexing & build refresh: compiled/indexer artifacts under `dist/src` updated (improves API indexing and workspace scanning).

Selected changes (verifiable)
-----------------------------

- `CHANGELOG.md` — new top entry for `0.1.289` summarizing changes.
- `package.json` — `version` field set to `0.1.289`.
- `dist/src/*` — refreshed build artifacts (e.g. `apiIndex`, `b4aProjectScanner`) included in repository build output.

Upgrade notes
-------------

- No breaking changes were introduced in this release. Existing user settings and workflow should continue to work the same.
- If you rely on a prebuilt API index, the updated `dist/src` artifacts may include minor packaging refinements — report any issues.

How to build the VSIX locally
-----------------------------

Run these commands from the project root (requires Node.js, npm, and vsce):

```powershell
npm install
npm run package:vsix
```

This runs compilation and the packaging pipeline; the resulting `.vsix` will be produced by `vsce` in the workspace root.

Next steps I can take
---------------------

- Create a compact GitHub release body (draft) based on this file.
- Push the commit and annotated tag (`v0.1.289`) to the remote and publish a GitHub release.
- Build the VSIX here (I can run `npm run package:vsix`), then attach it to the GitHub release.

If you want me to push and publish the release, or build the VSIX now, tell me and I'll proceed (I will not push without your confirmation).

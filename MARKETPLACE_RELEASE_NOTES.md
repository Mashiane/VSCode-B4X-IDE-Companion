# Marketplace Release Notes — v0.1.290 (2026-04-15)

Short summary
-------------

This short “What’s new” text is suitable for the Visual Studio Marketplace release notes field. Copy-paste it into the extension version’s Release Notes, or upload the included VSIX (`b4x-intellisense-0.1.290.vsix`) to publish the new version.

Highlights
----------

- New: "New B4X Project from Template" command (`b4xIntellisense.newB4xProjectFromTemplate`)
  - Scans configured platform library folders (including subfolders) for `.b4xtemplate` files.
  - Shows templates with platform prefixes and subpaths (e.g. `[B4A] Subfolder/TemplateName`).
  - Handles extraction, placeholder replacement, and project creation from templates.
- Improved indexing & packaging: refreshed API indexing and workspace scanning artifacts (`apiIndex`, `b4aProjectScanner`) for more reliable indexing and faster scans.
- Various internal refinements and build/package fixes.

Notes
-----

- Built VSIX (in this workspace root): `b4x-intellisense-0.1.290.vsix`.
- Full changelog is available in the repository: [CHANGELOG.md](CHANGELOG.md).

Quick publish instructions
------------------------

Portal (recommended if you prefer a web UI):
1. Visit https://marketplace.visualstudio.com/manage/publishers and sign in with the publisher account.
2. Select publisher `AneleMbangaMashy` → choose the extension → open **Versions**.
3. Either upload the new VSIX (choose the file above) or edit the latest version's **Release Notes** field and paste the text from this file.

CLI (requires publisher token & `vsce`):
```bash
# login once (enter PAT when prompted)
vsce login AneleMbangaMashy
# publish (patch|minor|major depending on semver)
vsce publish
```

If you want, I can push the commit+tag to the remote and run `vsce publish` for you — I will need publisher credentials (PAT) or permission to use a credential you provide. I won't publish without your confirmation.

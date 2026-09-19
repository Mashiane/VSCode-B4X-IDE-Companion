# Publishing the Extension to the Visual Studio Marketplace

This document describes how to publish the extension with `vsce`.

Extension identity (must not change, it is the live Marketplace identity):

| Field | Value |
|---|---|
| Publisher | `AneleMbangaMashy` |
| Name | `b4x-intellisense` |
| Extension ID | `AneleMbangaMashy.b4x-intellisense` |
| Repository | https://github.com/Mashiane/VSCode-B4X-IDE-Companion |

## Prerequisites
- A GitHub repository for this project.
- A Visual Studio Marketplace publisher (see below).
- Node.js and `vsce` installed locally for manual packaging.

## Create a Publisher
1. Sign in to the Visual Studio Marketplace: https://marketplace.visualstudio.com/
2. Click your avatar → `Publish extensions` → `Create new publisher`.
3. Choose a publisher ID (e.g. `your-username`) and fill in details.

## Create a Personal Access Token (PAT)
1. Go to https://dev.azure.com/ and sign in with the account that owns the publisher.
2. Create a Personal Access Token with:
   - **Organization:** `All accessible organizations`. Selecting a single organization causes `401 Unauthorized` or `403 Forbidden` on publish.
   - **Authorized Scopes:** `Marketplace` → `Manage`. This is the scope `vsce publish` requires.
   Copy the token, you cannot see it again.

## Publish Locally
Install `vsce`:

```bash
npm install -g @vscode/vsce
```

Login and publish using the PAT (manual flow):

```bash
vsce login AneleMbangaMashy
# When prompted, paste the PAT
vsce package
vsce publish
```

`vsce package` creates a `.vsix` file you can distribute manually.

### Version drift warning

`vscode:prepublish` runs `npm run build`, and `prebuild` runs `scripts/bump-version.js`, which increments the patch version on every build. So `vsce package` and `vsce publish` each bump the version again, and the packaged version will be higher than the one you bumped by hand.

To publish a build you already produced without another bump, point `vsce` at the existing file:

```bash
vsce publish --packagePath b4x-intellisense-0.1.483.vsix -p <PAT>
```

The Marketplace rejects any version that is not strictly higher than the currently published one, so bump before publishing.

## Publish via GitHub Actions (not configured)

There is **no automated publish workflow in this repository**. The only workflow is `.github/workflows/build-prebuilts.yml`, which runs on `workflow_dispatch` and pushes to `main`, builds the VSIX on Windows, macOS, and Linux, verifies it with `scripts/verify-vsix.js`, and uploads it as a build artifact. It never calls `vsce publish`, and it does not trigger on tags.

Publishing is therefore a manual step. Follow **Publish Locally** above, or run the publish from a workflow you add yourself:

1. Add a GitHub Repository Secret named `VSCE_TOKEN` with a Marketplace (Manage) PAT.
2. Add a workflow that triggers on tags matching `v*.*.*`.
3. In that workflow, install dependencies, run `npm run build`, then run `vsce publish --packagePath <vsix> -p $VSCE_TOKEN`.

## Notes & Troubleshooting
- Ensure `package.json` has a valid `publisher` field matching the Marketplace publisher name. It is currently `AneleMbangaMashy`, which matches the live listing.
- The Marketplace recommends a 128x128 PNG `icon`. The current `images/b4xlogo.png` is 365x435 and has been accepted in published releases, so this is a warning, not a blocker.
- `package.json` declares `"license": "CC0-1.0"`, matching the 7 KB `LICENSE` file. The file ships as `LICENSE.txt` and the listing can display license information.
- `CHANGELOG.md` ships in the package, so the Marketplace changelog tab is populated. Release notes in `README.md` also ship and are displayed on the Overview tab.
- There are 10 keywords, well under the 30 keyword limit the Marketplace enforces.
- No activation event uses `*`, so `--allow-star-activation` is not required to publish.
- If `vsce publish` fails with `401` or `403`, verify the PAT uses the `All accessible organizations` setting and the `Marketplace` → `Manage` scope.

## Manual Upload
If you prefer manual publishing, run `vsce package` and upload the generated `.vsix` file to the publisher portal at https://marketplace.visualstudio.com/manage/publishers/AneleMbangaMashy.

## Rollbacks
To roll back a published version, publish a new version with the previous code (bump version and create a new tag), or unlist a version from the publisher portal.


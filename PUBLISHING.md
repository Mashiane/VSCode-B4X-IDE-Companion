# Publishing the Extension to the Visual Studio Marketplace

This document describes how to publish the extension using `vsce` and how to set up the GitHub Actions workflow included in `.github/workflows/publish.yml`.

## Prerequisites
- A GitHub repository for this project.
- A Visual Studio Marketplace publisher (see below).
- Node.js and `vsce` installed locally for manual packaging.

## Create a Publisher
1. Sign in to the Visual Studio Marketplace: https://marketplace.visualstudio.com/
2. Click your avatar → `Publish extensions` → `Create new publisher`.
3. Choose a publisher ID (e.g. `your-username`) and fill in details.

## Create a Personal Access Token (PAT)
1. Go to https://dev.azure.com/ and sign in with the account that will own the publisher.
2. Create a Personal Access Token with **Packaging (publish)** scope. Copy the token — you will not be able to see it again.

## Publish Locally
Install `vsce`:

```bash
npm install -g vsce
```

Login and publish using the PAT (manual flow):

```bash
vsce login <publisher-name>
# When prompted, paste the PAT
vsce package
vsce publish
```

`vsce package` creates a `.vsix` file you can distribute manually.

## Publish via GitHub Actions (automated)
The repository includes `.github/workflows/publish.yml`. To enable automated publishing:

1. Add a GitHub Repository Secret named `VSCE_TOKEN` with the PAT value created above.
2. Create a git tag following semantic versioning, e.g. `v0.1.0`:

```bash
git tag v0.1.0
git push --tags
```

The `publish.yml` workflow triggers on pushed tags (`v*.*.*`) and will:
- Checkout the repository
- Install Node and dependencies
- Build the extension
- Run `vsce package` and `vsce publish` using `VSCE_TOKEN` from secrets

## Notes & Troubleshooting
- Ensure `package.json` has a valid `publisher` field matching the Marketplace publisher name.
- The marketplace requires a 128x128 PNG `icon` at the path specified in `package.json`.
- If `vsce publish` fails with authentication, verify the PAT has the correct scope and that the `VSCE_TOKEN` secret matches the PAT.

## Manual Upload
If you prefer manual publishing, run `vsce package` and upload the generated `.vsix` file to the publisher portal.

## Rollbacks
To roll back a published version, publish a new version with the previous code (bump version and create a new tag), or unlist a version from the publisher portal.


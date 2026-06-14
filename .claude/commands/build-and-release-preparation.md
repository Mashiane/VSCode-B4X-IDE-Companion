---
name: build-and-release-preparation
description: Workflow command scaffold for build-and-release-preparation in VSCode-B4X-IDE-Companion.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /build-and-release-preparation

Use this workflow when working on **build-and-release-preparation** in `VSCode-B4X-IDE-Companion`.

## Goal

Prepares the extension for release by updating packaging scripts, cleaning up files, updating documentation, and bumping version numbers.

## Common Files

- `.vscodeignore`
- `docs/linux-install-guide.md`
- `package.json`
- `scripts/bundle.js`
- `src/lspClient.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update or clean .vscodeignore to manage bundled files
- Update or create installation/configuration documentation in docs/
- Update package.json for version or build changes
- Update or run build scripts (e.g., scripts/bundle.js)
- Update code to point to new build outputs (e.g., lspClient.ts)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
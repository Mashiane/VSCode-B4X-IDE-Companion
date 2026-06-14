---
name: feature-development-linux-wine-support
description: Workflow command scaffold for feature-development-linux-wine-support in VSCode-B4X-IDE-Companion.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-linux-wine-support

Use this workflow when working on **feature-development-linux-wine-support** in `VSCode-B4X-IDE-Companion`.

## Goal

Implements new Linux/Wine-related features or MVPs, updating documentation, configuration, and core extension logic.

## Common Files

- `docs/linux-wine-mvp-plan.md`
- `docs/linux-wine-todo.md`
- `src/winePaths.ts`
- `src/extension.ts`
- `src/platformConfig.ts`
- `package.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update or create related documentation in docs/ (e.g., linux-wine-mvp-plan.md, linux-wine-todo.md)
- Modify or add implementation files in src/ (e.g., winePaths.ts, platformConfig.ts, extension.ts)
- Update package.json to reflect new dependencies or features
- Update README.md with new instructions or features

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
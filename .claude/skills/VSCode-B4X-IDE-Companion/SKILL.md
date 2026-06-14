```markdown
# VSCode-B4X-IDE-Companion Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you how to contribute to the VSCode-B4X-IDE-Companion project, a TypeScript-based Visual Studio Code extension. You'll learn the project's coding conventions, how to add new features (especially for Linux/Wine support), and how to prepare the extension for release. The guide covers file organization, commit patterns, and recommended workflows, including step-by-step instructions and example commands.

## Coding Conventions

- **File Naming:**  
  Use `camelCase` for file names.  
  _Example:_  
  ```
  src/winePaths.ts
  src/platformConfig.ts
  ```

- **Import Style:**  
  Use **relative imports**.  
  _Example:_  
  ```typescript
  import { getWinePaths } from './winePaths';
  ```

- **Export Style:**  
  Use **named exports**.  
  _Example:_  
  ```typescript
  export function getWinePaths() { ... }
  ```

- **Commit Messages:**  
  Follow **conventional commit** style with prefixes like `feat`, `fix`, `build`.  
  _Example:_  
  ```
  feat: add initial Wine support for Linux
  fix: correct path resolution on Wine environments
  build: update package.json for release
  ```

## Workflows

### Feature Development: Linux/Wine Support
**Trigger:** When adding or extending Linux/Wine support in the extension  
**Command:** `/add-linux-wine-feature`

1. **Update Documentation:**  
   - Edit or create relevant docs in `docs/` (e.g., `linux-wine-mvp-plan.md`, `linux-wine-todo.md`).
2. **Implement Feature:**  
   - Modify or add implementation files in `src/` (e.g., `winePaths.ts`, `platformConfig.ts`, `extension.ts`).
   - Example:
     ```typescript
     // src/winePaths.ts
     export function detectWinePaths() { ... }
     ```
3. **Update Configuration:**  
   - Edit `package.json` to reflect new dependencies or features.
4. **Update README:**  
   - Document new instructions or features in `README.md`.
5. **Commit Changes:**  
   - Use a conventional commit message, e.g.:
     ```
     feat: add Wine path detection for Linux
     ```

### Build and Release Preparation
**Trigger:** When preparing a new build or release for distribution  
**Command:** `/prepare-release`

1. **Clean Bundled Files:**  
   - Update or clean `.vscodeignore` to manage which files are included in the extension package.
2. **Update Documentation:**  
   - Edit or create installation/configuration docs in `docs/` (e.g., `linux-install-guide.md`).
3. **Update Versioning:**  
   - Bump version or update build changes in `package.json`.
4. **Run Build Scripts:**  
   - Update or execute build scripts (e.g., `scripts/bundle.js`).
5. **Update Code References:**  
   - Ensure code points to new build outputs (e.g., update `src/lspClient.ts` if needed).
6. **Commit Changes:**  
   - Use a conventional commit message, e.g.:
     ```
     build: prepare v1.2.0 release
     ```

## Testing Patterns

- **Test File Naming:**  
  Test files follow the `*.test.*` pattern.
  _Example:_  
  ```
  src/winePaths.test.ts
  ```

- **Testing Framework:**  
  Not explicitly specified—look for `.test.ts` files for test cases.

- **Example Test Skeleton:**  
  ```typescript
  // src/winePaths.test.ts
  import { detectWinePaths } from './winePaths';

  test('detectWinePaths returns expected paths', () => {
    expect(detectWinePaths()).toContain('/usr/bin/wine');
  });
  ```

## Commands

| Command                  | Purpose                                              |
|--------------------------|------------------------------------------------------|
| /add-linux-wine-feature  | Start the Linux/Wine feature development workflow    |
| /prepare-release         | Start the build and release preparation workflow     |
```

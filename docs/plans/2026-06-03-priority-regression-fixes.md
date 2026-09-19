# Priority Regression Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use sp-ecc:executing-plans to implement this plan task-by-task.

**Goal:** Fix 10 regressions found between LastWorkingVersion (v0.1.363) and current code (v0.1.404+) without breaking existing functionality.

**Architecture:** Each fix targets a specific file with a precise revert or repair. No refactoring, no new features — only restoring lost functionality, fixing broken code, and correcting regressions. Changes are independent and can be applied in any order.

**Tech Stack:** TypeScript, Node.js, VS Code Extension API

**Complexity:** Medium — most fixes are surgical 1-10 line changes; two require restoring larger blocks (platformConfig.ts, commandsProvider.ts)

**Risks:**
- HIGH: Restoring `WorkspaceClassStore`/`XmlLibraryStore` interfaces may reveal type errors in current code that added methods to the actual classes. Mitigation: compile after each task.
- MEDIUM: Restoring async `warmPlatformCache()` changes activation timing. Mitigation: the old version used the same async pattern successfully.
- LOW: Restoring "Open in B4X IDE" uses `Array.splice` (mutation). Mitigation: match old behavior exactly since this is a regression fix, not a refactor.

**Testing:** Compile with `npx tsc --noEmit` after each task. No unit test changes required — these are regression fixes.

---

### Task 1: Fix diagnostic source typo (`b4x-callsu` → `b4x-callsub`)

**Files:**
- Modify: `src/callSubDiagnostics.ts:41`

**Depends on:** None

**Step 1: Fix the typo**

Change line 41 from:
```typescript
diag.source = 'b4x-callsu';
```
to:
```typescript
diag.source = 'b4x-callsub';
```

**Step 2: Verify line 153 already uses correct source**

Line 153 should already be:
```typescript
const collection = vscode.languages.createDiagnosticCollection('b4x-callsub');
```
Confirm it matches.

**Step 3: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add src/callSubDiagnostics.ts
git commit -m "fix: correct diagnostic source from 'b4x-callsu' to 'b4x-callsub'"
```

---

### Task 2: Restore safe `execFile` in platformConfig.ts + async warmPlatformCache + invalidatePlatformCache

**Files:**
- Modify: `src/platformConfig.ts` (full rewrite to match old version's safe pattern)

**Depends on:** None

**Impact Analysis:** The current version uses `execSync` with string interpolation (shell injection risk) and synchronous `warmPlatformCache()` (blocks extension host). The old version used `execFileSync` as sync fallback + async `warmPlatformCache()` with `execFile`. Restoring the old pattern is safe because:
- `execFile`/`execFileSync` pass arguments as an array (no shell interpretation)
- Async `warmPlatformCache()` pre-warms cache during activation without blocking
- `invalidatePlatformCache()` was removed but callers may need it

**Step 1: Rewrite platformConfig.ts to restore the old safe pattern**

Replace the entire content of `src/platformConfig.ts` with the old version's pattern:
- `import { execFile } from 'child_process'` (not `execSync`)
- `findPlatformInstallDirs()`: uses `execFileSync` as synchronous fallback (safe, argument-based)
- `warmPlatformCache()`: async, uses `execFile` with callback (non-blocking)
- `invalidatePlatformCache()`: restored — sets `regDirsCache = undefined`
- `getPlatformSettings()`: unchanged (same logic in both versions)

The key differences from current:
1. Line 4: `import { execFile } from 'child_process'` instead of `import { execSync }`
2. Lines 38-82: `findPlatformInstallDirs()` uses `execFileSync` with argument array instead of `execSync` with string interpolation
3. Lines 74-78: `warmPlatformCache()` is async (`Promise<void>`) with `execFile` callback
4. Lines 35-37: `invalidatePlatformCache()` restored

**Step 2: Verify extension.ts calls warmPlatformCache correctly**

Check that `extension.ts` calls `warmPlatformCache()` during activation. The async version returns a Promise — verify the call site uses `void warmPlatformCache()` or `await warmPlatformCache()`.

**Step 3: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 4: Commit**

```bash
git add src/platformConfig.ts
git commit -m "fix: restore safe execFile and async warmPlatformCache, restore invalidatePlatformCache"
```

---

### Task 3: Fix SimpleInMemoryDB SQL routing in libraryIndexSqlite.ts

**Files:**
- Modify: `src/storage/libraryIndexSqlite.ts` (SimpleInMemoryDB class, lines 25-127)

**Depends on:** None

**Impact Analysis:** The `SimpleInMemoryDB` is only used as a fallback when `sql.js` WASM fails to load. In production, `sql.js` handles all SQL through real prepared statements. But in the edge case where WASM is blocked, the loose `.includes()` matching and missing `DELETE FROM FILES` handler cause silent data corruption.

**Step 1: Restore precise SQL pattern matching**

In `SimpleInMemoryDB.prepare()`, replace loose `.includes()` patterns with precise `startsWith + includes` patterns matching the old version:

- `t.includes('FROM FILES')` → `t.startsWith('SELECT PARSEDBLOB') && t.includes('FROM FILES')` 
  AND add separate handler for `t.startsWith('SELECT MTIME')`
- `t.includes('FROM XML_CLASSES')` → `t.startsWith('SELECT') && t.includes('FROM XML_CLASSES')`
- `t.includes('DELETE FROM B4XLIB_INNER')` → keep as-is (already precise)
- `t.includes('INSERT INTO B4XLIB_INNER')` → keep as-is (already precise)
- `t.includes('FROM B4XLIB_INNER')` → keep as-is (already precise)
- Add missing handler: `t.startsWith('DELETE FROM FILES')` → delete by absPath
- Add missing handler: `t.startsWith('SELECT MTIME')` → return `{ mtime, size }` by absPath

**Step 2: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 3: Commit**

```bash
git add src/storage/libraryIndexSqlite.ts
git commit -m "fix: restore precise SQL pattern matching in SimpleInMemoryDB fallback"
```

---

### Task 4: Restore WorkspaceClassStore and XmlLibraryStore interfaces

**Files:**
- Modify: `src/types.ts` (add interfaces back)
- Modify: `src/b4xCodeLensProvider.ts` (replace `any` with interface)
- Modify: `src/b4xImplementationProvider.ts` (replace `any` with interface)
- Modify: `src/b4xInlineCompletionProvider.ts` (replace `any` with interface)
- Modify: `src/b4xReferenceProvider.ts` (replace `any` with interface)
- Modify: `src/b4xTypeDefinitionProvider.ts` (replace `any` with interface)
- Modify: `src/b4xWorkspaceSymbolProvider.ts` (replace `any` with interface)
- Modify: `src/callSubDiagnostics.ts` (replace `any` with interface)

**Depends on:** None (but compile after to catch any type mismatches)

**Impact Analysis:** Adding interfaces back is purely additive — it adds compile-time checks. If any new methods were added to the actual classes since the interfaces were removed, the interfaces need to be updated to match. The compile step will catch this.

**Step 1: Add interfaces to types.ts**

Append to `src/types.ts` after `normalizeTypeName`:
```typescript
/** Minimal interface for the workspace class store used by providers. */
export interface WorkspaceClassStore {
  getDefinitionByName(name: string | undefined): import('./workspaceClassIndex').WorkspaceClassInfo | undefined;
  findClassesByPrefix(prefix: string): import('./workspaceClassIndex').WorkspaceClassInfo[];
  getAllClasses(): import('./workspaceClassIndex').WorkspaceClassInfo[];
  findMemberByName(memberName: string): { owner: import('./workspaceClassIndex').WorkspaceClassInfo; kind: 'method' | 'property'; item: import('./workspaceClassIndex').WorkspaceMethodInfo | import('./workspaceClassIndex').WorkspacePropertyInfo } | undefined;
  resolveMemberType(ownerType: string | undefined, memberName: string): string | undefined;
}

/** Minimal interface for the XML library store used by providers. */
export interface XmlLibraryStore {
  getClassByName(name: string | undefined): import('./xmlLibraryIndex').XmlClassInfo | undefined;
  findClassesByPrefix(prefix: string): import('./xmlLibraryIndex').XmlClassInfo[];
  getAllClasses(): import('./xmlLibraryIndex').XmlClassInfo[];
  findMemberByName(memberName: string): { owner: import('./xmlLibraryIndex').XmlClassInfo; kind: 'method' | 'property'; item: import('./xmlLibraryIndex').XmlMethodInfo | import('./xmlLibraryIndex').XmlPropertyInfo } | undefined;
  resolveMemberType(ownerType: string | undefined, memberName: string): string | undefined;
}
```

**Step 2: Update each provider to use interfaces instead of `any`**

For each file listed above, replace `any` type annotations with the proper interface:
- `private readonly workspaceClasses: any` → `private readonly workspaceClasses: WorkspaceClassStore`
- `private readonly xmlLibraries: any` → `private readonly xmlLibraries: XmlLibraryStore`
- `workspaceClasses: any` → `workspaceClasses: WorkspaceClassStore` (in function params)
- `xmlLibraries: any` → `xmlLibraries: XmlLibraryStore` (in function params)

Add `import { WorkspaceClassStore, XmlLibraryStore } from './types';` where needed.

**Step 3: Compile and fix any type mismatches**

Run: `npx tsc --noEmit --pretty`
If new methods were added to the actual classes, update the interfaces to include them.

**Step 4: Commit**

```bash
git add src/types.ts src/b4xCodeLensProvider.ts src/b4xImplementationProvider.ts src/b4xInlineCompletionProvider.ts src/b4xReferenceProvider.ts src/b4xTypeDefinitionProvider.ts src/b4xWorkspaceSymbolProvider.ts src/callSubDiagnostics.ts
git commit -m "fix: restore WorkspaceClassStore and XmlLibraryStore type interfaces"
```

---

### Task 5: Remove duplicated keyword tables, restore shared imports from b4xKeywords.ts

**Files:**
- Modify: `src/b4xOnTypeFormattingProvider.ts` (remove inline keyword tables, restore import)
- Modify: `src/b4xDocumentRangeFormattingProvider.ts` (remove inline keyword tables, restore import)
- Modify: `src/b4xDocumentFormattingProvider.ts` (remove inline keyword tables, restore import)
- Verify: `src/utils/b4xKeywords.ts` (ensure it has all needed keywords including `End Type`)

**Depends on:** None

**Impact Analysis:** Removing duplicated keyword tables and restoring shared imports ensures a single source of truth. The `b4xKeywords.ts` file must already have `MULTI_KEYWORDS`, `KEYWORD_CASING`, and `applyKeywordCasing`. We need to verify `End Type` is in the shared file (the inline copy has it but the shared file may not).

**Step 1: Check b4xKeywords.ts for completeness**

Read `src/utils/b4xKeywords.ts` and verify it contains:
- `End Type` in `MULTI_KEYWORDS`
- B4X primitive types (`int`, `string`, `long`, `float`, `double`, `boolean`, `byte`, `short`, `char`, `object`) in `KEYWORD_CASING`
- `applyKeywordCasing` function

If `End Type` is missing from MULTI_KEYWORDS, add it.
If primitive types are missing from KEYWORD_CASING, add them.

**Step 2: Remove inline tables from b4xOnTypeFormattingProvider.ts**

Remove the local `MULTI_KEYWORDS` and `KEYWORD_CASING` constants.
Add: `import { MULTI_KEYWORDS, KEYWORD_CASING } from './utils/b4xKeywords';`

**Step 3: Remove inline tables from b4xDocumentRangeFormattingProvider.ts**

Remove local keyword tables. Add: `import { MULTI_KEYWORDS, KEYWORD_CASING, applyKeywordCasing } from './utils/b4xKeywords';`

**Step 4: Remove inline tables from b4xDocumentFormattingProvider.ts**

Remove local keyword tables. Add: `import { KEYWORD_CASING, applyKeywordCasing } from './utils/b4xKeywords';`

**Step 5: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 6: Commit**

```bash
git add src/utils/b4xKeywords.ts src/b4xOnTypeFormattingProvider.ts src/b4xDocumentRangeFormattingProvider.ts src/b4xDocumentFormattingProvider.ts
git commit -m "fix: remove duplicated keyword tables, restore shared b4xKeywords imports"
```

---

### Task 6: Fix VS Code config mutation in vssettingsImporter.ts

**Files:**
- Modify: `src/vssettingsImporter.ts:211`

**Depends on:** None

**Step 1: Replace mutation with immutable spread**

Change:
```typescript
existingTokenCustom.textMateRules = combinedRules;
await workbenchCfg.update('editor.tokenColorCustomizations', existingTokenCustom, vscode.ConfigurationTarget.Workspace);
```
To:
```typescript
const updatedTokenCustom = { ...existingTokenCustom, textMateRules: combinedRules };
await workbenchCfg.update('editor.tokenColorCustomizations', updatedTokenCustom, vscode.ConfigurationTarget.Workspace);
```

**Step 2: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 3: Commit**

```bash
git add src/vssettingsImporter.ts
git commit -m "fix: use immutable spread instead of mutating VS Code config object"
```

---

### Task 7: Remove duplicated normalizeTypeName from apiIndex.ts, restore import from types.ts

**Files:**
- Modify: `src/apiIndex.ts` (remove local `normalizeTypeName`, restore import)
- Verify: `src/types.ts` (already has `normalizeTypeName`)

**Depends on:** None

**Step 1: Remove local normalizeTypeName from apiIndex.ts**

Delete the local `export function normalizeTypeName(...)` block (lines ~26-40).
Add: `import { normalizeTypeName } from './types';`
Remove the `export` keyword since it's now imported.

**Step 2: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 3: Commit**

```bash
git add src/apiIndex.ts
git commit -m "fix: remove duplicated normalizeTypeName, restore import from types.ts"
```

---

### Task 8: Restore "Open in B4X IDE" dynamic command in commandsProvider.ts

**Files:**
- Modify: `src/providers/commandsProvider.ts`

**Depends on:** None

**Impact Analysis:** The old code dynamically injects an "Open in {PLATFORM} IDE" tree item after filtering out workbench commands. It reads `b4x.lastOpenedProjectFile` from globalState, detects the platform, and inserts the item. This is a user-facing feature that was removed without replacement.

**Step 1: Restore the dynamic injection block**

After the `this.items.filter(...)` block (line 85-87 in current code), add:

```typescript
// Dynamically inject "Open in B4X IDE" when a project file is loaded.
const lastProjectFile = this.context.globalState?.get<string>('b4x.lastOpenedProjectFile') || '';
if (lastProjectFile && typeof lastProjectFile === 'string' && lastProjectFile.trim() !== '') {
  const ext = path.extname(lastProjectFile).toLowerCase();
  if (ext === '.b4a' || ext === '.b4i' || ext === '.b4j' || ext === '.b4r') {
    const platformName = ext.slice(1).toUpperCase();
    const openPlatformItem = new CommandsProvider.CommandItem(
      `Open in ${platformName} IDE`,
      'b4xIntellisense.openPlatform',
    );
    // Insert right after "Open B4X Project..." if present, otherwise at top
    const openProjectIdx = this.items.findIndex(
      (it) => it.commandId === 'b4xIntellisense.openB4xProject',
    );
    if (openProjectIdx >= 0) {
      this.items.splice(openProjectIdx + 1, 0, openPlatformItem);
    } else {
      this.items.unshift(openPlatformItem);
    }
  }
}
```

Also ensure `path` is imported at the top of the file (check if it already is).

**Step 2: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 3: Commit**

```bash
git add src/providers/commandsProvider.ts
git commit -m "fix: restore 'Open in B4X IDE' dynamic command in Projects tree"
```

---

### Task 9: Restore error logging in projectFile.ts parseProjectFile catch block

**Files:**
- Verify: `src/projectFile.ts:145`

**Depends on:** None

**Impact Analysis:** Upon review, the `console.error` on line 145 IS present in the current code. The review agent's finding was incorrect — the error logging was NOT removed. No change needed.

**Step 1: Verify**

Read line 145 of `src/projectFile.ts` and confirm:
```typescript
console.error(`[B4X ERROR] Failed to read file ${document.uri.fsPath}`, err);
```
is present. If so, skip this task.

If it was removed, add it back:
```typescript
} catch (err) {
  console.error(`[B4X ERROR] Failed to read file ${document.uri.fsPath}`, err);
  // Fall back to document-based parsing
  fileContent = document.getText();
}
```

**Step 2: Commit only if changed**

---

### Task 10: Fix platformBuilders.ts missing path import

**Files:**
- Modify: `src/platformBuilders.ts` (add `import * as path from 'node:path'`)

**Depends on:** None

**Impact Analysis:** If `path` import is missing but `path.join` is used, this is a runtime crash. Must be fixed.

**Step 1: Check if path import is missing**

Read the imports at the top of `src/platformBuilders.ts`. If `import * as path from 'node:path'` or `import * as path from 'path'` is absent but `path.join` is used in the file, add the import.

**Step 2: Compile**

Run: `npx tsc --noEmit --pretty`
Expected: PASS

**Step 3: Commit**

```bash
git add src/platformBuilders.ts
git commit -m "fix: restore missing path import in platformBuilders.ts"
```

---

## Phasing

This plan is small enough to ship as a single slice. All 10 tasks are independent and can be executed in order. After all tasks are complete, run a final compile check.

## Final Verification

After all tasks:
1. `npx tsc --noEmit --pretty` — must pass clean
2. `npm run build` — must produce dist/ bundles
3. `npm run verify:vsix` — must pass (if verify script exists)

---
**READY?** Proceed / Modify: [changes] / Different approach: [alternative]
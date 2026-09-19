# jMashProjectProfile Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use sp-ecc:executing-plans to implement this plan task-by-task.

**Goal:** Bring jMashProjectProfile's core features (unused Sub detection, unused library detection, project statistics, project packaging) into the B4X VS Code IntelliSense extension.

**Architecture:** Follow the existing diagnostic provider pattern (pure core logic file + VS Code integration file + registration in `extension.ts`). Statistics dashboard follows the standalone webview panel pattern (like `libraryBrowserProvider.ts`). Each feature is independently shippable.

**Tech Stack:** TypeScript (strict, ES2022, CommonJS), VS Code Extension API, DaisyUI + Tailwind CSS (for dashboard), Node.js `assert` for unit tests, `archiver` npm package for zip creation (packaging feature).

**Complexity:** High — 4 features, 3 with new diagnostic/webview infrastructure, 1 with filesystem operations.

**Risks:**
- HIGH: Reference counting is currently text-based (naive word matching). Unused Sub detection may produce false positives for Subs whose names match common words. Mitigated by excluding event handlers and lifecycle Subs, and using Warning severity (not Error).
- MEDIUM: Performance of workspace-wide reference scanning on large projects. Mitigated by reusing existing `b4xCodeLensProvider.ts` reference-counting approach and only scanning `.bas`/`.b4x` files.
- LOW: Statistics dashboard webview complexity. Mitigated by following the established `libraryBrowserProvider.ts` pattern exactly.

**Testing:** Unit: core logic functions in `unusedSubDiagnosticsCore.ts`, `unusedLibraryDiagnosticsCore.ts`, `projectStatisticsCore.ts`. Integration: VS Code Extension Host test for diagnostic registration. E2E: Manual verification with sample B4X projects.

---

## Phasing

| Phase | Feature | Tasks | Ships Independently? |
|-------|---------|-------|---------------------|
| **MVP** | Unused Sub Diagnostics | 1-9 | Yes |
| **Core** | Project Statistics Dashboard | 10-16 | Yes |
| **Hardening** | Unused Library Detection | 17-24 | Yes |
| **Polish** | Project Packaging for Distribution | 25+ | Yes (deferred until example zip provided) |

---

## Phase 1 (MVP): Unused Sub Diagnostics

Directly fulfills jMashProjectProfile's "Find unused subroutines" wishlist item. Follows the `callSubDiagnostics.ts` pattern exactly.

---

### Task 1: Create Core Logic — Event Handler Detection

**Files:**
- Create: `src/unusedSubDiagnosticsCore.ts`
- Test: `scripts/tests/test-unused-sub-diagnostics.ts`

**Depends on:** None

**Step 1: Write the failing test**

```typescript
// scripts/tests/test-unused-sub-diagnostics.ts
import {
  isEventHandler,
  isLifecycleSub,
  B4X_LIFECYCLE_SUBS
} from '../../src/unusedSubDiagnosticsCore';
import assert from 'assert';

function test(name: string, fn: () => void): { name: string; fn: () => void } {
  return { name, fn };
}

const tests = [
  test('isEventHandler detects Click handler', () => {
    assert.strictEqual(isEventHandler('Button1_Click', ['Click']), true);
  }),

  test('isEventHandler detects Tick handler', () => {
    assert.strictEqual(isEventHandler('Timer1_Tick', ['Tick']), true);
  }),

  test('isEventHandler detects ItemClick handler', () => {
    assert.strictEqual(isEventHandler('ListView1_ItemClick', ['ItemClick']), true);
  }),

  test('isEventHandler rejects regular Sub', () => {
    assert.strictEqual(isEventHandler('CalculateTotal', []), false);
  }),

  test('isEventHandler rejects Sub with underscore but unknown event', () => {
    assert.strictEqual(isEventHandler('MyVar_UnknownEvent', []), false);
  }),

  test('isEventHandler uses provided event names', () => {
    assert.strictEqual(isEventHandler('btn_Click', ['Click']), true);
    assert.strictEqual(isEventHandler('btn_Hover', ['Click']), false);
  }),

  test('isLifecycleSub detects Activity_Create', () => {
    assert.strictEqual(isLifecycleSub('Activity_Create'), true);
  }),

  test('isLifecycleSub detects Activity_Resume', () => {
    assert.strictEqual(isLifecycleSub('Activity_Resume'), true);
  }),

  test('isLifecycleSub detects Activity_Pause', () => {
    assert.strictEqual(isLifecycleSub('Activity_Pause'), true);
  }),

  test('isLifecycleSub detects Service_Create', () => {
    assert.strictEqual(isLifecycleSub('Service_Create'), true);
  }),

  test('isLifecycleSub detects Service_Start', () => {
    assert.strictEqual(isLifecycleSub('Service_Start'), true);
  }),

  test('isLifecycleSub detects B4XPage_Created', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Created'), true);
  }),

  test('isLifecycleSub detects B4XPage_Appear', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Appear'), true);
  }),

  test('isLifecycleSub detects B4XPage_Disappear', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Disappear'), true);
  }),

  test('isLifecycleSub detects B4XPage_Resize', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Resize'), true);
  }),

  test('isLifecycleSub detects Application_Start', () => {
    assert.strictEqual(isLifecycleSub('Application_Start'), true);
  }),

  test('isLifecycleSub detects Class_Globals', () => {
    assert.strictEqual(isLifecycleSub('Class_Globals'), true);
  }),

  test('isLifecycleSub detects Process_Globals', () => {
    assert.strictEqual(isLifecycleSub('Process_Globals'), true);
  }),

  test('isLifecycleSub rejects regular Sub', () => {
    assert.strictEqual(isLifecycleSub('CalculateTotal'), false);
  }),

  test('isLifecycleSub is case-insensitive', () => {
    assert.strictEqual(isLifecycleSub('activity_create'), true);
    assert.strictEqual(isLifecycleSub('B4XPAGE_CREATED'), true);
  }),

  test('B4X_LIFECYCLE_SUBS contains expected entries', () => {
    assert.ok(B4X_LIFECYCLE_SUBS.length >= 10);
  }),
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`FAIL: ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} tests passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop 2>&1 || echo "Expected: compilation fails because module does not exist yet"`

Expected: Compilation error — `Cannot find module '../../src/unusedSubDiagnosticsCore'`

**Step 3: Write minimal implementation**

```typescript
// src/unusedSubDiagnosticsCore.ts
/**
 * Core logic for unused Sub diagnostics.
 *
 * Pure functions with no VS Code dependencies.
 * Follows the pattern established by typeDiagnosticsCore.ts and callSubDiagnostics.ts.
 */

/** B4X lifecycle Subs that are called implicitly by the framework. */
export const B4X_LIFECYCLE_SUBS: readonly string[] = [
  // Activity lifecycle (B4A)
  'Activity_Create',
  'Activity_Resume',
  'Activity_Pause',
  // Service lifecycle (B4A)
  'Service_Create',
  'Service_Start',
  'Service_Destroy',
  // B4XPages lifecycle
  'B4XPage_Created',
  'B4XPage_Appear',
  'B4XPage_Disappear',
  'B4XPage_Resize',
  'B4XPage_CloseRequest',
  'B4XPage_BackKeyPressed',
  // B4i lifecycle
  'Application_Start',
  // Standard globals
  'Class_Globals',
  'Process_Globals',
] as const;

/** Check if a Sub name is a B4X lifecycle Sub (called implicitly by the framework). */
export function isLifecycleSub(subName: string): boolean {
  const lower = subName.toLowerCase();
  return B4X_LIFECYCLE_SUBS.some(lifecycle => lifecycle.toLowerCase() === lower);
}

/**
 * Check if a Sub name is an event handler.
 *
 * B4X event handlers follow the naming convention `ObjectName_EventName`.
 * A Sub is an event handler if:
 * 1. It contains an underscore (splitting it into prefix and suffix)
 * 2. The suffix (event name) matches one of the known event names provided
 *
 * @param subName — The Sub name to check (e.g., "Button1_Click")
 * @param knownEventNames — Known event names from library XML or #Event: directives
 *   (e.g., ["Click", "Tick", "ItemClick"]). These are compared case-insensitively.
 */
export function isEventHandler(subName: string, knownEventNames: string[]): boolean {
  const underscoreIndex = subName.indexOf('_');
  if (underscoreIndex < 1 || underscoreIndex === subName.length - 1) {
    return false;
  }
  const eventSuffix = subName.substring(underscoreIndex + 1);
  const lowerSuffix = eventSuffix.toLowerCase();
  return knownEventNames.some(known => known.toLowerCase() === lowerSuffix);
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-unused-sub-diagnostics.js`

Expected: All 21 tests pass.

**Step 5: Commit**

```bash
git add src/unusedSubDiagnosticsCore.ts scripts/tests/test-unused-sub-diagnostics.ts
git commit -m "feat: add event handler and lifecycle Sub detection (jMashProjectProfile MVP)"
```

---

### Task 2: Create Core Logic — Unused Sub Finder

**Files:**
- Modify: `src/unusedSubDiagnosticsCore.ts`
- Modify: `scripts/tests/test-unused-sub-diagnostics.ts`

**Depends on:** Task 1

**Step 1: Write the failing test**

Append to `scripts/tests/test-unused-sub-diagnostics.ts`:

```typescript
import {
  isEventHandler,
  isLifecycleSub,
  B4X_LIFECYCLE_SUBS,
  SubDeclaration,
  findUnusedSubs,
  collectAllKnownEventNames,
} from '../../src/unusedSubDiagnosticsCore';

// ... existing tests ...

const moreTests = [
  // findUnusedSubs tests
  test('findUnusedSubs flags Sub with zero references', () => {
    const subs: SubDeclaration[] = [
      { name: 'CalculateTotal', moduleName: 'Main', line: 10, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'CalculateTotal');
  }),

  test('findUnusedSubs skips Sub with references', () => {
    const subs: SubDeclaration[] = [
      { name: 'CalculateTotal', moduleName: 'Main', line: 10, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Activity_Create\n  CalculateTotal\nEnd Sub\nSub CalculateTotal\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips lifecycle Subs', () => {
    const subs: SubDeclaration[] = [
      { name: 'Activity_Create', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips event handlers', () => {
    const subs: SubDeclaration[] = [
      { name: 'Button1_Click', moduleName: 'Main', line: 20, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, ['Click'], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips Subs starting with underscore (B4X internal)', () => {
    const subs: SubDeclaration[] = [
      { name: '_ButtonClick', moduleName: 'Main', line: 30, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs counts CallSub string references', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 10, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Activity_Create\n  CallSub(Me, "DoWork")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs does not count the Sub definition line', () => {
    const subs: SubDeclaration[] = [
      { name: 'UnusedSub', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub UnusedSub\nEnd Sub\n',
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'UnusedSub');
  }),

  test('collectAllKnownEventNames merges workspace and library events', () => {
    const workspaceEvents = new Map<string, string[]>([
      ['MyButton', ['Click', 'LongClick']],
    ]);
    const libraryEvents = new Map<string, string[]>([
      ['Timer', ['Tick']],
      ['ListView', ['ItemClick', 'ItemLongClick']],
    ]);
    const result = collectAllKnownEventNames(workspaceEvents, libraryEvents);
    assert.ok(result.includes('Click'));
    assert.ok(result.includes('LongClick'));
    assert.ok(result.includes('Tick'));
    assert.ok(result.includes('ItemClick'));
    assert.ok(result.includes('ItemLongClick'));
  }),

  test('collectAllKnownEventNames deduplicates', () => {
    const workspaceEvents = new Map<string, string[]>([
      ['Btn1', ['Click']],
      ['Btn2', ['Click']],
    ]);
    const libraryEvents = new Map<string, string[]>([]);
    const result = collectAllKnownEventNames(workspaceEvents, libraryEvents);
    const clickCount = result.filter(e => e === 'Click').length;
    assert.strictEqual(clickCount, 1);
  }),
];

// Replace tests array with [...tests, ...moreTests] and update runTests
```

**Step 2: Run test to verify it fails**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-unused-sub-diagnostics.js`

Expected: Compilation error — `SubDeclaration`, `findUnusedSubs`, `collectAllKnownEventNames` not found.

**Step 3: Write minimal implementation**

Add to `src/unusedSubDiagnosticsCore.ts`:

```typescript
/** A Sub declaration found in a B4X module. */
export interface SubDeclaration {
  readonly name: string;
  readonly moduleName: string;
  readonly line: number;
  readonly isPrivate: boolean;
}

/** An unused Sub diagnostic result. */
export interface UnusedSubResult {
  readonly name: string;
  readonly moduleName: string;
  readonly line: number;
  readonly reason: 'unused' | 'private_unused';
}

/**
 * Collect all known event names from workspace classes and XML libraries.
 *
 * Merges events from both sources and deduplicates by lowercase comparison.
 * This is used to identify event handler Subs that should be excluded from
 * unused diagnostics.
 */
export function collectAllKnownEventNames(
  workspaceEvents: Map<string, string[]>,
  libraryEvents: Map<string, string[]>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const events of workspaceEvents.values()) {
    for (const event of events) {
      const lower = event.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(event);
      }
    }
  }

  for (const events of libraryEvents.values()) {
    for (const event of events) {
      const lower = event.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(event);
      }
    }
  }

  return result;
}

/**
 * Strip a B4X single-line comment from a line, respecting string literals.
 * Delegates to b4xDocParser.stripComment for correctness.
 * This is a simplified local version for use in the core module.
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inString = !inString;
    } else if (line[i] === "'"' && !inString) {
      return line.substring(0, i);
    }
  }
  return line;
}

/**
 * Check if a character position is inside a string literal.
 */
function isInsideString(line: string, charIndex: number): boolean {
  let inString = false;
  for (let i = 0; i < charIndex; i++) {
    if (line[i] === '"') {
      inString = !inString;
    }
  }
  return inString;
}

/**
 * Count references to a Sub name in a collection of file contents.
 *
 * Uses whole-word matching (word boundaries), excludes the Sub definition line,
 * excludes comments, and counts CallSub string references.
 *
 * @param subName — The Sub name to search for
 * @param subLine — The 0-based line number of the Sub definition (to exclude)
 * @param subModuleFile — The file path of the module containing the Sub definition (to exclude the definition line)
 * @param fileContents — Map of file path to file content
 */
function countReferences(
  subName: string,
  subLine: number,
  subModuleFile: string,
  fileContents: Map<string, string>,
): number {
  let count = 0;
  const subNameLower = subName.toLowerCase();
  const wordPattern = new RegExp(`\\b${escapeRegExp(subName)}\\b`, 'gi');

  for (const [filePath, content] of fileContents) {
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const rawLine = lines[lineIdx];

      // Skip the Sub definition line itself
      if (filePath === subModuleFile && lineIdx === subLine) {
        continue;
      }

      // Strip comments
      const codeLine = stripComment(rawLine);

      // Find all word-boundary matches
      let match: RegExpExecArray | null;
      wordPattern.lastIndex = 0;
      while ((match = wordPattern.exec(codeLine)) !== null) {
        // Skip if inside a string literal (but allow CallSub string references)
        const matchIndex = match.index;
        if (isInsideString(codeLine, matchIndex)) {
          // Inside a string — check if this is a CallSub reference
          // Pattern: CallSub(..., "SubName", ...)
          const beforeMatch = codeLine.substring(0, matchIndex);
          if (/CallSub(?:Delayed2|Delayed3|Delayed|3)?\s*\(/i.test(beforeMatch)) {
            count++;
          }
          continue;
        }

        // Skip if on a Sub/End Sub declaration line (other than our target)
        if (/^\s*(?:Public\s+|Private\s+)?Sub\s+/i.test(codeLine)) {
          continue;
        }
        if (/^\s*End\s+Sub/i.test(codeLine)) {
          continue;
        }

        count++;
      }
    }
  }

  return count;
}

/** Escape special regex characters in a string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find all unused Subs in a set of declarations.
 *
 * A Sub is considered unused if:
 * 1. It has zero references across all workspace files (excluding its own definition line)
 * 2. It is not a lifecycle Sub (Activity_Create, etc.)
 * 3. It is not an event handler (Button1_Click, etc.)
 * 4. It does not start with an underscore (B4X internal convention)
 *
 * @param subDeclarations — All Sub declarations in the workspace
 * @param knownEventNames — Known event names for event handler detection
 * @param knownLifecycleSubs — Known lifecycle Sub names (uses B4X_LIFECYCLE_SUBS if empty)
 * @param fileContents — Map of absolute file path to file content for reference counting
 * @returns Array of UnusedSubResult for Subs that appear unused
 */
export function findUnusedSubs(
  subDeclarations: readonly SubDeclaration[],
  knownEventNames: readonly string[],
  knownLifecycleSubs: readonly string[] | [],
  fileContents: Map<string, string> | Record<string, string>,
): UnusedSubResult[] {
  // Normalize fileContents to Map
  const contentsMap = fileContents instanceof Map
    ? fileContents
    : new Map(Object.entries(fileContents));

  const results: UnusedSubResult[] = [];
  const lifecycleSubs = knownLifecycleSubs.length > 0
    ? knownLifecycleSubs
    : B4X_LIFECYCLE_SUBS;

  for (const sub of subDeclarations) {
    // Skip lifecycle Subs (called by framework)
    if (isLifecycleSub(sub.name)) {
      continue;
    }

    // Skip event handlers (called by framework via Object_EventName convention)
    if (isEventHandler(sub.name, knownEventNames as string[])) {
      continue;
    }

    // Skip Subs starting with underscore (B4X internal convention)
    if (sub.name.startsWith('_')) {
      continue;
    }

    // Skip Subs that are single words with no underscore AND match common B4X reserved patterns
    // (e.g., "Initialize" is a convention Sub name that may be called reflectively)
    // This will be addressed in a future hardening phase.

    // Count references
    const refCount = countReferences(
      sub.name,
      sub.line,
      '',  // module file path not available in core logic
      contentsMap,
    );

    if (refCount === 0) {
      results.push({
        name: sub.name,
        moduleName: sub.moduleName,
        line: sub.line,
        reason: sub.isPrivate ? 'private_unused' : 'unused',
      });
    }
  }

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-unused-sub-diagnostics.js`

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/unusedSubDiagnosticsCore.ts scripts/tests/test-unused-sub-diagnostics.ts
git commit -m "feat: add unused Sub finder core logic (jMashProjectProfile MVP)"
```

---

### Task 3: Create VS Code Integration — Unused Sub Diagnostics Provider

**Files:**
- Create: `src/unusedSubDiagnostics.ts`

**Depends on:** Tasks 1, 2

**Step 1: Write the VS Code integration file**

```typescript
// src/unusedSubDiagnostics.ts
/**
 * VS Code diagnostic provider for unused Sub detection.
 *
 * Follows the pattern established by callSubDiagnostics.ts:
 * - provideUnusedSubDiagnosticsForDocument() — pure function, returns Diagnostic[]
 * - registerUnusedSubDiagnostics() — creates DiagnosticCollection, subscribes to events
 */
import * as vscode from 'vscode';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import {
  SubDeclaration,
  UnusedSubResult,
  findUnusedSubs,
  collectAllKnownEventNames,
  B4X_LIFECYCLE_SUBS,
} from './unusedSubDiagnosticsCore';

/**
 * Collect all Sub declarations from workspace classes.
 * Returns an array of SubDeclaration for each public Sub in each module.
 */
function collectSubDeclarations(
  workspaceClasses: WorkspaceClassStore,
): SubDeclaration[] {
  const declarations: SubDeclaration[] = [];
  const allClasses = workspaceClasses.getAllClasses();

  for (const cls of allClasses) {
    const moduleName = cls.name;
    for (const method of cls.methods) {
      // Skip Class_Globals and Process_Globals (handled as lifecycle Subs)
      if (
        method.name.toLowerCase() === 'class_globals' ||
        method.name.toLowerCase() === 'process_globals'
      ) {
        continue;
      }

      declarations.push({
        name: method.name,
        moduleName: moduleName,
        line: method.location?.range.start.line ?? 0,
        isPrivate: method.isPublic === false,
      });
    }
  }

  return declarations;
}

/**
 * Collect all known event names from workspace classes and XML libraries.
 * These are used to identify event handler Subs that should be excluded.
 */
function collectEventNames(
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): string[] {
  const workspaceEvents = new Map<string, string[]>();
  const libraryEvents = new Map<string, string[]>();

  // Collect from workspace classes
  for (const cls of workspaceClasses.getAllClasses()) {
    const events: string[] = [];
    for (const event of cls.events) {
      events.push(event.name);
    }
    if (events.length > 0) {
      workspaceEvents.set(cls.name, events);
    }
  }

  // Collect from XML libraries
  for (const cls of xmlLibraries.getAllClasses()) {
    const events: string[] = [];
    if (cls.events) {
      for (const event of cls.events) {
        events.push(event.name);
      }
    }
    if (events.length > 0) {
      libraryEvents.set(cls.name, events);
    }
  }

  return collectAllKnownEventNames(workspaceEvents, libraryEvents);
}

/**
 * Provide unused Sub diagnostics for a document.
 *
 * This is a pure function that can be called from tests.
 */
export function provideUnusedSubDiagnosticsForDocument(
  document: vscode.TextDocument,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  // Collect Sub declarations from the workspace
  const subDeclarations = collectSubDeclarations(workspaceClasses);

  // Collect known event names for event handler exclusion
  const knownEventNames = collectEventNames(workspaceClasses, xmlLibraries);

  // Read workspace file contents for reference counting
  const fileContents = new Map<string, string>();
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      // Only scan files in the workspace
      // This is a simplified approach — we read files from the workspaceClasses
      // which already have file paths
    }
  }

  // Use document text for the current file, and cached content for others
  for (const cls of workspaceClasses.getAllClasses()) {
    if (cls.filePath) {
      try {
        const fs = require('fs');
        const content = fs.readFileSync(cls.filePath, 'utf-8');
        fileContents.set(cls.filePath, content);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Include current document content
  fileContents.set(document.uri.fsPath, document.getText());

  // Find unused Subs
  const unusedSubs = findUnusedSubs(
    subDeclarations,
    knownEventNames,
    B4X_LIFECYCLE_SUBS,
    fileContents,
  );

  // Create diagnostics for unused Subs in the current document
  const currentFilePath = document.uri.fsPath;
  for (const unused of unusedSubs) {
    // Find the module that matches the current document
    const cls = workspaceClasses.getAllClasses().find(
      c => c.filePath === currentFilePath && c.name.toLowerCase() === unused.moduleName.toLowerCase()
    );
    if (!cls) continue;

    // Find the method in the class
    const method = cls.methods.find(
      m => m.name.toLowerCase() === unused.name.toLowerCase()
    );
    if (!method || !method.location) continue;

    const range = method.location.range;
    const severity = unused.reason === 'private_unused'
      ? vscode.DiagnosticSeverity.Hint
      : vscode.DiagnosticSeverity.Warning;

    const diag = new vscode.Diagnostic(
      range,
      unused.reason === 'private_unused'
        ? `Private Sub '${unused.name}' is not called anywhere in the workspace.`
        : `Sub '${unused.name}' is not called anywhere in the workspace. Consider removing it or adding a comment to suppress this warning.`,
      severity,
    );
    diag.source = 'b4x-unused-sub';
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostics.push(diag);
  }

  return diagnostics;
}

/**
 * Register the unused Sub diagnostic provider.
 *
 * Creates a DiagnosticCollection and subscribes to document change events.
 * Follows the same pattern as registerTypeDiagnostics and registerCallSubDiagnostics.
 */
export function registerUnusedSubDiagnostics(
  context: vscode.ExtensionContext,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-unused-sub');

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') return;

    try {
      const diagnostics = provideUnusedSubDiagnosticsForDocument(
        document,
        workspaceClasses,
        xmlLibraries,
      );
      collection.set(document.uri, diagnostics);
    } catch (e) {
      console.error('[b4x-unused-sub] Error refreshing diagnostics:', e);
    }
  };

  // Subscribe to document events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => refresh(doc)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => refresh(doc)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
  );

  // Initial refresh for active editor
  if (vscode.window.activeTextEditor) {
    refresh(vscode.window.activeTextEditor.document);
  }

  return collection;
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No compilation errors (assuming WorkspaceClassStore and XmlLibraryStore types match).

**Step 3: Commit**

```bash
git add src/unusedSubDiagnostics.ts
git commit -m "feat: add unused Sub diagnostic provider (jMashProjectProfile MVP)"
```

---

### Task 4: Register Unused Sub Diagnostics in Extension

**Files:**
- Modify: `src/extension.ts` (add import and registration)
- Modify: `package.json` (add configuration setting)

**Depends on:** Task 3

**Step 1: Add import to `src/extension.ts`**

Near the existing diagnostic imports (around line 185-186), add:

```typescript
import { registerUnusedSubDiagnostics } from './unusedSubDiagnostics';
```

**Step 2: Add registration in `src/extension.ts`**

Near the existing diagnostic registrations (around line 3792-3795), add:

```typescript
// Unused Sub diagnostics: warn when Subs have no references
registerUnusedSubDiagnostics(context, workspaceClasses, xmlLibraries),
```

**Step 3: Add configuration setting to `package.json`**

In the `configuration.properties` section (around line 692-864), add:

```json
"b4xIntellisense.enableUnusedSubDiagnostics": {
  "type": "boolean",
  "default": true,
  "description": "Warn about Subs that are not called anywhere in the workspace."
}
```

**Step 4: Update `unusedSubDiagnostics.ts` to respect the setting**

Add a guard at the top of the `refresh` function:

```typescript
const config = vscode.workspace.getConfiguration('b4xIntellisense');
if (!config.get<boolean>('enableUnusedSubDiagnostics', true)) {
  collection.clear();
  return;
}
```

**Step 5: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No compilation errors.

**Step 6: Commit**

```bash
git add src/extension.ts src/unusedSubDiagnostics.ts package.json
git commit -m "feat: register unused Sub diagnostics and add enableUnusedSubDiagnostics setting"
```

---

### Task 5: Add Command to Toggle Unused Sub Diagnostics

**Files:**
- Modify: `src/extension.ts` (add command registration)
- Modify: `package.json` (add command)

**Depends on:** Task 4

**Step 1: Add command to `package.json`**

In the `commands` array (around line 32-308), add:

```json
{
  "command": "b4xIntellisense.toggleUnusedSubDiagnostics",
  "title": "Toggle Unused Sub Diagnostics",
  "category": "B4X Companion"
}
```

**Step 2: Register command in `src/extension.ts`**

After the diagnostic registration, add:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('b4xIntellisense.toggleUnusedSubDiagnostics', async () => {
    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const current = config.get<boolean>('enableUnusedSubDiagnostics', true);
    await config.update('enableUnusedSubDiagnostics', !current, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(
      `Unused Sub diagnostics ${!current ? 'enabled' : 'disabled'}.`
    );
  }),
);
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No compilation errors.

**Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: add toggle command for unused Sub diagnostics"
```

---

### Task 6: Extend Unused Sub Diagnostics with CallSub Awareness

**Files:**
- Modify: `src/unusedSubDiagnosticsCore.ts`
- Modify: `scripts/tests/test-unused-sub-diagnostics.ts`

**Depends on:** Task 2

The current `countReferences` in the core logic already handles `CallSub` string references. This task adds explicit tests for the `CallSub` patterns: `CallSub`, `CallSubDelayed`, `CallSub2`, `CallSub3`, `CallSubDelayed2`, `CallSubDelayed3`.

**Step 1: Write the failing test**

Append to `scripts/tests/test-unused-sub-diagnostics.ts`:

```typescript
const callSubTests = [
  test('CallSub string reference counts as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSub("Main", "DoWork")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('CallSubDelayed string reference counts as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSubDelayed("Main", "DoWork")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('CallSub2 and CallSub3 string references count', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSub2("Main", "DoWork", x)\n  CallSub3("Main", "DoWork", x, y)\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Regular string does NOT count as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  Log("DoWork is great")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 1);
  }),

  test('Commented reference does NOT count', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' DoWork\nSub DoWork\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 1);
  }),
];
```

**Step 2: Run test to verify**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-unused-sub-diagnostics.js`

Expected: All tests pass (the CallSub handling is already in the core logic from Task 2).

**Step 3: Commit**

```bash
git add scripts/tests/test-unused-sub-diagnostics.ts
git commit -m "test: add CallSub awareness tests for unused Sub diagnostics"
```

---

### Task 7: Improve Unused Sub Diagnostics — Respect `b4xIntellisense.enableUnusedSubDiagnostics` Setting

**Files:**
- Modify: `src/unusedSubDiagnostics.ts`

**Depends on:** Task 4

This is already implemented in Task 4 Step 3. This task verifies the integration works end-to-end.

**Step 1: Manual verification**

1. Open a B4X project in VS Code with the extension loaded
2. Create a Sub that is never called
3. Verify a warning appears: `"Sub 'XXX' is not called anywhere in the workspace."`
4. Run command "B4X Companion: Toggle Unused Sub Diagnostics" to disable
5. Verify warnings disappear
6. Run command again to enable
7. Verify warnings reappear

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: ensure enableUnusedSubDiagnostics setting is respected"
```

---

### Task 8: Add Suppress Comment Support

**Files:**
- Modify: `src/unusedSubDiagnosticsCore.ts`
- Modify: `scripts/tests/test-unused-sub-diagnostics.ts`

**Depends on:** Task 2

Allow users to suppress unused Sub warnings with a comment: `' noinspection UnusedSub` or `' b4x-unused-sub: ignore`.

**Step 1: Write the failing test**

```typescript
const suppressTests = [
  test('Sub with noinspection comment is not flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'CallbackHandler', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' noinspection UnusedSub\nSub CallbackHandler\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Sub with b4x-unused-sub ignore comment is not flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'CallbackHandler', moduleName: 'Main', line: 5, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' b4x-unused-sub: ignore\nSub CallbackHandler\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Sub without suppress comment IS flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'UnusedSub', moduleName: 'Main', line: 3, isPrivate: false },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "Sub UnusedSub\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 1);
  }),
];
```

**Step 2: Modify `findUnusedSubs` in `unusedSubDiagnosticsCore.ts` to check for suppress comments**

In the `findUnusedSubs` function, before pushing to results, check if the line above the Sub definition contains a suppress comment. This requires the file content to be available. Add a helper:

```typescript
/** Check if a Sub declaration has a suppress comment on the line above it. */
function hasSuppressComment(
  filePath: string,
  line: number,
  fileContents: Map<string, string>,
): boolean {
  const content = fileContents.get(filePath);
  if (!content) return false;

  const lines = content.split('\n');
  if (line <= 0 || line >= lines.length) return false;

  // Check the line immediately above the Sub declaration
  const lineAbove = lines[line - 1];
  if (lineAbove) {
    const trimmed = lineAbove.trim();
    if (
      /noinspection.*UnusedSub/i.test(trimmed) ||
      /b4x-unused-sub\s*:\s*ignore/i.test(trimmed)
    ) {
      return true;
    }
  }

  return false;
}
```

Then in `findUnusedSubs`, add before `results.push`:

```typescript
// Check for suppress comments
const filePath = sub.filePath;
if (filePath && hasSuppressComment(filePath, sub.line, contentsMap)) {
  continue;
}
```

This requires adding `filePath` to `SubDeclaration`. Update the interface:

```typescript
export interface SubDeclaration {
  readonly name: string;
  readonly moduleName: string;
  readonly line: number;
  readonly isPrivate: boolean;
  readonly filePath?: string;
}
```

**Step 3: Run tests to verify**

Run: `npx tsc scripts/tests/test-unused-sub-diagnostics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-unused-sub-diagnostics.js`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/unusedSubDiagnosticsCore.ts scripts/tests/test-unused-sub-diagnostics.ts
git commit -m "feat: add suppress comment support for unused Sub diagnostics"
```

---

### Task 9: Build and Manual Smoke Test

**Files:** None (verification only)

**Depends on:** Tasks 1-8

**Step 1: Compile the extension**

Run: `npm run build`

Expected: Successful compilation with no errors.

**Step 2: Package as VSIX**

Run: `npx vsce package`

Expected: VSIX file created successfully.

**Step 3: Install in VS Code and test**

1. Install the VSIX: `code --install-extension b4x-intellisense-*.vsix`
2. Open a B4X project
3. Create an unused Sub
4. Verify warning appears
5. Add `' noinspection UnusedSub` above the Sub
6. Verify warning disappears
7. Run "Toggle Unused Sub Diagnostics" command
8. Verify diagnostics toggle on/off

**Step 4: Document in README**

Add a section to `README.md` under features:

```markdown
### Unused Sub Detection

The extension warns about Subs that are not referenced anywhere in the workspace, helping you identify dead code. Event handlers (e.g., `Button1_Click`, `Timer1_Tick`) and lifecycle Subs (e.g., `Activity_Create`, `B4XPage_Created`) are automatically excluded.

To suppress a warning for a specific Sub, add a comment on the line above:
```vb
' noinspection UnusedSub
Sub MyCallbackHandler
```

Toggle this feature with the `b4xIntellisense.enableUnusedSubDiagnostics` setting or the "Toggle Unused Sub Diagnostics" command.
```

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document unused Sub detection feature"
```

---

## Phase 2 (Core): Project Statistics Dashboard

Successor to jMashProjectProfile's HTML reports. A standalone webview panel showing live project metrics.

---

### Task 10: Create Core Logic — Project Statistics Collector

**Files:**
- Create: `src/projectStatisticsCore.ts`
- Create: `scripts/tests/test-project-statistics.ts`

**Depends on:** None (can be developed in parallel with Phase 1)

**Step 1: Write the failing test**

```typescript
// scripts/tests/test-project-statistics.ts
import {
  ProjectStatistics,
  ModuleStatistics,
  collectStatistics,
} from '../../src/projectStatisticsCore';
import assert from 'assert';

function test(name: string, fn: () => void): { name: string; fn: () => void } {
  return { name, fn };
}

const tests = [
  test('collectStatistics counts total lines', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Sub Main\n  Log "Hello"\nEnd Sub\n'],
      ['Utils.bas', 'Sub Helper\n  Return True\nEnd Sub\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.totalLines, 8);
  }),

  test('collectStatistics counts code lines excluding blanks and comments', () => {
    const files = new Map<string, string>([
      ['Main.bas', "Sub Main\n  ' This is a comment\n  Log \"Hello\"\n\nEnd Sub\n"],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.totalLines, 5);
    assert.strictEqual(stats.codeLines, 3); // Sub Main, Log "Hello", End Sub
  }),

  test('collectStatistics counts modules', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Sub Main\nEnd Sub\n'],
      ['Utils.bas', 'Sub Helper\nEnd Sub\n'],
      ['Types.bas', 'Type MyType\n  X As Int\nEnd Type\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.moduleCount, 3);
  }),

  test('collectStatistics counts Subs', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Sub Main\nEnd Sub\nSub Helper\nEnd Sub\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.subCount, 2);
  }),

  test('collectStatistics counts event handlers', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Sub Button1_Click\nEnd Sub\nSub Timer1_Tick\nEnd Sub\nSub DoWork\nEnd Sub\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.eventHandlerCount, 2);
    assert.strictEqual(stats.subCount, 3);
  }),

  test('collectStatistics counts Types', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Type Point\n  X As Int\n  Y As Int\nEnd Type\nType Color\n  R As Int\nEnd Type\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.typeCount, 2);
  }),

  test('collectStatistics provides per-module breakdown', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Sub Main\nEnd Sub\nSub Button1_Click\nEnd Sub\n'],
      ['Utils.bas', 'Sub Helper\nEnd Sub\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.modules.length, 2);

    const mainModule = stats.modules.find(m => m.fileName === 'Main.bas');
    assert.ok(mainModule);
    assert.strictEqual(mainModule!.subCount, 2);
    assert.strictEqual(mainModule!.eventHandlerCount, 1);
    assert.strictEqual(mainModule!.totalLines, 4);

    const utilsModule = stats.modules.find(m => m.fileName === 'Utils.bas');
    assert.ok(utilsModule);
    assert.strictEqual(utilsModule!.subCount, 1);
    assert.strictEqual(utilsModule!.totalLines, 2);
  }),

  test('collectStatistics counts comment lines', () => {
    const files = new Map<string, string>([
      ['Main.bas', "' Header comment\nSub Main\n  ' Inline comment\n  Log \"Hello\"\nEnd Sub\n"],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.commentLines, 2);
  }),
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`FAIL: ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} tests passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `npx tsc scripts/tests/test-project-statistics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop 2>&1 || echo "Expected: compilation fails"`

Expected: Compilation error — `projectStatisticsCore` does not exist.

**Step 3: Write minimal implementation**

```typescript
// src/projectStatisticsCore.ts
/**
 * Core logic for project statistics collection.
 *
 * Pure functions with no VS Code dependencies.
 * Successor to jMashProjectProfile's project analysis reports.
 */

/** Statistics for a single module (file). */
export interface ModuleStatistics {
  readonly fileName: string;
  readonly totalLines: number;
  readonly codeLines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly subCount: number;
  readonly eventHandlerCount: number;
  readonly typeCount: number;
}

/** Aggregate statistics for an entire project. */
export interface ProjectStatistics {
  readonly totalLines: number;
  readonly codeLines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly moduleCount: number;
  readonly subCount: number;
  readonly eventHandlerCount: number;
  readonly typeCount: number;
  readonly modules: readonly ModuleStatistics[];
}

/** Count Sub declarations in file content. */
function countSubs(content: string): { subCount: number; eventHandlerCount: number } {
  const lines = content.split('\n');
  let subCount = 0;
  let eventHandlerCount = 0;
  const subPattern = /^\s*(?:Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i;

  for (const line of lines) {
    const match = subPattern.exec(line);
    if (match) {
      subCount++;
      const name = match[1];
      // Event handlers have the pattern ObjectName_EventName
      if (name.includes('_') && !name.startsWith('_')) {
        eventHandlerCount++;
      }
    }
  }

  return { subCount, eventHandlerCount };
}

/** Count Type declarations in file content. */
function countTypes(content: string): number {
  const lines = content.split('\n');
  let typeCount = 0;
  const typePattern = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)/i;

  for (const line of lines) {
    if (typePattern.test(line)) {
      typeCount++;
    }
  }

  return typeCount;
}

/** Analyze a single module file and return its statistics. */
function analyzeModule(fileName: string, content: string): ModuleStatistics {
  const lines = content.split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      blankLines++;
    } else if (trimmed.startsWith("'")) {
      commentLines++;
    } else {
      // Lines with inline comments: count as code if there's code before the comment
      codeLines++;
    }
  }

  const { subCount, eventHandlerCount } = countSubs(content);
  const typeCount = countTypes(content);

  return {
    fileName,
    totalLines: lines.length,
    codeLines,
    commentLines,
    blankLines,
    subCount,
    eventHandlerCount,
    typeCount,
  };
}

/**
 * Collect project statistics from a set of file contents.
 *
 * @param files — Map of file name to file content (typically .bas, .b4a, .b4i, .b4j, .b4r files)
 * @returns Aggregate ProjectStatistics with per-module breakdown
 */
export function collectStatistics(files: Map<string, string>): ProjectStatistics {
  const modules: ModuleStatistics[] = [];

  for (const [fileName, content] of files) {
    modules.push(analyzeModule(fileName, content));
  }

  // Sort modules alphabetically by file name
  modules.sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    totalLines: modules.reduce((sum, m) => sum + m.totalLines, 0),
    codeLines: modules.reduce((sum, m) => sum + m.codeLines, 0),
    commentLines: modules.reduce((sum, m) => sum + m.commentLines, 0),
    blankLines: modules.reduce((sum, m) => sum + m.blankLines, 0),
    moduleCount: modules.length,
    subCount: modules.reduce((sum, m) => sum + m.subCount, 0),
    eventHandlerCount: modules.reduce((sum, m) => sum + m.eventHandlerCount, 0),
    typeCount: modules.reduce((sum, m) => sum + m.typeCount, 0),
    modules,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsc scripts/tests/test-project-statistics.ts --outDir dist/scripts/tests --module commonjs --target ES2022 --moduleResolution node --strict --esModuleInterop && node dist/scripts/tests/test-project-statistics.js`

Expected: All 8 tests pass.

**Step 5: Commit**

```bash
git add src/projectStatisticsCore.ts scripts/tests/test-project-statistics.ts
git commit -m "feat: add project statistics core logic (jMashProjectProfile Core)"
```

---

### Task 11: Create Project Statistics Webview Provider

**Files:**
- Create: `src/providers/projectStatisticsProvider.ts`

**Depends on:** Task 10

**Step 1: Create the provider following the libraryBrowserProvider pattern**

```typescript
// src/providers/projectStatisticsProvider.ts
/**
 * Project Statistics Dashboard — webview panel showing live project metrics.
 *
 * Follows the standalone webview panel pattern established by libraryBrowserProvider.ts.
 * Successor to jMashProjectProfile's HTML reports.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WorkspaceClassStore } from '../workspaceClassIndex';
import { XmlLibraryStore } from '../xmlLibraryIndex';
import { ProjectStatistics } from '../projectStatisticsCore';

export class ProjectStatisticsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly viewType = 'b4x-project-statistics';

  constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      this.viewType,
      'B4X Project Statistics',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media'),
        ],
      },
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
      if (msg.type === 'refresh') {
        this.updateData();
      }
    });
  }

  private async updateData(): Promise<void> {
    if (!this.panel) return;

    const stats = await this.collectStatistics();
    this.panel.webview.postMessage({ type: 'updateStatistics', statistics: stats });
  }

  private async collectStatistics(): Promise<ProjectStatistics> {
    const files = new Map<string, string>();

    // Collect workspace module files
    for (const cls of this.workspaceClasses.getAllClasses()) {
      if (cls.filePath) {
        try {
          const fs = await import('fs');
          const content = fs.readFileSync(cls.filePath, 'utf-8');
          const fileName = cls.filePath.replace(/^.*[\\/]/, '');
          files.set(fileName, content);
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Also include the active document if it's a B4X file
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'b4x') {
      const fileName = activeEditor.document.uri.fsPath.replace(/^.*[\\/]/, '');
      files.set(fileName, activeEditor.document.getText());
    }

    const { collectStatistics } = await import('../projectStatisticsCore');
    return collectStatistics(files);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const styleSrc = webview.cspSource;
    const daisyuiUri = webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'daisyui.min.css'),
    );
    const tailwindUri = webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'tailwind.min.js'),
    );
    const remixIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'remixicon.css'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${styleSrc} 'unsafe-inline'; font-src ${styleSrc}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${daisyuiUri}">
  <link rel="stylesheet" href="${remixIconUri}">
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --font: var(--vscode-font-family);
      --font-size: var(--vscode-font-size);
      --border: var(--vscode-panel-border);
      --hover: var(--vscode-list-hoverBackground);
      --link: var(--vscode-textLink-foreground);
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: var(--font-size);
      padding: 1rem;
    }
    .stat-card {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-number {
      font-size: 2rem;
      font-weight: bold;
      color: var(--link);
    }
    .stat-label {
      font-size: 0.85rem;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-lg font-bold">
      <i class="ri-bar-chart-box-line mr-2"></i>Project Statistics
    </h2>
    <button id="refresh-btn" class="btn btn-sm btn-primary">
      <i class="ri-refresh-line mr-1"></i>Refresh
    </button>
  </div>

  <div id="overview" class="grid grid-cols-4 gap-3 mb-6">
    <div class="stat-card">
      <div class="stat-number" id="total-lines">-</div>
      <div class="stat-label">Total Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="code-lines">-</div>
      <div class="stat-label">Code Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="module-count">-</div>
      <div class="stat-label">Modules</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="sub-count">-</div>
      <div class="stat-label">Subs</div>
    </div>
  </div>

  <div id="secondary" class="grid grid-cols-4 gap-3 mb-6">
    <div class="stat-card">
      <div class="stat-number" id="event-count">-</div>
      <div class="stat-label">Event Handlers</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="type-count">-</div>
      <div class="stat-label">Types</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="comment-lines">-</div>
      <div class="stat-label">Comment Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="blank-lines">-</div>
      <div class="stat-label">Blank Lines</div>
    </div>
  </div>

  <div class="overflow-x-auto">
    <table class="table table-sm table-zebra w-full">
      <thead>
        <tr>
          <th>Module</th>
          <th class="text-right">Lines</th>
          <th class="text-right">Code</th>
          <th class="text-right">Comments</th>
          <th class="text-right">Subs</th>
          <th class="text-right">Events</th>
          <th class="text-right">Types</th>
        </tr>
      </thead>
      <tbody id="modules-tbody">
        <tr><td colspan="7" class="text-center opacity-50">Loading...</td></tr>
      </tbody>
    </table>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateStatistics') {
        updateDashboard(msg.statistics);
      }
    });

    function updateDashboard(stats) {
      document.getElementById('total-lines').textContent = stats.totalLines.toLocaleString();
      document.getElementById('code-lines').textContent = stats.codeLines.toLocaleString();
      document.getElementById('module-count').textContent = stats.moduleCount;
      document.getElementById('sub-count').textContent = stats.subCount;
      document.getElementById('event-count').textContent = stats.eventHandlerCount;
      document.getElementById('type-count').textContent = stats.typeCount;
      document.getElementById('comment-lines').textContent = stats.commentLines.toLocaleString();
      document.getElementById('blank-lines').textContent = stats.blankLines.toLocaleString();

      const tbody = document.getElementById('modules-tbody');
      tbody.innerHTML = ''; // Clear loading state
      for (const m of stats.modules) {
        const row = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = m.fileName; // textContent — safe, no XSS
        const tdLines = document.createElement('td');
        tdLines.className = 'text-right';
        tdLines.textContent = m.totalLines.toLocaleString();
        const tdCode = document.createElement('td');
        tdCode.className = 'text-right';
        tdCode.textContent = m.codeLines.toLocaleString();
        const tdComments = document.createElement('td');
        tdComments.className = 'text-right';
        tdComments.textContent = m.commentLines.toLocaleString();
        const tdSubs = document.createElement('td');
        tdSubs.className = 'text-right';
        tdSubs.textContent = String(m.subCount);
        const tdEvents = document.createElement('td');
        tdEvents.className = 'text-right';
        tdEvents.textContent = String(m.eventHandlerCount);
        const tdTypes = document.createElement('td');
        tdTypes.className = 'text-right';
        tdTypes.textContent = String(m.typeCount);
        row.append(tdName, tdLines, tdCode, tdComments, tdSubs, tdEvents, tdTypes);
        tbody.appendChild(row);
      }
    }

    // Request initial data
    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No compilation errors.

**Step 3: Commit**

```bash
git add src/providers/projectStatisticsProvider.ts
git commit -m "feat: add project statistics webview provider (jMashProjectProfile Core)"
```

---

### Task 12: Register Project Statistics Command and Provider

**Files:**
- Modify: `src/extension.ts` (add import and command registration)
- Modify: `package.json` (add command and view container)

**Depends on:** Task 11

**Step 1: Add import to `src/extension.ts`**

```typescript
import { ProjectStatisticsProvider } from './providers/projectStatisticsProvider';
```

**Step 2: Register command in `src/extension.ts`**

After the existing webview provider registrations (around line 835), add:

```typescript
const projectStatistics = new ProjectStatisticsProvider(workspaceClasses, xmlLibraries);
context.subscriptions.push(
  vscode.commands.registerCommand('b4xIntellisense.showProjectStatistics', () => {
    projectStatistics.show();
  }),
);
```

**Step 3: Add command to `package.json`**

In the `commands` array, add:

```json
{
  "command": "b4xIntellisense.showProjectStatistics",
  "title": "Show Project Statistics",
  "category": "B4X Companion"
}
```

**Step 4: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No compilation errors.

**Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register project statistics command (jMashProjectProfile Core)"
```

---

### Task 13-16: Polish Statistics Dashboard (Deferred to Execution)

Tasks 13-16 cover:
- Task 13: Add library count to statistics
- Task 14: Add unused Sub/lib counts to dashboard
- Task 15: Add "Export as HTML" button (jMashProjectProfile parity)
- Task 16: Add automatic refresh on document save

These follow the same TDD pattern and will be detailed during execution.

---

## Phase 3 (Hardening): Unused Library Detection

Cross-reference declared libraries against actually-used types/methods.

---

### Task 17: Create Core Logic — Library Usage Analysis

**Files:**
- Create: `src/unusedLibraryDiagnosticsCore.ts`
- Create: `scripts/tests/test-unused-library-diagnostics.ts`

**Depends on:** Phase 1 (uses `workspaceClassIndex.ts` and `xmlLibraryIndex.ts`)

**Step 1: Write the failing test**

```typescript
// scripts/tests/test-unused-library-diagnostics.ts
import {
  LibraryUsageInfo,
  analyzeLibraryUsage,
} from '../../src/unusedLibraryDiagnosticsCore';
import assert from 'assert';

function test(name: string, fn: () => void): { name: string; fn: () => void } {
  return { name, fn };
}

const tests = [
  test('analyzeLibraryUsage flags unused library', () => {
    const declared = new Map<string, string[]>([
      ['HTTP', ['HttpJob', 'HttpRequest']],
      ['StringUtils', ['StringUtils']],
    ]);
    const used = new Set<string>(['HttpJob']); // Only HttpJob is used, not StringUtils
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 1);
    assert.strictEqual(result.unused[0].libraryName, 'StringUtils');
  }),

  test('analyzeLibraryUsage does not flag used library', () => {
    const declared = new Map<string, string[]>([
      ['HTTP', ['HttpJob']],
    ]);
    const used = new Set<string>(['HttpJob']);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0);
  }),

  test('analyzeLibraryUsage handles empty declarations', () => {
    const declared = new Map<string, string[]>([]);
    const used = new Set<string>(['Anything']);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0);
  }),
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`FAIL: ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} tests passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

**Step 2: Write minimal implementation**

```typescript
// src/unusedLibraryDiagnosticsCore.ts
/**
 * Core logic for unused library detection.
 *
 * Cross-references declared libraries against actually-used types/methods.
 * Successor to jMashProjectProfile's "Find unused libraries" wishlist item.
 */

/** Information about an unused library. */
export interface UnusedLibraryResult {
  readonly libraryName: string;
  readonly exportedTypes: readonly string[];
  readonly reason: string;
}

/** Result of library usage analysis. */
export interface LibraryUsageAnalysis {
  readonly unused: readonly UnusedLibraryResult[];
  readonly used: readonly string[];
}

/**
 * Analyze which declared libraries are unused.
 *
 * A library is considered unused if none of its exported types
 * are referenced anywhere in the workspace code.
 *
 * @param declaredLibraries — Map of library name to exported type names
 *   (from xmlLibraryIndex or project file parsing)
 * @param usedTypes — Set of type names that are actually used in workspace code
 *   (from workspaceClassIndex type inference)
 * @returns Analysis result with unused libraries and used libraries
 */
export function analyzeLibraryUsage(
  declaredLibraries: Map<string, string[]>,
  usedTypes: Set<string>,
): LibraryUsageAnalysis {
  const unused: UnusedLibraryResult[] = [];
  const used: string[] = [];

  for (const [libraryName, exportedTypes] of declaredLibraries) {
    // Check if any exported type from this library is used
    const isUsed = exportedTypes.some(typeName =>
      usedTypes.has(typeName.toLowerCase()),
    );

    if (isUsed) {
      used.push(libraryName);
    } else {
      unused.push({
        libraryName,
        exportedTypes,
        reason: `No types from '${libraryName}' (${exportedTypes.join(', ')}) are used in the project.`,
      });
    }
  }

  return { unused, used };
}
```

**Steps 3-5:** Compile, test, commit — follow the same TDD pattern.

---

### Tasks 18-24: Unused Library Diagnostics (Full Implementation)

Tasks 18-24 cover:
- Task 18: Create VS Code integration (`unusedLibraryDiagnostics.ts`)
- Task 19: Register in `extension.ts`
- Task 20: Add `enableUnusedLibraryDiagnostics` config setting
- Task 21: Add toggle command
- Task 22: Integrate library usage data from `xmlLibraryIndex.ts`
- Task 23: Integrate type usage data from `workspaceClassIndex.ts`
- Task 24: Build and smoke test

These follow the same patterns as Tasks 3-9 for unused Sub diagnostics.

---

## Phase 4 (Polish): Project Packaging for Distribution

**DEFERRED** until user provides an example zipped project from jMashProjectProfile.

The packaging feature will:
1. Read the project file (`.b4a`/`.b4i`/`.b4j`/`.b4r`) to extract library references
2. Resolve library JAR files from configured library paths
3. Collect shared code modules referenced in the project
4. Create a structured zip archive containing:
   - The project file
   - All module files
   - All referenced libraries
   - All shared code modules
   - A manifest/inventory file
5. Provide a VS Code command `"B4X: Package Project for Distribution"`

This will be planned in detail once the example zip structure is available.

---

## Appendix: Key File Locations Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/extension.ts` | ~5,843 | Central orchestrator — command registration, activation |
| `src/typeDiagnostics.ts` | 54 | Type diagnostic provider (pattern to follow) |
| `src/typeDiagnosticsCore.ts` | 69 | Pure type validation logic (pattern to follow) |
| `src/callSubDiagnostics.ts` | 182 | CallSub diagnostic provider (closest pattern) |
| `src/b4xCodeLensProvider.ts` | ~150 | Reference counting (infrastructure to reuse) |
| `src/workspaceClassIndex.ts` | ~899 | Workspace symbol index (data source) |
| `src/xmlLibraryIndex.ts` | ~534 | Library symbol index (data source) |
| `src/commonClassStore.ts` | ~90 | Common class members (data source) |
| `src/types.ts` | 46-54 | `B4xEventDef` interface |
| `src/providers/libraryBrowserProvider.ts` | ~350 | Standalone webview panel pattern (pattern to follow) |
| `src/providers/CompanionDashboardProvider.ts` | ~1000 | Sidebar webview pattern |
| `package.json` | commands: 32-308, config: 692-864 | Extension manifest |
| `scripts/tests/test-type-diagnostics.ts` | ~100 | Test pattern to follow |

---

**READY?** Proceed / Modify: [changes] / Different approach: [alternative]

**Plan complete and saved to `docs/plans/2026-05-30-jmash-project-profile-features.md`. Ready to execute?**
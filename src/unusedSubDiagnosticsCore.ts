/**
 * Core logic for unused Sub diagnostics.
 *
 * Pure functions with no VS Code dependencies.
 * Follows the pattern established by typeDiagnosticsCore.ts and callSubDiagnostics.ts.
 *
 * Successor to jMashProjectProfile's "Find unused subroutines" wishlist item.
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

/** A Sub declaration found in a B4X module. */
export interface SubDeclaration {
  readonly name: string;
  readonly moduleName: string;
  readonly line: number;
  readonly isPrivate: boolean;
  readonly filePath?: string;
}

/** An unused Sub diagnostic result. */
export interface UnusedSubResult {
  readonly name: string;
  readonly moduleName: string;
  readonly line: number;
  readonly reason: 'unused' | 'private_unused';
}

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
 * @param subName â€” The Sub name to check (e.g., "Button1_Click")
 * @param knownEventNames â€” Known event names from library XML or #Event: directives
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
 * Local copy for use in the core module (no VS Code dependency).
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inString = !inString;
    } else if (line[i] === "'" && !inString) {
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

/** Escape special regex characters in a string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count references to a Sub name in a collection of file contents.
 *
 * Uses whole-word matching (word boundaries), excludes the Sub definition line,
 * excludes comments, and counts CallSub string references.
 */
function countReferences(
  subName: string,
  subLine: number,
  subModuleFile: string,
  fileContents: Map<string, string>,
): number {
  let count = 0;
  const wordPattern = new RegExp(`\\b${escapeRegExp(subName)}\\b`, 'gi');

  for (const [filePath, content] of fileContents) {
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const rawLine = lines[lineIdx];
      if (rawLine === undefined) continue;

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
        // Check if inside a string literal
        const matchIndex = match.index;
        if (isInsideString(codeLine, matchIndex)) {
          // Inside a string â€” only count if this is a CallSub reference
          const beforeMatch = codeLine.substring(0, matchIndex);
          if (/CallSub(?:Delayed2|Delayed3|Delayed|3|2)?\s*\(/i.test(beforeMatch)) {
            count++;
          }
          continue;
        }

        // Skip Sub/End Sub declaration lines
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

/**
 * Check if a Sub declaration has a suppress comment on the line above it.
 *
 * Supported suppress patterns:
 * - `' noinspection UnusedSub`
 * - `' b4x-unused-sub: ignore`
 */
export function hasSuppressComment(
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

/**
 * Find all unused Subs in a set of declarations.
 *
 * A Sub is considered unused if:
 * 1. It has zero references across all workspace files (excluding its own definition line)
 * 2. It is not a lifecycle Sub (Activity_Create, etc.)
 * 3. It is not an event handler (Button1_Click, etc.)
 * 4. It does not start with an underscore (B4X internal convention)
 * 5. It does not have a suppress comment on the line above
 *
 * @param subDeclarations â€” All Sub declarations in the workspace
 * @param knownEventNames â€” Known event names for event handler detection
 * @param knownLifecycleSubs â€” Known lifecycle Sub names (uses B4X_LIFECYCLE_SUBS if empty)
 * @param fileContents â€” Map of absolute file path to file content for reference counting
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

    // Check for suppress comments
    if (sub.filePath && hasSuppressComment(sub.filePath, sub.line, contentsMap)) {
      continue;
    }

    // Count references
    const refCount = countReferences(
      sub.name,
      sub.line,
      sub.filePath ?? '',
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

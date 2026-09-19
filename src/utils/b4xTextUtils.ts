/**
 * Shared B4X text processing utilities.
 * Provides comment detection, string detection, and regex escaping
 * used across multiple providers (references, rename, CodeLens, etc.).
 */

/** Escape special regex characters in a string for use in RegExp. */
export function escapeRegex(str: string): string {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Find the index of the first comment character (') on a line,
 * respecting B4X string quoting rules ("" = escaped quote).
 * Returns -1 if no comment is found.
 */
export function findCommentStart(line: string): number {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        i++; // skip escaped quote pair
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === "'") {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Check if a column position is inside a double-quoted string,
 * correctly handling B4X escaped quotes ("").
 */
export function isInsideString(line: string, col: number): boolean {
  let inString = false;
  for (let i = 0; i < col && i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        i++; // skip escaped quote pair
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
    }
  }
  return inString;
}
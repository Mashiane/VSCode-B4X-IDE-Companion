/**
 * Shared B4X keyword casing tables.
 * Used by document, range, and on-type formatting providers.
 */

/** Multi-word keyword patterns with canonical replacement. */
export const MULTI_KEYWORDS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bend\s+sub\b/gi, replacement: 'End Sub' },
  { pattern: /\bend\s+if\b/gi, replacement: 'End If' },
  { pattern: /\bend\s+select\b/gi, replacement: 'End Select' },
  { pattern: /\bend\s+try\b/gi, replacement: 'End Try' },
  { pattern: /\belse\s+if\b/gi, replacement: 'Else If' },
  { pattern: /\bcase\s+else\b/gi, replacement: 'Case Else' },
  { pattern: /\bfor\s+each\b/gi, replacement: 'For Each' },
  { pattern: /\bclass_globals\b/gi, replacement: 'Class_Globals' },
  { pattern: /\bprocess_globals\b/gi, replacement: 'Process_Globals' },
];

/** Single-word keyword canonical casing (lowercase key → proper casing). */
export const KEYWORD_CASING: Readonly<Record<string, string>> = {
  'sub': 'Sub', 'end': 'End', 'if': 'If', 'then': 'Then',
  'else': 'Else', 'for': 'For', 'to': 'To', 'step': 'Step',
  'next': 'Next', 'do': 'Do', 'loop': 'Loop', 'while': 'While',
  'until': 'Until', 'select': 'Select', 'case': 'Case',
  'try': 'Try', 'catch': 'Catch', 'return': 'Return',
  'continue': 'Continue', 'exit': 'Exit', 'dim': 'Dim',
  'as': 'As', 'private': 'Private', 'public': 'Public',
  'type': 'Type', 'and': 'And', 'or': 'Or', 'not': 'Not',
  'mod': 'Mod', 'true': 'True', 'false': 'False', 'null': 'Null',
  'in': 'In', 'region': 'Region',
  // B4X primitive types
  'int': 'Int', 'string': 'String', 'long': 'Long',
  'float': 'Float', 'double': 'Double', 'boolean': 'Boolean',
  'byte': 'Byte', 'short': 'Short', 'char': 'Char', 'object': 'Object',
};

/**
 * Apply canonical keyword casing, preserving ALL-CAPS when the original
 * is longer than one character and entirely uppercase.
 */
export function applyKeywordCasing(match: string, canonical: string): string {
  if (match === match.toUpperCase() && match.length > 1) {
    return canonical.toUpperCase();
  }
  return canonical;
}
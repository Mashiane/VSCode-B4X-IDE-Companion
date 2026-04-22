/**
 * Test: What happens to #AdditionalJar lines with colons?
 * 
 * The colon normalization regex (slash-star-colon-star-slash-g) has a bug with Windows paths.
 */

function formatCodeSegment(code: string): string {
  let result = code;

  // Multi-word keywords
  const multiWord = [
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
  for (const { pattern, replacement } of multiWord) {
    result = result.replace(pattern, replacement);
  }

  // Single-word keywords
  const singleKeywords = [
    'Sub', 'End', 'If', 'Then', 'Else', 'For', 'To', 'Step', 'Next',
    'Do', 'Loop', 'While', 'Until', 'Select', 'Case', 'Try', 'Catch',
    'Return', 'Continue', 'Exit', 'Dim', 'As', 'Private', 'Public',
    'Type', 'And', 'Or', 'Not', 'Mod', 'True', 'False', 'Null',
    'In', 'Region',
    'Int', 'String', 'Long', 'Float', 'Double', 'Boolean', 'Byte',
    'Short', 'Char', 'Object',
  ];
  for (const keyword of singleKeywords) {
    const lower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${lower}\\b`, 'gi');
    result = result.replace(regex, () => keyword);
  }

  // Normalize spacing around operators
  result = result.replace(/(?<=[^\s<>=])\s*=\s*(?=[^\s<>=])/g, ' = ');
  result = result.replace(/\s*:\s*/g, ': ');  // <-- THE BUG
  result = result.replace(/\s*,\s*/g, ', ');

  return result;
}

function formatCode(code: string): string {
  let result = '';
  let inString = false;
  let segmentStart = 0;

  for (let i = 0; i <= code.length; i++) {
    const ch = i < code.length ? code[i] : null;
    if (inString) {
      if (ch === '"') {
        result += code.substring(segmentStart, i + 1);
        inString = false;
        segmentStart = i + 1;
      }
      continue;
    } else {
      if (ch === '"') {
        const beforeCode = code.substring(segmentStart, i);
        result += formatCodeSegment(beforeCode);
        inString = true;
        segmentStart = i;
      }
      continue;
    }
  }
  if (!inString && segmentStart < code.length) {
    result += formatCodeSegment(code.substring(segmentStart));
  }
  return result;
}

console.log('\n=== #AdditionalJar Colon Behavior ===\n');

const cases = [
  // Normal case - works fine
  '#AdditionalJar: sqlite.jar',
  
  // No space after colon - gets fixed (good)
  '#AdditionalJar:sqlite.jar',
  
  // Windows path - BUG: C:\ becomes C: \
  '#AdditionalJar: C:\\libs\\sqlite.jar',
  
  // Windows path without spaces
  '#AdditionalJar:C:\\libs\\sqlite.jar',
  
  // B4X multi-statement separator (this is the INTENDED use of colon normalization)
  'dim x as int: x = 5',
  
  // Time-like strings (hypothetical)
  'dim t as string = "12:30"',
  
  // #Event with colon
  '#Event: Click (x As Int)',
];

for (const input of cases) {
  const output = formatCode(input);
  const changed = input === output ? '  (unchanged)' : '  ← CHANGED';
  console.log(`Input:  "${input}"`);
  console.log(`Output: "${output}"${changed}`);
  console.log('');
}

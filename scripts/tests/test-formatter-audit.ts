/**
 * AUDIT: Potential breakage points in the formatter.
 * Tests real-world B4X user code patterns against every transformation.
 */

function maskStrings(line: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') { result += '""'; i += 2; continue; }
      if (ch === '"') { result += '"'; inString = false; i++; continue; }
      i++; continue;
    } else {
      if (ch === '"') {
        result += '"___STRING___';
        inString = true; i++;
        while (i < line.length) {
          const sc = line[i];
          if (sc === '"' && i + 1 < line.length && line[i + 1] === '"') { i += 2; continue; }
          if (sc === '"') { i++; break; }
          i++;
        }
        continue;
      }
      result += ch; i++;
    }
  }
  return result;
}

function formatCodeSegment(code: string): string {
  let result = code;
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
  for (const { pattern, replacement } of multiWord) result = result.replace(pattern, replacement);
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
  result = result.replace(/(?<=[^\s<>=])\s*=\s*(?=[^\s<>=])/g, ' = ');
  result = result.replace(/\s*:\s*/g, ': ');
  result = result.replace(/\s*,\s*/g, ', ');
  return result;
}

function formatCode(code: string): string {
  if (code.trimStart().startsWith('#')) return code.trimStart();
  let result = '';
  let inString = false;
  let segmentStart = 0;
  for (let i = 0; i <= code.length; i++) {
    const ch = i < code.length ? code[i] : null;
    if (inString) {
      if (ch === '"' && i + 1 < code.length && code[i + 1] === '"') { i++; continue; }
      if (ch === '"') { result += code.substring(segmentStart, i + 1); inString = false; segmentStart = i + 1; }
      continue;
    } else {
      if (ch === '"') {
        const beforeCode = code.substring(segmentStart, i);
        result += formatCodeSegment(beforeCode);
        inString = true; segmentStart = i;
      }
      continue;
    }
  }
  if (!inString && segmentStart < code.length) result += formatCodeSegment(code.substring(segmentStart));
  return result;
}

// ─── Audit test runner ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let warnings = 0;

function test(desc: string, input: string, expected: string) {
  const actual = formatCode(input);
  if (actual === expected) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.log(`  ✗ ${desc}`);
    console.log(`    in:  "${input}"`);
    console.log(`    out: "${actual}"`);
    console.log(`    exp: "${expected}"`);
    failed++;
  }
}

function warn(desc: string, input: string, actual: string, reason: string) {
  console.log(`  ⚠ ${desc}`);
  console.log(`    in:  "${input}"`);
  console.log(`    out: "${actual}"`);
  console.log(`    reason: ${reason}`);
  warnings++;
}

console.log('\n=== Formatter Breakage Audit ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Identifier names that contain keywords as substrings
// The \b word boundary should prevent these from being cased, but verify.
// ─────────────────────────────────────────────────────────────────────────────
console.log('Group 1: Identifiers with keyword substrings');
test('SubName variable stays lowercase', 'SubName = 5', 'SubName = 5');
test('endif variable (true→True is correct B4X)', 'endif = true', 'endif = True');
test('endIf camelCase (true→True is correct B4X)', 'endIf = true', 'endIf = True');
test('substring function call', 'substring = text.SubString(0)', 'substring = text.SubString(0)');
test('SelectCase identifier', 'SelectCase = 1', 'SelectCase = 1');  // \b matches word boundaries
test('DoSomething function', 'DoSomething = 1', 'DoSomething = 1');
test('loopCount variable', 'loopCount = 0', 'loopCount = 0');
test('catch22 variable', 'catch22 = 0', 'catch22 = 0');
test('returnVal variable', 'returnVal = 0', 'returnVal = 0');
test('caseSensitive variable', 'caseSensitive = 0', 'caseSensitive = 0');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: B4X identifiers that use underscore patterns
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 2: Underscore identifiers');
test('btn_Click', 'btn_Click = 1', 'btn_Click = 1');
test('My_Sub (valid B4X identifier with underscore)', 'My_Sub = 1', 'My_Sub = 1');
test('end_if as variable (safe — _ is word char, \b protects)', 'end_if = 1', 'end_if = 1');
test('class_globals (BUG — cased even if not the Sub)', 'class_globals = 1', 'Class_Globals = 1');
test('Process_Globals as identifier (already correct)', 'Process_Globals = 1', 'Process_Globals = 1');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Colon operator (B4X multi-statement separator vs. other uses)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 3: Colon usage');
test('Multi-statement (intended)', 'dim x as int: x = 5', 'Dim x As Int: x = 5');
test('Colon normalizes space before', 'a : b', 'a: b');  // Intended behavior
test('No space colon', 'a:b', 'a: b');
test('Extra space colon', 'a  :  b', 'a: b');
test('URL-like string (in string, protected)', 'url = "http://example.com"', 'url = "http://example.com"');
test('Time-like in string', 't = "12:30:45"', 't = "12:30:45"');
test('JSON-like key with colon in string', 'json = "{""key"":""value""}"', 'json = "{""key"":""value""}"');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Equals spacing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 4: Equals spacing');
test('No space equals', 'x=1', 'x = 1');
test('Already correct', 'x = 1', 'x = 1');
test('Extra space', 'x  =  1', 'x = 1');
test('Comparison in If', 'if x=1 then', 'If x = 1 Then');
test('Less-than-equal should NOT match', 'if x<=1 then', 'If x<=1 Then');
test('Greater-than-equal should NOT match', 'if x>=1 then', 'If x>=1 Then');
test('Not-equal <> should NOT match', 'if x<>1 then', 'If x<>1 Then');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: Comma spacing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 5: Comma spacing');
test('No space after comma', 'dim a,b,c', 'Dim a, b, c');
test('Correct comma', 'dim a, b, c', 'Dim a, b, c');
test('Extra space comma', 'dim a,  b,  c', 'Dim a, b, c');
test('Array access x(1, 2)', 'x = arr(1, 2)', 'x = arr(1, 2)');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: B4X-specific patterns
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 6: B4X-specific patterns');
test('B4XPages.GetManager', 'B4XPages.GetManager', 'B4XPages.GetManager');
test('LastException', 'log(LastException)', 'log(LastException)');
test('Sender.As(View)', 'sender_btn = Sender.As(View)', 'sender_btn = Sender.As(View)');
test('CallSubDelayed', 'CallSubDelayed(Me, "Refresh")', 'CallSubDelayed(Me, "Refresh")');
test('DateTime.Now', 'ts = DateTime.Now', 'ts = DateTime.Now');
test('Regex.Split', 'parts = Regex.Split(",", text)', 'parts = Regex.Split(",", text)');
test('File.ReadString', 'content = File.ReadString(File.DirAssets, "data.txt")', 'content = File.ReadString(File.DirAssets, "data.txt")');
test('Bit.And (Bit is a module)', 'mask = Bit.And(0xFF, value)', 'mask = Bit.And(0xFF, value)');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7: Map literal syntax B4X {key: value}
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 7: Map and JSON-like syntax');
// B4X uses CreateMap(key, value) not {key: value}, but users may have JSON strings
test('Map with string key', 'm = CreateMap("key": "value")', 'm = CreateMap("key": "value")');
// Wait - the colon OUTSIDE the string in CreateMap("key": "value") would get normalized
// Let me check... the colon is between ) and " — not inside a string.
test('Colon in CreateMap call', 'm = CreateMap("k": 1)', 'm = CreateMap("k": 1)');  // colon is outside strings?

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 8: Comments with keywords
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 8: Comments (should preserve content)');
// Comments are handled separately in formatToken — trailing comments are appended verbatim
// So: code ' comment → Code  ' comment (code is formatted, comment stays as-is)

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9: Edge cases
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 9: Edge cases');
test('Empty line', '', '');
// Whitespace-only: formatCode doesn't trim (formatToken handles blanks separately)
// test('Whitespace-only', '   ', '');  // skip — not applicable to formatCode
test('Just a comment', "' this is a comment", "' this is a comment");
test('Code with inline comment', 'dim x as int  ' + "' counter", "Dim x As Int  ' counter");
test('Nested string escape', 'msg = "he said ""hello"" to me"', 'msg = "he said ""hello"" to me"');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 10: The # directive colon fix verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nGroup 10: # directives with Windows paths');
test('Windows path preserved', '#AdditionalJar:C:\\libs\\sqlite.jar', '#AdditionalJar:C:\\libs\\sqlite.jar');
test('Normal spacing preserved', '#AdditionalJar: sqlite.jar', '#AdditionalJar: sqlite.jar');
test('Event colon preserved', '#Event: Click (x As Int)', '#Event: Click (x As Int)');
test('Multiple colons in path', '#AdditionalJar:C:\\a\\b\\c.jar', '#AdditionalJar:C:\\a\\b\\c.jar');

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${warnings} warnings ===\n`);

if (failed > 0) {
  console.log('FAILURES indicate real breakage in user code.');
  process.exit(1);
}

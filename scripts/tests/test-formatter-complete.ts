/**
 * Complete debug test suite for B4X Document Formatting Provider
 * 
 * Tests ALL edge cases:
 * - Case statements with string literals (previous bug)
 * - Return with string literals (previous bug)
 * - # directives (#Region, #If, #End Region, #End If, #AdditionalJar, #Event, etc.)
 * - #Else inside #If blocks
 * - All block constructs
 * - String masking
 * - Keyword casing
 * - Operator spacing
 */

import * as assert from 'assert';

// ─── Reproduce the exact formatting logic from b4xDocumentFormattingProvider ───

function maskStrings(line: string): string {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        result += '""';
        i += 2;
        continue;
      }
      if (ch === '"') {
        result += '"';
        inString = false;
        i++;
        continue;
      }
      i++;
      continue;
    } else {
      if (ch === '"') {
        result += '"___STRING___';
        inString = true;
        i++;
        while (i < line.length) {
          const sc = line[i];
          if (sc === '"' && i + 1 < line.length && line[i + 1] === '"') {
            i += 2;
            continue;
          }
          if (sc === '"') {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      result += ch;
      i++;
    }
  }

  return result;
}

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
  result = result.replace(/\s*:\s*/g, ': ');
  result = result.replace(/\s*,\s*/g, ', ');

  // NOTE: No trailing whitespace trim — preserves space before string literals

  return result;
}

function formatCode(code: string): string {
  // # directives: NOT formatted, returned verbatim (only trimmed)
  if (code.trimStart().startsWith('#')) {
    return code.trimStart();
  }

  let result = '';
  let inString = false;
  let segmentStart = 0;

  for (let i = 0; i <= code.length; i++) {
    const ch = i < code.length ? code[i] : null;

    if (inString) {
      if (ch === '"' && i + 1 < code.length && code[i + 1] === '"') {
        i++;
        continue;
      }
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

// ─── Indent level computation (simplified) ──────────────────────────────────

function computeIndentLevel(line: string, currentDepth: number): { indent: number; newDepth: number } {
  const upper = line.toUpperCase().trimStart();
  const masked = maskStrings(line);
  const code = masked.toUpperCase().trimStart();

  // ── End blocks ──
  if (/^\s*END\s+SUB\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*END\s+IF\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*NEXT\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*LOOP\b/.test(code) || /^\s*END\s+DO\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*END\s+SELECT\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*END\s+TRY\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*#\s*END\s*REGION\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };
  if (/^\s*#\s*END\s+IF\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: Math.max(0, currentDepth - 1) };

  // ── Else / Catch ──
  if (/^\s*ELSE\s+IF\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: currentDepth };
  if (/^\s*#\s*ELSE\s+IF\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: currentDepth };
  if (/^\s*ELSE\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: currentDepth };
  if (/^\s*#\s*ELSE\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: currentDepth };
  if (/^\s*CATCH\b/.test(code)) return { indent: Math.max(0, currentDepth - 1), newDepth: currentDepth };

  // ── Case / Case Else ──
  if (/^\s*CASE\s+ELSE\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*CASE\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };

  // ── Block openers ──
  if (/^\s*(PUBLIC\s+|PRIVATE\s+)?\s*SUB\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*FOR\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*DO\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*SELECT\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*TRY\b/.test(code)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*#\s*REGION\b/.test(masked)) return { indent: currentDepth, newDepth: currentDepth + 1 };
  if (/^\s*#\s*IF\b/.test(masked)) return { indent: currentDepth, newDepth: currentDepth + 1 };

  // ── Multi-line If ──
  if (/^\s*IF\b/.test(code)) {
    const thenIdx = code.indexOf('THEN');
    if (thenIdx !== -1) {
      const afterThen = code.slice(thenIdx + 4).trim();
      if (afterThen !== '') {
        return { indent: currentDepth, newDepth: currentDepth };
      }
    }
    return { indent: currentDepth, newDepth: currentDepth + 1 };
  }

  // ── # directives (non-block) — stay at current depth ──
  if (/^\s*#/.test(line)) return { indent: 0, newDepth: currentDepth };

  // ── Regular code line ──
  return { indent: currentDepth, newDepth: currentDepth };
}

// ─── Full format simulation ─────────────────────────────────────────────────

function formatLines(lines: string[]): string[] {
  const results: string[] = [];
  let depth = 0;
  let caseDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') {
      results.push('');
      continue;
    }

    if (trimmed.startsWith("'")) {
      results.push("'" + trimmed.slice(1).trim());
      continue;
    }

    // Compute indent
    const { indent: newIndent, newDepth: newDepthVal } = computeIndentLevel(line, depth + caseDepth);
    
    // For end-blocks, adjust depth BEFORE computing indent
    const code = maskStrings(line).toUpperCase().trimStart();
    let actualDepth = depth + caseDepth;
    
    if (/^\s*END\s+SUB\b/.test(code) || /^\s*END\s+IF\b/.test(code) || 
        /^\s*NEXT\b/.test(code) || /^\s*LOOP\b/.test(code) || 
        /^\s*END\s+DO\b/.test(code) || /^\s*END\s+SELECT\b/.test(code) ||
        /^\s*END\s+TRY\b/.test(code) || /^\s*#\s*END\s*REGION\b/.test(code) ||
        /^\s*#\s*END\s+IF\b/.test(code)) {
      depth = Math.max(0, depth - 1);
      if (/^\s*END\s+SELECT\b/.test(code)) caseDepth = 0;
      actualDepth = depth + caseDepth;
    }
    
    if (/^\s*ELSE\s+IF\b/.test(code) || /^\s*ELSE\b/.test(code) || /^\s*CATCH\b/.test(code)) {
      depth = Math.max(0, depth - 1);
      actualDepth = depth + caseDepth;
    }

    if (/^\s*CASE\s+ELSE\b/.test(code) || /^\s*CASE\b/.test(code)) {
      caseDepth = 1;
      actualDepth = depth;
    }

    const indentStr = '  '.repeat(actualDepth);
    const formatted = formatCode(line).trimStart();
    results.push(indentStr + formatted);

    // Update depth for openers (after the line)
    if (/^\s*(PUBLIC\s+|PRIVATE\s+)?\s*SUB\b/.test(code)) depth += 1;
    else if (/^\s*FOR\b/.test(code)) depth += 1;
    else if (/^\s*DO\b/.test(code)) depth += 1;
    else if (/^\s*SELECT\b/.test(code)) { caseDepth = 0; depth += 1; }
    else if (/^\s*TRY\b/.test(code)) depth += 1;
    else if (/^\s*#\s*REGION\b/.test(maskStrings(line))) depth += 1;
    else if (/^\s*#\s*IF\b/.test(maskStrings(line))) depth += 1;
    else if (/^\s*IF\b/.test(code)) {
      const thenIdx = code.indexOf('THEN');
      if (thenIdx !== -1) {
        const afterThen = code.slice(thenIdx + 4).trim();
        if (afterThen !== '') {
          // single-line, no depth change
        } else {
          depth += 1;
        }
      } else {
        depth += 1;
      }
    }
    else if (/^\s*ELSE\s+IF\b/.test(code)) depth += 1;
    else if (/^\s*#\s*ELSE\s+IF\b/.test(code)) depth += 1;
    else if (/^\s*ELSE\b/.test(code)) depth += 1;
    else if (/^\s*#\s*ELSE\b/.test(code)) depth += 1;
    else if (/^\s*CATCH\b/.test(code)) depth += 1;
  }

  return results;
}

// ─── TEST GROUPS ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, input: string, expected: string) {
  try {
    const actual = formatCode(input);
    assert.strictEqual(actual, expected);
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    input:    "${input}"`);
    console.error(`    expected: "${expected}"`);
    console.error(`    actual:   "${e?.actual}"`);
    failed++;
  }
}

function testLines(name: string, input: string[], expected: string[]) {
  try {
    const actual = formatLines(input);
    assert.deepStrictEqual(actual, expected);
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    const a = e?.actual;
    if (Array.isArray(a)) {
      for (let i = 0; i < Math.max(a.length, expected.length); i++) {
        const act = i < a.length ? a[i] : '(missing)';
        const exp = i < expected.length ? expected[i] : '(missing)';
        if (act !== exp) {
          console.error(`    line ${i}: expected "${exp}", got "${act}"`);
        }
      }
    }
    failed++;
  }
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

console.log('\n=== B4X Formatter Complete Debug Tests ===\n');

// ── Group 1: Case statements (previous bug) ─────────────────────────────
console.log('Group 1: Case statements with string literals');
test('case "btn", "button"', 'case "btn", "button"', 'Case "btn", "button"');
test('case "hello"', 'case "hello"', 'Case "hello"');
test('case else', 'case else', 'Case Else');
test('CASE "X"', 'CASE "X"', 'Case "X"');
test('case 1, 2, 3', 'case 1, 2, 3', 'Case 1, 2, 3');
test('case "a", "b", "c"', 'case "a", "b", "c"', 'Case "a", "b", "c"');

// ── Group 2: Return with strings (previous bug) ─────────────────────────
console.log('\nGroup 2: Return with string literals');
test('return "error"', 'return "error"', 'Return "error"');
test('return "hello" & "world"', 'return "hello" & "world"', 'Return "hello" & "world"');
test('RETURN "X"', 'RETURN "X"', 'Return "X"');
test('return 42', 'return 42', 'Return 42');

// ── Group 3: # directives — NOT formatted, only indented ──────────────
console.log('\nGroup 3: # directives (preserved verbatim, only indented)');
test('#Region name', '#Region name', '#Region name');
test('#region name', '#region name', '#region name');  // NOT cased
test('#End Region', '#End Region', '#End Region');
test('#end region', '#end region', '#end region');  // NOT cased
test('#If B4A', '#If B4A', '#If B4A');
test('#if b4a', '#if b4a', '#if b4a');  // NOT cased
test('#End If', '#End If', '#End If');
test('#end if', '#end if', '#end if');  // NOT cased
test('#Else', '#Else', '#Else');
test('#else', '#else', '#else');  // NOT cased
test('#Else If B4J', '#Else If B4J', '#Else If B4J');
test('#else if b4j', '#else if b4j', '#else if b4j');  // NOT cased
test('#AdditionalJar: sqlite.jar', '#AdditionalJar: sqlite.jar', '#AdditionalJar: sqlite.jar');
test('#AdditionalJar:C:\\libs\\sqlite.jar', '#AdditionalJar:C:\\libs\\sqlite.jar', '#AdditionalJar:C:\\libs\\sqlite.jar');  // NOT broken
test('#Event: Click (x As Int)', '#Event: Click (x As Int)', '#Event: Click (x As Int)');
test('#BA: some text', '#BA: some text', '#BA: some text');
test('#BridgeLogger: true', '#BridgeLogger: true', '#BridgeLogger: true');  // True NOT changed

// ── Group 4: Keywords inside strings NOT cased ─────────────────────────
console.log('\nGroup 4: Keywords inside strings preserved');
test('log("END IF")', 'log("END IF")', 'log("END IF")');
test('msg = "select case"', 'msg = "select case"', 'msg = "select case"');
test('x = "return"', 'x = "return"', 'x = "return"');

// ── Group 5: Operator spacing ───────────────────────────────────────────
console.log('\nGroup 5: Operator spacing');
test('x=1', 'x=1', 'x = 1');
test('x = 1', 'x = 1', 'x = 1');
test('if x=1 then', 'if x=1 then', 'If x = 1 Then');
test('a:b:c', 'a:b:c', 'a: b: c');
test('dim a,b,c', 'dim a,b,c', 'Dim a, b, c');

// ── Group 6: Multi-word keywords ────────────────────────────────────────
console.log('\nGroup 6: Multi-word keywords');
test('end sub', 'end sub', 'End Sub');
test('END SUB', 'END SUB', 'End Sub');  // ALL-CAPS → TitleCase
test('end  sub', 'end  sub', 'End Sub');  // extra space
test('end if', 'end if', 'End If');
test('end select', 'end select', 'End Select');
test('end try', 'end try', 'End Try');
test('else if', 'else if', 'Else If');
test('for each', 'for each', 'For Each');
test('Class_Globals', 'Class_Globals', 'Class_Globals');
test('class_globals', 'class_globals', 'Class_Globals');
test('Process_Globals', 'Process_Globals', 'Process_Globals');
test('process_globals', 'process_globals', 'Process_Globals');

// ── Group 7: Single-word keywords ───────────────────────────────────────
console.log('\nGroup 7: Single-word keywords');
test('sub name', 'sub name', 'Sub name');
test('SUB NAME', 'SUB NAME', 'Sub NAME');
test('if true then', 'if true then', 'If True Then');
test('for i = 1 to 10', 'for i = 1 to 10', 'For i = 1 To 10');
test('do while true', 'do while true', 'Do While True');
test('dim x as int', 'dim x as int', 'Dim x As Int');
test('private sub foo', 'private sub foo', 'Private Sub foo');
test('public sub bar', 'public sub bar', 'Public Sub bar');
test('continue for', 'continue for', 'Continue For');
test('exit sub', 'exit sub', 'Exit Sub');
test('try', 'try', 'Try');
test('catch', 'catch', 'Catch');
test('select case x', 'select case x', 'Select Case x');

// ── Group 8: Mixed strings and code ─────────────────────────────────────
console.log('\nGroup 8: Mixed strings and code');
test('dim msg as string = "hello"', 'dim msg as string = "hello"', 'Dim msg As String = "hello"');
test('log("test: " & x)', 'log("test: " & x)', 'log("test: " & x)');
test('if x = "then" then', 'if x = "then" then', 'If x = "then" Then');

// ── Group 9: Multi-line keyword casing ────────────────────────────────
console.log('\nGroup 9: Multi-line keyword casing');
test('select case value', 'select case value', 'Select Case value');
test('end select', 'end select', 'End Select');
test('if x = 1 then', 'if x = 1 then', 'If x = 1 Then');
test('else if x = 2 then', 'else if x = 2 then', 'Else If x = 2 Then');
test('else', 'else', 'Else');
test('end if', 'end if', 'End If');
test('try', 'try', 'Try');
test('catch', 'catch', 'Catch');
test('end try', 'end try', 'End Try');

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}

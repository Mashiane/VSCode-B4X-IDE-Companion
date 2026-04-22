/**
 * Tests for B4X Document Formatting Provider
 * 
 * Verifies correct formatting of Case statements, string literals,
 * and other B4X constructs.
 */

import * as assert from 'assert';

// Minimal reproduction of the formatting logic for testing
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
  ];

  for (const keyword of singleKeywords) {
    const lower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${lower}\\b`, 'gi');
    result = result.replace(regex, (match) => {
      if (match === match.toUpperCase() && match.length > 1) {
        return keyword.toUpperCase();
      }
      return keyword;
    });
  }

  // Normalize spacing around operators
  result = result.replace(/(?<=[^\s<>=])\s*=\s*(?=[^\s<>=])/g, ' = ');
  result = result.replace(/\s*:\s*/g, ': ');
  result = result.replace(/\s*,\s*/g, ', ');

  // NOTE: No trailing whitespace trim — preserves space before string literals

  return result;
}

function formatCode(code: string): string {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

function testCaseWithStringLiterals() {
  const input = 'case "btn", "button"';
  const expected = 'Case "btn", "button"';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, `Case with string literals should format correctly`);
  console.log('✓ case "btn", "button" → Case "btn", "button"');
}

function testCaseElse() {
  const input = 'case else';
  const expected = 'Case Else';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Case Else should format correctly');
  console.log('✓ case else → Case Else');
}

function testCaseSingleString() {
  const input = 'case "hello"';
  const expected = 'Case "hello"';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Case with single string should format correctly');
  console.log('✓ case "hello" → Case "hello"');
}

function testCaseNoString() {
  const input = 'case 1';
  const expected = 'Case 1';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Case without string should format correctly');
  console.log('✓ case 1 → Case 1');
}

function testSelectStatement() {
  const input = 'select case value';
  const expected = 'Select Case value';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Select Case should format correctly');
  console.log('✓ select case value → Select Case value');
}

function testEndSelect() {
  const input = 'end select';
  const expected = 'End Select';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'End Select should format correctly');
  console.log('✓ end select → End Select');
}

function testDimWithString() {
  const input = 'dim msg as Int = 5';
  const expected = 'Dim msg As Int = 5';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Dim with value should format correctly');
  console.log('✓ dim msg as Int = 5 → Dim msg As Int = 5');
}

function testLogWithString() {
  // 'log' is not a keyword in the formatter, so it stays lowercase
  const input = 'log("end if")';
  const expected = 'log("end if")';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Non-keywords should stay unchanged');
  console.log('✓ log("end if") → log("end if") (log is not a keyword)');
}

function testReturnWithString() {
  const input = 'return "error"';
  const expected = 'Return "error"';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Return with string should format correctly');
  console.log('✓ return "error" → Return "error"');
}

function testMultipleStringsInLine() {
  // 'log' is not a keyword, so it stays lowercase
  const input = 'log("hello" & "world")';
  const expected = 'log("hello" & "world")';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'Multiple strings in line should format correctly');
  console.log('✓ log("hello" & "world") → log("hello" & "world")');
}

function testIfWithCondition() {
  const input = 'if value = 1 then';
  const expected = 'If value = 1 Then';
  const actual = formatCode(input);
  assert.strictEqual(actual, expected, 'If condition should format correctly');
  console.log('✓ if value = 1 then → If value = 1 Then');
}

// ─── Run all tests ───────────────────────────────────────────────────────────

console.log('\nRunning B4X Formatter tests...\n');

try {
  testCaseWithStringLiterals();
  testCaseElse();
  testCaseSingleString();
  testCaseNoString();
  testSelectStatement();
  testEndSelect();
  testDimWithString();
  testLogWithString();
  testReturnWithString();
  testMultipleStringsInLine();
  testIfWithCondition();
  
  console.log('\n✓ All tests passed!\n');
} catch (error) {
  console.error('\n✗ Test failed:', error);
  process.exit(1);
}

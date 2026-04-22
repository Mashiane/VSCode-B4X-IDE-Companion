import * as assert from 'assert';
import { findMisplacedTypeRanges } from '../../src/typeDiagnosticsCore';
// Lightweight test - avoid importing 'vscode' to run in node

class MockLine {
  constructor(public text: string) {}
}

class MockDocument {
  public uri = { fsPath: 'test.bas' } as any;
  constructor(public lines: string[]) {}
  get languageId() { return 'b4x'; }
  get lineCount() { return this.lines.length; }
  // Accept either a number or a Position
  lineAt(_pos: any) { const index = typeof _pos === 'number' ? _pos : _pos.line; return { text: this.lines[index] }; }
  getText(range?: any) {
    if (!range) return this.lines.join('\n');
    const start = range.start.line;
    const end = range.end.line;
    return this.lines.slice(start, end + 1).join('\n');
  }
}

function run() {
  // Case 1: Type outside any Sub -> diagnostic
  const doc1 = new MockDocument([
    'Sub Initialize',
    'End Sub',
    'Type MyType',
    '  Field As String',
    'End Type',
  ]);
  // cast via unknown to satisfy structural differences
  const diags1 = findMisplacedTypeRanges(doc1.lines);
  console.log('Diagnostics for doc1:', diags1.length);
  assert.strictEqual(diags1.length, 1, 'Expected 1 diagnostic for Type outside subs');

  // Case 2: Type inside Class_Globals -> no diagnostic
  const doc2 = new MockDocument([
    'Sub Class_Globals',
    '  Type MyType',
    '    Field As String',
    '  End Type',
    'End Sub',
  ]);
  const diags2 = findMisplacedTypeRanges(doc2.lines);
  console.log('Diagnostics for doc2:', diags2.length);
  assert.strictEqual(diags2.length, 0, 'Expected 0 diagnostics for Type inside Class_Globals');

  console.log('All tests passed.');
}

try {
  run();
  process.exit(0);
} catch (err) {
  console.error('Tests failed', err);
  process.exit(1);
}

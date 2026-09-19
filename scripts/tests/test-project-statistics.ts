/**
 * Unit tests for project statistics core logic.
 *
 * Tests: collectStatistics, ModuleStatistics, ProjectStatistics
 */
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
    assert.strictEqual(stats.totalLines, 6); // trailing newline adds empty line
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
    assert.strictEqual(mainModule!.totalLines, 5); // 4 content lines + trailing newline

    const utilsModule = stats.modules.find(m => m.fileName === 'Utils.bas');
    assert.ok(utilsModule);
    assert.strictEqual(utilsModule!.subCount, 1);
    assert.strictEqual(utilsModule!.totalLines, 3); // 2 content lines + trailing newline
  }),

  test('collectStatistics counts comment lines', () => {
    const files = new Map<string, string>([
      ['Main.bas', "' Header comment\nSub Main\n  ' Inline comment\n  Log \"Hello\"\nEnd Sub\n"],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.commentLines, 2);
  }),

  test('collectStatistics handles empty file', () => {
    const files = new Map<string, string>([
      ['Empty.bas', ''],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.totalLines, 1); // empty string splits to ['']
    assert.strictEqual(stats.moduleCount, 1);
  }),

  test('collectStatistics handles Private and Public Sub declarations', () => {
    const files = new Map<string, string>([
      ['Main.bas', 'Private Sub InternalHelper\nEnd Sub\nPublic Sub DoWork\nEnd Sub\n'],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.subCount, 2);
  }),

  test('collectStatistics aggregates across modules', () => {
    const files = new Map<string, string>([
      ['A.bas', 'Sub A1\nEnd Sub\n'],
      ['B.bas', "Sub B1\n  ' comment\n  Log \"hi\"\nEnd Sub\nSub B2\nEnd Sub\n"],
    ]);
    const stats = collectStatistics(files);
    assert.strictEqual(stats.moduleCount, 2);
    assert.strictEqual(stats.subCount, 3);
    assert.strictEqual(stats.totalLines, 10); // 3 + 7 lines (including trailing newlines)
    assert.strictEqual(stats.commentLines, 1);
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
/**
 * Unit tests for unused library diagnostics core logic.
 *
 * Tests: analyzeLibraryUsage, UnusedLibraryResult, LibraryUsageAnalysis
 */
import {
  UnusedLibraryResult,
  LibraryUsageAnalysis,
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
    const used = new Set<string>(['httpjob']); // Only HttpJob is used (lowercase for comparison)
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 1);
    assert.strictEqual(result.unused[0].libraryName, 'StringUtils');
  }),

  test('analyzeLibraryUsage does not flag used library', () => {
    const declared = new Map<string, string[]>([
      ['HTTP', ['HttpJob']],
    ]);
    const used = new Set<string>(['httpjob']);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0);
    assert.strictEqual(result.used.length, 1);
    assert.strictEqual(result.used[0], 'HTTP');
  }),

  test('analyzeLibraryUsage handles empty declarations', () => {
    const declared = new Map<string, string[]>([]);
    const used = new Set<string>(['Anything']);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0);
    assert.strictEqual(result.used.length, 0);
  }),

  test('analyzeLibraryUsage handles empty used types', () => {
    const declared = new Map<string, string[]>([
      ['HTTP', ['HttpJob', 'HttpRequest']],
    ]);
    const used = new Set<string>([]);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 1);
    assert.strictEqual(result.unused[0].libraryName, 'HTTP');
  }),

  test('analyzeLibraryUsage is case-insensitive for type matching', () => {
    const declared = new Map<string, string[]>([
      ['JSON', ['JSONParser']],
    ]);
    const used = new Set<string>(['jsonparser']); // lowercase in the set
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0);
  }),

  test('analyzeLibraryUsage lists exported types in reason', () => {
    const declared = new Map<string, string[]>([
      ['UnusedLib', ['SomeType', 'AnotherType']],
    ]);
    const used = new Set<string>([]);
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 1);
    assert.ok(result.unused[0].reason.includes('SomeType'));
    assert.ok(result.unused[0].reason.includes('AnotherType'));
  }),

  test('analyzeLibraryUsage flags library where only some types are used', () => {
    const declared = new Map<string, string[]>([
      ['Charts', ['Chart', 'PieChart', 'BarChart']],
    ]);
    const used = new Set<string>(['chart']); // Only Chart is used
    const result = analyzeLibraryUsage(declared, used);
    assert.strictEqual(result.unused.length, 0); // Library IS used (at least one type)
    assert.strictEqual(result.used.length, 1);
  }),

  test('analyzeLibraryUsage handles library with no exported types', () => {
    const declared = new Map<string, string[]>([
      ['EmptyLib', []],
    ]);
    const used = new Set<string>(['anything']);
    const result = analyzeLibraryUsage(declared, used);
    // A library with no exported types is considered unused
    assert.strictEqual(result.unused.length, 1);
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
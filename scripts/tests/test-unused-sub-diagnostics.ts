/**
 * Unit tests for unused Sub diagnostics core logic.
 *
 * Tests: isEventHandler, isLifecycleSub, B4X_LIFECYCLE_SUBS,
 *         findUnusedSubs, collectAllKnownEventNames, CallSub awareness,
 *         suppress comment support.
 */
import {
  isEventHandler,
  isLifecycleSub,
  B4X_LIFECYCLE_SUBS,
  SubDeclaration,
  findUnusedSubs,
  collectAllKnownEventNames,
  hasSuppressComment,
} from '../../src/unusedSubDiagnosticsCore';
import assert from 'assert';

function test(name: string, fn: () => void): { name: string; fn: () => void } {
  return { name, fn };
}

// ─── Task 1: Event Handler & Lifecycle Detection ─────────────────────────

const lifecycleAndEventTests = [
  test('isEventHandler detects Click handler', () => {
    assert.strictEqual(isEventHandler('Button1_Click', ['Click']), true);
  }),

  test('isEventHandler detects Tick handler', () => {
    assert.strictEqual(isEventHandler('Timer1_Tick', ['Tick']), true);
  }),

  test('isEventHandler detects ItemClick handler', () => {
    assert.strictEqual(isEventHandler('ListView1_ItemClick', ['ItemClick']), true);
  }),

  test('isEventHandler rejects regular Sub', () => {
    assert.strictEqual(isEventHandler('CalculateTotal', []), false);
  }),

  test('isEventHandler rejects Sub with underscore but unknown event', () => {
    assert.strictEqual(isEventHandler('MyVar_UnknownEvent', []), false);
  }),

  test('isEventHandler uses provided event names', () => {
    assert.strictEqual(isEventHandler('btn_Click', ['Click']), true);
    assert.strictEqual(isEventHandler('btn_Hover', ['Click']), false);
  }),

  test('isLifecycleSub detects Activity_Create', () => {
    assert.strictEqual(isLifecycleSub('Activity_Create'), true);
  }),

  test('isLifecycleSub detects Activity_Resume', () => {
    assert.strictEqual(isLifecycleSub('Activity_Resume'), true);
  }),

  test('isLifecycleSub detects Activity_Pause', () => {
    assert.strictEqual(isLifecycleSub('Activity_Pause'), true);
  }),

  test('isLifecycleSub detects Service_Create', () => {
    assert.strictEqual(isLifecycleSub('Service_Create'), true);
  }),

  test('isLifecycleSub detects Service_Start', () => {
    assert.strictEqual(isLifecycleSub('Service_Start'), true);
  }),

  test('isLifecycleSub detects B4XPage_Created', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Created'), true);
  }),

  test('isLifecycleSub detects B4XPage_Appear', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Appear'), true);
  }),

  test('isLifecycleSub detects B4XPage_Disappear', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Disappear'), true);
  }),

  test('isLifecycleSub detects B4XPage_Resize', () => {
    assert.strictEqual(isLifecycleSub('B4XPage_Resize'), true);
  }),

  test('isLifecycleSub detects Application_Start', () => {
    assert.strictEqual(isLifecycleSub('Application_Start'), true);
  }),

  test('isLifecycleSub detects Class_Globals', () => {
    assert.strictEqual(isLifecycleSub('Class_Globals'), true);
  }),

  test('isLifecycleSub detects Process_Globals', () => {
    assert.strictEqual(isLifecycleSub('Process_Globals'), true);
  }),

  test('isLifecycleSub rejects regular Sub', () => {
    assert.strictEqual(isLifecycleSub('CalculateTotal'), false);
  }),

  test('isLifecycleSub is case-insensitive', () => {
    assert.strictEqual(isLifecycleSub('activity_create'), true);
    assert.strictEqual(isLifecycleSub('B4XPAGE_CREATED'), true);
  }),

  test('B4X_LIFECYCLE_SUBS contains expected entries', () => {
    assert.ok(B4X_LIFECYCLE_SUBS.length >= 10);
  }),
];

// ─── Task 2: Unused Sub Finder ────────────────────────────────────────────

const unusedSubTests = [
  test('findUnusedSubs flags Sub with zero references', () => {
    const subs: SubDeclaration[] = [
      { name: 'CalculateTotal', moduleName: 'Main', line: 10, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'CalculateTotal');
  }),

  test('findUnusedSubs skips Sub with references', () => {
    const subs: SubDeclaration[] = [
      { name: 'CalculateTotal', moduleName: 'Main', line: 10, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Activity_Create\n  CalculateTotal\nEnd Sub\nSub CalculateTotal\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips lifecycle Subs', () => {
    const subs: SubDeclaration[] = [
      { name: 'Activity_Create', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips event handlers', () => {
    const subs: SubDeclaration[] = [
      { name: 'Button1_Click', moduleName: 'Main', line: 20, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, ['Click'], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs skips Subs starting with underscore (B4X internal)', () => {
    const subs: SubDeclaration[] = [
      { name: '_ButtonClick', moduleName: 'Main', line: 30, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], { 'c:\\project\\main.bas': '' });
    assert.strictEqual(result.length, 0);
  }),

  test('findUnusedSubs does not count the Sub definition line', () => {
    const subs: SubDeclaration[] = [
      { name: 'UnusedSub', moduleName: 'Main', line: 3, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' comment\nSub UnusedSub\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'UnusedSub');
  }),

  test('collectAllKnownEventNames merges workspace and library events', () => {
    const workspaceEvents = new Map<string, string[]>([
      ['MyButton', ['Click', 'LongClick']],
    ]);
    const libraryEvents = new Map<string, string[]>([
      ['Timer', ['Tick']],
      ['ListView', ['ItemClick', 'ItemLongClick']],
    ]);
    const result = collectAllKnownEventNames(workspaceEvents, libraryEvents);
    assert.ok(result.includes('Click'));
    assert.ok(result.includes('LongClick'));
    assert.ok(result.includes('Tick'));
    assert.ok(result.includes('ItemClick'));
    assert.ok(result.includes('ItemLongClick'));
  }),

  test('collectAllKnownEventNames deduplicates', () => {
    const workspaceEvents = new Map<string, string[]>([
      ['Btn1', ['Click']],
      ['Btn2', ['Click']],
    ]);
    const libraryEvents = new Map<string, string[]>([]);
    const result = collectAllKnownEventNames(workspaceEvents, libraryEvents);
    const clickCount = result.filter(e => e === 'Click').length;
    assert.strictEqual(clickCount, 1);
  }),
];

// ─── Task 6: CallSub Awareness ────────────────────────────────────────────

const callSubTests = [
  test('CallSub string reference counts as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSub("Main", "DoWork")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('CallSubDelayed string reference counts as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSubDelayed("Main", "DoWork")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('CallSub2 and CallSub3 string references count', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  CallSub2("Main", "DoWork", x)\n  CallSub3("Main", "DoWork", x, y)\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Regular string does NOT count as a reference', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': 'Sub Button1_Click\n  Log("DoWork is great")\nEnd Sub\nSub DoWork\nEnd Sub',
    });
    assert.strictEqual(result.length, 1);
  }),

  test('Commented reference does NOT count', () => {
    const subs: SubDeclaration[] = [
      { name: 'DoWork', moduleName: 'Main', line: 5, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' DoWork\nSub DoWork\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 1);
  }),
];

// ─── Task 8: Suppress Comment Support ────────────────────────────────────

const suppressTests = [
  test('Sub with noinspection comment is not flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'CallbackHandler', moduleName: 'Main', line: 1, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' noinspection UnusedSub\nSub CallbackHandler\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Sub with b4x-unused-sub ignore comment is not flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'CallbackHandler', moduleName: 'Main', line: 1, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "' b4x-unused-sub: ignore\nSub CallbackHandler\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 0);
  }),

  test('Sub without suppress comment IS flagged', () => {
    const subs: SubDeclaration[] = [
      { name: 'UnusedSub', moduleName: 'Main', line: 1, isPrivate: false, filePath: 'c:\\project\\main.bas' },
    ];
    const result = findUnusedSubs(subs, [], [], {
      'c:\\project\\main.bas': "Sub UnusedSub\nEnd Sub\n",
    });
    assert.strictEqual(result.length, 1);
  }),
];

// ─── Run all tests ────────────────────────────────────────────────────────

const allTests = [
  ...lifecycleAndEventTests,
  ...unusedSubTests,
  ...callSubTests,
  ...suppressTests,
];

async function runTests() {
  let passed = 0;
  let failed = 0;
  for (const t of allTests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`FAIL: ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n${passed}/${allTests.length} tests passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
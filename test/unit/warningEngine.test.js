'use strict';
/**
 * Unit tests for b4xWarningEngineCore — the B4X real-time compiler warning engine.
 *
 * Run with:  node ./test/unit/warningEngine.test.js
 * Requires:  npm run compile  (produces dist/src/b4xWarningEngineCore.js)
 */

const assert = require('assert');
const {
  loadPlatformWarnings,
  maskLine,
  formatWarningMessage,
  analyzeModuleWarnings,
  DEFAULT_B4X_WARNINGS,
} = require('../../dist/src/b4xWarningEngineCore');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}${detail ? ' \u2014 ' + detail : ''}`);
    failed++;
  }
}

function getWarnings(lines, id, options = {}) {
  return analyzeModuleWarnings(lines, options).filter(w => w.warningId === id);
}

function expectWarning(label, lines, id, options = {}) {
  const hits = getWarnings(lines, id, options);
  ok(label, hits.length > 0, `Expected Warning #${id} but got none`);
}

function expectClean(label, lines, id, options = {}) {
  const hits = getWarnings(lines, id, options);
  ok(label, hits.length === 0, `Expected no Warning #${id} but got ${hits.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Catalog & Platform Loading
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 1: Catalog & Platform Loading');

{
  const cat = loadPlatformWarnings('b4a');
  ok('B4A catalog has >= 37 rules', cat.size >= 37);
  ok('Warning #1 message contains "Unreachable"', cat.get(1)?.toLowerCase().includes('unreachable'));
  ok('Warning #6 message contains "dip"', cat.get(6)?.includes('dip'));
  ok('Warning #33 message contains "DoEvents"', cat.get(33)?.includes('DoEvents'));
}

{
  const cat = loadPlatformWarnings('b4j');
  ok('B4J catalog has >= 30 rules', cat.size >= 30);
}

{
  const cat = loadPlatformWarnings('b4i');
  ok('B4I catalog has >= 30 rules', cat.size >= 30);
}

{
  ok('DEFAULT_B4X_WARNINGS has 37+ entries', Object.keys(DEFAULT_B4X_WARNINGS).length >= 37);
  ok('DEFAULT_B4X_WARNINGS[19] mentions Catch', DEFAULT_B4X_WARNINGS[19].includes('Catch'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — maskLine utility
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 2: maskLine utility');

{
  const { masked } = maskLine('    Log("hello world")');
  ok('maskLine: string contents replaced with spaces', !masked.includes('hello'));
  ok('maskLine: string delimiters preserved', masked.includes('"'));
}

{
  const { masked, commentStart } = maskLine("    Dim x As Int ' this is a comment");
  ok('maskLine: comment text replaced', !masked.includes('this is'));
  ok('maskLine: commentStart >= 0', commentStart >= 0);
  ok('maskLine: code before comment preserved', masked.includes('Dim'));
}

{
  const { masked } = maskLine('    Msgbox("He said ""hello""", "Title")');
  ok('maskLine: escaped double-quote ("") handled correctly', !masked.includes('hello'));
}

{
  const { masked, commentStart } = maskLine('    Dim x = "not a comment here"');
  ok('maskLine: quote inside string does not start comment', commentStart === -1);
}

{
  const { masked } = maskLine("    Dim s As String = \"it's fine\"");
  ok("maskLine: apostrophe inside string literal not treated as comment", masked.includes('Dim'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — formatWarningMessage utility
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 3: formatWarningMessage');

{
  const msg = formatWarningMessage('Value {0} is missing screen units.', '200');
  ok('Single placeholder replaced', msg === 'Value 200 is missing screen units.');
}

{
  const msg = formatWarningMessage('Sub {0} at line {1}.', 'Compute', '42');
  ok('Two placeholders replaced', msg === 'Sub Compute at line 42.');
}

{
  const msg = formatWarningMessage('No placeholders here.');
  ok('No-placeholder template unchanged', msg === 'No placeholders here.');
}

{
  const msg = formatWarningMessage('{0} and {0} again', 'X');
  ok('Repeated placeholder replaced globally', msg === 'X and X again');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Warning #1: Unreachable code
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 4: Warning #1 \u2014 Unreachable code');

expectWarning('#1: code after Return', [
  'Sub Compute As Int',
  '    Return 42',
  '    Log("never")',
  'End Sub',
], 1);

expectWarning('#1: code after bare Return in middle of Sub', [
  'Sub Process',
  '    Dim x As Int = 1',
  '    Return',
  '    x = 2',
  'End Sub',
], 1);

expectClean('#1: Else after Return is not unreachable', [
  'Sub Branch(cond As Boolean)',
  '    If cond Then',
  '        Return',
  '    Else',
  '        Log("else path")',
  '    End If',
  'End Sub',
], 1);

expectClean('#1: End Sub after Return is not unreachable', [
  'Sub GetNum As Int',
  '    Return 1',
  'End Sub',
], 1);

expectClean('#1: no Return — no unreachable code', [
  'Sub NoReturn',
  '    Log("hello")',
  'End Sub',
], 1);

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Warning #2: Not all code paths return a value
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 5: Warning #2 \u2014 Not all code paths return a value');

expectWarning('#2: typed Sub with no Return', [
  'Sub Calculate(x As Int) As Int',
  '    Log(x)',
  'End Sub',
], 2);

expectClean('#2: typed Sub with Return', [
  'Sub GetDouble(x As Int) As Int',
  '    Return x * 2',
  'End Sub',
], 2);

expectClean('#2: As Void Sub with no Return', [
  'Sub DoWork As Void',
  '    Log("work")',
  'End Sub',
], 2);

expectClean('#2: untyped Sub with no Return', [
  'Sub DoStuff',
  '    Log("hi")',
  'End Sub',
], 2);

expectClean('#2: Process_Globals typed not flagged', [
  'Sub Process_Globals As Int',
  '    Dim x As Int = 0',
  'End Sub',
], 2);

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Warning #3: Return type should be set explicitly
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 6: Warning #3 \u2014 Return type should be set explicitly');

expectWarning('#3: untyped Sub returns a value', [
  'Sub GetTotal',
  '    Return 100',
  'End Sub',
], 3);

expectClean('#3: typed Sub returning value', [
  'Sub GetTotal As Int',
  '    Return 100',
  'End Sub',
], 3);

expectClean('#3: bare Return in untyped Sub', [
  'Sub Exit',
  '    Return',
  'End Sub',
], 3);

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Warning #4: Return value is missing in typed Sub
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 7: Warning #4 \u2014 Return value missing');

expectWarning('#4: typed Sub with bare Return', [
  'Sub Calculate As Int',
  '    Return',
  'End Sub',
], 4);

expectClean('#4: typed Sub with value Return', [
  'Sub Calculate As Int',
  '    Return 42',
  'End Sub',
], 4);

expectClean('#4: untyped Sub with bare Return', [
  'Sub Exit',
  '    Return',
  'End Sub',
], 4);

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — Warning #5: Variable declaration type missing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 8: Warning #5 \u2014 Variable declaration type missing');

expectWarning('#5: bare Dim with no type', [
  'Sub Globals',
  '    Dim myVar',
  'End Sub',
], 5);

expectClean('#5: Dim with As type', [
  'Sub Globals',
  '    Dim myVar As String',
  'End Sub',
], 5);

expectClean('#5: Dim with initialiser', [
  'Sub Globals',
  '    Dim count = 0',
  'End Sub',
], 5);

expectClean('#5: Dim array declaration', [
  'Sub Globals',
  '    Dim arr(10) As Int',
  'End Sub',
], 5);

expectClean('#5: Private with As type', [
  'Sub Class_Globals',
  '    Private mName As String',
  'End Sub',
], 5);

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 — Warning #6: Missing screen units (dip / %x / %y)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 9: Warning #6 \u2014 Missing screen units');

for (const prop of ['Width', 'Height', 'Left', 'Top']) {
  expectWarning(`#6: raw number on .${prop}`, [
    'Sub CreateUI',
    `    btn.${prop} = 100`,
    'End Sub',
  ], 6);
}

expectClean('#6: value with dip', [
  'Sub CreateUI',
  '    btn.Width = 100dip',
  'End Sub',
], 6);

expectClean('#6: value with %x', [
  'Sub CreateUI',
  '    btn.Width = 50%x',
  'End Sub',
], 6);

expectClean('#6: value with %y', [
  'Sub CreateUI',
  '    btn.Height = 30%y',
  'End Sub',
], 6);

expectClean('#6: variable assignment — no raw literal', [
  'Sub CreateUI',
  '    btn.Width = myWidth',
  'End Sub',
], 6);

{
  const warnings = getWarnings([
    'Sub CreateUI',
    '    btn.Width = 200',
    'End Sub',
  ], 6);
  ok('#6: reported on line 1 (0-indexed)', warnings.length > 0 && warnings[0].line === 1);
  ok('#6: startCol points at or after the equals sign', warnings.length > 0 && warnings[0].startCol >= 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 10 — Warning #18: TextSize should not be scaled
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 10: Warning #18 \u2014 TextSize should not be scaled');

expectWarning('#18: TextSize = 16dip', [
  'Sub SetFont',
  '    lbl.TextSize = 16dip',
  'End Sub',
], 18);

expectWarning('#18: TextSize = x * 1dip', [
  'Sub SetFont',
  '    lbl.TextSize = 14 * 1dip',
  'End Sub',
], 18);

expectClean('#18: TextSize = 16 (plain, no scaling)', [
  'Sub SetFont',
  '    lbl.TextSize = 16',
  'End Sub',
], 18);

expectClean('#18: TextSize in comment not flagged', [
  'Sub SetFont',
  "    ' lbl.TextSize = 16dip",
  'End Sub',
], 18);

// ─────────────────────────────────────────────────────────────────────────────
// Section 11 — Warning #19: Empty Catch block
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 11: Warning #19 \u2014 Empty Catch block');

expectWarning('#19: Catch immediately followed by End Try', [
  'Sub RiskyOp',
  '    Try',
  '        Dim x As Int = 1 / 0',
  '    Catch',
  '    End Try',
  'End Sub',
], 19);

expectClean('#19: Catch with Log statement', [
  'Sub RiskyOp',
  '    Try',
  '        Dim x As Int = 1 / 0',
  '    Catch',
  '        Log(LastException.Message)',
  '    End Try',
  'End Sub',
], 19);

expectClean('#19: Catch with blank line then Log', [
  'Sub RiskyOp',
  '    Try',
  '        Dim x As Int = 1 / 0',
  '    Catch',
  '',
  '        Log(LastException.Message)',
  '    End Try',
  'End Sub',
], 19);

// ─────────────────────────────────────────────────────────────────────────────
// Section 12 — Warning #23: Dialogs in Activity_Pause
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 12: Warning #23 \u2014 Dialogs in Activity_Pause');

for (const dialog of ['Msgbox', 'MsgboxAsync', 'InputList', 'InputMultiList']) {
  expectWarning(`#23: ${dialog} in Activity_Pause`, [
    'Sub Activity_Pause(UserClosed As Boolean)',
    `    ${dialog}("msg", "title")`,
    'End Sub',
  ], 23);
}

expectClean('#23: dialog in normal Sub not flagged', [
  'Sub ShowSomething',
  '    Msgbox("hi", "title")',
  'End Sub',
], 23);

expectClean('#23: Log in Activity_Pause is fine', [
  'Sub Activity_Pause(UserClosed As Boolean)',
  '    Log("paused")',
  'End Sub',
], 23);

// ─────────────────────────────────────────────────────────────────────────────
// Section 13 — Warning #24: Cross-module access in Process_Globals
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 13: Warning #24 \u2014 Cross-module access in Process_Globals');

expectWarning('#24: Module.Field accessed in Process_Globals', [
  'Sub Process_Globals',
  '    Dim x As String = OtherModule.Config',
  'End Sub',
], 24, { moduleName: 'Main', projectModules: ['Main', 'OtherModule'] });

expectClean('#24: self-module access not flagged', [
  'Sub Process_Globals',
  '    Dim x As String = Main.Config',
  'End Sub',
], 24, { moduleName: 'Main', projectModules: ['Main', 'OtherModule'] });

expectClean('#24: cross-module access in normal Sub is fine', [
  'Sub Initialize',
  '    Dim x As String = OtherModule.Config',
  'End Sub',
], 24, { moduleName: 'Main', projectModules: ['Main', 'OtherModule'] });

// ─────────────────────────────────────────────────────────────────────────────
// Section 14 — Warning #28: Deprecated Theme.Holo
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 14: Warning #28 \u2014 Deprecated Theme.Holo');

expectWarning('#28: Theme.Holo in manifest attribute', [
  'SetApplicationAttribute(android:theme, "@android:style/Theme.Holo")',
], 28);

expectWarning('#28: Theme.Holo.Light variant', [
  "SetApplicationAttribute(android:theme, '@android:style/Theme.Holo.Light')",
], 28);

expectClean('#28: custom theme not flagged', [
  'SetApplicationAttribute(android:theme, "@style/AppTheme")',
], 28);

// ─────────────────────────────────────────────────────────────────────────────
// Section 15 — Warning #30: Variable shadows module name
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 15: Warning #30 \u2014 Variable shadows module name');

expectWarning('#30: Dim with same name as project module', [
  'Sub Process_Globals',
  '    Dim B4XPageHome As String',
  'End Sub',
], 30, { moduleName: 'Main', projectModules: ['Main', 'B4XPageHome', 'DaisyState'] });

expectClean('#30: variable name not a module', [
  'Sub Process_Globals',
  '    Dim userName As String',
  'End Sub',
], 30, { moduleName: 'Main', projectModules: ['Main', 'B4XPageHome'] });

expectClean('#30: Dim of own module name not flagged', [
  'Sub Process_Globals',
  '    Dim Main As String',
  'End Sub',
], 30, { moduleName: 'Main', projectModules: ['Main', 'B4XPageHome'] });

// ─────────────────────────────────────────────────────────────────────────────
// Section 16 — Warning #33: DoEvents deprecated (B4A only)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 16: Warning #33 \u2014 DoEvents deprecated');

expectWarning('#33: DoEvents in B4A Sub', [
  'Sub LongTask',
  '    DoEvents',
  'End Sub',
], 33, { platform: 'b4a' });

expectClean('#33: DoEvents NOT flagged on B4J', [
  'Sub LongTask',
  '    DoEvents',
  'End Sub',
], 33, { platform: 'b4j' });

expectClean('#33: Sleep(0) not flagged', [
  'Sub LongTask',
  '    Sleep(0)',
  'End Sub',
], 33, { platform: 'b4a' });

expectClean('#33: DoEvents in comment not flagged', [
  'Sub LongTask',
  "    ' Use DoEvents to yield",
  'End Sub',
], 33, { platform: 'b4a' });

// ─────────────────────────────────────────────────────────────────────────────
// Section 17 — Warning #34: Msgbox deprecated (B4A only)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 17: Warning #34 \u2014 Msgbox deprecated');

expectWarning('#34: Msgbox() in B4A', [
  'Sub ShowAlert',
  '    Msgbox("Alert", "Title")',
  'End Sub',
], 34, { platform: 'b4a' });

expectClean('#34: MsgboxAsync() not flagged', [
  'Sub ShowAlert',
  '    MsgboxAsync("Alert", "Title")',
  'End Sub',
], 34, { platform: 'b4a' });

expectClean('#34: Msgbox NOT flagged on B4J', [
  'Sub ShowAlert',
  '    Msgbox("Alert", "Title")',
  'End Sub',
], 34, { platform: 'b4j' });

expectClean('#34: Msgbox in comment not flagged', [
  'Sub ShowAlert',
  "    ' Msgbox(\"Alert\", \"Title\")",
  'End Sub',
], 34, { platform: 'b4a' });

// ─────────────────────────────────────────────────────────────────────────────
// Section 18 — Warning #37: Starter service in B4XPages
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 18: Warning #37 \u2014 Starter service in B4XPages');

expectWarning('#37: Starter module in B4XPages project', [
  '#Region  Service Attributes',
  '    #StartAtBoot: False',
  '#End Region',
  'Sub Process_Globals',
  'End Sub',
], 37, { isB4XPages: true, moduleName: 'Starter' });

expectClean('#37: Starter but NOT a B4XPages project', [
  '#Region  Service Attributes',
  '#End Region',
  'Sub Process_Globals',
  'End Sub',
], 37, { isB4XPages: false, moduleName: 'Starter' });

expectClean('#37: B4XPages but not the Starter module', [
  '#Region  Service Attributes',
  '#End Region',
  'Sub Process_Globals',
  'End Sub',
], 37, { isB4XPages: true, moduleName: 'B4XMain' });

// ─────────────────────────────────────────────────────────────────────────────
// Section 19 — Suppression mechanisms
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\u25a0 Section 19: Suppression mechanisms");

expectClean("#19a: inline 'ignore suppresses #6", [
  'Sub CreateUI',
  "    btn.Width = 200 'ignore",
  'End Sub',
], 6);

expectClean('#19b: #IgnoreWarnings: 33 suppresses DoEvents', [
  '#IgnoreWarnings: 33',
  'Sub LongTask',
  '    DoEvents',
  'End Sub',
], 33, { platform: 'b4a' });

expectClean('#19c: #IgnoreWarnings: 19, 33 suppresses both IDs', [
  '#IgnoreWarnings: 19, 33',
  'Sub LongTask',
  '    DoEvents',
  'End Sub',
], 33, { platform: 'b4a' });

expectWarning('#19d: non-suppressed warning still fires alongside suppressed one', [
  '#IgnoreWarnings: 33',
  'Sub CreateUI',
  '    btn.Width = 200',
  'End Sub',
], 6);

expectClean('#19e: #ignorewARNINGS case-insensitive', [
  '#ignorewARNINGS: 34',
  'Sub ShowAlert',
  '    Msgbox("Alert", "Title")',
  'End Sub',
], 34, { platform: 'b4a' });

{
  // Multiple #IgnoreWarnings directives merged
  const items = analyzeModuleWarnings([
    '#IgnoreWarnings: 6',
    '#IgnoreWarnings: 33',
    'Sub DoWork',
    '    DoEvents',
    '    btn.Width = 100',
    'End Sub',
  ], { platform: 'b4a' });
  ok('#19f: multiple #IgnoreWarnings lines — #6 suppressed', items.filter(w => w.warningId === 6).length === 0);
  ok('#19f: multiple #IgnoreWarnings lines — #33 suppressed', items.filter(w => w.warningId === 33).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 20 — Multiple warnings in a single file
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 20: Multiple warnings in one file');

{
  const lines = [
    'Sub Process_Globals',
    '    Dim x',               // #5
    'End Sub',
    'Sub CreateUI',
    '    btn.Width = 100',     // #6
    '    btn.Height = 200',    // #6 (second)
    '    DoEvents',            // #33 (B4A only)
    'End Sub',
  ];
  const all = analyzeModuleWarnings(lines, { platform: 'b4a' });
  const ids = all.map(w => w.warningId);
  ok('Multiple: #5 present', ids.includes(5));
  ok('Multiple: #6 present', ids.includes(6));
  ok('Multiple: #33 present', ids.includes(33));
  ok('Multiple: at least one #6 entry', all.filter(w => w.warningId === 6).length >= 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 21 — Scope boundary accuracy
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 21: Scope boundary accuracy');

{
  const warnings = analyzeModuleWarnings([
    'Sub DoWork',
    '    Log("no return needed")',
    'End Sub',
    'Sub Calculate As Int',
    '    Log("no return")',
    'End Sub',
  ]);
  const w2 = warnings.filter(w => w.warningId === 2);
  ok('Scope: #2 fires for typed Sub but not for preceding untyped Sub', w2.length === 1);
  ok('Scope: #2 reported on End Sub of second Sub (line 5, 0-indexed)', w2[0]?.line === 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 22 — Diagnostic message format & suggestedFix
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 22: Diagnostic message format & suggestedFix');

{
  const items = analyzeModuleWarnings([
    'Sub CreateUI',
    '    btn.Width = 100',
    'End Sub',
  ]);
  const w6 = items.find(w => w.warningId === 6);
  ok('#6: message starts with [Warning #6]', w6?.message.startsWith('[Warning #6]') === true);
  ok('#6: message contains the numeric value "100"', w6?.message.includes('100') === true);
  ok('#6: severity is "warning"', w6?.severity === 'warning');
  ok('#6: suggestedFix title present', typeof w6?.suggestedFix?.title === 'string');
  ok('#6: suggestedFix replacement contains "dip"', w6?.suggestedFix?.replacement.includes('dip') === true);
}

{
  const items = analyzeModuleWarnings([
    'Sub Globals',
    '    Dim myVar',
    'End Sub',
  ]);
  const w5 = items.find(w => w.warningId === 5);
  ok('#5: suggestedFix contains "As String"', w5?.suggestedFix?.replacement.includes('As String') === true);
}

{
  const items = analyzeModuleWarnings([
    'Sub LongTask',
    '    DoEvents',
    'End Sub',
  ], { platform: 'b4a' });
  const w33 = items.find(w => w.warningId === 33);
  ok('#33: suggestedFix replacement is Sleep(0)', w33?.suggestedFix?.replacement === 'Sleep(0)');
}

{
  const items = analyzeModuleWarnings([
    'Sub ShowAlert',
    '    Msgbox("hello", "hi")',
    'End Sub',
  ], { platform: 'b4a' });
  const w34 = items.find(w => w.warningId === 34);
  ok('#34: suggestedFix replacement is MsgboxAsync', w34?.suggestedFix?.replacement === 'MsgboxAsync');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 23 — Edge cases & robustness
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\u25a0 Section 23: Edge cases & robustness');

{
  const items = analyzeModuleWarnings([]);
  ok('Empty file produces no warnings', items.length === 0);
}

{
  const items = analyzeModuleWarnings(['', '', '']);
  ok('Blank-only file produces no warnings', items.length === 0);
}

{
  const items = analyzeModuleWarnings([
    'Sub DoWork',
    "    ' just a comment",
    'End Sub',
  ]);
  ok('Sub with only comments — no spurious #1', items.every(w => w.warningId !== 1));
}

{
  // "End Sub" inside a string literal must not close the Sub scope
  const items = analyzeModuleWarnings([
    'Sub Serialize As String',
    '    Return "End Sub"',
    'End Sub',
  ]);
  ok('"End Sub" inside string literal not treated as scope end', items.every(w => w.warningId !== 1));
}

{
  // DoEvents inside a string literal
  const items = analyzeModuleWarnings([
    'Sub Explain',
    '    Log("DoEvents is deprecated")',
    'End Sub',
  ], { platform: 'b4a' });
  ok('DoEvents inside string literal not flagged as #33', items.every(w => w.warningId !== 33));
}

{
  // Msgbox inside a string literal
  const items = analyzeModuleWarnings([
    'Sub Describe',
    '    Log("Use Msgbox to show dialogs")',
    'End Sub',
  ], { platform: 'b4a' });
  ok('Msgbox inside string literal not flagged as #34', items.every(w => w.warningId !== 34));
}

{
  // Case-insensitive Sub/End Sub matching
  const items = analyzeModuleWarnings([
    'sub calculate as int',
    '    log("no return")',
    'end sub',
  ]);
  const w2 = items.filter(w => w.warningId === 2);
  ok('Case-insensitive: lowercase sub/end sub tracked', w2.length >= 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(60)}`);
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'─'.repeat(60)}`);

if (failed > 0) {
  console.error(`\n  ${failed} test(s) FAILED\n`);
  process.exit(1);
} else {
  console.log('\n  All warning engine tests passed! \u2713\n');
}

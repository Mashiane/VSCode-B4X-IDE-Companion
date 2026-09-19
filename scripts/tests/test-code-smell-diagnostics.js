const assert = require('assert');
const { findCodeSmells } = require('../../dist/src/codeSmellDiagnosticsCore');

function run() {
  console.log('Testing B4X Code Smells & Features to Avoid diagnostics...');

  // Test 1: B4X-CS001 DoEvents
  const diags1 = findCodeSmells([
    'Sub Process_Globals',
    'End Sub',
    'Sub MySub',
    '  DoEvents',
    'End Sub',
  ]);
  assert.strictEqual(diags1.length, 1, 'Expected 1 diagnostic for DoEvents');
  assert.strictEqual(diags1[0].ruleId, 'B4X-CS001');

  // Test 2: B4X-CS002 Msgbox vs MsgboxAsync
  const diags2 = findCodeSmells([
    'Sub MySub',
    '  Msgbox("Hello", "Title")',
    '  MsgboxAsync("Safe", "Title")',
    'End Sub',
  ]);
  assert.strictEqual(diags2.length, 1, 'Expected 1 diagnostic for synchronous Msgbox');
  assert.strictEqual(diags2[0].ruleId, 'B4X-CS002');

  // Test 3: B4X-CS003 Map.GetKeyAt / Map.GetValueAt
  const diags3 = findCodeSmells([
    'Sub MySub',
    '  Dim k As String = MyMap.GetKeyAt(0)',
    '  Dim v As Object = MyMap.GetValueAt(0)',
    'End Sub',
  ]);
  assert.strictEqual(diags3.length, 2, 'Expected 2 diagnostics for GetKeyAt / GetValueAt');
  assert.strictEqual(diags3[0].ruleId, 'B4X-CS003');
  assert.strictEqual(diags3[1].ruleId, 'B4X-CS003');

  // Test 4: B4X-CS004 File.DirDefaultExternal
  const diags4 = findCodeSmells([
    'Sub MySub',
    '  Dim path As String = File.Combine(File.DirDefaultExternal, "data.txt")',
    'End Sub',
  ]);
  assert.strictEqual(diags4.length, 1, 'Expected 1 diagnostic for File.DirDefaultExternal');
  assert.strictEqual(diags4[0].ruleId, 'B4X-CS004');

  // Test 5: B4X-CS005 File.DirRootExternal
  const diags5 = findCodeSmells([
    'Sub MySub',
    '  Dim path As String = File.DirRootExternal',
    'End Sub',
  ]);
  assert.strictEqual(diags5.length, 1, 'Expected 1 diagnostic for File.DirRootExternal');
  assert.strictEqual(diags5[0].ruleId, 'B4X-CS005');

  // Test 6: B4X-CS006 SQL concatenation
  const diags6 = findCodeSmells([
    'Sub MySub',
    '  SQL.ExecNonQuery("INSERT INTO t VALUES (\' " & name & " \')")',
    '  SQL.ExecNonQuery2("INSERT INTO t VALUES (?)", Array(name))',
    'End Sub',
  ]);
  assert.strictEqual(diags6.length, 1, 'Expected 1 diagnostic for non-parameterized SQL query');
  assert.strictEqual(diags6[0].ruleId, 'B4X-CS006');

  // Test 7: B4X-CS007 Cursor
  const diags7 = findCodeSmells([
    'Sub MySub',
    '  Dim c As Cursor',
    '  Dim rs As ResultSet',
    'End Sub',
  ]);
  assert.strictEqual(diags7.length, 1, 'Expected 1 diagnostic for Cursor');
  assert.strictEqual(diags7[0].ruleId, 'B4X-CS007');

  // Test 8: B4X-CS008 Redundant initialization
  const diags8 = findCodeSmells([
    'Sub MySub',
    '  List1.Initialize',
    '  List1 = SomeOtherList',
    'End Sub',
  ]);
  assert.strictEqual(diags8.length, 1, 'Expected 1 diagnostic for redundant initialization');
  assert.strictEqual(diags8[0].ruleId, 'B4X-CS008');

  // Test 9: B4X-CS009 Redundant boolean logic
  const diags9 = findCodeSmells([
    'Sub MySub',
    '  If x = True Then Return True Else Return False',
    'End Sub',
  ]);
  assert.strictEqual(diags9.length, 1, 'Expected 1 diagnostic for redundant boolean return');
  assert.strictEqual(diags9[0].ruleId, 'B4X-CS009');

  // Test 10: Comments and string literals should NOT trigger false positives
  const diags10 = findCodeSmells([
    'Sub MySub',
    "  ' DoEvents is bad",
    "  ' File.DirDefaultExternal comment",
    '  Dim s As String = "DoEvents inside string"',
    '  Dim msg As String = "File.DirDefaultExternal inside string"',
    'End Sub',
  ]);
  assert.strictEqual(diags10.length, 0, 'Comments and strings must not trigger false positives');

  // Test 11: B4X-CS011 ListView / TableView
  const diags11 = findCodeSmells([
    'Sub MySub',
    '  Dim lv As ListView',
    '  Dim tv As TableView',
    'End Sub',
  ]);
  assert.strictEqual(diags11.length, 2, 'Expected 2 diagnostics for ListView and TableView');
  assert.strictEqual(diags11[0].ruleId, 'B4X-CS011');
  assert.strictEqual(diags11[1].ruleId, 'B4X-CS011');

  // Test 12: B4X-CS012 ExecQuerySingleResult
  const diags12 = findCodeSmells([
    'Sub MySub',
    '  Dim res As String = SQL.ExecQuerySingleResult("SELECT name FROM t WHERE id = 1")',
    'End Sub',
  ]);
  assert.strictEqual(diags12.length, 1, 'Expected 1 diagnostic for ExecQuerySingleResult');
  assert.strictEqual(diags12[0].ruleId, 'B4X-CS012');

  // Test 13: B4X-CS013 StartServiceAt / StartServiceAtExact
  const diags13 = findCodeSmells([
    'Sub MySub',
    '  StartServiceAt("", DateTime.Now + 1000, True)',
    '  StartServiceAtExact("", DateTime.Now + 1000, True)',
    'End Sub',
  ]);
  assert.strictEqual(diags13.length, 2, 'Expected 2 diagnostics for StartServiceAt');
  assert.strictEqual(diags13[0].ruleId, 'B4X-CS013');
  assert.strictEqual(diags13[1].ruleId, 'B4X-CS013');

  // Test 14: B4X-CS014 VideoView
  const diags14 = findCodeSmells([
    'Sub MySub',
    '  Dim vv As VideoView',
    'End Sub',
  ]);
  assert.strictEqual(diags14.length, 1, 'Expected 1 diagnostic for VideoView');
  assert.strictEqual(diags14[0].ruleId, 'B4X-CS014');

  // Test 15: B4X-CS015 Sub JobDone
  const diags15 = findCodeSmells([
    'Sub JobDone(Job As HttpJob)',
    '  If Job.Success Then',
    '  End If',
    'End Sub',
  ]);
  assert.strictEqual(diags15.length, 1, 'Expected 1 diagnostic for Sub JobDone');
  assert.strictEqual(diags15[0].ruleId, 'B4X-CS015');

  // Test 16: B4X-CS016 Round2
  const diags16 = findCodeSmells([
    'Sub MySub',
    '  Dim r As Double = Round2(12.3456, 2)',
    'End Sub',
  ]);
  assert.strictEqual(diags16.length, 1, 'Expected 1 diagnostic for Round2');
  assert.strictEqual(diags16[0].ruleId, 'B4X-CS016');

  // Test 17: B4X-CS017 TextReader / TextWriter
  const diags17 = findCodeSmells([
    'Sub MySub',
    '  Dim tr As TextReader',
    '  Dim tw As TextWriter',
    'End Sub',
  ]);
  assert.strictEqual(diags17.length, 2, 'Expected 2 diagnostics for TextReader and TextWriter');
  assert.strictEqual(diags17[0].ruleId, 'B4X-CS017');
  assert.strictEqual(diags17[1].ruleId, 'B4X-CS017');

  // Test 18: B4X-CS018 BANanoElement .IsInitialized
  const diags18 = findCodeSmells([
    'Sub Class_Globals',
    '  Private mElement As BANanoElement',
    'End Sub',
    'Sub Destroy',
    '  If mElement.IsInitialized Then',
    '    mElement.Remove',
    '  End If',
    'End Sub',
  ]);
  assert.strictEqual(diags18.length, 1, 'Expected 1 diagnostic for BANanoElement .IsInitialized');
  assert.strictEqual(diags18[0].ruleId, 'B4X-CS018');

  // Test 19: B4X-CS019 SmartString doubled quotes
  const diags19 = findCodeSmells([
    'Sub RenderHtml',
    '  Dim s As String = $\"<div class=\"\"sk-card\"\">\"$\\'.slice(0, -1),
    'End Sub',
  ]);
  assert.strictEqual(diags19.length, 2, 'Expected 2 diagnostics for SmartString doubled quotes');
  assert.strictEqual(diags19[0].ruleId, 'B4X-CS019');

  // Test 20: B4X-CS020 ABMaterial missing BuildGrid
  const diags20 = findCodeSmells([
    'Sub Initialize',
    '  page.InitializeWithTheme("page", "/ws/app/page", False, 0, theme)',
    '  page.AddRowsM(2, False, 10, 0, "").AddCells12(1, "")',
    'End Sub',
  ]);
  assert.strictEqual(diags20.length, 1, 'Expected 1 diagnostic for ABM missing BuildGrid');
  assert.strictEqual(diags20[0].ruleId, 'B4X-CS020');

  // Test 21: B4X-CS021 BANano.Header.Append with <style>
  const diags21 = findCodeSmells([
    'Sub Initialize',
    '  BANano.Header.Append("<style>.card{color:red;}</style>")',
    'End Sub',
  ]);
  assert.strictEqual(diags21.length, 1, 'Expected 1 diagnostic for BANano.Header.Append <style>');
  assert.strictEqual(diags21[0].ruleId, 'B4X-CS021');

  // Test 22: B4X-CS022 Unguarded CallSub
  const diags22 = findCodeSmells([
    'Sub Clicked',
    '  CallSub(mCallBack, "btn_Click")',
    'End Sub',
  ]);
  assert.strictEqual(diags22.length, 1, 'Expected 1 diagnostic for unguarded CallSub');
  assert.strictEqual(diags22[0].ruleId, 'B4X-CS022');

  console.log('PASS: All 22 B4X Code Smell, BANano & ABMaterial diagnostic tests passed successfully!');
}

try {
  run();
  process.exit(0);
} catch (err) {
  console.error('Code smell tests failed:', err);
  process.exit(1);
}

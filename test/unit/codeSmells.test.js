const assert = require('assert');
// Load the compiled JavaScript output from dist
const { findCodeSmells } = require('../../dist/src/codeSmellDiagnosticsCore');

console.log('--- Running B4X Code Smell Diagnostics Tests ---');

function testRule(name, lines, expectedRuleId, shouldFind = true) {
  const items = findCodeSmells(lines);
  const found = items.some(item => item.ruleId === expectedRuleId);
  if (shouldFind) {
    assert.strictEqual(found, true, `Expected rule ${expectedRuleId} in ${name}`);
  } else {
    assert.strictEqual(found, false, `Did not expect rule ${expectedRuleId} in ${name}`);
  }
  console.log(`  ✓ ${name} passed`);
}

// B4X-CS001: DoEvents
testRule('B4X-CS001: DoEvents detected', [
  'Sub SomeLoop',
  '    DoEvents',
  'End Sub'
], 'B4X-CS001');

// B4X-CS002: Synchronous Msgbox
testRule('B4X-CS002: Msgbox detected', [
  'Sub ShowAlert',
  '    Msgbox("Hello", "Title")',
  'End Sub'
], 'B4X-CS002');

// B4X-CS002: MsgboxAsync should NOT trigger
testRule('B4X-CS002: MsgboxAsync clean', [
  'Sub ShowAlert',
  '    MsgboxAsync("Hello", "Title")',
  'End Sub'
], 'B4X-CS002', false);

// B4X-CS018: BANanoElement .IsInitialized
testRule('B4X-CS018: BANanoElement .IsInitialized detected', [
  'Sub Class_Globals',
  '    Private mElement As BANanoElement',
  'End Sub',
  'Public Sub Clean',
  '    If mElement.IsInitialized Then',
  '        mElement.Remove',
  '    End If',
  'End Sub'
], 'B4X-CS018');

// B4X-CS018: BANanoElement <> Null should NOT trigger
testRule('B4X-CS018: BANanoElement <> Null clean', [
  'Sub Class_Globals',
  '    Private mElement As BANanoElement',
  'End Sub',
  'Public Sub Clean',
  '    If mElement <> Null Then',
  '        mElement.Remove',
  '    End If',
  'End Sub'
], 'B4X-CS018', false);

// B4X-CS019: SmartString doubled quotes
testRule('B4X-CS019: SmartString doubled quotes detected', [
  'Sub MakeHtml As String',
  '    Dim s As String = $"<div class=""card"">"$',
  '    Return s',
  'End Sub'
], 'B4X-CS019');

// B4X-CS019: SmartString single quotes should NOT trigger
testRule('B4X-CS019: SmartString single quotes clean', [
  'Sub MakeHtml As String',
  '    Dim s As String = $"<div class="card">"$',
  '    Return s',
  'End Sub'
], 'B4X-CS019', false);

// B4X-CS020: ABMaterial missing BuildGrid
testRule('B4X-CS020: ABM missing BuildGrid detected', [
  'Sub Initialize',
  '    page.InitializeWithTheme("page", "/ws/app/page", False, 0, theme)',
  '    page.AddRowsM(2, False, 10, 0, "").AddCells12(1, "")',
  'End Sub'
], 'B4X-CS020');

// B4X-CS020: ABMaterial with BuildGrid should NOT trigger
testRule('B4X-CS020: ABM with BuildGrid clean', [
  'Sub Initialize',
  '    page.InitializeWithTheme("page", "/ws/app/page", False, 0, theme)',
  '    page.AddRowsM(2, False, 10, 0, "").AddCells12(1, "")',
  '    page.BuildGrid',
  'End Sub'
], 'B4X-CS020', false);

// B4X-CS021: BANano.Header.Append with <style>
testRule('B4X-CS021: BANano.Header.Append <style> detected', [
  'Sub Class_Globals',
  'End Sub',
  'Public Sub Init',
  '    BANano.Header.Append("<style>.sk-btn { border-radius: 4px; }</style>")',
  'End Sub'
], 'B4X-CS021');

// B4X-CS022: Unguarded CallSub
testRule('B4X-CS022: Unguarded CallSub detected', [
  'Sub TriggerClick',
  '    CallSub(mCallBack, "btn_Click")',
  'End Sub'
], 'B4X-CS022');

// B4X-CS022: Guarded CallSub should NOT trigger
testRule('B4X-CS022: Guarded CallSub with SubExists clean', [
  'Sub TriggerClick',
  '    If SubExists(mCallBack, "btn_Click") Then',
  '        CallSub(mCallBack, "btn_Click")',
  '    End If',
  'End Sub'
], 'B4X-CS022', false);

// B4X-CS023: CustomView missing DesignerCreateView
testRule('B4X-CS023: Missing DesignerCreateView detected', [
  '#DesignerProperty: Key: Text, DisplayName: Text, FieldType: String, DefaultValue: Hello',
  'Sub Class_Globals',
  '    Private mBase As B4XView',
  'End Sub',
  'Public Sub Base_Resize(Width As Double, Height As Double)',
  'End Sub'
], 'B4X-CS023');

// B4X-CS023: CustomView with DesignerCreateView clean
testRule('B4X-CS023: Present DesignerCreateView clean', [
  '#DesignerProperty: Key: Text, DisplayName: Text, FieldType: String, DefaultValue: Hello',
  'Sub Class_Globals',
  '    Private mBase As B4XView',
  'End Sub',
  'Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)',
  'End Sub',
  'Public Sub Base_Resize(Width As Double, Height As Double)',
  'End Sub'
], 'B4X-CS023', false);

// B4X-CS024: CustomView missing Base_Resize
testRule('B4X-CS024: Missing Base_Resize detected', [
  '#DesignerProperty: Key: Text, DisplayName: Text, FieldType: String, DefaultValue: Hello',
  'Sub Class_Globals',
  '    Private mBase As B4XView',
  'End Sub',
  'Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)',
  'End Sub'
], 'B4X-CS024');

// B4X-CS025: Designer color read without PaintOrColorToColor
testRule('B4X-CS025: Unsafe color read detected', [
  '#DesignerProperty: Key: CardColor, DisplayName: Card Color, FieldType: Color, DefaultValue: 0xFFFFFFFF',
  'Sub Class_Globals',
  '    Private mBase As B4XView',
  '    Private mCardColor As Int',
  'End Sub',
  'Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)',
  '    mCardColor = Props.GetDefault("CardColor", 0xFFFFFFFF)',
  'End Sub'
], 'B4X-CS025');

// B4X-CS025: Designer color read with PaintOrColorToColor clean
testRule('B4X-CS025: Safe color read clean', [
  '#DesignerProperty: Key: CardColor, DisplayName: Card Color, FieldType: Color, DefaultValue: 0xFFFFFFFF',
  'Sub Class_Globals',
  '    Private mBase As B4XView',
  '    Private mCardColor As Int',
  '    Private xui As XUI',
  'End Sub',
  'Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)',
  '    mCardColor = xui.PaintOrColorToColor(Props.GetDefault("CardColor", 0xFFFFFFFF))',
  'End Sub'
], 'B4X-CS025', false);

// B4X-CS026: Duplicate key in #DesignerProperty
testRule('B4X-CS026: Duplicate DesignerProperty key detected', [
  '#DesignerProperty: Key: Header, DisplayName: Header 1, FieldType: String, DefaultValue: ""',
  '#DesignerProperty: Key: Header, DisplayName: Header 2, FieldType: String, DefaultValue: ""'
], 'B4X-CS026');

// B4X-CS026: Invalid FieldType in #DesignerProperty
testRule('B4X-CS026: Invalid FieldType detected', [
  '#DesignerProperty: Key: Header, DisplayName: Header, FieldType: CustomObject, DefaultValue: ""'
], 'B4X-CS026');

// B4X-CS027: Malformed #Event
testRule('B4X-CS027: Malformed #Event detected', [
  '#Event: '
], 'B4X-CS027');

// B4X-CS028: Missing mBase in CustomView
testRule('B4X-CS028: Missing mBase As B4XView detected', [
  '#DesignerProperty: Key: Text, DisplayName: Text, FieldType: String, DefaultValue: ""',
  'Sub Class_Globals',
  '    Private someVar As Int',
  'End Sub',
  'Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)',
  'End Sub'
], 'B4X-CS028');

// B4X-CS029: Deprecated Starter service
testRule('B4X-CS029: Deprecated Starter service detected', [
  '#Region Starter Service Attributes',
  '    #StartAtBoot: False',
  '#End Region',
  'Sub Service_Create',
  '    Log("Starter initialized")',
  'End Sub'
], 'B4X-CS029');

// B4X-CS030: Legacy Activity lifecycle in B4XPages
testRule('B4X-CS030: Activity_Create in B4XPages detected', [
  'Sub Class_Globals',
  '    Private Root As B4XView',
  'End Sub',
  'Public Sub Initialize As Object',
  '    Return Me',
  'End Sub',
  'Private Sub B4XPage_Created (Root1 As B4XView)',
  '    Root = Root1',
  'End Sub',
  'Sub Activity_Resume',
  '    Log("Resumed")',
  'End Sub'
], 'B4X-CS030');

console.log('\nAll Code Smell tests passed successfully!\n');

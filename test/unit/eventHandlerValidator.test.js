const assert = require('assert');
const { validateEventHandlers, DEFAULT_CORE_EVENT_SIGNATURES } = require('../../dist/src/eventHandlerValidatorCore');

console.log('--- Running B4X Event Handler Validator Tests ---');

function testEventValidation(name, lines, expectMismatch = true, ruleId = 'B4X-EV001') {
  const items = validateEventHandlers(lines);
  const found = items.some(item => item.ruleId === ruleId);
  if (expectMismatch) {
    assert.strictEqual(found, true, `Expected mismatch ${ruleId} in ${name}`);
  } else {
    assert.strictEqual(found, false, `Did not expect mismatch in ${name}`);
  }
  console.log(`  ✓ ${name} passed`);
}

// 1. Button_Click with extra parameter (should fail)
testEventValidation('Button_Click with invalid extra parameter detected', [
  'Sub Class_Globals',
  '    Private btnSubmit As Button',
  'End Sub',
  'Sub btnSubmit_Click(x As Int)',
  'End Sub'
], true);

// 2. Button_Click with 0 parameters (valid)
testEventValidation('Button_Click with 0 parameters clean', [
  'Sub Class_Globals',
  '    Private btnSubmit As Button',
  'End Sub',
  'Sub btnSubmit_Click',
  'End Sub'
], false);

// 3. CustomListView_ItemClick parameter mismatch (1 param instead of 2)
testEventValidation('CustomListView_ItemClick missing parameter detected', [
  'Sub Class_Globals',
  '    Private clv As CustomListView',
  'End Sub',
  'Sub clv_ItemClick(Index As Int)',
  'End Sub'
], true);

// 4. CustomListView_ItemClick type mismatch (String instead of Int)
testEventValidation('CustomListView_ItemClick type mismatch detected', [
  'Sub Class_Globals',
  '    Private clv As CustomListView',
  'End Sub',
  'Sub clv_ItemClick(Index As String, Value As Object)',
  'End Sub'
], true);

// 5. CustomListView_ItemClick with correct signature (Index As Int, Value As Object)
testEventValidation('CustomListView_ItemClick valid signature clean', [
  'Sub Class_Globals',
  '    Private clv As CustomListView',
  'End Sub',
  'Sub clv_ItemClick(Index As Int, Value As Object)',
  'End Sub'
], false);

// 6. Timer_Tick with 0 parameters (valid)
testEventValidation('Timer_Tick valid signature clean', [
  'Sub Class_Globals',
  '    Private timer1 As Timer',
  'End Sub',
  'Sub timer1_Tick',
  'End Sub'
], false);

// 7. Timer_Tick with invalid parameter
testEventValidation('Timer_Tick with parameter detected', [
  'Sub Class_Globals',
  '    Private timer1 As Timer',
  'End Sub',
  'Sub timer1_Tick(ms As Long)',
  'End Sub'
], true);

// 8. EditText_TextChanged valid signature
testEventValidation('EditText_TextChanged valid signature clean', [
  'Sub Class_Globals',
  '    Private txtSearch As EditText',
  'End Sub',
  'Sub txtSearch_TextChanged(Old As String, New As String)',
  'End Sub'
], false);

console.log('\nAll Event Handler Validator tests passed successfully!\n');

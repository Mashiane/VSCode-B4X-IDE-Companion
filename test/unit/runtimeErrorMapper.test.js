const assert = require('assert');
const {
  detectSuspectedCause,
  parseJavaStackTrace,
  resolveDebugLine,
  remapJavaStackTrace,
} = require('../../dist/src/runtimeErrorMapper');

console.log('--- Running B4X Runtime Error Mapper Tests ---');

// 1. Suspected cause detection
assert.ok(detectSuspectedCause('java.lang.NullPointerException: null object').includes('NullPointerException'));
assert.ok(detectSuspectedCause('java.lang.ClassCastException: Label cannot be cast to Button').includes('ClassCastException'));
assert.ok(detectSuspectedCause('java.lang.IndexOutOfBoundsException: Index 5 out of bounds').includes('IndexOutOfBoundsException'));
console.log('  ✓ Suspected cause heuristics passed');

// 2. Trace parsing
const sampleTrace = `
java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference
    at b4a.example.b4xmainpage._btnsubmit_click(b4xmainpage.java:184)
    at java.lang.reflect.Method.invoke(Native Method)
    at anywheresoftware.b4a.BA.raiseEvent2(BA.java:221)
`;

const parsed = parseJavaStackTrace(sampleTrace);
assert.strictEqual(parsed.frames.length, 3, "Parsed 3 frames");
assert.strictEqual(parsed.frames[0].method, "b4a.example.b4xmainpage._btnsubmit_click");
assert.strictEqual(parsed.frames[0].file, "b4xmainpage.java");
assert.strictEqual(parsed.frames[0].line, 184);
assert.strictEqual(parsed.frames[1].isNative, true);
console.log('  ✓ Trace frame parsing passed');

// 3. DebugLine backward lookup in generated Java
const sampleJava = `
public void _btnsubmit_click() throws Exception{
//BA.debugLineNum = 42;
BA.debugLineNum = 42;BA.debugLine="Sub btnSubmit_Click";
 //BA.debugLineNum = 43;
BA.debugLineNum = 43;BA.debugLine="Log(\\"Hello\\")";
 //BA.debugLineNum = 44;
BA.debugLineNum = 44;BA.debugLine="mBase.Visible = True";
mBase.setVisible(true);
}
`;

const b4xLine = resolveDebugLine(sampleJava, 10);
assert.strictEqual(b4xLine, 44, `Expected line 44, got ${b4xLine}`);
console.log('  ✓ Generated Java //BA.debugLineNum resolution passed');

// 4. End-to-end trace remapping
const result = remapJavaStackTrace(sampleTrace, (mod) => {
  if (mod.toLowerCase() === 'b4xmainpage') return sampleJava;
  return undefined;
});

assert.strictEqual(result.exceptionType, 'java.lang.NullPointerException');
assert.ok(result.topProjectFrame, "Found top project frame");
assert.strictEqual(result.topProjectFrame.moduleName, 'b4xmainpage');
assert.strictEqual(result.topProjectFrame.subName, 'btnsubmit_click');
assert.strictEqual(result.topProjectFrame.b4xLine, 44);
assert.strictEqual(result.topProjectFrame.b4xFile, 'b4xmainpage.bas');
console.log('  ✓ End-to-end stack trace remapping passed');

console.log('\nAll Runtime Error Mapper tests passed successfully!\n');

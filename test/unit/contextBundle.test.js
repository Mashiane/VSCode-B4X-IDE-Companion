const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  skeletonizeModule,
  estimateTokens,
  generateAsciiTree,
  generateContextBundle,
  generateJsonContextBundle,
  sanitizeSecrets,
  isExcludedFromBundle,
  saveCodeBundleToWorkspace,
} = require('../../dist/src/b4xContextBundleCore');

console.log('--- Running B4X Context Bundle Tests ---');

// 1. Skeleton generation collapses sub bodies
const sampleModule = `
Sub Process_Globals
    Private fx As JFX
    Private MainForm As Form
End Sub

Sub AppStart (Form1 As Form, Args() As String)
    MainForm = Form1
    MainForm.Title = "Hello"
    MainForm.Show
End Sub

Sub CalculateSum (a As Int, b As Int) As Int
    Dim res As Int = a + b
    Return res
End Sub
`;

const skelResult = skeletonizeModule(sampleModule);
assert.ok(skelResult.omittedSubsCount === 2, `Expected 2 omitted subs, got ${skelResult.omittedSubsCount}`);
assert.ok(skelResult.skeleton.includes("Sub Process_Globals"), "Should keep Process_Globals");
assert.ok(skelResult.skeleton.includes("Private MainForm As Form"), "Should keep Process_Globals variables");
assert.ok(skelResult.skeleton.includes("Sub AppStart (Form1 As Form, Args() As String)"), "Should keep AppStart signature");
assert.ok(skelResult.skeleton.includes("' ... body omitted"), "Should have omitted comment");
assert.ok(!skelResult.skeleton.includes('MainForm.Title = "Hello"'), "Should have omitted AppStart body");
console.log('  ✓ Skeleton module compression passed');

// 2. Focused sub preservation
const focusResult = skeletonizeModule(sampleModule, 'CalculateSum');
assert.ok(focusResult.skeleton.includes('Dim res As Int = a + b'), "Should preserve focused Sub CalculateSum body");
assert.ok(!focusResult.skeleton.includes('MainForm.Title = "Hello"'), "Should still omit AppStart body");
console.log('  ✓ Focused Sub preservation passed');

// 3. Token estimation
const tokens = estimateTokens("Hello World! This is a test.");
assert.ok(tokens > 0 && tokens < 20, `Token estimation realistic: ${tokens}`);
console.log('  ✓ Token estimation passed');

// 4. ASCII Tree generation
const tree = generateAsciiTree(['Main.bas', 'B4XMainPage.bas', 'Files/layout1.bal']);
assert.ok(tree.includes('├── '), "Should include tree branches");
assert.ok(tree.includes('└── '), "Should include tree end branch");
console.log('  ✓ ASCII tree generation passed');

// 5. Full Context Bundle generation (Markdown)
const bundle = generateContextBundle({
  projectName: 'TestApp',
  files: [
    { relPath: 'Main.bas', kind: 'bas', content: sampleModule, isFocused: true, focusSub: 'CalculateSum' },
    { relPath: 'Files/layout1.bal', kind: 'bal', content: '{"controls": []}' },
  ],
  buildErrors: ['Main.bas:12: Type mismatch'],
});

assert.ok(bundle.includes('# B4X Context Bundle: TestApp'), "Header present");
assert.ok(bundle.includes('## ⚠️ Recent Compiler Errors'), "Build errors section present");
assert.ok(bundle.includes('Type mismatch'), "Error content present");
assert.ok(bundle.includes('Token Budget:'), "Token budget stats present");
assert.ok(bundle.includes('Dim res As Int = a + b'), "Focused sub present in bundle");
console.log('  ✓ Full context bundle generation passed');

// 6. Erel-compatible JSON Code Bundle generation
const jsonBundleStr = generateJsonContextBundle({
  projectName: 'TestApp',
  platform: 'b4a',
  files: [
    { relPath: 'Main.bas', kind: 'bas', content: sampleModule },
    { relPath: 'Files/layout1.bal', kind: 'bal' },
  ],
  activeFile: 'Main.bas',
  activeSub: 'CalculateSum',
  activeLine: 15,
  libraries: ['Core', 'XUI'],
  buildErrors: ['Error on line 12'],
});

const jsonParsed = JSON.parse(jsonBundleStr);
assert.strictEqual(jsonParsed.project, 'TestApp');
assert.strictEqual(jsonParsed.platform, 'b4a');
assert.strictEqual(jsonParsed.caret.sub, 'CalculateSum');
assert.strictEqual(jsonParsed.caret.line, 15);
assert.strictEqual(jsonParsed.modules.length, 1);
assert.strictEqual(jsonParsed.modules[0].name, 'Main');
assert.strictEqual(jsonParsed.layouts.length, 1);
assert.strictEqual(jsonParsed.layouts[0].name, 'layout1');
assert.deepStrictEqual(jsonParsed.libraries, ['Core', 'XUI']);
console.log('  ✓ Erel-compatible JSON Code Bundle generation passed');

// 7. Secret sanitization
const codeWithKey = 'Dim apiKey As String = "sk-live-secret12345678"';
const sanitized = sanitizeSecrets(codeWithKey);
assert.ok(sanitized.includes('[REDACTED]'), 'Secret should be redacted');
assert.ok(!sanitized.includes('secret12345678'), 'Plain secret should not remain');
console.log('  ✓ Secret sanitization passed');

// 8. #ExcludeCodeFromBundle attribute support
const excludedModule = `
'#ExcludeCodeFromBundle: True
Sub SecretLogic
End Sub
`;
assert.ok(isExcludedFromBundle(excludedModule), 'Should detect #ExcludeCodeFromBundle');
assert.ok(!isExcludedFromBundle(sampleModule), 'Sample module should not be excluded');

const bundleWithExcluded = generateJsonContextBundle({
  projectName: 'TestApp',
  files: [
    { relPath: 'Main.bas', kind: 'bas', content: sampleModule },
    { relPath: 'Secret.bas', kind: 'bas', content: excludedModule },
  ],
});
const parsedExcluded = JSON.parse(bundleWithExcluded);
assert.strictEqual(parsedExcluded.modules.length, 1, 'Excluded module must not be included');
assert.strictEqual(parsedExcluded.modules[0].name, 'Main');
console.log('  ✓ #ExcludeCodeFromBundle filtering passed');


// 9. saveCodeBundleToWorkspace saves in CodeBundle folder
const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'b4x_cb_test_'));
const sampleMdContent = '# Project Code Bundle\n\nSome bundle content';
const savedResult = saveCodeBundleToWorkspace(tempWorkspace, 'TestApp', 'markdown', sampleMdContent);

assert.strictEqual(savedResult.relativePath, 'CodeBundle/TestApp.md');
assert.ok(fs.existsSync(savedResult.outputPath), 'CodeBundle file should exist on disk');
assert.strictEqual(fs.readFileSync(savedResult.outputPath, 'utf8'), sampleMdContent);

const sampleJsonContent = '{"projectName": "TestApp"}';
const savedJsonResult = saveCodeBundleToWorkspace(tempWorkspace, 'TestApp', 'json', sampleJsonContent);
assert.strictEqual(savedJsonResult.relativePath, 'CodeBundle/TestApp.json');
assert.ok(fs.existsSync(savedJsonResult.outputPath), 'JSON CodeBundle file should exist on disk');

fs.rmSync(tempWorkspace, { recursive: true, force: true });
console.log('  ✓ saveCodeBundleToWorkspace in CodeBundle folder passed');

console.log('\nAll Context Bundle tests passed successfully!\n');

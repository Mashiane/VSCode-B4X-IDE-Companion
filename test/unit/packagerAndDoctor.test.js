const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runB4xDoctor } = require('../../dist/src/b4xDoctorCore');
const { packageB4xLib, extractModuleMetadata, detectProjectName, detectProjectPlatform, resolveAdditionalLibrariesFolder } = require('../../dist/src/b4xLibPackagerCore');

console.log('--- Running B4X Doctor & Packager Tests ---');

// 1. Doctor runs and returns structured report
const doctorReport = runB4xDoctor({
  javaHome: undefined,
  b4aBuilderPath: undefined,
  b4jBuilderPath: undefined,
});

assert.ok(doctorReport.components.length >= 6, "Report has components");
assert.ok(doctorReport.markdown.includes('B4X Environment Health Report'), "Markdown title present");
console.log('  ✓ B4X Doctor diagnostics report passed');

// 2. Metadata extraction from .bas
const sampleBas = `
'#Version: 2.50
'#Author: Test Author
'#SupportedPlatforms: B4A, B4J

Sub Class_Globals
End Sub
`;

const meta = extractModuleMetadata(sampleBas);
assert.strictEqual(meta.version, '2.50');
assert.strictEqual(meta.author, 'Test Author');
assert.strictEqual(meta.supportedPlatforms, 'B4A, B4J');
console.log('  ✓ Module metadata extraction passed');

// 3. Packaging temporary project into .b4xlib
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xlib_test_'));
const basFile = path.join(tempDir, 'MyCustomWidget.bas');
fs.writeFileSync(basFile, sampleBas, 'utf8');

const filesDir = path.join(tempDir, 'Files');
fs.mkdirSync(filesDir);
fs.writeFileSync(path.join(filesDir, 'test.png'), 'fake-image-bytes', 'utf8');

const outZip = path.join(tempDir, 'dist', 'MyCustomWidget.b4xlib');
const pkgResult = packageB4xLib(tempDir, outZip);

assert.strictEqual(pkgResult.success, true, "Packager succeeded");
assert.ok(fs.existsSync(outZip), ".b4xlib file created");
assert.ok(pkgResult.filesIncluded.includes('MyCustomWidget.bas'), "Module included");
assert.ok(pkgResult.filesIncluded.includes('manifest.txt'), "manifest.txt included");
assert.ok(pkgResult.filesIncluded.some(f => f.includes('test.png')), "Assets included");

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('  ✓ .b4xlib archive creation passed');


// 4. Project Name & Platform Detection
const tempProjDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4x_proj_test_'));
fs.writeFileSync(path.join(tempProjDir, 'AwesomeLib.b4a'), 'Version=1.00', 'utf8');
assert.strictEqual(detectProjectName(tempProjDir), 'AwesomeLib', 'Should detect project name from .b4a file');
assert.strictEqual(detectProjectPlatform(tempProjDir), 'b4a', 'Should detect b4a platform from .b4a file');
fs.rmSync(tempProjDir, { recursive: true, force: true });
console.log('  ✓ Project Name & Platform detection passed');

// 5. Additional Libraries Folder Resolution
const resolvedFromSetting = resolveAdditionalLibrariesFolder({
  platform: 'b4a',
  getSetting: (k) => k === 'b4aAdditionalLibrariesFolder' ? 'C:\\custom\\libs' : undefined,
});
assert.strictEqual(resolvedFromSetting, 'C:\\custom\\libs', 'Should resolve from platform-specific setting');

const resolvedFromIni = resolveAdditionalLibrariesFolder({
  platform: 'b4a',
  getSetting: () => undefined,
  getIniAdditionalFolder: (p) => p === 'b4a' ? 'C:\\ini\\libs' : undefined,
});
assert.strictEqual(resolvedFromIni, 'C:\\ini\\libs', 'Should resolve from platform INI');

const resolvedCrossPlatform = resolveAdditionalLibrariesFolder({
  platform: 'b4r',
  getSetting: () => undefined,
  getIniAdditionalFolder: (p) => p === 'b4a' ? 'C:\\b4a\\fallback\\libs' : undefined,
});
assert.strictEqual(resolvedCrossPlatform, 'C:\\b4a\\fallback\\libs', 'Should fallback cross-platform');
console.log('  ✓ Additional Libraries folder resolution passed');

console.log('\nAll Doctor & Packager tests passed successfully!\n');

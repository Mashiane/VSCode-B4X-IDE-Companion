const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  convertLayoutToJson,
  convertJsonToLayout,
  exportLayoutToJsonFile,
  importLayoutFromJsonFile,
} = require('../../dist/src/cli/b4xLayoutCli');

console.log('--- Running B4X Layout CLI & Converter Tests ---');

async function runTests() {
  const sampleLayoutJson = {
    Version: 1,
    LayoutHeader: {
      NumberOfControls: 1,
      NumberOfVariants: 1,
      ControlsHeaders: [
        { Name: "Button1", JavaType: "android.widget.Button", DesignerType: "Button" }
      ],
      Variants: [
        { Width: 320, Height: 480, Scale: 1 }
      ]
    },
    Views: {
      "0": {
        name: "Button1",
        type: "Button",
        left: 10,
        top: 20,
        width: 100,
        height: 40,
        text: "Click Me"
      }
    },
    Scripts: {}
  };

  // 1. JSON to Binary encoding
  const bytes = await convertJsonToLayout(sampleLayoutJson);
  assert.ok(bytes instanceof Uint8Array, "Encoded to Uint8Array");
  assert.ok(bytes.length > 0, "Non-empty byte stream produced");
  console.log(`  ✓ JSON to Binary layout encoding passed (${bytes.length} bytes)`);

  // 2. Export / Import file roundtrip
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4x_layout_cli_'));
  const jsonFile = path.join(tempDir, 'test.layout.json');
  fs.writeFileSync(jsonFile, JSON.stringify(sampleLayoutJson, null, 2), 'utf8');

  const balFile = path.join(tempDir, 'test.bal');
  const generatedBal = await importLayoutFromJsonFile(jsonFile, balFile);
  assert.ok(fs.existsSync(generatedBal), "Import generated .bal file");
  assert.ok(fs.statSync(generatedBal).size > 0, ".bal file is non-empty");
  console.log('  ✓ importLayoutFromJsonFile passed');

  const reExportedJson = path.join(tempDir, 'reexported.layout.json');
  const generatedJson = await exportLayoutToJsonFile(generatedBal, reExportedJson);
  assert.ok(fs.existsSync(generatedJson), "Export generated .json file");
  const reParsed = JSON.parse(fs.readFileSync(generatedJson, 'utf8'));
  assert.ok(reParsed.LayoutHeader, "Re-exported JSON has LayoutHeader");
  console.log('  ✓ exportLayoutToJsonFile passed');

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('\nAll Layout CLI & Converter tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

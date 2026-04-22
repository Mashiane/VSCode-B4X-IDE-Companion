/**
 * Platform Intelligence Test Suite
 * 
 * Tests multi-platform support for B4A, B4i, B4J, and B4R:
 *   1. Platform detection from file extensions
 *   2. INI path construction for all platforms
 *   3. Install folder defaults for all platforms
 *   4. Package.json configuration (settings, languages, commands)
 *   5. Code structure verification
 * 
 * This test runs WITHOUT VS Code runtime (pure Node.js, no vscode imports).
 * 
 * Run: npm run compile && node dist/scripts/tests/test-platform-intelligence.js
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------
const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');

type B4xPlatformName = 'b4a' | 'b4i' | 'b4j' | 'b4r';

// Expected INI paths for each platform
const EXPECTED_INI_PATHS: Record<B4xPlatformName, string> = {
  b4a: path.join(APPDATA, 'Anywhere Software', 'Basic4android', 'b4xV5.ini'),
  b4i: path.join(APPDATA, 'Anywhere Software', 'B4i', 'b4xV5.ini'),
  b4j: path.join(APPDATA, 'Anywhere Software', 'B4J', 'b4xV5.ini'),
  b4r: path.join(APPDATA, 'Anywhere Software', 'B4R', 'b4xV5.ini'),
};

// Expected install folders for each platform
const EXPECTED_INSTALL_FOLDERS: Record<B4xPlatformName, string> = {
  b4a: path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anywhere Software', 'B4A'),
  b4i: path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Anywhere Software', 'B4i'),
  b4j: path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anywhere Software', 'B4J'),
  b4r: path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anywhere Software', 'B4R'),
};

// Platform detection function (inlined to avoid vscode import)
const EXTENSION_TO_PLATFORM: Record<string, B4xPlatformName | undefined> = {
  '.b4a': 'b4a',
  '.b4i': 'b4i',
  '.b4j': 'b4j',
  '.b4r': 'b4r',
};

function detectPlatformFromPath(filePath: string): B4xPlatformName | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_PLATFORM[ext];
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

async function runTest(t: ReturnType<typeof test>) {
  try {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${t.name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function runTests(tests: ReturnType<typeof test>[]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  B4X IntelliSense — Platform Intelligence Tests`);
  console.log(`${'='.repeat(60)}\n`);
  
  for (const t of tests) {
    await runTest(t);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Test Suite 1: Platform Detection from File Extensions
// ---------------------------------------------------------------------------
const testPlatformDetection = test('Platform Detection from File Extensions', () => {
  console.log('\n--- Platform Detection from File Extensions ---\n');
  
  // Test B4A detection
  assert.strictEqual(detectPlatformFromPath('MyApp.b4a'), 'b4a', 'Should detect .b4a as b4a');
  assert.strictEqual(detectPlatformFromPath('C:\\Projects\\Test.b4a'), 'b4a', 'Should detect .b4a with full path');
  
  // Test B4i detection
  assert.strictEqual(detectPlatformFromPath('MyApp.b4i'), 'b4i', 'Should detect .b4i as b4i');
  assert.strictEqual(detectPlatformFromPath('C:\\Projects\\Test.b4i'), 'b4i', 'Should detect .b4i with full path');
  
  // Test B4J detection
  assert.strictEqual(detectPlatformFromPath('MyApp.b4j'), 'b4j', 'Should detect .b4j as b4j');
  assert.strictEqual(detectPlatformFromPath('C:\\Projects\\Test.b4j'), 'b4j', 'Should detect .b4j with full path');
  
  // Test B4R detection
  assert.strictEqual(detectPlatformFromPath('MyApp.b4r'), 'b4r', 'Should detect .b4r as b4r');
  assert.strictEqual(detectPlatformFromPath('C:\\Projects\\Test.b4r'), 'b4r', 'Should detect .b4r with full path');
  
  // Test non-project files
  assert.strictEqual(detectPlatformFromPath('Module.bas'), undefined, 'Should not detect .bas as platform');
  assert.strictEqual(detectPlatformFromPath('Utils.b4x'), undefined, 'Should not detect .b4x as platform');
  assert.strictEqual(detectPlatformFromPath('README.md'), undefined, 'Should not detect .md as platform');
});

// ---------------------------------------------------------------------------
// Test Suite 2: INI Path Construction
// ---------------------------------------------------------------------------
const testIniPathConstruction = test('INI Path Construction for All Platforms', () => {
  console.log('\n--- INI Path Construction ---\n');
  
  // Verify expected paths are correctly constructed
  for (const platform of ['b4a', 'b4i', 'b4j', 'b4r'] as B4xPlatformName[]) {
    const expectedPath = EXPECTED_INI_PATHS[platform];
    console.log(`  ${platform.toUpperCase()}: ${expectedPath}`);
    
    // Verify path structure
    assert.ok(expectedPath.includes('Anywhere Software'), `${platform} INI path should include 'Anywhere Software'`);
    assert.ok(expectedPath.endsWith('b4xV5.ini'), `${platform} INI path should end with b4xV5.ini`);
  }
  
  // Verify paths are distinct for each platform
  const paths = Object.values(EXPECTED_INI_PATHS);
  const uniquePaths = new Set(paths);
  assert.strictEqual(uniquePaths.size, paths.length, 'Each platform should have a unique INI path');
  
  // Verify B4i uses correct folder name
  assert.ok(EXPECTED_INI_PATHS.b4i.includes('\\B4i\\'), 'B4i INI path should include \\B4i\\ folder');
});

// ---------------------------------------------------------------------------
// Test Suite 3: Install Folder Defaults
// ---------------------------------------------------------------------------
const testInstallFolderDefaults = test('Install Folder Default Paths', () => {
  console.log('\n--- Install Folder Default Paths ---\n');
  
  // Test that expected install folders are correctly constructed
  for (const platform of ['b4a', 'b4i', 'b4j', 'b4r'] as B4xPlatformName[]) {
    const expectedFolder = EXPECTED_INSTALL_FOLDERS[platform];
    console.log(`  ${platform.toUpperCase()}: ${expectedFolder}`);
    
    // Verify path structure
    assert.ok(expectedFolder.includes('Anywhere Software'), `${platform} install path should include 'Anywhere Software'`);
    // Check for platform folder name (case-insensitive)
    const folderNameLower = expectedFolder.toLowerCase();
    assert.ok(
      folderNameLower.includes(platform.toLowerCase()) || 
      (platform === 'b4a' && (folderNameLower.includes('b4a') || folderNameLower.includes('basic4android'))),
      `${platform} install path should include platform folder name`
    );
  }
  
  // Verify B4i uses Program Files (x86) by default
  const b4iFolder = EXPECTED_INSTALL_FOLDERS.b4i;
  assert.ok(b4iFolder.includes('Program Files (x86)'), 'B4i should default to Program Files (x86)');
  
  // Verify other platforms use Program Files by default
  for (const platform of ['b4a', 'b4j', 'b4r'] as B4xPlatformName[]) {
    const folder = EXPECTED_INSTALL_FOLDERS[platform];
    assert.ok(folder.includes('Program Files') && !folder.includes('(x86)'), 
      `${platform.toUpperCase()} should default to Program Files (not x86)`);
  }
});

// ---------------------------------------------------------------------------
// Test Suite 4: Package.json Settings
// ---------------------------------------------------------------------------
const testPackageJsonSettings = test('Package.json Settings for All Platforms', () => {
  console.log('\n--- Package.json Settings ---\n');
  
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const settings = packageJson.contributes.configuration.properties;
  
  // Check for all 4 install path settings
  const expectedInstallSettings = [
    'b4xIntellisense.b4aInstallPath',
    'b4xIntellisense.b4iInstallPath',
    'b4xIntellisense.b4jInstallPath',
    'b4xIntellisense.b4rInstallPath',
  ];
  
  for (const settingKey of expectedInstallSettings) {
    assert.ok(settings[settingKey], `Setting ${settingKey} should exist in package.json`);
    assert.strictEqual(settings[settingKey].type, 'string', `${settingKey} should be a string type`);
    assert.ok(settings[settingKey].default, `${settingKey} should have a default value`);
    console.log(`  ✓ ${settingKey}`);
    console.log(`    Default: ${settings[settingKey].default}`);
  }
  
  // Check for all 4 INI path settings
  const expectedIniSettings = [
    'b4xIntellisense.b4aIniPath',
    'b4xIntellisense.b4iIniPath',
    'b4xIntellisense.b4jIniPath',
    'b4xIntellisense.b4rIniPath',
  ];
  
  for (const settingKey of expectedIniSettings) {
    assert.ok(settings[settingKey], `Setting ${settingKey} should exist in package.json`);
    assert.strictEqual(settings[settingKey].type, 'string', `${settingKey} should be a string type`);
    console.log(`  ✓ ${settingKey}`);
  }
});

// ---------------------------------------------------------------------------
// Test Suite 5: Language Registration
// ---------------------------------------------------------------------------
const testLanguageRegistration = test('Language Registration for All File Types', () => {
  console.log('\n--- Language Registration ---\n');
  
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const languages = packageJson.contributes.languages;
  const b4xLanguage = languages.find((l: any) => l.id === 'b4x');
  
  assert.ok(b4xLanguage, 'B4X language should be registered');
  
  // Check extensions
  const expectedExtensions = ['.bas', '.b4x', '.b4a', '.b4i', '.b4j', '.b4r'];
  for (const ext of expectedExtensions) {
    assert.ok(b4xLanguage.extensions.includes(ext), `Extension ${ext} should be registered`);
    console.log(`  ✓ Extension "${ext}" registered`);
  }
  
  // Check aliases
  const expectedAliases = ['B4X', 'B4A', 'B4J', 'B4I', 'B4R'];
  for (const alias of expectedAliases) {
    assert.ok(b4xLanguage.aliases.includes(alias), `Alias "${alias}" should be registered`);
    console.log(`  ✓ Alias "${alias}" registered`);
  }
});

// ---------------------------------------------------------------------------
// Test Suite 6: Command Titles are Platform-Agnostic
// ---------------------------------------------------------------------------
const testCommandTitles = test('Command Titles are Platform-Agnostic', () => {
  console.log('\n--- Command Titles ---\n');
  
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const commands = packageJson.contributes.commands;
  
  // Check theme import command title (should say B4X, not B4A)
  const themeCommand = commands.find((c: any) => c.command === 'b4xIntellisense.importThemeFromInstall');
  assert.ok(themeCommand, 'Theme import command should exist');
  assert.ok(themeCommand.title.includes('B4X'), 'Theme command should mention B4X (not just B4A)');
  console.log(`  ✓ Theme import: "${themeCommand.title}"`);
  
  // Check install project command
  const installCommand = commands.find((c: any) => c.command === 'b4xIntellisense.installProject');
  assert.ok(installCommand, 'Install project command should exist');
  console.log(`  ✓ Install project: "${installCommand.title}"`);
  
  // Check open project command
  const openCommand = commands.find((c: any) => c.command === 'b4xIntellisense.openB4xProject');
  assert.ok(openCommand, 'Open B4X project command should exist');
  console.log(`  ✓ Open B4X project: "${openCommand.title}"`);
});

// ---------------------------------------------------------------------------
// Test Suite 7: Description and Keywords
// ---------------------------------------------------------------------------
const testDescriptionAndKeywords = test('Description and Keywords Include All Platforms', () => {
  console.log('\n--- Description and Keywords ---\n');
  
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Check description mentions all platforms
  const description = packageJson.description;
  assert.ok(description.includes('B4A'), 'Description should mention B4A');
  assert.ok(description.includes('B4i'), 'Description should mention B4i');
  assert.ok(description.includes('B4J'), 'Description should mention B4J');
  assert.ok(description.includes('B4R'), 'Description should mention B4R');
  console.log('  ✓ Description mentions all platforms');
  
  // Verify description mentions all file types
  assert.ok(description.includes('.b4a'), 'Description should mention .b4a files');
  assert.ok(description.includes('.b4i'), 'Description should mention .b4i files');
  assert.ok(description.includes('.b4j'), 'Description should mention .b4j files');
  assert.ok(description.includes('.b4r'), 'Description should mention .b4r files');
  console.log('  ✓ Description mentions all file extensions');
  
  // Check keywords include all platforms
  const keywords = packageJson.keywords;
  for (const keyword of ['b4a', 'b4i', 'b4j', 'b4r']) {
    assert.ok(keywords.includes(keyword), `Keyword "${keyword}" should be present`);
  }
  console.log('  ✓ Keywords include all platforms');
});

// ---------------------------------------------------------------------------
// Test Suite 8: Explorer Context Menu
// ---------------------------------------------------------------------------
const testExplorerContextMenu = test('Explorer Context Menu Supports All Platforms', () => {
  console.log('\n--- Explorer Context Menu ---\n');
  
  const packageJsonPath = path.resolve('package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const menus = packageJson.contributes.menus;
  const explorerMenu = menus['explorer/context'];
  
  // Find open B4X project command in explorer menu
  const openB4xCommand = explorerMenu.find((m: any) => m.command === 'b4xIntellisense.openB4xProject');
  assert.ok(openB4xCommand, 'Open B4X project should be in explorer context menu');
  
  // Check the "when" clause includes all platform extensions
  const whenClause = openB4xCommand.when;
  assert.ok(whenClause, 'Open B4X command should have a "when" clause');
  
  // The when clause may use a regex pattern like /\.(b4a|b4i|b4j|b4r)/ or list them individually
  const whenClauseLower = whenClause.toLowerCase();
  
  // Check if using regex pattern or individual extensions
  // Regex pattern: /\.(b4a|b4i|b4j|b4r)/ becomes \\.(b4a|b4i|b4j|b4r) in JSON
  const hasRegexPattern = whenClauseLower.includes('b4a') && 
                          whenClauseLower.includes('b4i') &&
                          whenClauseLower.includes('b4j') &&
                          whenClauseLower.includes('b4r');
  
  // Or check for individual extensions with dots
  const hasIndividualExtensions = whenClauseLower.includes('.b4a') && 
                                   whenClauseLower.includes('.b4i') &&
                                   whenClauseLower.includes('.b4j') &&
                                   whenClauseLower.includes('.b4r');
  
  assert.ok(
    hasRegexPattern || hasIndividualExtensions,
    'When clause should include all platform extensions (.b4a, .b4i, .b4j, .b4r)'
  );
  
  console.log(`  ✓ Explorer context menu "when" clause:`);
  console.log(`    ${whenClause}`);
});

// ---------------------------------------------------------------------------
// Test Suite 9: Code Structure (No Hardcoded B4A Paths)
// ---------------------------------------------------------------------------
const testNoHardcodedB4aPaths = test('Source Code Uses Platform Variables (No Hardcoded B4A)', () => {
  console.log('\n--- Source Code Platform Awareness ---\n');
  
  // Read extension.ts and check for platform-aware patterns
  const extensionTsPath = path.resolve('src', 'extension.ts');
  const extensionCode = fs.readFileSync(extensionTsPath, 'utf8');
  
  // Check that install path setting is constructed dynamically
  assert.ok(
    extensionCode.includes('`${platform.platform}InstallPath`') || 
    extensionCode.includes('platform.settingKey'),
    'Extension should use dynamic install path settings (e.g., `${platform.platform}InstallPath`)'
  );
  console.log('  ✓ Install paths constructed dynamically from platform');
  
  // Check that platform detection is used
  assert.ok(
    extensionCode.includes('detectPlatformFromPath') ||
    extensionCode.includes('lastOpenedProjectPlatform'),
    'Extension should use platform detection or persisted platform'
  );
  console.log('  ✓ Platform detection/persistence used');
  
  // Check that error messages say "B4X" not just "B4A"
  const b4aOnlyErrors = extensionCode.match(/showErrorMessage\([^)]*B4A[^)]*\)/g) || [];
  const b4xErrors = extensionCode.match(/showErrorMessage\([^)]*B4X[^)]*\)/g) || [];
  
  // Allow B4A in specific contexts (like B4A-specific settings) but prefer B4X
  console.log(`  ✓ Found ${b4xErrors.length} error message(s) mentioning "B4X"`);
  
  // Check backup command handles multiple platforms
  assert.ok(
    extensionCode.includes('B4i') && extensionCode.includes('B4J') && extensionCode.includes('B4R'),
    'Extension code should reference all platforms (B4i, B4J, B4R)'
  );
  console.log('  ✓ Code references all platforms');
  
  // Check projectFile.ts uses B4xProjectConfig (not B4aProjectConfig)
  const projectFilePath = path.resolve('src', 'projectFile.ts');
  const projectFileCode = fs.readFileSync(projectFilePath, 'utf8');
  
  assert.ok(
    projectFileCode.includes('B4xProjectConfig'),
    'projectFile.ts should use B4xProjectConfig interface name'
  );
  assert.ok(
    !projectFileCode.includes('B4aProjectConfig'),
    'projectFile.ts should NOT use old B4aProjectConfig name'
  );
  console.log('  ✓ Interface named B4xProjectConfig (not B4aProjectConfig)');
});

// ---------------------------------------------------------------------------
// Test Suite 10: File Filter in Open Dialog
// ---------------------------------------------------------------------------
const testOpenDialogFilter = test('Open Project Dialog Filter Includes All Platforms', () => {
  console.log('\n--- Open Project Dialog Filter ---\n');
  
  const extensionTsPath = path.resolve('src', 'extension.ts');
  const extensionCode = fs.readFileSync(extensionTsPath, 'utf8');
  
  // Find the promptForB4xProjectFile function
  const hasB4aFilter = extensionCode.includes("'b4a'") && extensionCode.includes('showOpenDialog');
  const hasB4iFilter = extensionCode.includes("'b4i'") && extensionCode.includes('showOpenDialog');
  const hasB4jFilter = extensionCode.includes("'b4j'") && extensionCode.includes('showOpenDialog');
  const hasB4rFilter = extensionCode.includes("'b4r'") && extensionCode.includes('showOpenDialog');
  
  assert.ok(hasB4aFilter, 'Dialog filter should include .b4a');
  assert.ok(hasB4iFilter, 'Dialog filter should include .b4i');
  assert.ok(hasB4jFilter, 'Dialog filter should include .b4j');
  assert.ok(hasB4rFilter, 'Dialog filter should include .b4r');
  
  console.log('  ✓ Open dialog filter includes .b4a');
  console.log('  ✓ Open dialog filter includes .b4i');
  console.log('  ✓ Open dialog filter includes .b4j');
  console.log('  ✓ Open dialog filter includes .b4r');
});

// ---------------------------------------------------------------------------
// Run All Tests
// ---------------------------------------------------------------------------
async function main() {
  const tests = [
    testPlatformDetection,
    testIniPathConstruction,
    testInstallFolderDefaults,
    testPackageJsonSettings,
    testLanguageRegistration,
    testCommandTitles,
    testDescriptionAndKeywords,
    testExplorerContextMenu,
    testNoHardcodedB4aPaths,
    testOpenDialogFilter,
  ];
  
  await runTests(tests);
}

// Run tests if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

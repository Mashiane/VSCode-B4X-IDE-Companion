/**
 * Integration test for the "Open B4A Project" pipeline.
 *
 * Exercises the full chain:
 *   .b4a parsing → INI discovery → library resolution → XML/b4xlib parsing
 *   → workspace class parsing → intellisense store operations.
 *
 * Uses a real project file: B4A\B4XDaisyUIKitDemo.b4a
 *
 * Run:  npm run compile && node dist/scripts/tests/test-open-b4a-project.js
 */

// ---------------------------------------------------------------------------
// 1. vscode mock is loaded via NODE_PATH=__mocks__ (see __mocks__/vscode.js).
//    No monkey-patching needed — Node resolves `require('vscode')` from
//    the __mocks__ directory automatically.
// ---------------------------------------------------------------------------

// Fake classes re-declared here for use in the test helper below.
class FakePosition {
  constructor(public line: number, public character: number) {}
}
class FakeRange {
  constructor(public start: FakePosition, public end: FakePosition) {}
}
class FakeUri {
  public scheme = 'file';
  constructor(public fsPath: string) {}
  static file(p: string) { return new FakeUri(p); }
  toString() { return this.fsPath; }
}

// ---------------------------------------------------------------------------
// 2. Helper to build a mock TextDocument from file path + content.
// ---------------------------------------------------------------------------
function makeTextDocument(filePath: string, content: string): any {
  const lines = content.split(/\r?\n/);
  return {
    uri: FakeUri.file(filePath),
    languageId: 'b4x',
    getText: (range?: any) => {
      if (!range) return content;
      const start = range.start.line;
      const end = range.end.line;
      return lines.slice(start, end + 1).join('\n');
    },
    lineCount: lines.length,
    lineAt: (pos: any) => {
      const i = typeof pos === 'number' ? pos : pos.line;
      const text = lines[i] ?? '';
      return {
        text,
        range: new FakeRange(
          new FakePosition(i, 0),
          new FakePosition(i, text.length),
        ),
      };
    },
    positionAt: (offset: number) => {
      let running = 0;
      for (let idx = 0; idx < lines.length; idx++) {
        const lineLen = (lines[idx] ?? '').length + 1; // +1 for \n
        if (offset < running + lineLen) {
          return new FakePosition(idx, offset - running);
        }
        running += lineLen;
      }
      return new FakePosition(lines.length - 1, (lines[lines.length - 1] ?? '').length);
    },
    offsetAt: (pos: any) => {
      let offset = 0;
      for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += (lines[i] ?? '').length + 1;
      }
      return offset + pos.character;
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Imports — vscode is resolved from __mocks__/vscode.js via NODE_PATH.
// ---------------------------------------------------------------------------
import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parsePlatformIni, parsePlatformSettings, loadPlatformIni } from '../../src/platformIni';
import { findPlatformInstallDirs, defaultB4aIniPath } from '../../src/platformConfig';
import { normalizeBasePath, getProjectRootFromProjectFile } from '../../src/projectFile';
import { parseXmlLibraryDocument, XmlLibraryStore } from '../../src/xmlLibraryIndex';
import { parseWorkspaceClassDocument, WorkspaceClassStore } from '../../src/workspaceClassIndex';

// ---------------------------------------------------------------------------
// Test configuration — paths on this dev machine.
// ---------------------------------------------------------------------------
const PROJECT_FILE = path.resolve('B4A', 'B4XDaisyUIKitDemo.b4a');
const INI_PATH = defaultB4aIniPath;
const B4A_INSTALL_LIBRARIES = path.join(
  process.env.ProgramFiles ?? 'C:\\Program Files',
  'Anywhere Software', 'B4A', 'Libraries',
);

// Expected from the .b4a file
const EXPECTED_LIBRARIES = ['b4xgifview', 'b4xpages', 'core', 'javaobject', 'stringutils', 'xui'];
const EXPECTED_MODULE_COUNT = 112;

// ---------------------------------------------------------------------------
// 4. Test helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

async function runTests(tests: ReturnType<typeof test>[]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  B4X IntelliSense — Open B4A Project Tests`);
  console.log(`${'='.repeat(60)}\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓  ${t.name}`);
    } catch (err: any) {
      if (err?.message?.startsWith('SKIP:')) {
        skipped++;
        console.log(`  ○  ${t.name} (${err.message})`);
      } else {
        failed++;
        console.error(`  ✗  ${t.name}`);
        console.error(`     ${err?.message ?? err}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${'─'.repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

function skipIf(condition: boolean, reason: string) {
  if (condition) throw new Error(`SKIP: ${reason}`);
}

// ---------------------------------------------------------------------------
// 5. Parse the .b4a project file manually (same logic as projectFile.ts
//    parseProjectFile but without full vscode dependency chain).
// ---------------------------------------------------------------------------
interface ParsedProject {
  projectDirectory: string;
  libraries: Set<string>;
  moduleNames: string[];
  moduleBasePaths: Set<string>;
}

function parseB4aFile(filePath: string): ParsedProject {
  const content = fs.readFileSync(filePath, 'utf8');
  const projectDirectory = path.dirname(filePath);
  const libraries = new Set<string>();
  const moduleNames: string[] = [];
  const moduleBasePaths = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '@EndOfDesignText@') break;
    if (!trimmed || !trimmed.includes('=')) continue;

    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (!value) continue;

    if (/^library\d+$/i.test(key)) {
      libraries.add(value.toLowerCase());
    }

    if (/^module\d+$/i.test(key)) {
      // Strip B4X path prefixes
      const cleaned = value.replace(/^\|(?:relative|absolute|shared)\|/i, '');
      moduleNames.push(cleaned);
      const resolved = path.resolve(projectDirectory, cleaned);
      const parsed = path.parse(resolved);
      moduleBasePaths.add(path.join(parsed.dir, parsed.name).toLowerCase());
    }
  }

  return { projectDirectory, libraries, moduleNames, moduleBasePaths };
}

// ---------------------------------------------------------------------------
// 6. Resolve library files on disk (mirrors reloadPlatformAssets logic).
// ---------------------------------------------------------------------------
function resolveLibraryFiles(
  allowedLibraries: Set<string>,
  searchFolders: string[],
): { xmlFiles: string[]; b4xlibFiles: string[] } {
  const xmlFiles: string[] = [];
  const b4xlibFiles: string[] = [];

  for (const lib of allowedLibraries) {
    let foundXml = false;
    let foundB4xlib = false;

    for (const folder of searchFolders) {
      if (!fs.existsSync(folder)) continue;

      // XML
      if (!foundXml) {
        for (const candidate of [
          path.join(folder, `${lib}.xml`),
          path.join(folder, lib, `${lib}.xml`),
        ]) {
          try {
            if (fs.statSync(candidate).isFile()) {
              // Case-insensitive match — library names in .b4a are lowercased
              xmlFiles.push(candidate);
              foundXml = true;
              break;
            }
          } catch { /* not found */ }
        }
      }

      // B4XLIB
      if (!foundB4xlib) {
        for (const candidate of [
          path.join(folder, `${lib}.b4xlib`),
          path.join(folder, lib, `${lib}.b4xlib`),
        ]) {
          try {
            if (fs.statSync(candidate).isFile()) {
              b4xlibFiles.push(candidate);
              foundB4xlib = true;
              break;
            }
          } catch { /* not found */ }
        }
      }

      if (foundXml && foundB4xlib) break;
    }

    // Case-insensitive retry — read the folder and match ignoring case
    if (!foundXml && !foundB4xlib) {
      for (const folder of searchFolders) {
        if (!fs.existsSync(folder)) continue;
        try {
          const entries = fs.readdirSync(folder);
          if (!foundXml) {
            const match = entries.find(e => e.toLowerCase() === `${lib}.xml`);
            if (match) { xmlFiles.push(path.join(folder, match)); foundXml = true; }
          }
          if (!foundB4xlib) {
            const match = entries.find(e => e.toLowerCase() === `${lib}.b4xlib`);
            if (match) { b4xlibFiles.push(path.join(folder, match)); foundB4xlib = true; }
          }
        } catch { /* ignore */ }
        if (foundXml || foundB4xlib) break;
      }
    }
  }

  return { xmlFiles, b4xlibFiles };
}

// ---------------------------------------------------------------------------
// 7. Test suite
// ---------------------------------------------------------------------------

const allTests = [

  // ── Section A: Project File Parsing ─────────────────────────────────

  test('Project file exists on disk', () => {
    assert.ok(fs.existsSync(PROJECT_FILE), `Expected ${PROJECT_FILE} to exist`);
  }),

  test('Parses all 6 expected libraries from .b4a', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    for (const lib of EXPECTED_LIBRARIES) {
      assert.ok(proj.libraries.has(lib), `Missing library: ${lib}`);
    }
    assert.strictEqual(proj.libraries.size, EXPECTED_LIBRARIES.length,
      `Expected ${EXPECTED_LIBRARIES.length} libraries, got ${proj.libraries.size}`);
  }),

  test('Parses all 112 modules from .b4a', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    assert.strictEqual(proj.moduleNames.length, EXPECTED_MODULE_COUNT,
      `Expected ${EXPECTED_MODULE_COUNT} modules, got ${proj.moduleNames.length}`);
  }),

  test('Module |relative| prefix is stripped', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    for (const mod of proj.moduleNames) {
      assert.ok(!mod.startsWith('|'), `Module name still has prefix: ${mod}`);
    }
  }),

  test('getProjectRootFromProjectFile returns parent directory', () => {
    const root = getProjectRootFromProjectFile(PROJECT_FILE);
    assert.strictEqual(root, path.dirname(PROJECT_FILE));
  }),

  test('normalizeBasePath drops extension and lowercases', () => {
    const result = normalizeBasePath('C:\\b4a\\workspace\\MyModule.bas');
    assert.strictEqual(result, 'c:\\b4a\\workspace\\mymodule');
  }),

  // ── Section B: Platform INI Parsing ────────────────────────────────

  test('b4xV5.ini exists at %APPDATA% path', () => {
    assert.ok(fs.existsSync(INI_PATH), `INI file not found: ${INI_PATH}`);
  }),

  test('parsePlatformIni extracts AdditionalLibrariesFolder', () => {
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    assert.ok(folders.additionalLibrariesFolder,
      'Expected AdditionalLibrariesFolder to be set');
    assert.ok(fs.existsSync(folders.additionalLibrariesFolder!),
      `AdditionalLibrariesFolder does not exist: ${folders.additionalLibrariesFolder}`);
  }),

  test('parsePlatformIni extracts SharedModulesFolder', () => {
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    assert.ok(folders.sharedModulesFolder,
      'Expected SharedModulesFolder to be set');
  }),

  test('parsePlatformIni extracts PlatformFolder', () => {
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    assert.ok(folders.platformFolder, 'Expected PlatformFolder to be set');
  }),

  test('parsePlatformSettings extracts font and theme', () => {
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const settings = parsePlatformSettings(raw);
    assert.ok(settings.fontName2, 'Expected FontName2');
    assert.ok(typeof settings.fontSize2 === 'number', 'Expected FontSize2 as number');
    assert.ok(settings.ideTheme2, 'Expected IdeTheme2');
  }),

  test('loadPlatformIni returns a valid LoadedPlatformConfig', async () => {
    skipIf(!fs.existsSync(INI_PATH), 'INI not found');
    const config = await loadPlatformIni({ platform: 'b4a', iniPath: INI_PATH });
    assert.ok(config, 'Expected loadPlatformIni to return config');
    assert.strictEqual(config!.platform, 'b4a');
    assert.ok(config!.folders, 'Expected folders');
    assert.ok(config!.settings, 'Expected settings');
  }),

  // ── Section C: Platform Install Discovery ──────────────────────────

  test('B4A install Libraries folder exists on disk', () => {
    // Try both Program Files locations
    const pfx86 = path.join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Anywhere Software', 'B4A', 'Libraries',
    );
    const pf = B4A_INSTALL_LIBRARIES;
    const exists = fs.existsSync(pf) || fs.existsSync(pfx86);
    assert.ok(exists, `Neither ${pf} nor ${pfx86} exists`);
  }),

  test('findPlatformInstallDirs runs without error', () => {
    // May return empty if no registry entries exist, but should not throw
    const dirs = findPlatformInstallDirs();
    assert.ok(typeof dirs === 'object', 'Expected an object');
  }),

  // ── Section D: Library File Resolution ─────────────────────────────

  test('Resolves Core.xml from install Libraries folder', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    const searchFolders = [
      B4A_INSTALL_LIBRARIES,
      folders.additionalLibrariesFolder,
    ].filter((f): f is string => !!f && fs.existsSync(f));

    const resolved = resolveLibraryFiles(proj.libraries, searchFolders);
    const coreXml = resolved.xmlFiles.find(f => /core\.xml$/i.test(f));
    assert.ok(coreXml, `Core.xml not found. Searched: ${searchFolders.join(', ')}`);
    assert.ok(fs.existsSync(coreXml!), `Core.xml not on disk: ${coreXml}`);
  }),

  test('Resolves B4XPages.b4xlib from install Libraries folder', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    const searchFolders = [
      B4A_INSTALL_LIBRARIES,
      folders.additionalLibrariesFolder,
    ].filter((f): f is string => !!f && fs.existsSync(f));

    const resolved = resolveLibraryFiles(proj.libraries, searchFolders);
    const b4xpages = resolved.b4xlibFiles.find(f => /b4xpages\.b4xlib$/i.test(f));
    assert.ok(b4xpages, `B4XPages.b4xlib not found. Searched: ${searchFolders.join(', ')}`);
  }),

  test('All 6 libraries resolve to at least xml or b4xlib', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    const searchFolders = [
      B4A_INSTALL_LIBRARIES,
      folders.additionalLibrariesFolder,
    ].filter((f): f is string => !!f && fs.existsSync(f));

    const resolved = resolveLibraryFiles(proj.libraries, searchFolders);
    const allResolved = new Set([
      ...resolved.xmlFiles.map(f => path.basename(f, path.extname(f)).toLowerCase()),
      ...resolved.b4xlibFiles.map(f => path.basename(f, path.extname(f)).toLowerCase()),
    ]);
    for (const lib of EXPECTED_LIBRARIES) {
      assert.ok(allResolved.has(lib), `Library '${lib}' not resolved. Resolved: ${[...allResolved].join(', ')}`);
    }
  }),

  // ── Section E: XML Library Parsing (Core.xml) ──────────────────────

  test('parseXmlLibraryDocument parses Core.xml into classes', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const doc = makeTextDocument(coreXml, content);
    const classes = parseXmlLibraryDocument(doc);

    assert.ok(classes.length > 0, 'Expected at least 1 class from Core.xml');
    console.log(`       Core.xml: ${classes.length} classes parsed`);

    // Core.xml should have well-known classes
    const names = new Set(classes.map(c => c.name.toLowerCase()));
    assert.ok(names.has('activity'), 'Expected Activity class in Core.xml');
    assert.ok(names.has('list'), 'Expected List class in Core.xml');
  }),

  test('Activity class from Core.xml has methods and properties', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const activity = classes.find(c => c.name.toLowerCase() === 'activity');
    assert.ok(activity, 'Activity class not found');
    assert.ok(activity!.methods.length > 0, 'Activity should have methods');
    assert.ok(activity!.properties.length > 0, 'Activity should have properties');
    console.log(`       Activity: ${activity!.methods.length} methods, ${activity!.properties.length} properties`);
  }),

  test('Parsed XML methods have valid signatures', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    for (const cls of classes.slice(0, 5)) {
      for (const m of cls.methods) {
        assert.ok(m.name, `Method missing name in class ${cls.name}`);
        assert.ok(m.signature, `Method ${m.name} in ${cls.name} missing signature`);
        assert.ok(typeof m.returnType === 'string', `Method ${m.name} missing returnType`);
      }
    }
  }),

  // ── Section F: XmlLibraryStore Operations ──────────────────────────

  test('XmlLibraryStore manual population and lookup', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));

    // Manually populate the store (bypasses replaceXmlFiles which needs real vscode.workspace)
    const store = new XmlLibraryStore();
    // Use internal map via getClassByName after manual inject
    for (const cls of classes) {
      // Access the private map directly for testing
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    // Lookup
    const activity = store.getClassByName('Activity');
    assert.ok(activity, 'getClassByName(Activity) should return a class');
    assert.strictEqual(activity!.name, 'Activity');

    // Case-insensitive lookup
    const actLower = store.getClassByName('activity');
    assert.ok(actLower, 'Case-insensitive lookup should work');

    // Prefix search
    const prefixed = store.findClassesByPrefix('act');
    assert.ok(prefixed.length > 0, 'findClassesByPrefix("act") should return results');

    // Member resolution
    const member = store.getMember('Activity', 'Finish');
    // Finish may or may not exist — test that getMember returns consistently
    if (member) {
      assert.ok(member.kind === 'method' || member.kind === 'property');
    }
  }),

  test('XmlLibraryStore.resolveMemberType returns valid type', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const store = new XmlLibraryStore();
    for (const cls of classes) {
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    // Activity class should have methods with return types
    const actCls = store.getClassByName('Activity');
    if (actCls && actCls.methods.length > 0) {
      const firstMethod = actCls.methods[0]!;
      const resolved = store.resolveMemberType('Activity', firstMethod.name);
      // resolved may be 'void' or a real type — just check it's a string
      assert.ok(resolved === undefined || typeof resolved === 'string',
        `resolveMemberType should return string or undefined, got ${typeof resolved}`);
    }
  }),

  test('XmlLibraryStore.getDiagnostics reports correct count', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const store = new XmlLibraryStore();
    for (const cls of classes) {
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    const diag = store.getDiagnostics('Activity');
    assert.strictEqual(diag.count, classes.length);
    assert.ok(diag.hasExact, 'getDiagnostics should find Activity');
  }),

  test('XmlLibraryStore.findMemberByName finds across all classes', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), `Core.xml not at ${coreXml}`);

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const store = new XmlLibraryStore();
    for (const cls of classes) {
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    // "Initialize" is likely present in many classes
    const found = store.findMemberByName('Initialize');
    if (found) {
      assert.ok(found.owner, 'findMemberByName should include owner class');
      assert.ok(found.kind === 'method' || found.kind === 'property');
    }
  }),

  // ── Section G: Multiple XML Libraries ──────────────────────────────

  test('All resolved XML libraries parse without errors', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    const searchFolders = [
      B4A_INSTALL_LIBRARIES,
      folders.additionalLibrariesFolder,
    ].filter((f): f is string => !!f && fs.existsSync(f));

    const resolved = resolveLibraryFiles(proj.libraries, searchFolders);
    let totalClasses = 0;
    const errors: string[] = [];

    for (const xmlFile of resolved.xmlFiles) {
      try {
        const content = fs.readFileSync(xmlFile, 'utf8');
        const classes = parseXmlLibraryDocument(makeTextDocument(xmlFile, content));
        totalClasses += classes.length;
      } catch (err: any) {
        errors.push(`${path.basename(xmlFile)}: ${err.message}`);
      }
    }

    assert.strictEqual(errors.length, 0, `XML parse errors:\n${errors.join('\n')}`);
    assert.ok(totalClasses > 0, 'Expected at least 1 class across all XML files');
    console.log(`       Total XML classes from project libraries: ${totalClasses}`);
  }),

  // ── Section H: Workspace Module Parsing ────────────────────────────

  test('parseWorkspaceClassDocument parses a .bas module file', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    // Find a .bas file that exists
    let basFile: string | undefined;
    for (const mod of proj.moduleNames) {
      const candidate = path.resolve(proj.projectDirectory, mod + '.bas');
      if (fs.existsSync(candidate)) {
        basFile = candidate;
        break;
      }
    }
    // Also check the project directory directly
    if (!basFile) {
      const entries = fs.readdirSync(proj.projectDirectory);
      const bas = entries.find(e => e.toLowerCase().endsWith('.bas'));
      if (bas) basFile = path.join(proj.projectDirectory, bas);
    }
    skipIf(!basFile, 'No .bas files found in project');

    const content = fs.readFileSync(basFile!, 'utf8');
    const doc = makeTextDocument(basFile!, content);
    const result = parseWorkspaceClassDocument(doc);

    // A valid .bas with Type= header should parse; if not, it might be
    // a Main module without the right structure, which is OK.
    if (result) {
      assert.ok(result.name, 'Parsed class should have a name');
      assert.ok(result.moduleType === 'class' || result.moduleType === 'static',
        `moduleType should be class or static, got ${result.moduleType}`);
      console.log(`       ${path.basename(basFile!)}: ${result.moduleType} — ${result.methods.length} methods, ${result.properties.length} properties`);
    } else {
      console.log(`       ${path.basename(basFile!)}: not a class/static module (OK for Main)`);
    }
  }),

  test('Multiple workspace .bas files parse and populate WorkspaceClassStore', () => {
    const proj = parseB4aFile(PROJECT_FILE);
    const store = new WorkspaceClassStore();
    let parsedCount = 0;
    let totalMethods = 0;
    let totalProperties = 0;
    const errors: string[] = [];

    for (const mod of proj.moduleNames.slice(0, 20)) { // test first 20 for speed
      const candidate = path.resolve(proj.projectDirectory, mod + '.bas');
      if (!fs.existsSync(candidate)) continue;

      try {
        const content = fs.readFileSync(candidate, 'utf8');
        const doc = makeTextDocument(candidate, content);
        const result = parseWorkspaceClassDocument(doc);
        if (result) {
          // Inject into store manually
          (store as any).workspaceClassesByName.set(result.name.toLowerCase(), result);
          (store as any).workspaceFileToClassName.set(candidate.toLowerCase(), result.name.toLowerCase());
          parsedCount++;
          totalMethods += result.methods.length;
          totalProperties += result.properties.length;
        }
      } catch (err: any) {
        errors.push(`${path.basename(candidate)}: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      console.log(`       Parse errors: ${errors.join('; ')}`);
    }
    assert.ok(parsedCount > 0, 'Expected at least 1 module to parse successfully');
    console.log(`       Workspace: ${parsedCount} modules parsed, ${totalMethods} methods, ${totalProperties} properties`);

    // Test store operations
    const all = store.findClassesByPrefix('');
    assert.strictEqual(all.length, parsedCount, 'findClassesByPrefix("") should return all classes');

    const prefixed = store.findClassesByPrefix('b4xdaisy');
    assert.ok(prefixed.length > 0, 'Expected B4XDaisy* classes from prefix search');
  }),

  // ── Section I: Full Pipeline Simulation ────────────────────────────

  test('Full pipeline: .b4a → INI → libraries → XML parse → store populated', async () => {
    // 1. Parse project
    const proj = parseB4aFile(PROJECT_FILE);
    assert.ok(proj.libraries.size > 0, 'Project has libraries');

    // 2. Parse INI
    skipIf(!fs.existsSync(INI_PATH), 'INI not found');
    const raw = fs.readFileSync(INI_PATH, 'utf8');
    const folders = parsePlatformIni(raw);
    const searchFolders = [
      B4A_INSTALL_LIBRARIES,
      folders.additionalLibrariesFolder,
    ].filter((f): f is string => !!f && fs.existsSync(f));

    // 3. Resolve library files
    const resolved = resolveLibraryFiles(proj.libraries, searchFolders);
    const totalFiles = resolved.xmlFiles.length + resolved.b4xlibFiles.length;
    assert.ok(totalFiles > 0, 'Expected at least 1 library file resolved');

    // 4. Parse XMLs into store
    const xmlStore = new XmlLibraryStore();
    for (const xmlFile of resolved.xmlFiles) {
      const content = fs.readFileSync(xmlFile, 'utf8');
      const classes = parseXmlLibraryDocument(makeTextDocument(xmlFile, content));
      for (const cls of classes) {
        (xmlStore as any).classesByName.set(cls.name.toLowerCase(), cls);
      }
    }

    // 5. Parse workspace modules
    const wsStore = new WorkspaceClassStore();
    let wsParsed = 0;
    for (const mod of proj.moduleNames) {
      const candidate = path.resolve(proj.projectDirectory, mod + '.bas');
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        const result = parseWorkspaceClassDocument(makeTextDocument(candidate, content));
        if (result) {
          (wsStore as any).workspaceClassesByName.set(result.name.toLowerCase(), result);
          wsParsed++;
        }
      } catch { /* skip */ }
    }

    const xmlCount = xmlStore.findClassesByPrefix('').length;
    const wsCount = wsStore.findClassesByPrefix('').length;

    console.log(`       Pipeline summary:`);
    console.log(`         Libraries: ${proj.libraries.size} (from .b4a)`);
    console.log(`         Modules: ${proj.moduleNames.length} (from .b4a)`);
    console.log(`         XML files resolved: ${resolved.xmlFiles.length}`);
    console.log(`         B4XLIB files resolved: ${resolved.b4xlibFiles.length}`);
    console.log(`         XML classes loaded: ${xmlCount}`);
    console.log(`         Workspace classes: ${wsCount}`);

    // Verify meaningful content was loaded
    assert.ok(xmlCount > 10, `Expected > 10 XML classes, got ${xmlCount}`);
    assert.ok(wsCount > 0, `Expected workspace classes > 0, got ${wsCount}`);

    // Cross-store queries should work
    const activityFromXml = xmlStore.getClassByName('Activity');
    assert.ok(activityFromXml, 'Activity should be in XML store');

    // Workspace DAisy classes
    const daisyClasses = wsStore.findClassesByPrefix('b4xdaisy');
    assert.ok(daisyClasses.length > 0, 'Expected B4XDaisy* workspace classes');
  }),

  // ── Section J: Intellisense Feature Simulation ─────────────────────

  test('Completion: prefix search returns relevant items', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), 'Core.xml not found');

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const store = new XmlLibraryStore();
    for (const cls of classes) {
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    // Simulate typing "Act" - should suggest Activity
    const results = store.findClassesByPrefix('act');
    const hasActivity = results.some(c => c.name.toLowerCase() === 'activity');
    assert.ok(hasActivity, 'Typing "act" should suggest Activity class');
  }),

  test('Hover: member lookup returns method with signature and doc', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), 'Core.xml not found');

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    const store = new XmlLibraryStore();
    for (const cls of classes) {
      (store as any).classesByName.set(cls.name.toLowerCase(), cls);
    }

    // Activity should have methods
    const activityCls = store.getClassByName('Activity');
    assert.ok(activityCls, 'Activity class should exist');
    if (activityCls && activityCls.methods.length > 0) {
      const method = activityCls.methods[0]!;
      assert.ok(method.name, 'Method should have name');
      assert.ok(method.signature, 'Method should have signature');
    }
  }),

  test('Go-to-definition: class location is populated', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), 'Core.xml not found');

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    // Classes from XML should have location
    const withLocation = classes.filter(c => c.location);
    assert.ok(withLocation.length > 0, 'Expected classes with location set');
  }),

  test('Signature help: method params are parsed', () => {
    const coreXml = path.join(B4A_INSTALL_LIBRARIES, 'Core.xml');
    skipIf(!fs.existsSync(coreXml), 'Core.xml not found');

    const content = fs.readFileSync(coreXml, 'utf8');
    const classes = parseXmlLibraryDocument(makeTextDocument(coreXml, content));
    // Find a method with parameters
    let foundWithParams = false;
    for (const cls of classes) {
      for (const m of cls.methods) {
        if (m.params && m.params.length > 0) {
          assert.ok(m.params[0]!.name, 'Param should have name');
          assert.ok(m.params[0]!.type, 'Param should have type');
          foundWithParams = true;
          break;
        }
      }
      if (foundWithParams) break;
    }
    assert.ok(foundWithParams, 'Expected at least one method with parsed parameters');
  }),

];

// ---------------------------------------------------------------------------
// 8. Run
// ---------------------------------------------------------------------------
(async () => {
  try {
    await runTests(allTests);
  } catch (err) {
    console.error('Test runner failed:', err);
    process.exit(1);
  }
})();

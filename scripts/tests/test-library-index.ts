import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { libraryIndex, ParsedModuleBlob } from '../../src/storage/libraryIndexSqlite';

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4x-libtest-'));
  try {
    console.log('Using tmp storage:', tmp);
    libraryIndex.init(tmp);

    // create a fake module file
    const fakeFile = path.join(tmp, 'MyModule.bas');
    fs.writeFileSync(fakeFile, 'Sub Test\nEnd Sub\n', 'utf8');

    const stat = fs.statSync(fakeFile);
    const parsed: ParsedModuleBlob = {
      moduleKind: 'class',
      name: 'MyModule',
      methods: [{ name: 'Test', params: [], returnType: 'void', signature: 'Test()' }],
      properties: [],
      doc: 'test module',
    };

    libraryIndex.upsertParsedForPath(fakeFile, Math.floor(stat.mtimeMs), stat.size, parsed);
    const got = libraryIndex.getParsedForPath(fakeFile);
    assert.ok(got, 'Expected parsed blob to be returned');
    assert.strictEqual(got.parsed.name, parsed.name, 'Parsed name should match');

    console.log('Parsed blob roundtrip OK');

    // XML class persistence
    const xmlPath = path.join(tmp, 'lib.xml');
    libraryIndex.upsertXmlClasses(xmlPath, [{ name: 'SampleClass', methods: [], properties: [], doc: 'xml class' }]);
    const xml = libraryIndex.getXmlClassByName('SampleClass');
    assert.ok(xml && xml.name === 'SampleClass', 'XML class persisted and retrievable');

    console.log('XML class persistence OK');

    console.log('All library index tests passed');
  } finally {
    try { libraryIndex.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

try {
  run();
  process.exit(0);
} catch (err) {
  console.error('Library index tests failed', err);
  process.exit(1);
}

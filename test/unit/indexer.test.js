const assert = require('assert');
const { DocumentManager } = require('../../server/indexer/documentManager');

async function runTests() {
  console.log('🚀 Running LSP Indexer Unit Tests...');
  
  const docManager = new DocumentManager();

  // Test 1: Symbol Extraction - Basic Sub
  console.log('Testing: Symbol Extraction - Basic Sub...');
  const content1 = 'Sub HelloWorld()\n  Log "Hello"\nEnd Sub';
  docManager.openDocument('file://test1.bas', content1);
  const completions1 = docManager.getCompletions('');
  const hasHelloWorld = completions1.some(s => s.name === 'HelloWorld');
  assert.ok(hasHelloWorld, 'Should extract Sub name "HelloWorld"');
  console.log('✅ Passed');

  // Test 2: Symbol Extraction - Global Variable
  console.log('Testing: Symbol Extraction - Global Variable...');
  const content2 = 'Dim x As Integer = 10';
  docManager.openDocument('file://test2.bas', content2);
  const completions2 = docManager.getCompletions('');
  const hasX = completions2.some(s => s.name === 'x');
  assert.ok(hasX, 'Should extract global variable "x"');
  console.log('✅ Passed');

  // Test 3: Document Lifecycle - Close Document
  console.log('Testing: Document Lifecycle - Close Document...');
  const uri = 'file://test3.bas';
  docManager.openDocument(uri, 'Sub Test()\nEnd Sub');
  docManager.closeDocument(uri);
  const completions3 = docManager.getCompletions('');
  const hasTest = completions3.some(s => s.name === 'Test');
  assert.strictEqual(hasTest, false, 'Symbols should be removed after document is closed');
  console.log('✅ Passed');

  console.log('\n✨ All Unit Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('\n❌ Tests Failed:', err);
  process.exit(1);
});

const { DocumentManager } = require('../server/indexer/documentManager');
const fs = require('fs');
const path = require('path');

async function verifyCoreIndexing() {
  console.log('🚀 Starting Core Functionality Verification...');
  
  const docManager = new DocumentManager();
  const testFile = '../test/sample.bas';
  const absolutePath = path.resolve(__dirname, testFile);
  
  if (!fs.existsSync(absolutePath)) {
    console.error('❌ Test file not found: ' + absolutePath);
    process.exit(1);
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const uri = 'file://' + absolutePath;

  console.log('Indexing sample file...');
  docManager.openDocument(uri, content);

  // We expect to find symbols in sample.bas
  const completions = docManager.getCompletions('');
  
  if (completions && completions.length > 0) {
    console.log('✅ SUCCESS: Core indexing engine is functional.');
    console.log(`Found ${completions.length} symbols in sample.bas`);
    process.exit(0);
  } else {
    console.error('❌ FAILURE: No symbols were indexed from the sample file.');
    process.exit(1);
  }
}

verifyCoreIndexing().catch(err => {
  console.error('Unexpected error during verification:', err);
  process.exit(1);
});

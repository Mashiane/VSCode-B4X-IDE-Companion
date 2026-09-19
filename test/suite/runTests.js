const { runTests } = require('@vscode/test-electron');
const path = require('path');

try {
  runTests({
    extensionDevelopmentPath: path.resolve(__dirname, '../../'),
    extensionTestsPath: path.resolve(__dirname, 'suite'),
  });
} catch (err) {
  console.error('Failed to launch tests:', err);
  process.exit(1);
}

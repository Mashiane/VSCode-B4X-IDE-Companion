import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // compiled tests live under `dist/src/test`, so walk up to repo root
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

main();

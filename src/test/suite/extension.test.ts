import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

describe('B4X integration tests', () => {
  it('Open B4X Project loads libraries and writes diagnostics', async function () {
    this.timeout(300000);

    const projectFile = 'C:\\b4a\\workspace\\0SithasoDaisyUIKit\\B4A\\B4XDaisyUIKitDemo.b4a';
    if (!fs.existsSync(projectFile)) {
      // Skip if the test project isn't available in this environment
      this.skip();
      return;
    }

    const projectUri = vscode.Uri.file(projectFile);
    const projectRoot = path.dirname(projectFile);

    // Ensure workspace folder is set to projectRoot
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      const ok = vscode.workspace.updateWorkspaceFolders(0, null, { uri: vscode.Uri.file(projectRoot), name: path.basename(projectRoot) });
      if (!ok) {
        throw new Error('Failed to add workspace folder for tests');
      }
      await new Promise(res => setTimeout(res, 500));
    } else {
      const existing = vscode.workspace.workspaceFolders![0]!;
      if (path.resolve(existing.uri.fsPath).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) {
        const ok = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders!.length, { uri: vscode.Uri.file(projectRoot), name: path.basename(projectRoot) });
        if (!ok) throw new Error('Failed to replace workspace folder for tests');
        await new Promise(res => setTimeout(res, 500));
      }
    }

    // Activate the extension before executing its commands
    const ext = vscode.extensions.getExtension('AneleMbangaMashy.b4x-intellisense');
    if (!ext) throw new Error('Extension AneleMbangaMashy.b4x-intellisense not found');
    await ext.activate();

    // Wait for commands to be registered (reduce flakiness)
    const waitForCommand = async (cmd: string, timeout = 30000) => {
      const interval = 500;
      let waited = 0;
      while (waited < timeout) {
        const cmds = await vscode.commands.getCommands(true);
        if (cmds.includes(cmd)) return;
        await new Promise(res => setTimeout(res, interval));
        waited += interval;
      }
      throw new Error(`Command ${cmd} not registered after ${timeout}ms`);
    };

    await waitForCommand('b4xIntellisense.openB4xProject');
    await waitForCommand('b4xIntellisense.dumpDiagnostics');

    // Execute openB4xProject with the project file URI
    await vscode.commands.executeCommand('b4xIntellisense.openB4xProject', projectUri);

    // Request a diagnostics dump so we can assert on the generated file
    await vscode.commands.executeCommand('b4xIntellisense.dumpDiagnostics');

    // Wait for dumpDiagnostics output file to appear
    const diagPath = path.join(projectRoot, 'b4x-intellisense-diagnostics.json');
    const maxWait = 120000;
    const interval = 1000;
    let waited = 0;
    while (!fs.existsSync(diagPath) && waited < maxWait) {
      await new Promise(res => setTimeout(res, interval));
      waited += interval;
    }
    assert.ok(fs.existsSync(diagPath), `Diagnostics file not found at ${diagPath}`);

    const content = JSON.parse(fs.readFileSync(diagPath, 'utf8'));
    assert.ok(Array.isArray(content.stores.loadedXmlFiles), 'diagnostics.stores.loadedXmlFiles missing');
    assert.ok(Array.isArray(content.stores.loadedModuleFiles), 'diagnostics.stores.loadedModuleFiles missing');
    assert.ok(typeof content.stores.xmlClassCount === 'number', 'xmlClassCount missing or wrong type');
  });
});

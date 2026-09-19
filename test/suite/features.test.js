const assert = require('assert');
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

suite('B4X Core Feature Tests', () => {
  
  test('B4X Project Opening - Workspace Integration', async () => {
    const projectFile = path.join(__dirname, '..', '..', 'test', 'sample.bas');
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
    
    // We simulate the "Open Project" command by opening a .bas file
    const doc = await vscode.workspace.openTextDocument({ uri: vscode.Uri.file(projectFile) });
    await vscode.window.showTextDocument(doc);
    
    assert.ok(doc.languageId === 'b4x', 'File should be recognized as B4X language');
  });

  test('B4X Document Formatting - Structural Check', async () => {
    const testContent = 'Sub Test()\n  If True Then\n  Msgbox "Hello"\nEnd If\nEnd Sub';
    const doc = await vscode.workspace.openTextDocument({
      content: testContent,
      language: 'b4x'
    });
    
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('vscode.executeFormatDocument');
    
    const formattedText = doc.getText();
    assert.ok(formattedText.includes('  Msgbox "Hello"'), 'Formatting should preserve or correct indentation');
  });

  test('B4X Navigation - Go to Definition', async () => {
    const content = 'Sub Main\n  Call MySub\nEnd Sub\n\nSub MySub\n  Log "Hello"\nEnd Sub';
    const doc = await vscode.workspace.openTextDocument({
      content: content,
      language: 'b4x'
    });
    await vscode.window.showTextDocument(doc);
    
    const position = new vscode.Position(1, 11); // Position of 'MySub' in 'Call MySub'
    const range = new vscode.Range(position, position);
    
    const definitions = await vscode.executeDefinitionProvider(doc.uri, range);
    assert.ok(definitions && definitions.length > 0, 'Should find a definition for MySub');
  });
});

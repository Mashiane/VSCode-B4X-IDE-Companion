const assert = require('assert');
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

async function runE2ETests() {
  console.log('🚀 Starting B4X Extension End-to-End Suite...');
  
  // Setup: Create a temporary test workspace
  const testWorkspace = path.join(__dirname, '..', '..', 'test', 'e2e-workspace');
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }

  try {
    // Journey 1: Project Initialization & Language Recognition
    console.log('Testing Journey 1: Project Initialization...');
    const projectFile = path.join(testWorkspace, 'Main.b4a');
    fs.writeFileSync(projectFile, 'Sub Main\n  Log "Hello"\nEnd Sub');
    const doc = await vscode.workspace.openTextDocument({ uri: vscode.Uri.file(projectFile) });
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'b4x', 'File should be recognized as B4X');
    console.log('✅ Journey 1 Passed');

    // Journey 2: IntelliSense - Keyword Completions
    console.log('Testing Journey 2: Keyword Completions...');
    const compDoc = await vscode.workspace.openTextDocument({
      content: 'Sub Test()\n  ',
      language: 'b4x'
    });
    await vscode.window.showTextDocument(compDoc);
    const position = new vscode.Position(1, 2);
    const completions = await vscode.executeCompletionItemProvider(compDoc.uri, position);
    const hasIf = completions.some(item => item.label.toLowerCase().includes('if'));
    const hasFor = completions.some(item => item.label.toLowerCase().includes('for'));
    assert.ok(hasIf && hasFor, 'Should provide B4X keyword completions (If, For)');
    console.log('✅ Journey 2 Passed');

    // Journey 3: Navigation - Go to Definition
    console.log('Testing Journey 3: Go to Definition...');
    const navContent = 'Sub Main\n  Call MySub\nEnd Sub\n\nSub MySub\n  Log "Hello"\nEnd Sub';
    const navDoc = await vscode.workspace.openTextDocument({
      content: navContent,
      language: 'b4x'
    });
    await vscode.window.showTextDocument(navDoc);
    const navPos = new vscode.Position(1, 11);
    const navRange = new vscode.Range(navPos, navPos);
    const definitions = await vscode.executeDefinitionProvider(navDoc.uri, navRange);
    assert.ok(definitions && definitions.length > 0, 'Should resolve definition for MySub');
    console.log('✅ Journey 3 Passed');

    // Journey 4: Refactoring - Rename Symbol
    console.log('Testing Journey 4: Rename Symbol...');
    const renContent = 'Sub Main\n  Dim x As Integer\n  Log x\nEnd Sub';
    const renDoc = await vscode.workspace.openTextDocument({
      content: renContent,
      language: 'b4x'
    });
    await vscode.window.showTextDocument(renDoc);
    const renPos = new vscode.Position(1, 11);
    const renRange = new vscode.Range(renPos, renPos);
    const workspaceEdit = await vscode.executeRenameProvider(renDoc.uri, renRange, 'newVar');
    await vscode.workspace.applyEdit(workspaceEdit);
    assert.ok(renDoc.getText().includes('Dim newVar'), 'Variable declaration should be renamed');
    console.log('✅ Journey 4 Passed');

    // Journey 5: Formatting - Structural Indentation
    console.log('Testing Journey 5: Formatting...');
    const fmtContent = 'Sub Test()\nIf True Then\nMsgbox "Hi"\nEnd If\nEnd Sub';
    const fmtDoc = await vscode.workspace.openTextDocument({
      content: fmtContent,
      language: 'b4x'
    });
    await vscode.window.showTextDocument(fmtDoc);
    await vscode.commands.executeCommand('vscode.executeFormatDocument');
    assert.ok(fmtDoc.getText().includes('  Msgbox "Hi"'), 'Indentation should be applied');
    console.log('✅ Journey 5 Passed');

    // Journey 6: Diagnostics - Type Placement
    console.log('Testing Journey 6: Diagnostics...');
    const diagContent = 'Sub Main\n  Type MyType(X As Int, Y As Int)\nEnd Sub';
    const diagDoc = await vscode.workspace.openTextDocument({
      content: diagContent,
      language: 'b4x'
    });
    await vscode.window.showTextDocument(diagDoc);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const diagnostics = vscode.languages.getDiagnostics(diagDoc.uri);
    const hasTypeWarning = diagnostics.some(d => d.message.includes('Type'));
    assert.ok(hasTypeWarning, 'Should warn when Type is declared inside a Sub');
    console.log('✅ Journey 6 Passed');

    console.log('\n✨ ALL E2E USER JOURNEYS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ E2E Test Suite Failed:');
    console.error(err);
    process.exit(1);
  }
}

runE2ETests();

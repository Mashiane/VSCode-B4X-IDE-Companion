import * as vscode from 'vscode';

export default class ExtractMethodCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract];

  public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.ProviderResult<vscode.CodeAction[]> {
    // Only offer for B4X files
    if (document.languageId !== 'b4x') return [];
    if (range.isEmpty) return [];

    // Only offer for non-empty selections that contain meaningful code
    const selectedText = document.getText(range).trim();
    if (!selectedText) return [];

    const action = new vscode.CodeAction('Extract Method', vscode.CodeActionKind.RefactorExtract);
    action.command = { command: 'b4xIntellisense.extractMethod', title: 'Extract Method' };
    action.isPreferred = true;
    return [action];
  }
}

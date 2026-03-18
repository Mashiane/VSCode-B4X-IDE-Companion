import * as vscode from 'vscode';
import { Range } from 'vscode';

export default class ExtractMethodCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract];

  public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.ProviderResult<vscode.CodeAction[]> {
    if (range.isEmpty) return [];

    const action = new vscode.CodeAction('Extract Method', vscode.CodeActionKind.RefactorExtract);
    action.command = { command: 'b4xIntellisense.extractMethod', title: 'Extract Method' };
    action.isPreferred = true;
    return [action];
  }
}

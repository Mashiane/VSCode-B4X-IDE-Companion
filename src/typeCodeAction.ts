import * as vscode from 'vscode';

export class TypeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'b4x-intellisense') continue;
      if (!/Type declarations must be defined/i.test(diag.message)) continue;

      const moveToClass = new vscode.CodeAction('Move Type into Sub Class_Globals', vscode.CodeActionKind.QuickFix);
      moveToClass.edit = this.createMoveEdit(document, diag.range, 'class');
      moveToClass.diagnostics = [diag];
      moveToClass.isPreferred = true;

      const moveToProcess = new vscode.CodeAction('Move Type into Sub Process_Globals', vscode.CodeActionKind.QuickFix);
      moveToProcess.edit = this.createMoveEdit(document, diag.range, 'process');
      moveToProcess.diagnostics = [diag];

      actions.push(moveToClass, moveToProcess);
    }

    return actions;
  }

  private createMoveEdit(document: vscode.TextDocument, typeRange: vscode.Range, targetScope: 'class' | 'process'): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const typeText = document.getText(typeRange);

    // Remove original type block
    edit.delete(document.uri, typeRange);

    // Find target sub
    const targetRegex = targetScope === 'class' ? /^\s*Sub\s+Class_Globals\b/i : /^\s*Sub\s+Process_Globals\b/i;
    let insertPos: vscode.Position | undefined;
    for (let i = 0; i < document.lineCount; i += 1) {
      const line = document.lineAt(i).text.replace(/'.*$/, '').trim();
      if (targetRegex.test(line)) {
        // find End Sub corresponding
        for (let j = i + 1; j < document.lineCount; j += 1) {
          const l = document.lineAt(j).text.replace(/'.*$/, '').trim();
          if (/^\s*End\s+Sub\b/i.test(l)) {
            insertPos = new vscode.Position(j, 0);
            break;
          }
        }
        break;
      }
    }

    if (!insertPos) {
      // create the sub at top (after initial metadata lines if present)
      let top = 0;
      for (let i = 0; i < Math.min(30, document.lineCount); i += 1) {
        const t = document.lineAt(i).text.trim();
        if (t === '' || t.startsWith("'")) continue;
        // stop before first Sub or If file header marker
        if (/^Sub\b/i.test(t) || /^@EndOfDesignText@/i.test(t)) {
          top = i;
          break;
        }
      }
      insertPos = new vscode.Position(top, 0);

      // prepare wrapper
      const wrapper = `Sub ${targetScope === 'class' ? 'Class_Globals' : 'Process_Globals'}\n${typeText}\nEnd Sub\n\n`;
      edit.insert(document.uri, insertPos, wrapper);
      return edit;
    }

    // Insert before End Sub
    const insertionText = `${typeText}\n`;
    edit.insert(document.uri, insertPos, insertionText);
    return edit;
  }
}

export default TypeCodeActionProvider;

import * as vscode from 'vscode';
import { findCodeSmells, CodeSmellItem } from './codeSmellDiagnosticsCore';
import { validateEventHandlers } from './eventHandlerValidatorCore';

export function provideCodeSmellDiagnosticsForDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(document.lineAt(i).text);
  }

  const items: CodeSmellItem[] = findCodeSmells(lines);
  const eventItems = validateEventHandlers(lines);
  const diagnostics: vscode.Diagnostic[] = [];

  for (const ev of eventItems) {
    const start = new vscode.Position(ev.line, ev.startCol);
    const end = new vscode.Position(ev.line, Math.min(document.lineAt(ev.line).text.length, ev.endCol));
    const range = new vscode.Range(start, end);

    const diag = new vscode.Diagnostic(range, `[${ev.ruleId}] ${ev.message}`, vscode.DiagnosticSeverity.Warning);
    diag.source = 'b4x-event-validator';
    diag.code = ev.ruleId;
    diagnostics.push(diag);
  }

  for (const item of items) {
    const start = new vscode.Position(item.line, item.startCol);
    const end = new vscode.Position(item.line, Math.min(document.lineAt(item.line).text.length, item.endCol));
    const range = new vscode.Range(start, end);

    const severity = item.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

    const diag = new vscode.Diagnostic(range, `[${item.ruleId}] ${item.message}`, severity);
    diag.source = 'b4x-code-smell';
    diag.code = item.ruleId;
    diagnostics.push(diag);
  }

  return diagnostics;
}

export function registerCodeSmellDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-code-smells');
  context.subscriptions.push(collection);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('b4x', new CodeSmellActionProvider(), {
      providedCodeActionKinds: CodeSmellActionProvider.providedCodeActionKinds,
    })
  );

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') {
      return;
    }

    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const enabled = config.get<boolean>('enableCodeSmellDiagnostics', true);

    if (!enabled) {
      collection.delete(document.uri);
      return;
    }

    try {
      const diagnostics = provideCodeSmellDiagnosticsForDocument(document);
      collection.set(document.uri, diagnostics);
    } catch (err) {
      console.error('Failed to compute code smell diagnostics', err);
    }
  };

  if (vscode.window.activeTextEditor) {
    refresh(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc)));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => refresh(doc)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('b4xIntellisense.enableCodeSmellDiagnostics')) {
        for (const doc of vscode.workspace.textDocuments) {
          refresh(doc);
        }
      }
    })
  );

  return collection;
}

export class CodeSmellActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.code === 'B4X-CS025') {
        const lineText = document.lineAt(diag.range.start.line).text;
        const propMatch = /Props\.GetDefault\s*\(\s*"[^"]+"\s*,\s*[^)]+\)/i.exec(lineText);
        if (propMatch) {
          const original = propMatch[0];
          const fix = new vscode.CodeAction(
            "Wrap with 'xui.PaintOrColorToColor(...)'",
            vscode.CodeActionKind.QuickFix
          );
          fix.edit = new vscode.WorkspaceEdit();
          const matchStart = lineText.indexOf(original);
          const matchRange = new vscode.Range(
            new vscode.Position(diag.range.start.line, matchStart),
            new vscode.Position(diag.range.start.line, matchStart + original.length)
          );
          fix.edit.replace(document.uri, matchRange, `xui.PaintOrColorToColor(${original})`);
          fix.diagnostics = [diag];
          fix.isPreferred = true;
          actions.push(fix);
        }
      } else if (diag.code === 'B4X-CS023') {
        const fix = new vscode.CodeAction(
          "Insert 'DesignerCreateView' scaffold",
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        const scaffold = `\n'Base type must be Object\nPublic Sub DesignerCreateView (Base As Object, Lbl As Label, Props As Map)\n    mBase = Base\n    Tag = mBase.Tag\n    mBase.Tag = Me\nEnd Sub\n`;
        fix.edit.insert(document.uri, new vscode.Position(document.lineCount, 0), scaffold);
        fix.diagnostics = [diag];
        actions.push(fix);
      } else if (diag.code === 'B4X-CS024') {
        const fix = new vscode.CodeAction(
          "Insert 'Base_Resize' scaffold",
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        const scaffold = `\nPrivate Sub Base_Resize (Width As Double, Height As Double)\n\nEnd Sub\n`;
        fix.edit.insert(document.uri, new vscode.Position(document.lineCount, 0), scaffold);
        fix.diagnostics = [diag];
        actions.push(fix);
      }
    }

    return actions;
  }
}

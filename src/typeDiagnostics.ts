import * as vscode from 'vscode';

import { findMisplacedTypeRanges } from './typeDiagnosticsCore';

export function provideTypeDiagnosticsForDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i += 1) {
    lines.push(document.lineAt(i).text);
  }

  const ranges = findMisplacedTypeRanges(lines);
  for (const r of ranges) {
    const start = new vscode.Position(r.startLine, Math.max(0, (document.lineAt(r.startLine).text.search(/\S|$/))));
    const endLine = Math.min(document.lineCount - 1, r.endLine);
    const endChar = document.lineAt(endLine).text.length;
    const range = new vscode.Range(start, new vscode.Position(endLine, endChar));
    const diag = new vscode.Diagnostic(range, 'Type declarations must be defined inside Sub Class_Globals or Sub Process_Globals', vscode.DiagnosticSeverity.Warning);
    diag.source = 'b4x-intellisense';
    diagnostics.push(diag);
  }

  return diagnostics;
}

export function registerTypeDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-type');
  context.subscriptions.push(collection);

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') {
      return;
    }

    try {
      const diagnostics = provideTypeDiagnosticsForDocument(document);
      collection.set(document.uri, diagnostics);
    } catch (err) {
      console.error('Failed to compute type diagnostics', err);
    }
  };

  if (vscode.window.activeTextEditor) {
    refresh(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc)));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => refresh(doc)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)));

  return collection;
}

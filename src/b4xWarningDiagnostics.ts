import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  analyzeModuleWarnings,
  WarningDiagnosticItem,
  B4XPlatform,
} from './b4xWarningEngineCore';

export class B4XWarningActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'b4x-warning-engine') {
        continue;
      }

      const match = /\[Warning #(\d+)\]/.exec(diagnostic.message);
      const warnId = match ? parseInt(match[1]!, 10) : 0;

      // 1. Line-level 'ignore comment
      const line = document.lineAt(diagnostic.range.start.line);
      if (!line.text.includes("'ignore")) {
        const ignoreAction = new vscode.CodeAction(
          `Ignore this warning (add 'ignore)`,
          vscode.CodeActionKind.QuickFix
        );
        ignoreAction.edit = new vscode.WorkspaceEdit();
        ignoreAction.edit.insert(document.uri, new vscode.Position(line.lineNumber, line.text.length), " 'ignore");
        ignoreAction.diagnostics = [diagnostic];
        actions.push(ignoreAction);
      }

      // 2. Module-level #IgnoreWarnings attribute
      if (warnId > 0) {
        const globalIgnoreAction = new vscode.CodeAction(
          `Ignore warning #${warnId} in this module (#IgnoreWarnings: ${warnId})`,
          vscode.CodeActionKind.QuickFix
        );
        globalIgnoreAction.edit = new vscode.WorkspaceEdit();
        // Check if #IgnoreWarnings already exists in header
        let existingLine = -1;
        for (let i = 0; i < Math.min(25, document.lineCount); i++) {
          if (/^\s*#IgnoreWarnings:/i.test(document.lineAt(i).text)) {
            existingLine = i;
            break;
          }
        }
        if (existingLine >= 0) {
          const curText = document.lineAt(existingLine).text;
          globalIgnoreAction.edit.replace(
            document.uri,
            new vscode.Range(new vscode.Position(existingLine, 0), new vscode.Position(existingLine, curText.length)),
            `${curText}, ${warnId}`
          );
        } else {
          globalIgnoreAction.edit.insert(
            document.uri,
            new vscode.Position(0, 0),
            `#IgnoreWarnings: ${warnId}\n`
          );
        }
        globalIgnoreAction.diagnostics = [diagnostic];
        actions.push(globalIgnoreAction);
      }

      // 3. Rule-specific automated fixes
      if (warnId === 6) {
        // Missing screen unit 'dip' -> append dip
        const wordRange = document.getWordRangeAtPosition(diagnostic.range.start);
        if (wordRange) {
          const word = document.getText(wordRange);
          const fixAction = new vscode.CodeAction(
            `Append 'dip' unit (${word} -> ${word}dip)`,
            vscode.CodeActionKind.QuickFix
          );
          fixAction.edit = new vscode.WorkspaceEdit();
          fixAction.edit.replace(document.uri, wordRange, `${word}dip`);
          fixAction.isPreferred = true;
          fixAction.diagnostics = [diagnostic];
          actions.push(fixAction);
        }
      } else if (warnId === 5) {
        // Missing declaration type -> add ' As String'
        const fixAction = new vscode.CodeAction(
          `Add 'As String' to declaration`,
          vscode.CodeActionKind.QuickFix
        );
        fixAction.edit = new vscode.WorkspaceEdit();
        fixAction.edit.insert(document.uri, diagnostic.range.end, ` As String`);
        fixAction.isPreferred = true;
        fixAction.diagnostics = [diagnostic];
        actions.push(fixAction);
      } else if (warnId === 19) {
        // Empty catch block -> insert Log(LastException.Message)
        const fixAction = new vscode.CodeAction(
          `Insert Log(LastException.Message)`,
          vscode.CodeActionKind.QuickFix
        );
        fixAction.edit = new vscode.WorkspaceEdit();
        fixAction.edit.insert(
          document.uri,
          new vscode.Position(diagnostic.range.start.line, line.text.length),
          `\n\tLog(LastException.Message)`
        );
        fixAction.isPreferred = true;
        fixAction.diagnostics = [diagnostic];
        actions.push(fixAction);
      } else if (warnId === 33) {
        // DoEvents -> replace with Sleep(0)
        const fixAction = new vscode.CodeAction(
          `Replace DoEvents with 'Sleep(0)'`,
          vscode.CodeActionKind.QuickFix
        );
        fixAction.edit = new vscode.WorkspaceEdit();
        fixAction.edit.replace(document.uri, diagnostic.range, `Sleep(0)`);
        fixAction.isPreferred = true;
        fixAction.diagnostics = [diagnostic];
        actions.push(fixAction);
      } else if (warnId === 34) {
        // Msgbox -> MsgboxAsync
        const fixAction = new vscode.CodeAction(
          `Replace Msgbox with 'MsgboxAsync'`,
          vscode.CodeActionKind.QuickFix
        );
        fixAction.edit = new vscode.WorkspaceEdit();
        fixAction.edit.replace(document.uri, diagnostic.range, `MsgboxAsync`);
        fixAction.isPreferred = true;
        fixAction.diagnostics = [diagnostic];
        actions.push(fixAction);
      }
    }

    return actions;
  }
}

/**
 * Provides warning diagnostics for a document.
 */
export function provideWarningDiagnosticsForDocument(
  document: vscode.TextDocument,
  platform: B4XPlatform = 'b4a'
): vscode.Diagnostic[] {
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(document.lineAt(i).text);
  }

  const fileName = path.basename(document.fileName);
  const moduleName = fileName.replace(/\.[^/.]+$/, '');
  const isB4XPages = lines.some((l) => /B4XPages\b/i.test(l)) || moduleName.toLowerCase().startsWith('b4xpage');

  const items: WarningDiagnosticItem[] = analyzeModuleWarnings(lines, {
    platform,
    isB4XPages,
    moduleName,
  });

  const diagnostics: vscode.Diagnostic[] = [];

  for (const item of items) {
    const lineText = document.lineAt(item.line).text;
    const startCol = Math.max(0, Math.min(item.startCol, lineText.length));
    const endCol = Math.max(startCol + 1, Math.min(item.endCol, lineText.length));
    const range = new vscode.Range(new vscode.Position(item.line, startCol), new vscode.Position(item.line, endCol));

    const diag = new vscode.Diagnostic(
      range,
      item.message,
      vscode.DiagnosticSeverity.Warning
    );
    diag.source = 'b4x-warning-engine';
    diag.code = `B4X-W${item.warningId}`;
    diagnostics.push(diag);
  }

  return diagnostics;
}

/**
 * Registers real-time compiler warning diagnostics in VS Code.
 */
export function registerWarningDiagnostics(
  context: vscode.ExtensionContext,
  getPlatform: () => B4XPlatform = () => 'b4a'
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-compiler-warnings');
  context.subscriptions.push(collection);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('b4x', new B4XWarningActionProvider(), {
      providedCodeActionKinds: B4XWarningActionProvider.providedCodeActionKinds,
    })
  );

  let debounceTimer: NodeJS.Timeout | undefined;

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') {
      return;
    }

    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    const enabled = config.get<boolean>('enableCompilerWarnings', true);

    if (!enabled) {
      collection.delete(document.uri);
      return;
    }

    const platform = getPlatform();
    const diags = provideWarningDiagnosticsForDocument(document, platform);
    collection.set(document.uri, diags);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        refresh(event.document);
      }, 250);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      refresh(document);
    })
  );

  // Initialize open documents
  vscode.workspace.textDocuments.forEach((doc) => {
    refresh(doc);
  });

  return collection;
}

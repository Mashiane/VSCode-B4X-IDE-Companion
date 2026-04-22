/**
 * B4X CallSub Target Validation
 * Warns when CallSub/CallSubDelayed/CallSub3 references a Sub that doesn't exist.
 */

import * as vscode from 'vscode';
import { stripComment } from './b4xDocParser';

interface CallSubCall {
  moduleName: string;
  subName: string;
  range: vscode.Range;
  isDelayed: boolean;
}

export function provideCallSubDiagnosticsForDocument(
  document: vscode.TextDocument,
  workspaceSubs: Map<string, Set<string>>,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const calls = extractCallSubCalls(document);

  for (const call of calls) {
    const moduleLower = call.moduleName.toLowerCase();
    const subNameLower = call.subName.toLowerCase();

    // Check if the module exists and has the Sub
    const moduleSubs = workspaceSubs.get(moduleLower);
    if (!moduleSubs) {
      // We can't verify this module (might be external library)
      continue;
    }

    if (!moduleSubs.has(subNameLower)) {
      const keyword = call.isDelayed ? 'CallSubDelayed' : 'CallSub';
      const diag = new vscode.Diagnostic(
        call.range,
        `Sub '${call.subName}' not found in module '${call.moduleName}'. ${keyword} will fail at runtime.`,
        vscode.DiagnosticSeverity.Warning,
      );
      diag.source = 'b4x-callsu';
      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

/**
 * Extract all CallSub/CallSubDelayed/CallSub3 calls from a document.
 */
function extractCallSubCalls(document: vscode.TextDocument): CallSubCall[] {
  const calls: CallSubCall[] = [];
  const text = document.getText();
  const lines = text.split(/\r?\n/);

  // Match: CallSub("Module", "SubName") or CallSubDelayed(moduleVar, "SubName")
  // Also: CallSub3("Module", "SubName", arg1, arg2), CallSubDelayed2, CallSubDelayed3
  // Regex handles all variants: CallSub, CallSub3, CallSubDelayed, CallSubDelayed2, CallSubDelayed3
  const callSubVariants = 'CallSub(?:Delayed2|Delayed3|Delayed|3)?';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const code = stripComment(line);
    let match: RegExpExecArray | null;

    // Reset regex lastIndex for each line
    // Handles: CallSub("Module", "Sub") and CallSub(Module, "Sub")
    // Variants: CallSub, CallSub3, CallSubDelayed, CallSubDelayed2, CallSubDelayed3
    const lineRegex = new RegExp(`\\b${callSubVariants}\\s*\\(\\s*"?([A-Za-z_][A-Za-z0-9_]*)?"?\\s*,\\s*"([^"]+)"\\s*`, 'gi');
    while ((match = lineRegex.exec(code)) !== null) {
      const functionName = match[0]?.match(/\b(CallSub\w*)\b/i)?.[1];
      const moduleName = match[1];
      const subName = match[2];

      if (!functionName || !moduleName || !subName) continue;

      const startChar = match.index;
      const endChar = startChar + match[0].length;
      const range = new vscode.Range(i, startChar, i, endChar);

      calls.push({
        moduleName,
        subName,
        range,
        isDelayed: functionName.toLowerCase().includes('delayed'),
      });
    }
  }

  return calls;
}

/**
 * Collect all Sub names defined in each module across the workspace.
 */
export function collectWorkspaceSubs(
  workspaceClasses: any,
  xmlLibraries: any,
): Map<string, Set<string>> {
  const subs = new Map<string, Set<string>>();

  // Collect from workspace classes
  try {
    const allClasses = workspaceClasses?.getAllClasses?.() ?? workspaceClasses?.findClassesByPrefix?.('') ?? [];
    for (const cls of allClasses) {
      const key = cls.name.toLowerCase();
      if (!subs.has(key)) {
        subs.set(key, new Set<string>());
      }
      const moduleSubs = subs.get(key)!;
      for (const method of cls.methods ?? []) {
        const name = method.name ?? method.signature?.split('(')[0]?.trim();
        if (name) {
          moduleSubs.add(name.toLowerCase());
        }
      }
    }
  } catch {
    // ignore
  }

  // Collect from XML libraries
  try {
    const xmlClasses = xmlLibraries?.getAllClasses?.() ?? [];
    for (const cls of xmlClasses) {
      const key = cls.name.toLowerCase();
      if (!subs.has(key)) {
        subs.set(key, new Set<string>());
      }
      const moduleSubs = subs.get(key)!;
      for (const method of cls.methods ?? []) {
        const name = method.name ?? method.signature?.split('(')[0]?.trim();
        if (name) {
          moduleSubs.add(name.toLowerCase());
        }
      }
    }
  } catch {
    // ignore
  }

  return subs;
}

export function registerCallSubDiagnostics(
  context: vscode.ExtensionContext,
  workspaceClasses: any,
  xmlLibraries: any,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-callsub');
  context.subscriptions.push(collection);

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') {
      return;
    }

    try {
      const workspaceSubs = collectWorkspaceSubs(workspaceClasses, xmlLibraries);
      const diagnostics = provideCallSubDiagnosticsForDocument(document, workspaceSubs);
      collection.set(document.uri, diagnostics);
    } catch (err) {
      console.error('Failed to compute CallSub diagnostics', err);
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

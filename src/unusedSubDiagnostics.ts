/**
 * VS Code diagnostic provider for unused Sub detection.
 *
 * Follows the pattern established by callSubDiagnostics.ts:
 * - provideUnusedSubDiagnosticsForDocument() â€” pure function, returns Diagnostic[]
 * - registerUnusedSubDiagnostics() â€” creates DiagnosticCollection, subscribes to events
 *
 * Successor to jMashProjectProfile's "Find unused subroutines" wishlist item.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import {
  SubDeclaration,
  findUnusedSubs,
  collectAllKnownEventNames,
  B4X_LIFECYCLE_SUBS,
} from './unusedSubDiagnosticsCore';

/**
 * Collect all Sub declarations from workspace classes.
 * Returns an array of SubDeclaration for each method in each module.
 */
function collectSubDeclarations(
  workspaceClasses: WorkspaceClassStore,
): SubDeclaration[] {
  const declarations: SubDeclaration[] = [];
  const allClasses = workspaceClasses.getAllClasses();

  for (const cls of allClasses) {
    const moduleName = cls.name;
    for (const method of cls.methods) {
      // Skip Class_Globals and Process_Globals (handled as lifecycle Subs)
      if (
        method.name.toLowerCase() === 'class_globals' ||
        method.name.toLowerCase() === 'process_globals'
      ) {
        continue;
      }

      declarations.push({
        name: method.name,
        moduleName: moduleName,
        line: method.location?.range.start.line ?? 0,
        isPrivate: method.isPublic === false,
        filePath: cls.filePath,
      });
    }
  }

  return declarations;
}

/**
 * Collect all known event names from workspace classes and XML libraries.
 * These are used to identify event handler Subs that should be excluded.
 */
function collectEventNames(
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): string[] {
  const workspaceEvents = new Map<string, string[]>();
  const libraryEvents = new Map<string, string[]>();

  // Collect from workspace classes
  for (const cls of workspaceClasses.getAllClasses()) {
    const events: string[] = [];
    for (const event of cls.events) {
      events.push(event.name);
    }
    if (events.length > 0) {
      workspaceEvents.set(cls.name, events);
    }
  }

  // Collect from XML libraries
  for (const cls of xmlLibraries.getAllClasses()) {
    const events: string[] = [];
    if (cls.events) {
      for (const event of cls.events) {
        events.push(event.name);
      }
    }
    if (events.length > 0) {
      libraryEvents.set(cls.name, events);
    }
  }

  return collectAllKnownEventNames(workspaceEvents, libraryEvents);
}

/**
 * Provide unused Sub diagnostics for a document.
 *
 * This is a pure function that can be called from tests.
 */
export function provideUnusedSubDiagnosticsForDocument(
  document: vscode.TextDocument,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): vscode.Diagnostic[] {
  // Check if diagnostics are enabled
  const config = vscode.workspace.getConfiguration('b4xIntellisense');
  if (!config.get<boolean>('enableUnusedSubDiagnostics', true)) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];

  // Collect Sub declarations from the workspace
  const subDeclarations = collectSubDeclarations(workspaceClasses);

  // Collect known event names for event handler exclusion
  const knownEventNames = collectEventNames(workspaceClasses, xmlLibraries);

  // Read workspace file contents for reference counting
  const fileContents = new Map<string, string>();

  for (const cls of workspaceClasses.getAllClasses()) {
    if (cls.filePath) {
      try {
        const content = fs.readFileSync(cls.filePath, 'utf-8');
        fileContents.set(cls.filePath, content);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Include current document content (may be more recent than disk)
  fileContents.set(document.uri.fsPath, document.getText());

  // Find unused Subs
  const unusedSubs = findUnusedSubs(
    subDeclarations,
    knownEventNames,
    B4X_LIFECYCLE_SUBS,
    fileContents,
  );

  // Create diagnostics for unused Subs in the current document only
  const currentFilePath = document.uri.fsPath;
  for (const unused of unusedSubs) {
    // Find the module that matches the current document
    const cls = workspaceClasses.getAllClasses().find(
      c => c.filePath === currentFilePath && c.name.toLowerCase() === unused.moduleName.toLowerCase(),
    );
    if (!cls) continue;

    // Find the method in the class
    const method = cls.methods.find(
      m => m.name.toLowerCase() === unused.name.toLowerCase(),
    );
    if (!method || !method.location) continue;

    const range = method.location.range;
    const severity = unused.reason === 'private_unused'
      ? vscode.DiagnosticSeverity.Hint
      : vscode.DiagnosticSeverity.Warning;

    const diag = new vscode.Diagnostic(
      range,
      unused.reason === 'private_unused'
        ? `Private Sub '${unused.name}' is not called anywhere in the workspace.`
        : `Sub '${unused.name}' is not called anywhere in the workspace. Consider removing it or adding a comment to suppress this warning.`,
      severity,
    );
    diag.source = 'b4x-unused-sub';
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostics.push(diag);
  }

  return diagnostics;
}

/**
 * Register the unused Sub diagnostic provider.
 *
 * Creates a DiagnosticCollection and subscribes to document change events.
 * Follows the same pattern as registerTypeDiagnostics and registerCallSubDiagnostics.
 */
export function registerUnusedSubDiagnostics(
  context: vscode.ExtensionContext,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-unused-sub');

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') return;

    try {
      const diagnostics = provideUnusedSubDiagnosticsForDocument(
        document,
        workspaceClasses,
        xmlLibraries,
      );
      collection.set(document.uri, diagnostics);
    } catch (e) {
      console.error('[b4x-unused-sub] Error refreshing diagnostics:', e);
    }
  };

  // Subscribe to document events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => refresh(doc)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => refresh(doc)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
  );

  // Initial refresh for active editor
  if (vscode.window.activeTextEditor) {
    refresh(vscode.window.activeTextEditor.document);
  }

  return collection;
}

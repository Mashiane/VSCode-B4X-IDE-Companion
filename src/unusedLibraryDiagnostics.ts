/**
 * VS Code diagnostic provider for unused library detection.
 *
 * Cross-references declared libraries (from the project file) against
 * actually-used types in workspace code. Flags libraries whose types
 * are never referenced.
 *
 * Follows the pattern established by callSubDiagnostics.ts and
 * unusedSubDiagnostics.ts.
 *
 * Successor to jMashProjectProfile's "Find unused libraries" wishlist item.
 */
import * as vscode from 'vscode';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import {
  analyzeLibraryUsage,
  UnusedLibraryResult,
} from './unusedLibraryDiagnosticsCore';

/**
 * Build a map of library name to exported type names from the XML library store.
 *
 * Groups all XmlClassInfo entries by their libraryName property,
 * collecting the class names each library exports.
 */
function collectDeclaredLibraries(
  xmlLibraries: XmlLibraryStore,
  allowedLibraries: ReadonlySet<string> | undefined,
): Map<string, string[]> {
  const libraryMap = new Map<string, string[]>();

  for (const cls of xmlLibraries.getAllClasses()) {
    const libName = cls.libraryName;

    // If allowedLibraries is set, only include libraries that are declared in the project
    if (allowedLibraries && !allowedLibraries.has(libName.toLowerCase())) {
      continue;
    }

    if (!libraryMap.has(libName)) {
      libraryMap.set(libName, []);
    }
    const types = libraryMap.get(libName);
    if (types) {
      types.push(cls.name);
    }
  }

  return libraryMap;
}

/**
 * Build a set of type names actually used in workspace code.
 *
 * Collects all type names referenced in variable declarations,
 * method parameters, return types, and Dim statements from
 * workspace classes.
 */
function collectUsedTypes(
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
): Set<string> {
  const usedTypes = new Set<string>();

  // Collect type references from workspace classes
  for (const cls of workspaceClasses.getAllClasses()) {
    // Methods — return types and parameter types
    for (const method of cls.methods) {
      if (method.returnType && method.returnType !== 'void') {
        usedTypes.add(method.returnType.toLowerCase());
      }
      for (const param of method.parameters) {
        if (param.type) {
          usedTypes.add(param.type.toLowerCase());
        }
      }
    }

    // Properties — property types
    for (const prop of cls.properties) {
      if (prop.type) {
        usedTypes.add(prop.type.toLowerCase());
      }
    }

    // Fields — field types (these are also type declarations)
    for (const field of cls.fields) {
      if (field.type) {
        usedTypes.add(field.type.toLowerCase());
      }
    }
  }

  // Also include class names that are explicitly referenced
  // (e.g., in Dim statements, type casts, etc.)
  for (const cls of workspaceClasses.getAllClasses()) {
    usedTypes.add(cls.name.toLowerCase());
  }

  // Include all XML library class names as potentially used
  // (if they're in allowedLibraries, they're likely used for completions)
  // Note: we DON'T add these — that would make every library appear "used"
  // Instead, we rely on the workspace types to determine actual usage

  return usedTypes;
}

/**
 * Provide unused library diagnostics for a document.
 *
 * This is a pure function that can be called from tests.
 */
export function provideUnusedLibraryDiagnosticsForDocument(
  document: vscode.TextDocument,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
  allowedLibraries: ReadonlySet<string> | undefined,
): vscode.Diagnostic[] {
  // Check if diagnostics are enabled
  const config = vscode.workspace.getConfiguration('b4xIntellisense');
  if (!config.get<boolean>('enableUnusedLibraryDiagnostics', true)) {
    return [];
  }

  // If no allowed libraries are set, we can't determine which are unused
  if (!allowedLibraries || allowedLibraries.size === 0) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];

  // Collect declared libraries and their exported types
  const declaredLibraries = collectDeclaredLibraries(xmlLibraries, allowedLibraries);

  // Collect types actually used in workspace code
  const usedTypes = collectUsedTypes(workspaceClasses, xmlLibraries);

  // Also scan the current document for type references
  const documentText = document.getText();
  for (const [libName, types] of declaredLibraries) {
    for (const typeName of types) {
      // Simple text-based check: if the type name appears in the document
      const regex = new RegExp(`\\b${escapeRegExp(typeName)}\\b`, 'i');
      if (regex.test(documentText)) {
        usedTypes.add(typeName.toLowerCase());
      }
    }
  }

  // Analyze which libraries are unused
  const analysis = analyzeLibraryUsage(declaredLibraries, usedTypes);

  // Create diagnostics for unused libraries
  // Since libraries aren't tied to a specific line, we place the diagnostic
  // at the top of the document (line 0, column 0) with a library-wide message
  for (const unused of analysis.unused) {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      unused.reason + ' Consider removing it from the project libraries.',
      vscode.DiagnosticSeverity.Information,
    );
    diag.source = 'b4x-unused-lib';
    diag.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostics.push(diag);
  }

  return diagnostics;
}

/** Escape special regex characters in a string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Register the unused library diagnostic provider.
 *
 * Creates a DiagnosticCollection and subscribes to document change events.
 * Follows the same pattern as registerUnusedSubDiagnostics.
 */
export function registerUnusedLibraryDiagnostics(
  context: vscode.ExtensionContext,
  workspaceClasses: WorkspaceClassStore,
  xmlLibraries: XmlLibraryStore,
  getAllowedLibraries: () => ReadonlySet<string> | undefined,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('b4x-unused-lib');

  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== 'b4x') return;

    try {
      const allowedLibraries = getAllowedLibraries();
      const diagnostics = provideUnusedLibraryDiagnosticsForDocument(
        document,
        workspaceClasses,
        xmlLibraries,
        allowedLibraries,
      );
      collection.set(document.uri, diagnostics);
    } catch (e) {
      console.error('[b4x-unused-lib] Error refreshing diagnostics:', e);
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
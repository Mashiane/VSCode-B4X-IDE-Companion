/**
 * B4X Type Definition Provider
 * Go to Type Definition for variable types.
 * `Dim btn As Button` → F12 on `Button` → jump to Button class definition.
 */

import * as vscode from 'vscode';

export class B4xTypeDefinitionProvider implements vscode.TypeDefinitionProvider {
  constructor(
    private readonly workspaceClasses: any,
    private readonly xmlLibraries: any,
    private readonly primitiveTypes: any,
  ) {}

  provideTypeDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Definition> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return undefined;

    const word = document.getText(wordRange);
    if (!word) return undefined;

    // Only provide type definition if the word appears in a type context.
    // Check: `As TypeName` or `Dim x As TypeName`
    const line = document.lineAt(position.line).text;
    const typeMatch = new RegExp(`\\bAs\\s+(${this.escapeRegex(word)})\\b`, 'gi').exec(line);
    const dimMatch = new RegExp(`\\bDim\\s+\\w+\\s+As\\s+(${this.escapeRegex(word)})\\b`, 'gi').exec(line);

    // If the word is not in a type declaration context, skip — this is not a type usage.
    if (!typeMatch && !dimMatch) {
      return undefined;
    }

    // Look up the type name in workspace classes
    const wsClass = this.workspaceClasses.getDefinitionByName(word);
    if (wsClass) {
      return wsClass.location;
    }

    // Look up in XML libraries
    const xmlClass = this.xmlLibraries.getClassByName(word);
    if (xmlClass) {
      return xmlClass.location;
    }

    // Check primitive types
    if (this.primitiveTypes?.isPrimitiveType?.(word)) {
      const mapped = this.primitiveTypes.resolvePrimitiveType(word);
      if (mapped) {
        const mappedClass = this.xmlLibraries.getClassByName(mapped);
        if (mappedClass) {
          return mappedClass.location;
        }
      }
    }

    return undefined;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}

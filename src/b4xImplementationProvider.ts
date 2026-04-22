/**
 * B4X Implementation Provider
 * Go to Implementation for B4X symbols.
 * For Sub names: finds the Sub definition in the current or other modules.
 * For class/interface-like patterns: finds concrete implementations.
 */

import * as vscode from 'vscode';

export class B4xImplementationProvider implements vscode.ImplementationProvider {
  constructor(
    private readonly workspaceClasses: any,
    private readonly xmlLibraries: any,
  ) {}

  provideImplementation(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Definition> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return undefined;

    const word = document.getText(wordRange);
    if (!word) return undefined;

    const locations: vscode.Location[] = [];

    // Guard against uninitialized stores
    const wsMember = this.workspaceClasses?.findMemberByName?.(word);
    if (wsMember?.item?.location) {
      locations.push(wsMember.item.location);
    }

    const xmlMember = this.xmlLibraries?.findMemberByName?.(word);
    if (xmlMember?.item?.location) {
      locations.push(xmlMember.item.location);
    }

    return locations.length > 0 ? locations : undefined;
  }
}

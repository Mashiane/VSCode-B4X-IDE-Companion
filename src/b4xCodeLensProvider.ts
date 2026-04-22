/**
 * B4X Code Lens Provider
 * Shows reference counts above Sub declarations in the editor.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class B4xCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private readonly workspaceClasses: any,
  ) {}

  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /** Call this when files change to refresh CodeLens display. */
  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const subMatch = /^\s*(Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
      if (!subMatch) continue;

      const subName = subMatch[2];
      if (!subName) continue;
      if (/^Class_Globals$|^Process_Globals$/i.test(subName)) continue;

      const range = new vscode.Range(i, 0, i, line.length);

      const refCount = this.countReferencesInDocument(document, subName);
      const wsRefCount = this.countReferencesInWorkspaceOnDisk(document, subName);

      const title = refCount > 0 ? `${refCount} reference${refCount > 1 ? 's' : ''}` : '0 references';
      const fullTitle = wsRefCount > refCount
        ? `${refCount} refs (document) · ${wsRefCount} refs (workspace)`
        : title;

      const lens = new vscode.CodeLens(range, {
        title: fullTitle,
        command: 'editor.action.referenceSearch.trigger',
        arguments: [],
      });

      lenses.push(lens);
    }

    return lenses;
  }

  private countReferencesInDocument(document: vscode.TextDocument, name: string): number {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const nameLower = name.toLowerCase();
    let count = 0;
    const wordRegex = new RegExp(`\\b${this.escapeRegex(name)}\\b`, 'gi');

    for (const line of lines) {
      if (line.trim().startsWith("'")) continue;

      if (/^\s*(Public\s+|Private\s+)?Sub\s+/i.test(line)) {
        const match = /^\s*(Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
        if (match && match[2] && match[2].toLowerCase() === nameLower) continue;
      }

      const matches = line.match(wordRegex);
      if (matches) {
        count += matches.length;
      }
    }

    return count;
  }

  /**
   * Count references across all workspace files on disk (not just open tabs).
   */
  private countReferencesInWorkspaceOnDisk(document: vscode.TextDocument, name: string): number {
    let total = this.countReferencesInDocument(document, name);
    const nameLower = name.toLowerCase();
    const wordRegex = new RegExp(`\\b${this.escapeRegex(name)}\\b`, 'gi');
    const excludePath = document.uri.fsPath.toLowerCase();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return total;

    for (const folder of workspaceFolders) {
      const b4xFiles = this.findB4xFilesOnDisk(folder.uri.fsPath);
      for (const filePath of b4xFiles) {
        if (filePath.toLowerCase() === excludePath) continue;
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (!content.toLowerCase().includes(nameLower)) continue;

          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            if (line.trim().startsWith("'")) continue;
            const matches = line.match(wordRegex);
            if (matches) total += matches.length;
          }
        } catch {
          // ignore file errors
        }
      }
    }

    return total;
  }

  /**
   * Recursively find all B4X source files under a directory.
   */
  private findB4xFilesOnDisk(rootDir: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          const lowerName = entry.name.toLowerCase();
          if (lowerName === 'objects' || lowerName === '.git' || lowerName === 'node_modules') continue;
          files.push(...this.findB4xFilesOnDisk(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.bas' || ext === '.b4a' || ext === '.b4i' || ext === '.b4j' || ext === '.b4r') {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
    return files;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}

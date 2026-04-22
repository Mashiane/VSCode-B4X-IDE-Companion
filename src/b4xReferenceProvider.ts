/**
 * B4X Find All References Provider
 * Provides "Find All References" (Shift+F12) functionality for B4X symbols.
 * Searches the current document (entire file, no scope filtering) and all
 * workspace files on disk (not just open tabs).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class B4xReferenceProvider implements vscode.ReferenceProvider {
  constructor(
    private readonly workspaceClasses: any, // WorkspaceClassStore
    private readonly xmlLibraries: any, // XmlLibraryStore
  ) {}

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Location[]> {
    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/,
    );
    if (!wordRange) {
      return [];
    }

    const word = document.getText(wordRange);
    if (!word) {
      return [];
    }

    const references: vscode.Location[] = [];

    // 1. Find references in current document (entire file, no scope filtering)
    this.findReferencesInDocument(document, word, references);

    // 2. Find references in other workspace files on disk (not just open tabs)
    this.findReferencesInWorkspaceOnDisk(word, document.uri, references, token);

    return references;
  }

  /**
   * Finds all references to the symbol in the entire document.
   * No scope-based filtering — Sub names are global, and Find All References
   * should show all text occurrences regardless of where they appear.
   */
  private findReferencesInDocument(
    document: vscode.TextDocument,
    word: string,
    references: vscode.Location[],
  ): void {
    const wordLower = word.toLowerCase();
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const trimmedLine = line.trim();

      // Skip comment lines
      if (trimmedLine.startsWith("'")) {
        continue;
      }

      // Find all occurrences of the word in this line
      let startIndex = 0;
      while (true) {
        const lineLower = line.toLowerCase();
        const idx = lineLower.indexOf(wordLower, startIndex);
        if (idx === -1) {
          break;
        }

        // Verify it's a whole word match
        const beforeChar = idx > 0 ? line[idx - 1] : ' ';
        const afterChar =
          idx + word.length < line.length ? line[idx + word.length] : ' ';
        const isWordBoundary =
          !/[A-Za-z0-9_]/.test(beforeChar || ' ') && !/[A-Za-z0-9_]/.test(afterChar || ' ');

        if (isWordBoundary) {
          const startPos = new vscode.Position(i, idx);
          const endPos = new vscode.Position(i, idx + word.length);
          references.push(
            new vscode.Location(
              document.uri,
              new vscode.Range(startPos, endPos),
            ),
          );
        }

        startIndex = idx + word.length;
      }
    }
  }

  /**
   * Finds references in workspace files on disk, not just open documents.
   * Uses workspaceFolders to discover all .bas files and reads them
   * directly from the filesystem.
   */
  private findReferencesInWorkspaceOnDisk(
    word: string,
    excludeUri: vscode.Uri,
    references: vscode.Location[],
    token: vscode.CancellationToken,
  ): void {
    const wordLower = word.toLowerCase();
    const excludePath = this.fsPathFromUri(excludeUri)?.toLowerCase();
    const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const folder of workspaceFolders) {
      if (token.isCancellationRequested) return;

      const b4xFiles = this.findB4xFilesOnDisk(folder.uri.fsPath);

      for (const filePath of b4xFiles) {
        if (token.isCancellationRequested) return;

        // Skip the current document (already processed)
        if (excludePath && filePath.toLowerCase() === excludePath) {
          continue;
        }

        // Quick check: does this file contain the word?
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (!content.toLowerCase().includes(wordLower)) {
            continue;
          }

          const docUri = vscode.Uri.file(filePath);
          this.addReferencesFromText(content, word, wordRegex, docUri, references);
        } catch {
          // ignore file read errors
        }
      }
    }
  }

  /**
   * Recursively find all .bas files under a directory.
   */
  private findB4xFilesOnDisk(rootDir: string): string[] {
    const files: string[] = [];

    try {
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);

        // Skip common non-project directories
        if (entry.isDirectory()) {
          const lowerName = entry.name.toLowerCase();
          if (lowerName === 'objects' || lowerName === '.git' || lowerName === 'node_modules') {
            continue;
          }
          files.push(...this.findB4xFilesOnDisk(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.bas' || ext === '.b4a' || ext === '.b4i' || ext === '.b4j' || ext === '.b4r') {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // ignore directory read errors
    }

    return files;
  }

  /**
   * Add references found in raw text to the references array.
   */
  private addReferencesFromText(
    text: string,
    word: string,
    wordRegex: RegExp,
    docUri: vscode.Uri,
    references: vscode.Location[],
  ): void {
    const lines = text.split(/\r?\n/);
    let match: RegExpExecArray | null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (!line) continue;

      // Skip comment-only lines
      if (line.trim().startsWith("'")) continue;

      // Find comment start position (respecting string quoting)
      const commentStart = this.findCommentStart(line);

      // Reset regex state and find all matches on this line
      wordRegex.lastIndex = 0;
      while ((match = wordRegex.exec(line)) !== null) {
        // Skip matches inside comments
        if (commentStart !== -1 && match.index >= commentStart) continue;

        // Skip matches inside string literals
        if (this.isInsideString(line, match.index)) continue;

        const startPos = new vscode.Position(lineIdx, match.index);
        const endPos = new vscode.Position(lineIdx, match.index + word.length);
        references.push(
          new vscode.Location(docUri, new vscode.Range(startPos, endPos)),
        );
      }
    }
  }

  /**
   * Find the index of the first comment character (') on a line,
   * respecting B4X string quoting rules ("" = escaped quote).
   */
  private findCommentStart(line: string): number {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
          i++; continue;
        }
        if (ch === '"') { inString = false; }
      } else {
        if (ch === '"') { inString = true; }
        else if (ch === "'") { return i; }
      }
    }
    return -1;
  }

  /**
   * Check if a column position is inside a double-quoted string,
   * correctly handling B4X escaped quotes ("").
   */
  private isInsideString(line: string, col: number): boolean {
    let inString = false;
    for (let i = 0; i < col && i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
          i++; continue;
        }
        if (ch === '"') { inString = false; }
      } else {
        if (ch === '"') { inString = true; }
      }
    }
    return inString;
  }

  /**
   * Convert a VS Code URI to a file system path.
   */
  private fsPathFromUri(uri: vscode.Uri): string | null {
    try {
      if (uri.scheme === 'file') {
        return uri.fsPath;
      }
      const decoded = decodeURIComponent(uri.toString());
      const match = decoded.match(/file:\/\/\/(.:\/.*)/);
      if (match && match[1]) {
        return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}

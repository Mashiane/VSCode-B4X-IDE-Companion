/**
 * B4X Rename Provider
 * Provides F2 rename refactoring across all B4X files in the workspace.
 * Preserves case conventions (ALLCAPS -> ALLCAPS, camelCase -> camelCase).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class B4xRenameProvider implements vscode.RenameProvider {
  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Range> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }
    return wordRange;
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.WorkspaceEdit> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }

    const oldName = document.getText(wordRange);
    if (!oldName) {
      return undefined;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
      throw new Error(`'${newName}' is not a valid B4X identifier.`);
    }

    const edit = new vscode.WorkspaceEdit();
    const wordRegex = new RegExp(`\\b${this.escapeRegex(oldName)}\\b`, 'gi');

    // 1. Rename in current document (in-memory)
    const currentEdits = this.findRenameEditsInText(
      document.getText(), oldName, newName, wordRegex,
    );
    if (currentEdits.length > 0) {
      const textEdits = currentEdits.map(e =>
        new vscode.TextEdit(
          new vscode.Range(e.line, e.startCol, e.line, e.endCol),
          e.newText,
        ),
      );
      edit.set(document.uri, textEdits);
    }

    // 2. Rename in all workspace files on disk (not just open tabs)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const excludePath = document.uri.fsPath.toLowerCase();
      for (const folder of workspaceFolders) {
        const b4xFiles = this.findB4xFilesOnDisk(folder.uri.fsPath);
        for (const filePath of b4xFiles) {
          if (filePath.toLowerCase() === excludePath) continue;
          try {
            const text = fs.readFileSync(filePath, 'utf8');
            if (!text.toLowerCase().includes(oldName.toLowerCase())) continue;

            const fileEdits = this.findRenameEditsInText(text, oldName, newName, wordRegex);
            if (fileEdits.length > 0) {
              edit.set(vscode.Uri.file(filePath), this.convertLineColToEdits(text, fileEdits));
            }
          } catch {
            // ignore file errors
          }
        }
      }
    }

    return edit;
  }

  /**
   * Find all rename edits needed in a text buffer.
   * Returns an array of { line, startCol, endCol, newText }.
   */
  private findRenameEditsInText(
    text: string,
    oldName: string,
    newName: string,
    wordRegex: RegExp,
  ): Array<{ line: number; startCol: number; endCol: number; newText: string }> {
    const edits: Array<{ line: number; startCol: number; endCol: number; newText: string }> = [];
    const lines = text.split(/\r?\n/);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx] ?? '';

      // Skip comment-only lines
      if (lineText.trimStart().startsWith("'")) continue;

      let match: RegExpExecArray | null;
      // Reset regex state for each line
      wordRegex.lastIndex = 0;
      while ((match = wordRegex.exec(lineText)) !== null) {
        const colInLine = match.index;

        // Skip if inside a comment (after ')
        const commentIdx = this.findCommentStart(lineText);
        if (commentIdx !== -1 && colInLine >= commentIdx) continue;

        // Skip if inside a quoted string
        if (this.isInQuotedString(lineText, colInLine)) continue;

        edits.push({
          line: lineIdx,
          startCol: colInLine,
          endCol: colInLine + match[0].length,
          newText: this.preserveCase(match[0], newName),
        });
      }
    }

    return edits;
  }

  /**
   * Convert line/column edit descriptors to vscode.TextEdit objects.
   */
  private convertLineColToEdits(
    text: string,
    edits: Array<{ line: number; startCol: number; endCol: number; newText: string }>,
  ): vscode.TextEdit[] {
    return edits.map(e =>
      new vscode.TextEdit(
        new vscode.Range(e.line, e.startCol, e.line, e.endCol),
        e.newText,
      ),
    );
  }

  /**
   * Recursively find all .bas/.b4a/.b4i/.b4j/.b4r files under a directory.
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
          i++; // skip escaped quote
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === "'") {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Check if a column position is inside a double-quoted string,
   * correctly handling B4X escaped quotes ("").
   */
  private isInQuotedString(line: string, col: number): boolean {
    let inString = false;
    for (let i = 0; i < col && i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
          i++; // skip escaped quote
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        }
      }
    }
    return inString;
  }

  private preserveCase(original: string, replacement: string): string {
    if (original === original.toUpperCase() && original.length > 1) {
      return replacement.toUpperCase();
    }
    if (original === original.toLowerCase()) {
      return replacement.toLowerCase();
    }
    if (/^[A-Z][a-z]/.test(original)) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}

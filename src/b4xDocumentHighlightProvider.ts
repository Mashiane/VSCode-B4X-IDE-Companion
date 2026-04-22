/**
 * B4X Document Highlight Provider
 * Highlights all occurrences of the symbol under cursor in the current document.
 */

import * as vscode from 'vscode';
import { stripComment } from './b4xDocParser';

export class B4xDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
  provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentHighlight[]> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return [];

    const word = document.getText(wordRange);
    if (!word) return [];

    const highlights: vscode.DocumentHighlight[] = [];
    const wordLower = word.toLowerCase();
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const trimmed = line.trimStart();
      if (trimmed.startsWith("'")) continue;

      let idx = line.toLowerCase().indexOf(wordLower);
      while (idx !== -1) {
        // Whole word check
        const beforeChar = idx > 0 ? line[idx - 1] : ' ';
        const afterChar = idx + word.length < line.length ? line[idx + word.length] : ' ';
        const isWordBoundary =
          !/[A-Za-z0-9_]/.test(beforeChar || ' ') && !/[A-Za-z0-9_]/.test(afterChar || ' ');

        if (isWordBoundary) {
          const start = new vscode.Position(i, idx);
          const end = new vscode.Position(i, idx + word.length);
          const range = new vscode.Range(start, end);

          // Determine highlight kind
          const isDeclaration = this.isDeclaration(line);
          const isRead = this.isReadAccess(line, idx, word);

          highlights.push(
            new vscode.DocumentHighlight(
              range,
              isDeclaration
                ? vscode.DocumentHighlightKind.Write
                : isRead
                  ? vscode.DocumentHighlightKind.Read
                  : vscode.DocumentHighlightKind.Text,
            ),
          );
        }

        idx = line.toLowerCase().indexOf(wordLower, idx + word.length);
      }
    }

    return highlights;
  }

  /**
   * Check if the line declares the symbol (Sub, Type, Dim).
   */
  private isDeclaration(line: string): boolean {
    return /^\s*(Public\s+|Private\s+)?(Sub|Type|Dim|Const)\b/i.test(line);
  }

  /**
   * Check if the symbol is being read (used in expression, not declared).
   */
  private isReadAccess(line: string, idx: number, word: string): boolean {
    const before = line.substring(0, idx);
    // If preceded by Dim, As, Sub, Type — it's part of a declaration
    if (/\b(Dim|As|Sub|Type|Const|Private|Public)\s*$/i.test(before.trim())) {
      return false;
    }
    return true;
  }
}

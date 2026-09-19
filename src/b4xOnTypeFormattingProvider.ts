/**
 * B4X On-Type Formatting Provider
 * Auto-fixes keyword casing as you type — only the word near the cursor.
 */

import * as vscode from 'vscode';
import { MULTI_KEYWORDS, KEYWORD_CASING, applyKeywordCasing } from './utils/b4xKeywords';

export class B4xOnTypeFormattingProvider implements vscode.OnTypeFormattingEditProvider {
  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    _options: vscode.FormattingOptions,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    // Only trigger on space, Enter, or colon (B4X statement separator)
    if (ch !== ' ' && ch !== '\n' && ch !== ':') {
      return [];
    }

    const lineText = document.lineAt(position.line).text;

    // Find the word that ends at (or just before) the cursor position.
    // This ensures we only fix the keyword the user just typed, not
    // every keyword on the line.
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return [];
    }

    const word = document.getText(wordRange);
    if (!word) return [];

    const edits: vscode.TextEdit[] = [];

    // 1. Check if the word near cursor is a single-word keyword
    const lowerWord = word.toLowerCase();
    const correctCasing = KEYWORD_CASING[lowerWord];
    const replacement = correctCasing ? applyKeywordCasing(word, correctCasing) : undefined;
    if (replacement && word !== replacement) {
      edits.push(new vscode.TextEdit(wordRange, replacement));
    }

    // 2. Check if multi-word keywords overlap with the cursor position
    for (const { pattern, replacement } of MULTI_KEYWORDS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(lineText)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        const cursorCol = position.character;

        // Only fix if the match overlaps with or is adjacent to the cursor
        if (cursorCol >= matchStart && cursorCol <= matchEnd + 1) {
          const range = new vscode.Range(
            new vscode.Position(position.line, matchStart),
            new vscode.Position(position.line, matchEnd),
          );
          edits.push(new vscode.TextEdit(range, replacement));
          break; // only one multi-word match per cursor position
        }
      }
    }

    return edits.length > 0 ? edits : [];
  }
}

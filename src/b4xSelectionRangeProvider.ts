/**
 * B4X Selection Range Provider
 * Enables smart expand selection (Ctrl+Shift+RightArrow).
 * Expands: word → line → block → Sub → entire Sub
 */

import * as vscode from 'vscode';
import { stripComment } from './b4xDocParser';

export class B4xSelectionRangeProvider implements vscode.SelectionRangeProvider {
  provideSelectionRanges(
    document: vscode.TextDocument,
    positions: vscode.Position[],
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.SelectionRange[]> {
    const ranges: vscode.SelectionRange[] = [];

    for (const position of positions) {
      const selectionRanges = this.buildSelectionRanges(document, position);
      ranges.push(selectionRanges);
    }

    return ranges;
  }

  private buildSelectionRanges(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.SelectionRange {
    const line = document.lineAt(position.line);
    const wordRange = document.getWordRangeAtPosition(position) || new vscode.Range(position, position);

    // Level 1: Word under cursor
    let current = new vscode.SelectionRange(wordRange, undefined);

    // Level 2: Entire line content (excluding leading/trailing whitespace)
    const lineRange = new vscode.Range(position.line, line.firstNonWhitespaceCharacterIndex, position.line, line.text.length);
    if (!current.range.contains(lineRange)) {
      current = new vscode.SelectionRange(lineRange, current);
    }

    // Level 3: Containing Sub block
    const subRange = this.findContainingSub(document, position.line);
    if (subRange && !current.range.contains(subRange)) {
      current = new vscode.SelectionRange(subRange, current);
    }

    // Level 4: Entire document
    const fullDocRange = document.validateRange(
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(document.lineCount - 1, 0)),
    );
    current = new vscode.SelectionRange(fullDocRange, current);

    return current;
  }

  /**
   * Find the Sub block containing the given line.
   */
  private findContainingSub(document: vscode.TextDocument, lineNum: number): vscode.Range | undefined {
    let subStart = -1;
    let subEnd = -1;

    // Search upward for Sub declaration
    for (let i = lineNum; i >= 0; i--) {
      const code = stripComment(document.lineAt(i).text).trim();
      if (/^\s*(Public\s+|Private\s+)?Sub\b/i.test(code)) {
        subStart = i;
        break;
      }
    }

    if (subStart === -1) return undefined;

    // Search downward for End Sub
    for (let i = subStart; i < document.lineCount; i++) {
      const code = stripComment(document.lineAt(i).text).trim();
      if (/^\s*End\s+Sub\s*$/i.test(code)) {
        subEnd = i;
        break;
      }
    }

    if (subEnd === -1) return undefined;

    return new vscode.Range(
      new vscode.Position(subStart, 0),
      new vscode.Position(subEnd, document.lineAt(subEnd).text.length),
    );
  }
}

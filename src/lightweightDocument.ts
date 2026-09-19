/**
 * Lightweight document adapter for B4X file parsing.
 *
 * Replaces `vscode.workspace.openTextDocument()` for bulk file loading
 * (reference modules, workspace modules, XML libraries). The VS Code API
 * puts each opened document through the full lifecycle (language detection,
 * model creation, event emission) — unnecessary overhead for files that
 * only need their text content scanned.
 *
 * `LightweightDocument` satisfies the same `B4xDocument` interface that
 * `vscode.TextDocument` does, so all parsing functions can accept either.
 * Real editor documents (from change handlers) continue to use
 * `vscode.TextDocument` directly.
 */

import * as fs from 'node:fs';
import * as vscode from 'vscode';

/**
 * Minimal document interface needed by B4X parsing functions.
 *
 * Both `vscode.TextDocument` and `LightweightDocument` satisfy this
 * interface, so callers can pass either without casting.
 */
export interface B4xDocument {
  readonly uri: vscode.Uri;
  readonly lineCount: number;
  lineAt(line: number): { readonly text: string; readonly range: vscode.Range };
  /** Full document text. Used by XML library parsing. */
  getText(): string;
  /** Convert a character offset to a Position. Used by XML library parsing. */
  positionAt(offset: number): vscode.Position;
}

/**
 * File-backed document that avoids VS Code's document lifecycle overhead.
 *
 * Created from a file path via `fromFile()`. Reads the file synchronously
 * and splits into lines. Provides the same accessors that the parsing
 * functions need — `uri`, `lineCount`, `lineAt()`, `getText()`,
 * and `positionAt()`.
 */
export class LightweightDocument implements B4xDocument {
  readonly uri: vscode.Uri;
  readonly lineCount: number;
  private readonly _lines: readonly string[];
  private readonly _fullText: string;

  private constructor(filePath: string, content: string) {
    this.uri = vscode.Uri.file(filePath);
    this._fullText = content;
    this._lines = Object.freeze(content.split(/\r?\n/));
    this.lineCount = this._lines.length;
  }

  lineAt(line: number): { readonly text: string; readonly range: vscode.Range } {
    const text = this._lines[line] ?? '';
    return {
      text,
      range: new vscode.Range(line, 0, line, text.length),
    };
  }

  getText(): string {
    return this._fullText;
  }

  positionAt(offset: number): vscode.Position {
    // Walk lines to find the line/column for the character offset.
    // This mirrors VS Code's TextDocument.positionAt() for the common case.
    let remaining = Math.max(0, Math.min(offset, this._fullText.length));
    for (let line = 0; line < this._lines.length; line++) {
      // +1 for the newline character that was removed by split
      const lineText = this._lines[line]!;
      const lineLen = lineText.length + 1;
      if (remaining < lineLen) {
        return new vscode.Position(line, remaining);
      }
      remaining -= lineLen;
    }
    // Offset past end of document — return last line, last column
    const lastLine = Math.max(0, this._lines.length - 1);
    const lastLineText = this._lines[lastLine] ?? '';
    return new vscode.Position(lastLine, lastLineText.length);
  }

  /**
   * Create a LightweightDocument by reading a file from disk.
   * Returns `undefined` if the file cannot be read.
   */
  static fromFile(filePath: string): LightweightDocument | undefined {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return new LightweightDocument(filePath, content);
    } catch {
      return undefined;
    }
  }
}
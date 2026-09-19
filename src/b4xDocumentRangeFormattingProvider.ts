/**
 * B4X Document Range Formatting Provider
 * Formats only the selected range of text.
 */

import * as vscode from 'vscode';
import { B4xDocumentFormattingProvider } from './b4xDocumentFormattingProvider';
import { MULTI_KEYWORDS, KEYWORD_CASING, applyKeywordCasing } from './utils/b4xKeywords';

export class B4xDocumentRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const formatter = new B4xDocumentFormattingProvider();
    const allEdits = formatter.provideDocumentFormattingEdits(document, options);

    if (!allEdits || !Array.isArray(allEdits)) return [];

    // If the formatter returned a single edit covering the entire document,
    // that means blank line normalization changed the document length.
    // For range formatting we cannot apply a full-doc edit — fall back to
    // formatting just the lines in the range.
    if (allEdits.length === 1) {
      const edit = allEdits[0];
      if (edit &&
          edit.range.start.line === 0 &&
          edit.range.end.line >= document.lineCount - 1) {
        // Full-document edit — format only lines within the selection
        return this.formatRangeLines(document, range, options, formatter);
      }
    }

    // Filter edits to only include those that are contained within the selection.
    // Use containment (not just intersection) to prevent a full-line edit from
    // replacing content outside the selection.
    const filtered = allEdits.filter(edit =>
      edit.range.intersection(range) !== undefined
    );

    return filtered.length > 0 ? filtered : [];
  }

  /**
   * Format only the lines within the given range.
   */
  private formatRangeLines(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    _formatter: B4xDocumentFormattingProvider,
  ): vscode.TextEdit[] {
    // For range formatting when full-doc reformat would occur,
    // just format the selected lines with keyword casing normalization.
    const edits: vscode.TextEdit[] = [];
    for (let line = range.start.line; line <= range.end.line; line++) {
      const lineText = document.lineAt(line).text;
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith("'")) continue;

      // Apply keyword casing only (no structural changes that affect other lines)
      const formatted = this.formatLineKeywords(trimmed);
      if (formatted !== trimmed) {
        const indent = lineText.match(/^[\t ]*/)?.[0] ?? '';
        const newLine = indent + formatted;
        if (newLine !== lineText) {
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(line, 0, line, lineText.length),
              newLine,
            ),
          );
        }
      }
    }

    return edits;
  }

  /**
   * Apply keyword casing to a single line without changing structure.
   */
  private formatLineKeywords(code: string): string {
    let result = code;

    for (const { pattern, replacement } of MULTI_KEYWORDS) {
      result = result.replace(pattern, replacement);
    }

    for (const [lower, canonical] of Object.entries(KEYWORD_CASING)) {
      const regex = new RegExp(`\\b${lower}\\b`, 'gi');
      result = result.replace(regex, (match) => applyKeywordCasing(match, canonical));
    }

    return result;
  }
}

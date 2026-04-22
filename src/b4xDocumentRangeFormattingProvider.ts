/**
 * B4X Document Range Formatting Provider
 * Formats only the selected range of text.
 */

import * as vscode from 'vscode';
import { B4xDocumentFormattingProvider } from './b4xDocumentFormattingProvider';

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

    const multiWord = [
      { pattern: /\bend\s+sub\b/gi, replacement: 'End Sub' },
      { pattern: /\bend\s+if\b/gi, replacement: 'End If' },
      { pattern: /\bend\s+select\b/gi, replacement: 'End Select' },
      { pattern: /\bend\s+try\b/gi, replacement: 'End Try' },
      { pattern: /\belse\s+if\b/gi, replacement: 'Else If' },
      { pattern: /\bcase\s+else\b/gi, replacement: 'Case Else' },
      { pattern: /\bfor\s+each\b/gi, replacement: 'For Each' },
      { pattern: /\bclass_globals\b/gi, replacement: 'Class_Globals' },
      { pattern: /\bprocess_globals\b/gi, replacement: 'Process_Globals' },
    ];

    for (const { pattern, replacement } of multiWord) {
      result = result.replace(pattern, replacement);
    }

    const singleKeywords = [
      'Sub', 'End', 'If', 'Then', 'Else', 'For', 'To', 'Step', 'Next',
      'Do', 'Loop', 'While', 'Until', 'Select', 'Case', 'Try', 'Catch',
      'Return', 'Continue', 'Exit', 'Dim', 'As', 'Private', 'Public',
      'Type', 'And', 'Or', 'Not', 'Mod', 'True', 'False', 'Null',
      'In', 'Region',
    ];

    for (const keyword of singleKeywords) {
      const lower = keyword.toLowerCase();
      const regex = new RegExp(`\\b${lower}\\b`, 'gi');
      result = result.replace(regex, (match) => {
        if (match === match.toUpperCase() && match.length > 1) {
          return keyword.toUpperCase();
        }
        return keyword;
      });
    }

    return result;
  }
}

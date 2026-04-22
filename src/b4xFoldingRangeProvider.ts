/**
 * B4X Folding Range Provider
 * Provides code folding for all B4X block constructs including:
 * - Sub...End Sub
 * - If...End If
 * - For/For Each...Next
 * - Select...End Select
 * - Try...End Try
 * - Do...Loop
 * - While...Wend
 * - Type...End Type
 * - #Region...#End Region
 * - Comments blocks
 */

import * as vscode from 'vscode';

interface BlockStart {
  line: number;
  type: string;
  isMultiLine: boolean;
}

export class B4xFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    context: vscode.FoldingContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const ranges: vscode.FoldingRange[] = [];
    const blockStack: BlockStart[] = [];

    // Track regions separately (they can be nested arbitrarily)
    const regionStack: number[] = [];

    for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
      if (token.isCancellationRequested) {
        break;
      }

      const line = document.lineAt(lineNum);
      const text = line.text;
      const trimmedText = text.trim();

      // Skip empty lines
      if (!trimmedText) {
        continue;
      }

      // Handle #Region blocks (can be nested)
      if (/^\s*#Region\b/i.test(text)) {
        regionStack.push(lineNum);
        continue;
      }

      if (/^\s*#End\s+Region\s*$/i.test(text) && regionStack.length > 0) {
        const startLine = regionStack.pop()!;
        if (lineNum - startLine > 1) {
          ranges.push(
            new vscode.FoldingRange(startLine, lineNum - 1, vscode.FoldingRangeKind.Region),
          );
        }
        continue;
      }

      // Handle regular code blocks
      const blockType = this.detectBlockStart(text);
      if (blockType) {
        blockStack.push({
          line: lineNum,
          type: blockType,
          isMultiLine: !this.isInlineBlock(text, blockType),
        });
      } else {
        const blockEndType = this.detectBlockEnd(text);
        if (blockEndType && blockStack.length > 0) {
          // Find the matching start block
          for (let i = blockStack.length - 1; i >= 0; i--) {
            const startBlock = blockStack[i];
            if (startBlock && this.isMatchingEnd(startBlock.type, blockEndType)) {
              blockStack.splice(i, 1);

              // Only create fold if there are multiple lines
              if (lineNum - startBlock.line > 1) {
                const kind = this.getFoldingRangeKind(startBlock.type);
                ranges.push(
                  new vscode.FoldingRange(startBlock.line, lineNum - 1, kind),
                );
              }
              break;
            }
          }
        }
      }
    }

    // Sort ranges by start line
    ranges.sort((a, b) => a.start - b.start);

    return ranges;
  }

  /**
   * Detects if a line starts a block construct
   */
  private detectBlockStart(text: string): string | null {
    const trimmed = text.trim();

    // Skip comments
    if (trimmed.startsWith("'")) {
      return null;
    }

    // Sub
    if (/^\s*(Public\s+|Private\s+)?Sub\s+\w+/i.test(text)) {
      return 'sub';
    }

    // If...Then (multi-line only, not inline If)
    if (/^\s*If\b.+?\bThen\s*$/i.test(text)) {
      return 'if';
    }

    // For/For Each
    if (/^\s*For\s+(Each\s+)?\w+/i.test(text)) {
      return 'for';
    }

    // Select/Select Case
    if (/^\s*Select\s*(Case\s+\w+)?\s*$/i.test(text)) {
      return 'select';
    }

    // Try
    if (/^\s*Try\s*$/i.test(text)) {
      return 'try';
    }

    // Type
    if (/^\s*Type\s+\w+/i.test(text)) {
      return 'type';
    }

    // Do While/Do Until/Do
    if (/^\s*Do\s*(While|Until)?.*$/i.test(text)) {
      // Exclude Do...Loop While/Until (closing is on same construct)
      if (/^\s*Do\s*$/i.test(text) || /^\s*Do\s+(While|Until)\b/i.test(text)) {
        return 'do';
      }
    }

    // While
    if (/^\s*While\b/i.test(text)) {
      return 'while';
    }

    // Case (can fold Case blocks within Select)
    if (/^\s*Case\s+/i.test(text)) {
      return 'case';
    }

    // Catch (can fold Catch blocks within Try)
    if (/^\s*Catch\b/i.test(text)) {
      return 'catch';
    }

    return null;
  }

  /**
   * Detects if a line ends a block construct
   */
  private detectBlockEnd(text: string): string | null {
    const trimmed = text.trim();

    // End Sub
    if (/^\s*End\s+Sub\s*$/i.test(text)) {
      return 'sub';
    }

    // End If
    if (/^\s*End\s+If\s*$/i.test(text)) {
      return 'if';
    }

    // Next
    if (/^\s*Next\s*$/i.test(text)) {
      return 'for';
    }

    // End Select
    if (/^\s*End\s+Select\s*$/i.test(text)) {
      return 'select';
    }

    // End Try
    if (/^\s*End\s+Try\s*$/i.test(text)) {
      return 'try';
    }

    // Loop
    if (/^\s*Loop\s*(While|Until)?.*$/i.test(text)) {
      return 'do';
    }

    // Wend
    if (/^\s*Wend\s*$/i.test(text)) {
      return 'while';
    }

    // End Type
    if (/^\s*End\s+Type\s*$/i.test(text)) {
      return 'type';
    }

    return null;
  }

  /**
   * Checks if a block is inline (doesn't need folding)
   */
  private isInlineBlock(text: string, blockType: string): boolean {
    // Inline If...Then on single line
    if (blockType === 'if' && /^\s*If\b.+?\bThen\s+.+$/i.test(text)) {
      return true;
    }
    return false;
  }

  /**
   * Checks if an end block matches a start block type.
   * Catch blocks are part of the Try...End Try construct, so 'catch'
   * matches 'try' as its end type (the End Try closes both).
   */
  private isMatchingEnd(startType: string, endType: string): boolean {
    if (startType === 'catch' && endType === 'try') return true;
    return startType === endType;
  }

  /**
   * Gets the folding range kind for better UI presentation
   */
  private getFoldingRangeKind(blockType: string): vscode.FoldingRangeKind {
    switch (blockType) {
      case 'region':
        return vscode.FoldingRangeKind.Region;
      case 'comment':
        return vscode.FoldingRangeKind.Comment;
      case 'imports':
        return vscode.FoldingRangeKind.Imports;
      default:
        return vscode.FoldingRangeKind.Region;
    }
  }
}

/**
 * B4X Document Formatting Provider
 *
 * World-class structural formatter modeled on VB.NET/VB6 formatters.
 * Handles block indentation, keyword casing, blank line normalization,
 * string protection, and B4X-specific constructs.
 */

import * as vscode from 'vscode';
import { getPostDesignStartLine } from './b4xDocParser';

// ─── Configuration ───────────────────────────────────────────────────────────

interface FormatOptions {
  insertSpaces: boolean;
  tabSize: number;
}

// ─── Token Types ─────────────────────────────────────────────────────────────

enum TokenKind {
  Code,
  Blank,
  CommentOnly,
  DesignerEnd,
}

interface Token {
  kind: TokenKind;
  raw: string;
  code: string;           // stripped of comments, strings replaced with placeholders
  codeWithStrings: string; // original code (strings intact) — for string-aware checks
  comment: string;        // trailing comment text (without ')
  indentLevel: number;    // computed during analysis
}

// ─── Block Tracking ──────────────────────────────────────────────────────────

enum BlockKind {
  SubBlock,       // Sub ... End Sub
  IfBlock,        // If ... End If
  ForBlock,       // For ... Next
  DoBlock,        // Do ... Loop
  SelectBlock,    // Select ... End Select
  TryBlock,       // Try ... End Try
  RegionBlock,    // #Region ... #End Region
  IfDefBlock,     // #If ... #End If
  CaseBlock,      // Case inside Select (sub-indent)
}

interface BlockInfo {
  kind: BlockKind;
}

// ─── Formatter ───────────────────────────────────────────────────────────────

export class B4xDocumentFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const opts: FormatOptions = {
      insertSpaces: options.insertSpaces as boolean,
      tabSize: options.tabSize as number,
    };

    const rawLines = document.getText().split(/\r?\n/);
    const designEnd = getPostDesignStartLine(document);

    // Phase 1: Tokenize
    const tokens = this.tokenize(rawLines, designEnd);

    // Phase 2: Compute indent levels via block tracking
    this.computeIndentLevels(tokens);

    // Phase 3: Format each line
    const formatted = tokens.map(t => this.formatToken(t, opts));

    // Phase 4: Normalize blank lines (collapse runs, ensure spacing between Subs)
    this.normalizeBlankLines(formatted, tokens);

    // Phase 5: Build edits
    const edits: vscode.TextEdit[] = [];
    if (formatted.length !== rawLines.length) {
      const newText = formatted.join('\n');
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0),
      );
      edits.push(new vscode.TextEdit(fullRange, newText));
    } else {
      for (let i = 0; i < rawLines.length; i++) {
        const original = rawLines[i];
        const result = formatted[i];
        if (original !== undefined && result !== undefined && original !== result) {
          edits.push(
            new vscode.TextEdit(
              new vscode.Range(i, 0, i, original.length),
              result,
            ),
          );
        }
      }
    }

    return edits.length > 0 ? edits : [];
  }

  // ─── Phase 1: Tokenize ─────────────────────────────────────────────────────

  private tokenize(rawLines: string[], designEnd: number): Token[] {
    const tokens: Token[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? '';
      const trimmed = raw.trim();

      if (i < designEnd) {
        tokens.push({
          kind: TokenKind.Code,
          raw,
          code: this.maskStrings(raw),
          codeWithStrings: raw,
          comment: '',
          indentLevel: -1,
        });
        continue;
      }

      if (trimmed === '') {
        tokens.push({
          kind: TokenKind.Blank,
          raw: '',
          code: '',
          codeWithStrings: '',
          comment: '',
          indentLevel: 0,
        });
        continue;
      }

      if (trimmed.startsWith("'")) {
        tokens.push({
          kind: TokenKind.CommentOnly,
          raw: raw,
          code: '',
          codeWithStrings: raw,
          comment: trimmed.slice(1).trim(),
          indentLevel: 0,
        });
        continue;
      }

      if (trimmed === '#EndOfDesignText@') {
        tokens.push({
          kind: TokenKind.DesignerEnd,
          raw,
          code: trimmed,
          codeWithStrings: trimmed,
          comment: '',
          indentLevel: -1,
        });
        continue;
      }

      const { code, comment } = this.stripComment(raw);
      tokens.push({
        kind: TokenKind.Code,
        raw,
        code: this.maskStrings(code),
        codeWithStrings: code,
        comment,
        indentLevel: 0,
      });
    }

    return tokens;
  }

  /**
   * Replace string literal contents with a placeholder so block-keyword
   * detection doesn't false-positive on keywords inside strings.
   * E.g. `Log("END IF")` → `Log("___STRING___")`
   */
  private maskStrings(line: string): string {
    let result = '';
    let inString = false;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      if (inString) {
        if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
          result += '""';
          i += 2;
          continue;
        }
        if (ch === '"') {
          result += '"';
          inString = false;
          i++;
          continue;
        }
        i++;
        continue;
      } else {
        if (ch === '"') {
          result += '"___STRING___';
          inString = true;
          i++;
          // skip to closing quote
          while (i < line.length) {
            const sc = line[i];
            if (sc === '"' && i + 1 < line.length && line[i + 1] === '"') {
              i += 2;
              continue;
            }
            if (sc === '"') {
              i++;
              break;
            }
            i++;
          }
          continue;
        }
        result += ch;
        i++;
      }
    }

    return result;
  }

  /**
   * Strip trailing comment from a code line.
   * Handles: code ' comment   and   code "string with '" ' comment
   */
  private stripComment(line: string): { code: string; comment: string } {
    let inString = false;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      if (inString) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            i += 2;
            continue;
          }
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === "'") {
          return {
            code: line.substring(0, i).trimEnd(),
            comment: line.substring(i + 1).trim(),
          };
        }
      }
      i++;
    }

    return { code: line.trimEnd(), comment: '' };
  }

  // ─── Phase 2: Compute Indent Levels ────────────────────────────────────────

  private computeIndentLevels(tokens: Token[]): void {
    let depth = 0;
    const stack: BlockInfo[] = [];
    let caseDepth = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;

      if (token.indentLevel === -1) continue;

      if (token.kind === TokenKind.Blank || token.kind === TokenKind.CommentOnly) {
        token.indentLevel = depth + caseDepth;
        continue;
      }

      // Use masked code for block detection — strings replaced with placeholders
      const code = token.code;
      const upper = code.toUpperCase().trimStart();

      // ── End blocks ──
      if (/^\s*END\s+SUB\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.SubBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*END\s+IF\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*NEXT\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.ForBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*LOOP\b/.test(upper) || /^\s*END\s+DO\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.DoBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*END\s+SELECT\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.SelectBlock);
        caseDepth = 0;
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*END\s+TRY\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.TryBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*#\s*END\s*REGION\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.RegionBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }
      if (/^\s*#\s*END\s+IF\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfDefBlock);
        token.indentLevel = depth + caseDepth;
        continue;
      }

      // ── Else / Catch ──
      if (/^\s*ELSE\s+IF\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfBlock);
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.IfBlock });
        depth += 1;
        continue;
      }
      if (/^\s*#\s*ELSE\s+IF\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfDefBlock);
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.IfDefBlock });
        depth += 1;
        continue;
      }
      if (/^\s*ELSE\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfBlock);
        token.indentLevel = depth + caseDepth;
        depth += 1;
        continue;
      }
      if (/^\s*#\s*ELSE\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.IfDefBlock);
        token.indentLevel = depth + caseDepth;
        depth += 1;
        continue;
      }
      if (/^\s*CATCH\b/.test(upper)) {
        depth = Math.max(0, depth - 1);
        this.popBlockIfMatching(stack, BlockKind.TryBlock);
        token.indentLevel = depth + caseDepth;
        depth += 1;
        continue;
      }

      // ── Case / Case Else ──
      if (/^\s*CASE\s+ELSE\b/.test(upper)) {
        caseDepth = 1;
        token.indentLevel = depth;
        continue;
      }
      if (/^\s*CASE\b/.test(upper)) {
        caseDepth = 1;
        token.indentLevel = depth;
        continue;
      }

      // ── Block openers ──
      if (/^\s*(PUBLIC\s+|PRIVATE\s+)?\s*SUB\b/.test(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.SubBlock });
        depth += 1;
        continue;
      }
      if (/^\s*FOR\b/.test(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.ForBlock });
        depth += 1;
        continue;
      }
      if (/^\s*DO\b/.test(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.DoBlock });
        depth += 1;
        continue;
      }
      if (/^\s*SELECT\b/.test(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.SelectBlock });
        caseDepth = 0;
        depth += 1;
        continue;
      }
      if (/^\s*TRY\b/.test(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.TryBlock });
        depth += 1;
        continue;
      }
      if (/^\s*#\s*REGION\b/i.test(code)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.RegionBlock });
        depth += 1;
        continue;
      }
      if (/^\s*#\s*IF\b/i.test(code)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.IfDefBlock });
        depth += 1;
        continue;
      }

      // ── Multi-line If ──
      if (/^\s*IF\b/.test(upper) && !this.isSingleLineIf(upper)) {
        token.indentLevel = depth + caseDepth;
        stack.push({ kind: BlockKind.IfBlock });
        depth += 1;
        continue;
      }

      // ── Regular code line ──
      token.indentLevel = depth + caseDepth;
    }
  }

  private popBlockIfMatching(stack: BlockInfo[], kind: BlockKind): void {
    for (let i = stack.length - 1; i >= 0; i--) {
      const item = stack[i];
      if (item && item.kind === kind) {
        stack.splice(i, 1);
        return;
      }
    }
  }

  private isSingleLineIf(code: string): boolean {
    const upper = code.toUpperCase().trim();
    const thenIdx = upper.indexOf('THEN');
    if (thenIdx === -1) return false;
    const afterThen = upper.slice(thenIdx + 4).trim();
    // Treat as single-line if there's any content after THEN (including whitespace-only,
    // assuming user intends to add code or accidentally left trailing spaces)
    return afterThen !== null && afterThen !== undefined;
  }

  // ─── Phase 3: Format Individual Lines ──────────────────────────────────────

  private formatToken(token: Token, opts: FormatOptions): string {
    if (token.indentLevel === -1) return token.raw;
    if (token.kind === TokenKind.Blank) return '';

    if (token.kind === TokenKind.CommentOnly) {
      const indent = this.makeIndent(token.indentLevel, opts);
      return indent + "'" + token.comment;
    }

    const indent = this.makeIndent(token.indentLevel, opts);

    // Skip keyword casing and spacing normalization for preprocessor directives.
    // Lines starting with # (e.g. #AdditionalJar, #Event, #If) can contain
    // Windows paths, arbitrary text, and syntax that the keyword/spacing
    // formatter would corrupt (e.g. C:\ → C: \).
    // We only apply indentation and trim the leading whitespace.
    if (token.codeWithStrings.trimStart().startsWith('#')) {
      let code = token.codeWithStrings.trimStart();
      if (token.comment) {
        code = code + '  ' + "'" + token.comment;
      }
      return indent + code;
    }

    // Use the original code (with strings intact) for keyword casing
    let code = this.formatCode(token.codeWithStrings, opts).trimStart();

    if (token.comment) {
      code = code + '  ' + "'" + token.comment;
    }

    return indent + code;
  }

  /**
   * Apply keyword casing and spacing normalization to a code line.
   * String contents are preserved — keywords inside strings are not cased.
   */
  private formatCode(code: string, _opts: FormatOptions): string {
    // We process the code token-by-token: outside strings we apply keyword
    // casing; inside strings we leave everything verbatim.
    let result = '';
    let inString = false;
    let segmentStart = 0;

    for (let i = 0; i <= code.length; i++) {
      const ch = i < code.length ? code[i] : null;

      if (inString) {
        if (ch === '"' && i + 1 < code.length && code[i + 1] === '"') {
          i++; // skip escaped quote
          continue;
        }
        if (ch === '"') {
          // End of string — append string content verbatim
          result += code.substring(segmentStart, i + 1);
          inString = false;
          segmentStart = i + 1;
        }
        continue;
      } else {
        if (ch === '"') {
          // Start of string — format the code before the string
          const beforeCode = code.substring(segmentStart, i);
          result += this.formatCodeSegment(beforeCode);
          inString = true;
          segmentStart = i;
        }
        continue;
      }
    }

    // Append remaining code after last string (or full line if no strings)
    if (!inString && segmentStart < code.length) {
      result += this.formatCodeSegment(code.substring(segmentStart));
    }

    return result;
  }

  /**
   * Apply keyword casing and operator spacing to a code segment
   * that is known to be outside any string literal.
   */
  private formatCodeSegment(code: string): string {
    let result = code;

    // ── Multi-word keywords ──
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

    // ── Single-word keywords ──
    const singleKeywords = [
      'Sub', 'End', 'If', 'Then', 'Else', 'For', 'To', 'Step', 'Next',
      'Do', 'Loop', 'While', 'Until', 'Select', 'Case', 'Try', 'Catch',
      'Return', 'Continue', 'Exit', 'Dim', 'As', 'Private', 'Public',
      'Type', 'And', 'Or', 'Not', 'Mod', 'True', 'False', 'Null',
      'In', 'Region',
      // B4X primitive types
      'Int', 'String', 'Long', 'Float', 'Double', 'Boolean', 'Byte',
      'Short', 'Char', 'Object',
    ];

    for (const keyword of singleKeywords) {
      const lower = keyword.toLowerCase();
      const regex = new RegExp(`\\b${lower}\\b`, 'gi');
      result = result.replace(regex, () => keyword);
    }

    // ── Normalize spacing around operators (outside strings) ──
    // Only space-out standalone `=` that are not part of <=, >=, <>, ==
    result = result.replace(/(?<=[^\s<>=])\s*=\s*(?=[^\s<>=])/g, ' = ');
    result = result.replace(/\s*:\s*/g, ': ');
    result = result.replace(/\s*,\s*/g, ', ');

    // NOTE: We deliberately do NOT trim trailing whitespace here.
    // Segments before string literals need their trailing spaces preserved
    // (e.g., `Case "btn"` — the space after `Case` must survive).
    // Line-level trimming happens in formatToken via trimStart() on the
    // full formatted line, so per-segment trimming would be incorrect.

    return result;
  }

  private makeIndent(level: number, opts: FormatOptions): string {
    if (level <= 0) return '';
    if (opts.insertSpaces) {
      return ' '.repeat(level * opts.tabSize);
    }
    return '\t'.repeat(level);
  }

  // ─── Phase 4: Normalize Blank Lines ────────────────────────────────────────

  private normalizeBlankLines(
    formatted: string[],
    tokens: Token[],
  ): void {
    let consecutiveBlanks = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (formatted[i] === '') {
        consecutiveBlanks++;
        if (consecutiveBlanks > 1) {
          formatted[i] = '__REMOVE__';
        }
      } else {
        consecutiveBlanks = 0;
      }
    }

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token || token.kind !== TokenKind.Code) continue;
      const upper = token.code.toUpperCase().trimStart();
      if (!/^\s*(PUBLIC\s+|PRIVATE\s+)?SUB\b/.test(upper)) continue;

      const prevFormatted = formatted[i - 1];
      if (prevFormatted === '' || prevFormatted === '__REMOVE__') continue;

      if (formatted[i - 1] !== '' && formatted[i - 1] !== '__REMOVE__') {
        formatted.splice(i, 0, '');
        tokens.splice(i, 0, {
          kind: TokenKind.Blank,
          raw: '',
          code: '',
          codeWithStrings: '',
          comment: '',
          indentLevel: 0,
        });
        i++;
      }
    }

    for (let i = 0; i < formatted.length; i++) {
      if (formatted[i] === '__REMOVE__') {
        formatted[i] = '';
      }
    }
  }
}

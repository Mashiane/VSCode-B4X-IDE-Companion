/**
 * B4X Auto-Close Keywords Feature
 * Automatically inserts closing keywords (End If, Next, End Select, etc.) when Enter is pressed
 * after an opening block statement.
 */

import * as vscode from 'vscode';

// Regex patterns for block start/end statements
const BLOCK_PATTERNS = {
  sub: {
    start: /^\s*(Public\s+|Private\s+)?Sub\s+\w+/i,
    end: /^\s*End\s+Sub\s*$/i,
    closing: 'End Sub',
  },
  if: {
    start: /^\s*If\b.+?\bThen\s*$/i,
    end: /^\s*End\s+If\s*$/i,
    closing: 'End If',
  },
  inlineIf: /^\s*If\b.+?\bThen\s+.+$/i, // Single-line If (should NOT get End If)
  for: {
    start: /^\s*For\s+(Each\s+)?\w+/i,
    end: /^\s*Next\s*$/i,
    closing: 'Next',
  },
  select: {
    start: /^\s*Select\s+(Case\s+)?\w*/i,
    end: /^\s*End\s+Select\s*$/i,
    closing: 'End Select',
  },
  try: {
    start: /^\s*Try\s*$/i,
    end: /^\s*End\s+Try\s*$/i,
    closing: 'Catch\n\tLog(LastException)\nEnd Try', // 3 lines!
  },
  type: {
    start: /^\s*Type\s+\w+/i,
    end: /^\s*End\s+Type\s*$/i,
    closing: 'End Type',
  },
  doLoop: {
    start: /^\s*Do\s+(While|Until)?/i,
    end: /^\s*Loop\s+(While|Until)?\s*$/i,
    closing: 'Loop',
  },
  whileWend: {
    start: /^\s*While\b/i,
    end: /^\s*Wend\s*$/i,
    closing: 'Wend',
  },
  region: {
    start: /^\s*#Region\b/i,
    end: /^\s*#End\s+Region\s*$/i,
    closing: '#End Region',
  },
};

interface FunctionBlock {
  lineStart: number;
  lineEnd: number;
  name: string;
  scope: 'Public' | 'Private';
  text: string;
}

// Cache of function blocks for the current document
let functionBlocks: FunctionBlock[] = [];
let cachedDocumentUri: string | null = null;

/**
 * Registers the auto-close keyword handler
 * Returns a disposable that unsubscribes the handler
 */
export function registerAutoCloseKeywords(context: vscode.ExtensionContext): vscode.Disposable {
  const disposable = vscode.workspace.onDidChangeTextDocument(onTextChange);
  context.subscriptions.push(
    disposable,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'b4x') {
        analyzeDocumentForFunctionBlocks(editor.document);
      }
    }),
  );

  // Analyze the active document on activation
  if (vscode.window.activeTextEditor?.document.languageId === 'b4x') {
    analyzeDocumentForFunctionBlocks(vscode.window.activeTextEditor.document);
  }

  return disposable;
}

/**
 * Handles text change events to detect Enter key presses
 */
function onTextChange(event: vscode.TextDocumentChangeEvent): void {
  if (event.document.languageId !== 'b4x') {
    return;
  }

  if (event.contentChanges.length === 0) {
    return;
  }

  const change = event.contentChanges[0];
  if (!change || !change.text.match(/\n\s*$/)) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== event.document) {
    return;
  }

  // Re-analyze document after change
  analyzeDocumentForFunctionBlocks(event.document);

  const lineNum = change.range.start.line;
  const lineText = event.document.lineAt(lineNum).text;
  const leadingWhitespace = lineText.match(/^[\t ]*/)?.[0] || '';

  // Check if this line is an opening block statement
  const closingStatement = getClosingStatement(lineText, lineNum);
  if (!closingStatement) {
    return;
  }

  // Verify we need to insert the closing statement
  if (!needsClosingStatement(event.document, lineNum, closingStatement.type)) {
    return;
  }

  // Fix casing of the current line
  const fixedLineText = fixKeywordCasing(lineText, closingStatement.type);

  // Insert the closing statement
  editor.edit(
    (editBuilder) => {
      const lineRange = event.document.lineAt(lineNum).range;
      editBuilder.replace(lineRange, fixedLineText);

      const insertLine = lineNum + 1;
      const insertPos = new vscode.Position(insertLine, 0);

      if (closingStatement.type === 'try') {
        // Try block gets 3 lines: Catch, Log(LastException), End Try
        const catchLine = `${leadingWhitespace}Catch`;
        const logLine = `${leadingWhitespace}\tLog(LastException)`;
        const endTryLine = `${leadingWhitespace}End Try`;
        editBuilder.insert(
          insertPos,
          `\n${catchLine}\n${logLine}\n${endTryLine}\n${leadingWhitespace}`,
        );
      } else {
        editBuilder.insert(
          insertPos,
          `\n${leadingWhitespace}${closingStatement.text}\n${leadingWhitespace}`,
        );
      }
    },
    { undoStopBefore: true, undoStopAfter: true },
  );
}

/**
 * Determines what closing statement (if any) should be inserted
 */
function getClosingStatement(
  lineText: string,
  lineNum: number,
): { type: string; text: string } | null {
  const trimmed = lineText.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith("'")) {
    return null;
  }

  // Check for Sub (must be at global scope, not inside another Sub)
  if (BLOCK_PATTERNS.sub.start.test(lineText)) {
    const currentBlock = getCurrentFunctionBlock(lineNum);
    if (currentBlock) {
      return null; // Already inside a Sub, don't auto-close
    }
    return { type: 'sub', text: BLOCK_PATTERNS.sub.closing };
  }

  // Check for If...Then (multi-line only, not inline If)
  if (BLOCK_PATTERNS.if.start.test(lineText)) {
    // Make sure it's not an inline If
    if (BLOCK_PATTERNS.inlineIf.test(lineText)) {
      return null; // Inline If doesn't need End If
    }
    return { type: 'if', text: BLOCK_PATTERNS.if.closing };
  }

  // Check for For/For Each
  if (BLOCK_PATTERNS.for.start.test(lineText)) {
    return { type: 'for', text: BLOCK_PATTERNS.for.closing };
  }

  // Check for Select/Select Case
  if (BLOCK_PATTERNS.select.start.test(lineText)) {
    return { type: 'select', text: BLOCK_PATTERNS.select.closing };
  }

  // Check for Try
  if (BLOCK_PATTERNS.try.start.test(lineText)) {
    return { type: 'try', text: BLOCK_PATTERNS.try.closing };
  }

  // Check for Type
  if (BLOCK_PATTERNS.type.start.test(lineText)) {
    return { type: 'type', text: BLOCK_PATTERNS.type.closing };
  }

  // Check for Do While/Do Until/Do
  if (BLOCK_PATTERNS.doLoop.start.test(lineText)) {
    return { type: 'doLoop', text: BLOCK_PATTERNS.doLoop.closing };
  }

  // Check for While
  if (BLOCK_PATTERNS.whileWend.start.test(lineText)) {
    return { type: 'whileWend', text: BLOCK_PATTERNS.whileWend.closing };
  }

  // Check for #Region
  if (BLOCK_PATTERNS.region.start.test(lineText)) {
    return { type: 'region', text: BLOCK_PATTERNS.region.closing };
  }

  return null;
}

/**
 * Checks if a closing statement is actually needed
 * Counts open vs close statements to avoid duplicates
 */
function needsClosingStatement(
  document: vscode.TextDocument,
  currentLine: number,
  blockType: string,
): boolean {
  const currentBlock = getCurrentFunctionBlock(currentLine);
  if (!currentBlock) {
    // At global scope - only Sub needs closing
    if (blockType === 'sub') {
      return countBlockDifference(document, blockType, 0, document.lineCount) > 0;
    }
    return false; // Other blocks should be inside a Sub
  }

  // Inside a function block - count opens vs closes
  const diff = countBlockDifference(
    document,
    blockType,
    currentBlock.lineStart,
    currentBlock.lineEnd,
  );

  return diff > 0;
}

/**
 * Counts the difference between opening and closing statements
 */
function countBlockDifference(
  document: vscode.TextDocument,
  blockType: string,
  startLine: number,
  endLine: number,
): number {
  let openCount = 0;
  let closeCount = 0;

  const patterns = BLOCK_PATTERNS[blockType as keyof typeof BLOCK_PATTERNS];
  if (!patterns || !('start' in patterns)) {
    return 0;
  }

  for (let i = startLine; i <= endLine && i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    // Skip comments
    if (lineText.trim().startsWith("'")) {
      continue;
    }

    if (patterns.start.test(lineText)) {
      openCount++;
    }
    if (patterns.end && patterns.end.test(lineText)) {
      closeCount++;
    }
  }

  // For If blocks, subtract inline Ifs from open count
  if (blockType === 'if') {
    let inlineIfCount = 0;
    for (let i = startLine; i <= endLine && i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;
      if (!lineText.trim().startsWith("'") && BLOCK_PATTERNS.inlineIf.test(lineText)) {
        inlineIfCount++;
      }
    }
    openCount -= inlineIfCount;
  }

  return openCount - closeCount;
}

/**
 * Fixes the casing of B4X keywords for proper formatting
 */
function fixKeywordCasing(lineText: string, blockType: string): string {
  let fixed = lineText;

  switch (blockType) {
    case 'sub':
      fixed = fixed
        .replace(/\b(public)\b/gi, 'Public')
        .replace(/\b(private)\b/gi, 'Private')
        .replace(/\b(sub)\b/gi, 'Sub')
        .replace(/\b(as)\b/gi, 'As');
      break;
    case 'if':
      fixed = fixed
        .replace(/\b(if)\b/gi, 'If')
        .replace(/\b(then)\b/gi, 'Then')
        .replace(/\b(and)\b/gi, 'And')
        .replace(/\b(or)\b/gi, 'Or')
        .replace(/\b(not)\b/gi, 'Not');
      break;
    case 'for':
      fixed = fixed
        .replace(/\b(for)\b/gi, 'For')
        .replace(/\b(each)\b/gi, 'Each')
        .replace(/\b(in)\b/gi, 'In')
        .replace(/\b(as)\b/gi, 'As')
        .replace(/\b(to)\b/gi, 'To')
        .replace(/\b(step)\b/gi, 'Step');
      break;
    case 'select':
      fixed = fixed
        .replace(/\b(select)\b/gi, 'Select')
        .replace(/\b(case)\b/gi, 'Case');
      break;
    case 'try':
      fixed = fixed.replace(/\b(try)\b/gi, 'Try');
      break;
    case 'type':
      fixed = fixed
        .replace(/\b(type)\b/gi, 'Type')
        .replace(/\b(as)\b/gi, 'As');
      break;
    case 'doLoop':
      fixed = fixed
        .replace(/\b(do)\b/gi, 'Do')
        .replace(/\b(while)\b/gi, 'While')
        .replace(/\b(until)\b/gi, 'Until');
      break;
    case 'whileWend':
      fixed = fixed.replace(/\b(while)\b/gi, 'While');
      break;
    case 'region':
      fixed = fixed
        .replace(/\b(#region)\b/gi, '#Region')
        .replace(/\b(#end\s+region)\b/gi, '#End Region');
      break;
  }

  return fixed;
}

/**
 * Analyzes the document to find all function blocks (Subs)
 */
function analyzeDocumentForFunctionBlocks(document: vscode.TextDocument): void {
  // Only re-analyze if document changed
  if (cachedDocumentUri === document.uri.toString()) {
    return;
  }

  functionBlocks = [];
  cachedDocumentUri = document.uri.toString();

  let currentBlock: FunctionBlock | null = null;

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    // Check for Sub start
    const subStartMatch = lineText.match(BLOCK_PATTERNS.sub.start);
    if (subStartMatch) {
      currentBlock = {
        lineStart: i,
        lineEnd: -1,
        name: subStartMatch[0].match(/Sub\s+(\w+)/i)?.[1] || '',
        scope: lineText.match(/^\s*Private\s+/i) ? 'Private' : 'Public',
        text: '',
      };
    }

    // Check for Sub end
    if (currentBlock && BLOCK_PATTERNS.sub.end.test(lineText)) {
      currentBlock.lineEnd = i;
      currentBlock.text = document.getText(
        new vscode.Range(
          new vscode.Position(currentBlock.lineStart, 0),
          new vscode.Position(i, lineText.length),
        ),
      );
      functionBlocks.push(currentBlock);
      currentBlock = null;
    }
  }
}

/**
 * Gets the function block that contains the given line
 */
function getCurrentFunctionBlock(lineNum: number): FunctionBlock | null {
  return functionBlocks.find(
    (block) => block.lineStart <= lineNum && block.lineEnd >= lineNum,
  ) || null;
}

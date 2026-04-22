/**
 * B4X Inline Completion Item Provider
 * Ghost text completions that appear as you type (accept with Tab).
 * Provides contextual completions for Sub calls, member access, and keywords.
 */

import * as vscode from 'vscode';
import { getLinePrefix, stripComment } from './b4xDocParser';

export class B4xInlineCompletionItemProvider implements vscode.InlineCompletionItemProvider {
  constructor(
    private readonly workspaceClasses: any,
    private readonly xmlLibraries: any,
  ) {}

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    // Use string-aware comment detection
    if (this.isInComment(lineText, position.character)) {
      return [];
    }

    const linePrefix = getLinePrefix(document, position);
    const items: vscode.InlineCompletionItem[] = [];

    // If user is typing a Sub call (word followed by space or opening paren)
    const wordMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(linePrefix);
    if (wordMatch && wordMatch[1]) {
      const word = wordMatch[1];

      // Check if this matches a known Sub in workspace
      const workspaceMember = this.workspaceClasses?.findMemberByName?.(word);
      if (workspaceMember) {
        const completion = this.createInlineCompletionForMember(workspaceMember, word, linePrefix, position);
        if (completion) items.push(completion);
      }

      // Check XML library methods
      const xmlMember = this.xmlLibraries?.findMemberByName?.(word);
      if (xmlMember) {
        const completion = this.createInlineCompletionForMember(xmlMember, word, linePrefix, position);
        if (completion) items.push(completion);
      }
    }

    return items;
  }

  /**
   * Check if a position is inside a comment, respecting B4X string quoting.
   */
  private isInComment(lineText: string, character: number): boolean {
    const code = stripComment(lineText.substring(0, character));
    // If stripping comments removed content, we're in a comment
    return code.length < lineText.substring(0, character).length;
  }

  /**
   * Create an inline completion for a known method/sub.
   */
  private createInlineCompletionForMember(
    member: any,
    word: string,
    linePrefix: string,
    position: vscode.Position,
  ): vscode.InlineCompletionItem | undefined {
    if (!member?.item) return undefined;
    const name = member.item.name || word;
    // Use params (non-deprecated field) with fallback
    const params = member.item.params || member.item.parameters || [];

    // Only show completion if we have at least one param to complete
    if (params.length === 0) return undefined;

    // Check if user already typed the opening paren
    const afterWord = linePrefix.slice(word.length);
    if (afterWord.startsWith('(')) {
      return undefined;
    }

    // Build ghost text with snippet syntax for tab-through
    const paramList = params.map((p: any, i: number) =>
      `${p.name || `param${i + 1}`}: ${p.type || p.rawType || 'Object'}`
    ).join(', ');
    const insertText = `(${paramList})`;

    return new vscode.InlineCompletionItem(
      insertText,
      new vscode.Range(position.line, position.character, position.line, position.character),
    );
  }
}

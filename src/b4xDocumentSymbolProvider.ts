/**
 * B4X Document Symbol Provider
 * Provides Outline view and Ctrl+Shift+O (Go to Symbol in Editor) functionality.
 * Extracts Subs, Types, Regions, and global variables from the current document.
 */

import * as vscode from 'vscode';
import { getPostDesignStartLine, stripComment } from './b4xDocParser';

export class B4xDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const regionStack: { symbol: vscode.DocumentSymbol; endLine: number }[] = [];

    const startLine = getPostDesignStartLine(document);

    // Track which scope we're in so variables are placed correctly
    let inGlobalsSub = false;

    for (let i = startLine; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;
      const code = stripComment(text).trim();

      // Handle #Region
      const regionMatch = code.match(/^#Region\s+(.+)$/i);
      if (regionMatch) {
        const regionName = regionMatch[1]?.trim() ?? 'Region';
        const regionSymbol = new vscode.DocumentSymbol(
          regionName,
          'Region',
          vscode.SymbolKind.Namespace,
          new vscode.Range(i, 0, i, text.length),
          new vscode.Range(i, 0, i, text.length),
        );
        regionStack.push({ symbol: regionSymbol, endLine: -1 });
        continue;
      }

      // Handle #End Region
      if (/^#End\s+Region\s*$/i.test(code)) {
        for (let j = regionStack.length - 1; j >= 0; j--) {
          const entry = regionStack[j];
          if (entry && entry.endLine === -1) {
            entry.endLine = i;
            entry.symbol.range = new vscode.Range(
              entry.symbol.range.start,
              new vscode.Position(i, text.length),
            );
            break;
          }
        }
        continue;
      }

      // Handle Sub declarations
      const subMatch = code.match(/^\s*(Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?/i);
      if (subMatch) {
        const visibility = subMatch[1]?.trim() ?? '';
        const subName = subMatch[2] ?? '';
        const params = subMatch[3] ?? '';

        // Track entry/exit of Class_Globals / Process_Globals for variable placement
        if (/^Class_Globals$/i.test(subName) || /^Process_Globals$/i.test(subName)) {
          inGlobalsSub = true;
        }

        let kind = vscode.SymbolKind.Function;
        if (/^Class_Globals$/i.test(subName) || /^Process_Globals$/i.test(subName)) {
          kind = vscode.SymbolKind.Namespace;
        } else if (/^_Initialize$/i.test(subName)) {
          kind = vscode.SymbolKind.Constructor;
        }

        const fullRange = this.findSubEndRange(document, i);
        const nameRange = new vscode.Range(i, 0, i, text.length);
        const symbol = new vscode.DocumentSymbol(
          subName,
          `${visibility} Sub ${subName}${params}`.trim(),
          kind,
          fullRange,
          nameRange,
        );
        // Subs are always top-level symbols — no nesting inside Regions or other Subs
        symbols.push(symbol);
        continue;
      }

      // Handle End Sub — exit Class_Globals/Process_Globals scope
      if (/^End\s+Sub$/i.test(code)) {
        // Check if we're exiting a globals sub
        const prevLine = i > 0 ? document.lineAt(i - 1).text.trim() : '';
        // We can't easily know which Sub we're in, so check conservatively
        // by scanning back for the Sub name. For safety, just reset the flag
        // and re-scan to find which scope we're actually in.
        inGlobalsSub = false;
        // Re-scan from start to determine current scope
        for (let k = startLine; k < i; k++) {
          const c = stripComment(document.lineAt(k).text).trim();
          if (/^\s*(Public\s+|Private\s+)?Sub\s+Class_Globals\b/i.test(c) ||
              /^\s*(Public\s+|Private\s+)?Sub\s+Process_Globals\b/i.test(c)) {
            inGlobalsSub = true;
          }
          if (/^\s*End\s+Sub$/i.test(c)) {
            inGlobalsSub = false;
          }
        }
        continue;
      }

      // Handle Type declarations
      const typeMatch = code.match(/^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i);
      if (typeMatch) {
        const typeName = typeMatch[1] ?? '';
        const fields = typeMatch[2] ?? '';
        const symbol = new vscode.DocumentSymbol(
          typeName,
          `Type ${typeName}(${fields})`,
          vscode.SymbolKind.Struct,
          new vscode.Range(i, 0, i, text.length),
          new vscode.Range(i, 0, i, text.length),
        );
        this.addChild(symbols, symbol, regionStack, i);
        continue;
      }

      // Handle variable declarations (only inside Class_Globals/Process_Globals)
      if (inGlobalsSub) {
        const varMatch = code.match(/^\s*(Dim|Private|Public)\s+(.+)$/i);
        if (varMatch) {
          const visibility = varMatch[1] ?? '';
          const clause = varMatch[2] ?? '';
          const names = this.parseVariableNames(clause);
          for (const { name, type } of names) {
            const symbol = new vscode.DocumentSymbol(
              name,
              `${visibility} ${name}${type ? ` As ${type}` : ''}`.trim(),
              vscode.SymbolKind.Variable,
              new vscode.Range(i, 0, i, text.length),
              new vscode.Range(i, 0, i, text.length),
            );
            this.addChild(symbols, symbol, regionStack, i);
          }
        }
      }
    }

    // Close any unclosed regions at end of file
    for (const region of regionStack) {
      if (region.endLine === -1) {
        region.endLine = document.lineCount - 1;
        region.symbol.range = new vscode.Range(
          region.symbol.range.start,
          new vscode.Position(document.lineCount - 1, 0),
        );
      }
    }

    // Add top-level regions to symbols
    for (const region of regionStack) {
      symbols.push(region.symbol);
    }

    return symbols;
  }

  private findSubEndRange(document: vscode.TextDocument, startLine: number): vscode.Range {
    let endLine = startLine;
    for (let i = startLine + 1; i < document.lineCount; i++) {
      const code = stripComment(document.lineAt(i).text).trim();
      if (/^End\s+Sub$/i.test(code)) {
        endLine = i;
        break;
      }
    }
    const endText = document.lineAt(endLine).text;
    return new vscode.Range(startLine, 0, endLine, endText.length);
  }

  private parseVariableNames(clause: string): Array<{ name: string; type?: string }> {
    const results: Array<{ name: string; type?: string }> = [];
    const parts = clause.split(',').map(s => s.trim()).filter(Boolean);

    for (const part of parts) {
      const asMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+As\s+(\w+)/i);
      if (asMatch && asMatch[1]) {
        results.push({ name: asMatch[1], type: asMatch[2] });
        continue;
      }
      const eqMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (eqMatch && eqMatch[1]) {
        results.push({ name: eqMatch[1] });
        continue;
      }
      const nameMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (nameMatch && nameMatch[1]) {
        results.push({ name: nameMatch[1] });
      }
    }

    return results;
  }

  private addChild(
    symbols: vscode.DocumentSymbol[],
    symbol: vscode.DocumentSymbol,
    regionStack: Array<{ symbol: vscode.DocumentSymbol; endLine: number }>,
    line: number,
  ): void {
    const activeRegions = regionStack.filter(r => r.endLine === -1 || r.endLine >= line);

    if (activeRegions.length > 0) {
      const currentRegion = activeRegions[activeRegions.length - 1];
      if (currentRegion) {
        currentRegion.symbol.children = currentRegion.symbol.children || [];
        currentRegion.symbol.children.push(symbol);
      }
    } else {
      // No active region — add to top-level symbols
      symbols.push(symbol);
    }
  }
}

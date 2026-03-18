import * as vscode from 'vscode';

import { parseTypedNameList, stripComment, getPostDesignStartLine } from './b4xDocParser';

export type B4xLocalSymbolKind = 'sub' | 'type' | 'variable';

export interface B4xLocalSymbol {
  name: string;
  kind: B4xLocalSymbolKind;
  typeName?: string;
  container?: string;
}

export interface B4xLocalTypeField {
  name: string;
  typeName?: string;
}

export interface B4xLocalTypeDefinition {
  name: string;
  fields: B4xLocalTypeField[];
}

export function collectLocalSymbols(document: vscode.TextDocument): B4xLocalSymbol[] {
  const symbols: B4xLocalSymbol[] = [];
  const seen = new Set<string>();
  let currentContainer: string | undefined;

  const startLine = getPostDesignStartLine(document);
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (!code) {
      continue;
    }

    if (/^Sub\s+Class_Globals\b/i.test(code)) {
      currentContainer = 'Class_Globals';
    } else if (/^Sub\s+Process_Globals\b/i.test(code)) {
      currentContainer = 'Process_Globals';
    } else if (/^End\s+Sub\b/i.test(code)) {
      currentContainer = undefined;
    }

    registerSubSymbol(code, symbols, seen);
    registerTypeSymbol(code, symbols, seen);
    registerVariableSymbols(code, currentContainer, symbols, seen);
  }

  return symbols;
}

export function collectLocalTypeDefinitions(document: vscode.TextDocument): B4xLocalTypeDefinition[] {
  const types: B4xLocalTypeDefinition[] = [];
  const seen = new Set<string>();

  const startLine = getPostDesignStartLine(document);
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (!code) {
      continue;
    }

    const match = /^\s*Type\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?<fields>.*)\)\s*$/i.exec(code);
    const name = match?.groups?.name;
    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }

    seen.add(name.toLowerCase());
    types.push({
      name,
      fields: dedupeNameEntries(parseTypedNameList(match?.groups?.fields ?? '')).map((entry) => ({
        name: entry.name,
        typeName: entry.type,
      })),
    });
  }

  return types;
}

export function getLocalTypeDefinition(
  document: vscode.TextDocument,
  typeName: string | undefined,
): B4xLocalTypeDefinition | undefined {
  if (!typeName) {
    return undefined;
  }

  return collectLocalTypeDefinitions(document).find((item) => item.name.toLowerCase() === typeName.toLowerCase());
}

function registerSubSymbol(code: string, symbols: B4xLocalSymbol[], seen: Set<string>): void {
  const match = /^\s*(?:Public\s+|Private\s+)?Sub\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\b/i.exec(code);
  const name = match?.groups?.name;
  if (!name || /^Class_Globals$|^Process_Globals$/i.test(name)) {
    return;
  }

  pushSymbol({ name, kind: 'sub' }, symbols, seen);
}

function registerTypeSymbol(code: string, symbols: B4xLocalSymbol[], seen: Set<string>): void {
  const match = /^\s*Type\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(code);
  const name = match?.groups?.name;
  if (!name) {
    return;
  }

  pushSymbol({ name, kind: 'type' }, symbols, seen);
}

function registerVariableSymbols(
  code: string,
  container: string | undefined,
  symbols: B4xLocalSymbol[],
  seen: Set<string>,
): void {
  const match = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(code);
  const clause = match?.[1];
  if (!clause) {
    return;
  }

  for (const declaration of parseTypedNameList(clause)) {
    pushSymbol(
      {
        name: declaration.name,
        kind: 'variable',
        typeName: declaration.type,
        container,
      },
      symbols,
      seen,
    );
  }
}

function dedupeNameEntries(entries: Array<{ name: string; type?: string }>): Array<{ name: string; type?: string }> {
  const byName = new Map<string, { name: string; type?: string }>();

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (!existing.type && entry.type)) {
      byName.set(key, entry);
    }
  }

  return [...byName.values()];
}

function pushSymbol(symbol: B4xLocalSymbol, symbols: B4xLocalSymbol[], seen: Set<string>): void {
  const key = `${symbol.kind}:${symbol.name.toLowerCase()}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  symbols.push(symbol);
}
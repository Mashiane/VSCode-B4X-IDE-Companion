import * as path from 'node:path';
import * as vscode from 'vscode';

import { B4xClass, B4xMethod, B4xParameter, B4xProperty } from './types';
import { libraryIndex } from './storage/libraryIndexSqlite';

export interface XmlMethodInfo extends B4xMethod {
  location: vscode.Location;
}

export interface XmlPropertyInfo extends B4xProperty {
  location: vscode.Location;
}

export interface XmlClassInfo extends B4xClass {
  filePath: string;
  location: vscode.Location;
  methods: XmlMethodInfo[];
  properties: XmlPropertyInfo[];
}

export class XmlLibraryStore {
  private readonly classesByName = new Map<string, XmlClassInfo>();

  public async replaceXmlFiles(filePaths: string[]): Promise<void> {
    console.log(`[B4X TRACE ${new Date().toISOString()}] XmlLibraryStore.replaceXmlFiles.enter -> ${filePaths.length} files`);
    this.classesByName.clear();

    const uniquePaths = [...new Set(filePaths.map((item) => item.toLowerCase()))];
    await Promise.all(uniquePaths.map(async (filePath) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const parsed = parseXmlLibraryDocument(document);
      const toPersist: any[] = [];
      for (const item of parsed) {
        const key = item.name.toLowerCase();
        if (!this.classesByName.has(key)) {
          this.classesByName.set(key, item);
        }
        toPersist.push({ name: item.name, methods: item.methods.map((m) => ({ name: m.name, params: m.params, returnType: m.returnType, signature: m.signature, doc: m.doc })), properties: item.properties.map((p) => ({ name: p.name, type: p.type, access: p.access, doc: p.doc })), doc: item.doc });
      }
      try {
        libraryIndex.upsertXmlClasses(filePath, toPersist);
      } catch (err) {
        console.warn('B4X: failed to persist xml classes for', filePath, err);
      }
    }));
    try {
      const count = this.classesByName.size;
      const samples = [...this.classesByName.keys()].slice(0, 10);
      console.log(`B4X: XmlLibraryStore.replaceXmlFiles -> loaded ${count} classes from xml files. samples=`, samples);
    } catch (err) {
      console.warn('B4X: XmlLibraryStore.replaceXmlFiles logging failed', err);
    }
  }

  public getClassByName(name: string | undefined): XmlClassInfo | undefined {
    if (!name) {
      return undefined;
    }

    return this.classesByName.get(name.trim().toLowerCase());
  }

  public findClassesByPrefix(prefix: string): XmlClassInfo[] {
    const normalizedPrefix = prefix.toLowerCase();
    return [...this.classesByName.values()].filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix));
  }

  // Diagnostics helper to inspect current store contents for debugging.
  public getDiagnostics(lookupName?: string): { count: number; sample: string[]; hasExact: boolean } {
    const count = this.classesByName.size;
    const sample = [...this.classesByName.keys()].slice(0, 100);
    const hasExact = !!lookupName && this.classesByName.has(lookupName.trim().toLowerCase());
    return { count, sample, hasExact };
  }

  public getMember(
    ownerType: string | undefined,
    memberName: string,
  ): { kind: 'method'; item: XmlMethodInfo } | { kind: 'property'; item: XmlPropertyInfo } | undefined {
    const owner = this.getClassByName(ownerType);
    if (!owner) {
      return undefined;
    }

    const method = owner.methods.find((item) => item.name.toLowerCase() === memberName.toLowerCase());
    if (method) {
      return { kind: 'method', item: method };
    }

    const property = owner.properties.find((item) => item.name.toLowerCase() === memberName.toLowerCase());
    if (property) {
      return { kind: 'property', item: property };
    }

    return undefined;
  }

  public resolveMemberType(ownerType: string | undefined, memberName: string): string | undefined {
    const member = this.getMember(ownerType, memberName);
    if (!member) {
      return undefined;
    }

    return member.kind === 'method'
      ? member.item.returnType ?? member.item.rawReturnType
      : member.item.type ?? member.item.rawType;
  }

  // Find a member by name across all XML classes (useful for hover on bare member names)
  public findMemberByName(memberName: string): { owner: XmlClassInfo; kind: 'method' | 'property'; item: XmlMethodInfo | XmlPropertyInfo } | undefined {
    if (!memberName) return undefined;
    const name = memberName.toLowerCase();
    for (const owner of this.classesByName.values()) {
      const m = owner.methods.find((mm) => mm.name.toLowerCase() === name);
      if (m) return { owner, kind: 'method', item: m };
      const p = owner.properties.find((pp) => pp.name.toLowerCase() === name);
      if (p) return { owner, kind: 'property', item: p };
    }
    return undefined;
  }
}

function parseXmlLibraryDocument(document: vscode.TextDocument): XmlClassInfo[] {
  const text = document.getText();
  const classes: XmlClassInfo[] = [];
  const classPattern = /<class>([\s\S]*?)<\/class>/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classPattern.exec(text)) !== null) {
    const block = classMatch[1] ?? '';
    const blockStart = classMatch.index;
    const shortName = decodeXml(extractTagValue(block, 'shortname') ?? extractTagValue(block, 'name') ?? '');
    if (!shortName) {
      continue;
    }

    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const methods = parseMethods(document, block, blockStart);
    const properties = [
      ...parseProperties(document, block, blockStart),
      ...parseFields(document, block, blockStart),
    ];

    classes.push({
      name: shortName,
      libraryName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
      doc: comment || undefined,
      description: comment || undefined,
      methods,
      properties,
      filePath: document.uri.fsPath,
      location: createTagLocation(document, text, 'shortname', shortName, blockStart) ?? createLineLocation(document, 0),
    });
  }

  return classes;
}

function parseMethods(document: vscode.TextDocument, classBlock: string, blockStart: number): XmlMethodInfo[] {
  const result: XmlMethodInfo[] = [];
  const methodPattern = /<method>([\s\S]*?)<\/method>/g;
  let match: RegExpExecArray | null;

  while ((match = methodPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    const name = decodeXml(extractTagValue(block, 'name') ?? '');
    if (!name) {
      continue;
    }

    const parameters = parseParameters(block);
    const rawReturnType = decodeXml(extractTagValue(block, 'returntype') ?? 'void');
    const signature = `${name}(${parameters.map((item) => `${item.name} As ${item.rawType ?? item.type}`).join(', ')})${rawReturnType === 'void' ? '' : ` As ${rawReturnType}`}`;
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');

    result.push({
      kind: 'method',
      name,
      params: parameters,
      parameters,
      returnType: rawReturnType,
      rawReturnType,
      rawSignature: signature,
      signature,
      doc: comment || undefined,
      description: comment || undefined,
      location: createTagLocation(document, classBlock, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

function parseProperties(document: vscode.TextDocument, classBlock: string, blockStart: number): XmlPropertyInfo[] {
  const result: XmlPropertyInfo[] = [];
  const propertyPattern = /<property>([\s\S]*?)<\/property>/g;
  let match: RegExpExecArray | null;

  while ((match = propertyPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    const name = decodeXml(extractTagValue(block, 'name') ?? '');
    if (!name) {
      continue;
    }

    const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const writable = /<parameter>/.test(block);
    result.push({
      kind: 'property',
      name,
      access: writable ? 'readwrite' : 'readonly',
      type: rawType,
      rawType,
      rawSignature: `${name} As ${rawType}`,
      signature: `${name} As ${rawType}`,
      doc: comment || undefined,
      description: comment || undefined,
      location: createTagLocation(document, classBlock, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

function parseFields(document: vscode.TextDocument, classBlock: string, blockStart: number): XmlPropertyInfo[] {
  const result: XmlPropertyInfo[] = [];
  const fieldPattern = /<field>([\s\S]*?)<\/field>/g;
  let match: RegExpExecArray | null;

  while ((match = fieldPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    const name = decodeXml(extractTagValue(block, 'name') ?? '');
    if (!name) {
      continue;
    }

    const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    result.push({
      kind: 'property',
      name,
      access: 'readonly',
      type: rawType,
      rawType,
      rawSignature: `${name} As ${rawType}`,
      signature: `${name} As ${rawType}`,
      doc: comment || undefined,
      description: comment || undefined,
      location: createTagLocation(document, classBlock, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

function parseParameters(block: string): B4xParameter[] {
  const result: B4xParameter[] = [];
  const parameterPattern = /<parameter>([\s\S]*?)<\/parameter>/g;
  let match: RegExpExecArray | null;

  while ((match = parameterPattern.exec(block)) !== null) {
    const parameterBlock = match[1] ?? '';
    const name = decodeXml(extractTagValue(parameterBlock, 'name') ?? '') || `arg${result.length + 1}`;
    const rawType = decodeXml(extractTagValue(parameterBlock, 'type') ?? 'Object');
    result.push({
      name,
      type: rawType,
      rawType,
    });
  }

  return result;
}

function extractTagValue(block: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'i').exec(block);
  return match?.[1]?.trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function createTagLocation(
  document: vscode.TextDocument,
  text: string,
  tagName: string,
  value: string,
  baseOffset: number,
): vscode.Location | undefined {
  const target = `<${tagName}>${escapeForTagSearch(value)}</${tagName}>`;
  const index = text.indexOf(target, Math.max(0, baseOffset));
  if (index < 0) {
    return undefined;
  }

  const startOffset = index + tagName.length + 2;
  const start = document.positionAt(startOffset);
  const end = document.positionAt(startOffset + value.length);
  return new vscode.Location(document.uri, new vscode.Range(start, end));
}

function escapeForTagSearch(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createLineLocation(document: vscode.TextDocument, lineNumber: number): vscode.Location {
  const line = document.lineAt(lineNumber);
  return new vscode.Location(document.uri, line.range);
}

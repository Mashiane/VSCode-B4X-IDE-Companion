import * as path from 'node:path';
import * as vscode from 'vscode';

import { B4xClass, B4xEventDef, B4xFieldDef, B4xMethod, B4xParameter, B4xProperty } from './types';
import { libraryIndex } from './storage/libraryIndexSqlite';

export interface XmlMethodInfo extends B4xMethod {
  location: vscode.Location;
}

export interface XmlPropertyInfo extends B4xProperty {
  location: vscode.Location;
}

export interface XmlFieldInfo extends B4xFieldDef {
  location: vscode.Location;
}

export interface XmlClassInfo extends B4xClass {
  filePath: string;
  location: vscode.Location;
  methods: XmlMethodInfo[];
  properties: XmlPropertyInfo[];
  events: B4xEventDef[];
  fields: XmlFieldInfo[];
  /** Library version parsed from <version> or <doclet-version-NOT-library-version>. */
  version?: string;
}

export class XmlLibraryStore {
  private readonly classesByName = new Map<string, XmlClassInfo>();
  private loadedFiles: string[] = [];

  /** Returns the file paths that were last passed to replaceXmlFiles. */
  public get loadedFilePaths(): readonly string[] {
    return this.loadedFiles;
  }

  public async replaceXmlFiles(filePaths: string[]): Promise<void> {
    console.log(`[B4X TRACE ${new Date().toISOString()}] XmlLibraryStore.replaceXmlFiles.enter -> ${filePaths.length} files`);
    this.loadedFiles = [...filePaths];
    this.classesByName.clear();

    // Deduplicate by lowercase key but preserve original casing of the path
    // so that vscode.Uri.file() receives the real filesystem path (case-sensitive on Linux/macOS).
    const seen = new Map<string, string>();
    for (const fp of filePaths) {
      const key = fp.toLowerCase();
      if (!seen.has(key)) seen.set(key, fp);
    }
    const uniquePaths = [...seen.values()];
    await Promise.all(uniquePaths.map(async (filePath) => {
      const document = await Promise.resolve(vscode.workspace.openTextDocument(vscode.Uri.file(filePath))).catch(() => undefined);
      if (!document) {
        console.warn('B4X: failed to open XML library document, skipped:', filePath);
        return;
      }
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

  /** Get all loaded classes. */
  public getAllClasses(): XmlClassInfo[] {
    return [...this.classesByName.values()];
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

  /** Get all events for a class by name. */
  public getEvents(className: string | undefined): B4xEventDef[] {
    const owner = this.getClassByName(className);
    return owner?.events ?? [];
  }

  /** Get all fields for a class by name. */
  public getFields(className: string | undefined): XmlFieldInfo[] {
    const owner = this.getClassByName(className);
    return owner?.fields ?? [];
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

export function parseXmlLibraryDocument(document: vscode.TextDocument): XmlClassInfo[] {
  const text = document.getText();
  const classes: XmlClassInfo[] = [];

  // Parse library-level version from the root element.
  // Prefer <version> (real library version) over <doclet-version-NOT-library-version> (jar2xml tool version).
  const versionMatch = /<version>([^<]+)<\/version>/i.exec(text);
  const docletVersionMatch = /<doclet-version-NOT-library-version>([^<]+)<\/doclet-version-NOT-library-version>/i.exec(text);
  const libraryVersion = (versionMatch && versionMatch[1] !== '0' ? versionMatch[1] : docletVersionMatch?.[1]) ?? undefined;

  // Use a proper nested-tag-aware parser instead of lazy regex.
  // /<class>.*?<\/class>/ stops at the first </class> which may be nested.
  let pos = 0;
  while (pos < text.length) {
    const classStart = text.indexOf('<class>', pos);
    if (classStart < 0) break;

    // Find the matching </class> by counting nesting depth
    let depth = 1;
    let i = classStart + 7;
    while (i < text.length && depth > 0) {
      if (text.startsWith('<class>', i)) { depth++; i += 7; }
      else if (text.startsWith('</class>', i)) { depth--; i += 8; }
      else { i++; }
    }
    if (depth !== 0) break; // malformed XML

    const blockStart = classStart;
    const block = text.substring(classStart + 7, i - 8);
    pos = i;

    const shortName = decodeXml(extractTagValue(block, 'shortname') ?? '');
    // If no <shortname> tag, derive from the fully-qualified <name> tag.
    // Common class in Core.xml has no <shortname>, only a FQDN <name>.
    const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
    let effectiveName = shortName || deriveShortName(rawName);
    if (!effectiveName) {
      continue;
    }

    // Normalize B4A internal names to user-facing names
    // String2 is the internal wrapper — users always see and type "String"
    if (effectiveName === 'String2') {
      effectiveName = 'String';
    }

    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const methods = parseMethods(document, block, blockStart, text);
    const properties = parseProperties(document, block, blockStart, text);
    const fields = parseFields(document, block, blockStart, text);
    const events = parseEvents(document, block, blockStart);

    // Normalize String2 → String in all member types
    normalizeMemberTypes(methods);
    normalizeMemberTypes(properties);
    normalizeMemberTypes(fields);

    classes.push({
      name: effectiveName,
      libraryName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
      doc: comment || undefined,
      description: comment || undefined,
      methods,
      properties,
      fields,
      events,
      version: libraryVersion,
      filePath: document.uri.fsPath,
      location: createTagLocation(document, text, 'shortname', effectiveName, blockStart)
        ?? createTagLocation(document, text, 'name', effectiveName, blockStart)
        ?? createLineLocation(document, 0),
    });
  }

  return classes;
}

/** Derive a short class name from a fully-qualified name.
 *  E.g. 'anywheresoftware.b4a.keywords.Common' → 'Common' */
function deriveShortName(fqdn: string): string {
  if (!fqdn) return '';
  const lastDot = fqdn.lastIndexOf('.');
  return lastDot >= 0 ? fqdn.substring(lastDot + 1) : fqdn;
}

function parseMethods(document: vscode.TextDocument, classBlock: string, blockStart: number, text: string): XmlMethodInfo[] {
  const result: XmlMethodInfo[] = [];
  const methodPattern = /<method>([\s\S]*?)<\/method>/g;
  let match: RegExpExecArray | null;

  while ((match = methodPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    // Extract DesignerName if present (B4A name like "CallSub"), else fall back to text content (Java name like "CallSubNew")
    const designerNameMatch = /<name\s[^>]*DesignerName="([^"]*)"[^>]*>/i.exec(block);
    const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
    const name = designerNameMatch?.[1] ?? rawName;
    if (!name) {
      continue;
    }

    const parameters = parseParameters(block);
    const rawReturnType = decodeXml(extractTagValue(block, 'returntype') ?? 'void');
    const signature = `${name}(${parameters.map((item) => `${item.name} As ${item.rawType ?? item.type}`).join(', ')})${rawReturnType === 'void' ? '' : ` As ${rawReturnType}`}`;
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const formattedDoc = formatDocToMarkdown(comment);

    result.push({
      kind: 'method',
      name,
      params: parameters,
      parameters,
      returnType: rawReturnType,
      rawReturnType,
      rawSignature: signature,
      signature,
      isPublic: true,
      doc: formattedDoc,
      description: formattedDoc,
      location: createTagLocation(document, text, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

function parseProperties(document: vscode.TextDocument, classBlock: string, blockStart: number, text: string): XmlPropertyInfo[] {
  const result: XmlPropertyInfo[] = [];
  const propertyPattern = /<property>([\s\S]*?)<\/property>/g;
  let match: RegExpExecArray | null;

  while ((match = propertyPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    // Extract DesignerName if present, else fall back to text content
    const designerNameMatch = /<name\s[^>]*DesignerName="([^"]*)"[^>]*>/i.exec(block);
    const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
    const name = designerNameMatch?.[1] ?? rawName;
    if (!name) {
      continue;
    }

    const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const formattedDoc = formatDocToMarkdown(comment);
    const writable = /<parameter>/.test(block);
    result.push({
      kind: 'property',
      name,
      access: writable ? 'readwrite' : 'readonly',
      type: rawType,
      rawType,
      rawSignature: `${name} As ${rawType}`,
      signature: `${name} As ${rawType}`,
      doc: formattedDoc,
      isPublic: true,
      description: formattedDoc,
      location: createTagLocation(document, text, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

function parseFields(document: vscode.TextDocument, classBlock: string, blockStart: number, text: string): XmlFieldInfo[] {
  const result: XmlFieldInfo[] = [];
  const fieldPattern = /<field>([\s\S]*?)<\/field>/g;
  let match: RegExpExecArray | null;

  while ((match = fieldPattern.exec(classBlock)) !== null) {
    const block = match[1] ?? '';
    // Extract DesignerName if present, else fall back to text content
    const designerNameMatch = /<name\s[^>]*DesignerName="([^"]*)"[^>]*>/i.exec(block);
    const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
    const name = designerNameMatch?.[1] ?? rawName;
    if (!name) {
      continue;
    }

    const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const formattedDoc = formatDocToMarkdown(comment);
    result.push({
      name,
      type: rawType,
      rawType,
      doc: formattedDoc,
      description: formattedDoc,
      location: createTagLocation(document, text, 'name', name, blockStart + match.index) ?? createLineLocation(document, 0),
    });
  }

  return result;
}

/** Parse `<event>` elements from a class block.
 *  Format in Core.xml: <event>Click(Position As Int, Value As Object)</event> */
function parseEvents(document: vscode.TextDocument, classBlock: string, blockStart: number): B4xEventDef[] {
  const result: B4xEventDef[] = [];
  const eventPattern = /<event>([\s\S]*?)<\/event>/gi;
  let match: RegExpExecArray | null;

  while ((match = eventPattern.exec(classBlock)) !== null) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;

    // Parse "EventName(Param1 As Type1, Param2 As Type2)"
    const eventMatch = /^(\w+)\s*(?:\(([^)]*)\))?$/.exec(raw);
    if (!eventMatch || !eventMatch[1]) continue;

    const eventName = eventMatch[1];
    const paramsStr = eventMatch[2] ?? '';
    const params = paramsStr
      ? paramsStr.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    result.push({
      name: eventName,
      params,
      rawEvent: raw,
      doc: undefined,
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

const _extractTagRegexCache = new Map<string, RegExp>();
function extractTagValue(block: string, tagName: string): string | undefined {
  let re = _extractTagRegexCache.get(tagName);
  if (!re) {
    re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    _extractTagRegexCache.set(tagName, re);
    // Reset lastIndex to avoid stateful issues if flags ever include 'g'
  }
  re.lastIndex = 0;
  const match = re.exec(block);
  return match?.[1]?.trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    // Numeric decimal entities: &#60; → <
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number.parseInt(num, 10)))
    // Numeric hex entities: &#x3C; → <
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * Normalize B4A internal type names to user-facing names across all member types.
 * String2 → String is the primary normalization, but this can be extended for
 * other internal→user mappings in the future.
 */
function normalizeMemberTypes(members: Array<{type?: string; rawType?: string; returnType?: string; rawReturnType?: string; params?: Array<{type: string; rawType?: string}>} | {type?: string; rawType?: string}>): void {
  for (const member of members) {
    if ('returnType' in member && member.returnType) {
      if (member.returnType === 'String2') member.returnType = 'String';
      if (member.rawReturnType === 'String2') member.rawReturnType = 'String';
    }
    if ('type' in member && member.type) {
      if (member.type === 'String2') member.type = 'String';
      if (member.rawType === 'String2') member.rawType = 'String';
    }
    if ('params' in member && member.params) {
      for (const param of member.params) {
        if (param.type === 'String2') param.type = 'String';
        if (param.rawType === 'String2') param.rawType = 'String';
      }
    }
    // Also normalize signature strings that may contain String2
    if ('signature' in member && typeof (member as any).signature === 'string') {
      (member as any).signature = (member as any).signature.replace(/\bString2\b/g, 'String');
    }
    if ('rawSignature' in member && typeof (member as any).rawSignature === 'string') {
      (member as any).rawSignature = (member as any).rawSignature.replace(/\bString2\b/g, 'String');
    }
  }
}

/**
 * Convert B4A-style `<code>...</code>` blocks in XML comments to
 * Markdown triple-backtick code blocks.  VS Code renders these with
 * a copy button in hover popups and completion documentation.
 *
 * Example input:
 *   Logs a message.\nExample:\n<code>\nLog("hello")\n</code>
 * Example output:
 *   Logs a message.\nExample:\n```b4x\nLog("hello")\n```
 */
export function formatDocToMarkdown(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  let text = decodeXml(raw);
  // Convert <code>...</code> blocks (case-insensitive) to ```b4x code fences
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, body) => {
    // Trim leading/trailing whitespace inside the code block
    let trimmed = body.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
    return `\n\`\`\`b4x\n${trimmed}\n\`\`\`\n`;
  });
  // Convert <b>bold</b> tags
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  // Convert <link>title|url</link> tags
  text = text.replace(/<link>([^|]+)\|([^<]+)<\/link>/gi, '[$1]($2)');
  return text.trim();
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

import * as vscode from 'vscode';

import {
  B4XApiIndex,
  B4xClass,
  B4xLibrary,
  B4xMethod,
  B4xParameter,
  B4xProperty,
  B4xPropertyAccess,
  BuildSummary,
} from './types';

const placeholderLibraryPrefix = '__blank_library_';
const placeholderClassPrefix = '__blank_class_';

export interface MemberAccessInfo {
  expression: string;
  memberPrefix: string;
}

export interface MemberReference {
  expression: string;
  memberName: string;
}

export interface CallContext {
  expression?: string;
  callee: string;
  argumentIndex: number;
}

export interface TypedNameEntry {
  name: string;
  type?: string;
}

interface ParserState {
  libraries: B4xLibrary[];
  classes: B4xClass[];
  classesByName: Map<string, B4xClass>;
  currentLibrary?: B4xLibrary;
  currentClass?: B4xClass;
  currentLibraryDocLines: string[];
  currentClassDocLines: string[];
  pendingMemberDocLines: string[];
  blankLibraryCount: number;
  blankClassCount: number;
}

export interface ParsedLineResult {
  kind: 'library' | 'class' | 'method' | 'property' | 'doc' | 'other';
}

export function getLinePrefix(document: vscode.TextDocument, position: vscode.Position): string {
  return document.lineAt(position.line).text.slice(0, position.character);
}

export function stripComment(text: string): string {
  const commentIndex = text.indexOf("'");
  return commentIndex === -1 ? text : text.slice(0, commentIndex);
}

export function isCommentPosition(lineText: string, character: number): boolean {
  return lineText.slice(0, character).includes("'");
}

export function getMemberAccessInfo(linePrefix: string): MemberAccessInfo | undefined {
  const codePrefix = stripComment(linePrefix);
  const match = /(?<expression>[A-Za-z_][A-Za-z0-9_\.]*)\.\s*(?<memberPrefix>[A-Za-z_][A-Za-z0-9_]*)?$/.exec(codePrefix);
  if (!match?.groups?.expression) {
    return undefined;
  }

  return {
    expression: match.groups.expression,
    memberPrefix: match.groups.memberPrefix ?? '',
  };
}

export function getMemberReferenceAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): MemberReference | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) {
    return undefined;
  }

  const lineText = document.lineAt(position.line).text;
  const prefix = stripComment(lineText.slice(0, range.start.character));
  const match = /(?<expression>[A-Za-z_][A-Za-z0-9_\.]*)\.\s*$/.exec(prefix);
  if (!match?.groups?.expression) {
    return undefined;
  }

  return {
    expression: match.groups.expression,
    memberName: document.getText(range),
  };
}

export function getCallContext(linePrefix: string): CallContext | undefined {
  const codePrefix = stripComment(linePrefix);
  let nesting = 0;

  // Scan from the cursor back to the nearest unmatched opening parenthesis.
  for (let index = codePrefix.length - 1; index >= 0; index -= 1) {
    const character = codePrefix[index];

    if (character === ')') {
      nesting += 1;
      continue;
    }

    if (character !== '(') {
      continue;
    }

    if (nesting > 0) {
      nesting -= 1;
      continue;
    }

    const targetText = codePrefix.slice(0, index).trimEnd();
    const match = /(?:(?<expression>[A-Za-z_][A-Za-z0-9_\.]*)\.)?(?<callee>[A-Za-z_][A-Za-z0-9_]*)$/.exec(targetText);
    if (!match?.groups?.callee) {
      return undefined;
    }

    return {
      expression: match.groups.expression,
      callee: match.groups.callee,
      argumentIndex: countTopLevelCommas(codePrefix.slice(index + 1)),
    };
  }

  return undefined;
}

export function getPostDesignStartLine(document: vscode.TextDocument): number {
  const marker = '@EndOfDesignText@';
  for (let i = 0; i < Math.min(document.lineCount, 2000); i += 1) {
    if (document.lineAt(i).text.includes(marker)) {
      return i + 1;
    }
  }

  return 0;
}

function countTopLevelCommas(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  let commas = 0;
  let nesting = 0;

  for (const character of text) {
    if (character === '(') {
      nesting += 1;
      continue;
    }

    if (character === ')' && nesting > 0) {
      nesting -= 1;
      continue;
    }

    if (character === ',' && nesting === 0) {
      commas += 1;
    }
  }

  return commas;
}

export function parseApiIndexDocument(source: string, sourceFile: string): B4XApiIndex {
  const state: ParserState = {
    libraries: [],
    classes: [],
    classesByName: new Map<string, B4xClass>(),
    currentLibraryDocLines: [],
    currentClassDocLines: [],
    pendingMemberDocLines: [],
    blankLibraryCount: 0,
    blankClassCount: 0,
  };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    parseStructuredLine(line, state);
  }

  finalizePendingDocs(state);

  const libraries = normalizeLibraries(state.libraries);
  const classes = normalizeClasses(state.classes, libraries);

  return {
    version: 1,
    sourceFile,
    generatedAt: new Date().toISOString(),
    libraries,
    classes,
    classesByName: Object.fromEntries(classes.map((item) => [item.name.toLowerCase(), item])),
  };
}

export function summarizeApiIndex(index: B4XApiIndex): BuildSummary {
  let methods = 0;
  let properties = 0;

  for (const item of index.classes) {
    methods += item.methods.length;
    properties += item.properties.length;
  }

  return {
    libraries: index.libraries.length,
    classes: index.classes.length,
    methods,
    properties,
  };
}

export function parseStructuredLine(line: string, state: ParserState): ParsedLineResult {
  const libraryHeader = parseLibraryHeader(line);
  if (libraryHeader) {
    finalizePendingDocs(state);

    const libraryName = libraryHeader.name || `${placeholderLibraryPrefix}${++state.blankLibraryCount}`;
    const library: B4xLibrary = {
      name: libraryName,
      version: libraryHeader.version,
      classNames: [],
    };

    state.libraries.push(library);
    state.currentLibrary = library;
    state.currentClass = undefined;
    state.currentLibraryDocLines = [];
    state.currentClassDocLines = [];
    state.pendingMemberDocLines = [];
    return { kind: 'library' };
  }

  const classHeader = parseClassHeader(line);
  if (classHeader) {
    finalizePendingClassDocs(state);
    state.pendingMemberDocLines = [];

    const className = classHeader.name || `${placeholderClassPrefix}${++state.blankClassCount}`;
    const owner = getOrCreateClass(state, className, state.currentLibrary?.name ?? 'Unknown');
    state.currentClass = owner;
    if (state.currentLibrary && !state.currentLibrary.classNames.includes(owner.name)) {
      state.currentLibrary.classNames.push(owner.name);
    }
    state.currentClassDocLines = [];
    return { kind: 'class' };
  }

  const docLine = sanitizeDocumentationLine(line);
  if (docLine) {
    if (state.currentClass && state.currentClass.methods.length === 0 && state.currentClass.properties.length === 0) {
      state.currentClassDocLines.push(docLine);
    } else if (state.currentLibrary && !state.currentClass && state.currentLibrary.classNames.length === 0) {
      state.currentLibraryDocLines.push(docLine);
    } else {
      state.pendingMemberDocLines.push(docLine);
    }

    return { kind: 'doc' };
  }

  const methodLine = parseMethodLine(line);
  if (methodLine) {
    finalizePendingClassDocs(state);
    if (state.currentClass) {
      const doc = combineDocs(state.pendingMemberDocLines, methodLine.doc);
      state.pendingMemberDocLines = [];
      upsertMethod(state.currentClass, {
        kind: 'method',
        name: methodLine.name,
        params: methodLine.params,
        parameters: methodLine.params,
        returnType: simplifyTypeName(methodLine.returnType) ?? methodLine.returnType,
        rawReturnType: methodLine.returnType,
        rawSignature: methodLine.rawSignature,
        signature: methodLine.rawSignature,
        doc,
        description: doc,
      });
    }

    return { kind: 'method' };
  }

  const propertyLine = parsePropertyLine(line);
  if (propertyLine) {
    finalizePendingClassDocs(state);
    if (state.currentClass) {
      const doc = combineDocs(state.pendingMemberDocLines, propertyLine.doc);
      state.pendingMemberDocLines = [];
      upsertProperty(state.currentClass, {
        kind: 'property',
        name: propertyLine.name,
        access: propertyLine.access,
        type: propertyLine.type ? simplifyTypeName(propertyLine.type) ?? propertyLine.type : undefined,
        rawType: propertyLine.type,
        rawSignature: propertyLine.rawSignature,
        signature: propertyLine.rawSignature,
        doc,
        description: doc,
      });
    }

    return { kind: 'property' };
  }

  if (line.trim()) {
    finalizePendingClassDocs(state);
    state.pendingMemberDocLines = [];
  }

  return { kind: 'other' };
}

export function parseLibraryHeader(line: string): { name: string; version: string } | undefined {
  const match = /^'''\s+LIBRARY:\s*(.*?)\s*\(v([^)]*)\)\s*$/.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    name: match[1]?.trim() ?? '',
    version: match[2]?.trim() ?? '',
  };
}

export function parseClassHeader(line: string): { name: string } | undefined {
  const match = /^'''\s+=== CLASS:\s*(.*?)\s*===\s*$/.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    name: match[1]?.trim() ?? '',
  };
}

export function parseMethodLine(line: string): {
  name: string;
  params: B4xParameter[];
  returnType: string;
  rawSignature: string;
  doc?: string;
} | undefined {
  const match = /^\[Met\]\s+(?<name>[^\s(]+)\((?<params>.*)\)\s+As\s+(?<returnType>\S+)(?:\s{2,}(?<doc>.*))?$/.exec(line);
  if (!match?.groups?.name || match.groups.params === undefined || !match.groups.returnType) {
    return undefined;
  }

  const name = match.groups.name.trim();
  const paramsSource = match.groups.params;
  const returnType = match.groups.returnType.trim();

  return {
    name,
    params: parseParameterList(paramsSource),
    returnType,
    rawSignature: `${name}(${paramsSource.trim()}) As ${returnType}`,
    doc: cleanInlineText(match.groups.doc),
  };
}

export function parsePropertyLine(line: string): {
  name: string;
  access: B4xPropertyAccess;
  type?: string;
  rawSignature: string;
  doc?: string;
} | undefined {
  const match = /^\[Prop(?::(?<access>[RW]))?\]\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:\s+As\s+(?<type>\S+))?(?:\s{2,}(?<doc>.*))?$/.exec(line);
  if (!match?.groups?.name) {
    return undefined;
  }

  const name = match.groups.name.trim();
  const rawType = match.groups.type?.trim();

  return {
    name,
    access: toPropertyAccess(match.groups.access),
    type: rawType,
    rawSignature: rawType ? `${name} As ${rawType}` : name,
    doc: cleanInlineText(match.groups.doc),
  };
}

export function parseParameterList(source: string): B4xParameter[] {
  const trimmed = source.trim();
  if (!trimmed) {
    return [];
  }

  return splitTopLevelCommaSegments(trimmed)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => parseParameter(item, index));
}

export function parseTypedNameList(clause: string): TypedNameEntry[] {
  const result: TypedNameEntry[] = [];
  const pendingNames: string[] = [];

  for (const rawSegment of splitTopLevelCommaSegments(clause)) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }

    const typedMatch = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s+As\s+(?<type>[A-Za-z_][A-Za-z0-9_\.\[\]]*)(?:\s*=.+)?$/i.exec(segment);
    if (typedMatch?.groups?.name) {
      const names = [...pendingNames, typedMatch.groups.name];
      pendingNames.length = 0;

      for (const name of names) {
        result.push({ name, type: typedMatch.groups.type });
      }

      continue;
    }

    const nameMatch = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:\s*=.+)?$/i.exec(segment);
    if (nameMatch?.groups?.name) {
      pendingNames.push(nameMatch.groups.name);
      result.push({ name: nameMatch.groups.name });
    }
  }

  return result;
}

export function sanitizeDocumentationLine(line: string): string | undefined {
  const match = /^'''\s?(.*)$/.exec(line);
  const text = match?.[1]?.trim();
  if (!text) {
    return undefined;
  }

  if (/^#{3,}$/.test(text) || /^={3,}/.test(text) || /^INDEX\s*\(/.test(text) || /^-\s/.test(text)) {
    return undefined;
  }

  return text;
}

function parseParameter(source: string, index: number): B4xParameter {
  const normalizedSource = source.trim().replace(/\s+/g, ' ');
  if (!normalizedSource) {
    return {
      name: `arg${index + 1}`,
      type: 'Object',
      rawType: 'Object',
    };
  }

  const parsed = parseParameterNameAndType(normalizedSource);
  if (!parsed) {
    return {
      name: `arg${index + 1}`,
      type: simplifyTypeName(normalizedSource) ?? normalizedSource,
      rawType: normalizedSource,
    };
  }

  const rawType = parsed.type;
  return {
    name: parsed.name,
    type: simplifyTypeName(rawType) ?? rawType,
    rawType,
  };
}

// Splits a parameter list on commas that are not nested inside paired delimiters.
// Examples:
// - "" -> []
// - "android.view.View ThisView" -> ["android.view.View ThisView"]
// - "int Left, int Top, int Width, int Height" -> ["int Left", "int Top", "int Width", "int Height"]
// - "boolean[] MuteArray, boolean Sync" -> ["boolean[] MuteArray", "boolean Sync"]
export function splitTopLevelCommaSegments(source: string): string[] {
  const parts: string[] = [];
  let current = '';
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '<') {
      angleDepth += 1;
      current += character;
      continue;
    }

    if (character === '>' && angleDepth > 0) {
      angleDepth -= 1;
      current += character;
      continue;
    }

    if (character === '(') {
      parenDepth += 1;
      current += character;
      continue;
    }

    if (character === ')' && parenDepth > 0) {
      parenDepth -= 1;
      current += character;
      continue;
    }

    if (character === '[') {
      bracketDepth += 1;
      current += character;
      continue;
    }

    if (character === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      current += character;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      current += character;
      continue;
    }

    if (character === '}' && braceDepth > 0) {
      braceDepth -= 1;
      current += character;
      continue;
    }

    if (
      character === ','
      && angleDepth === 0
      && parenDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
    ) {
      const segment = current.trim();
      if (segment) {
        parts.push(segment);
      }
      current = '';
      continue;
    }

    current += character;
  }

  const lastSegment = current.trim();
  if (lastSegment) {
    parts.push(lastSegment);
  }

  return parts;
}

// Interprets the final token as the parameter name and everything before it as the type.
// Examples:
// - "android.view.View ThisView" -> { type: "android.view.View", name: "ThisView" }
// - "byte[] Data" -> { type: "byte[]", name: "Data" }
// - "Object Comparator" -> { type: "Object", name: "Comparator" }
function parseParameterNameAndType(source: string): { type: string; name: string } | undefined {
  const tokens = source.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return undefined;
  }

  const name = tokens[tokens.length - 1] ?? '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return undefined;
  }

  const type = tokens.slice(0, -1).join(' ').trim();
  if (!type) {
    return undefined;
  }

  return { type, name };
}

function getOrCreateClass(state: ParserState, className: string, libraryName: string): B4xClass {
  const key = className.toLowerCase();
  const existing = state.classesByName.get(key);
  if (existing) {
    return existing;
  }

  const created: B4xClass = {
    name: className,
    libraryName,
    methods: [],
    properties: [],
  };

  state.classes.push(created);
  state.classesByName.set(key, created);
  return created;
}

function upsertMethod(ownerClass: B4xClass, method: B4xMethod): void {
  const existingIndex = ownerClass.methods.findIndex((item) => item.rawSignature === method.rawSignature);
  if (existingIndex >= 0) {
    ownerClass.methods[existingIndex] = method;
    return;
  }

  ownerClass.methods.push(method);
}

function upsertProperty(ownerClass: B4xClass, property: B4xProperty): void {
  const existingIndex = ownerClass.properties.findIndex((item) => item.name.toLowerCase() === property.name.toLowerCase());
  if (existingIndex >= 0) {
    ownerClass.properties[existingIndex] = property;
    return;
  }

  ownerClass.properties.push(property);
}

function finalizePendingDocs(state: ParserState): void {
  finalizePendingLibraryDocs(state);
  finalizePendingClassDocs(state);
  state.pendingMemberDocLines = [];
}

function finalizePendingLibraryDocs(state: ParserState): void {
  if (!state.currentLibrary || state.currentLibraryDocLines.length === 0) {
    state.currentLibraryDocLines = [];
    return;
  }

  const doc = collapseDocLines(state.currentLibraryDocLines);
  if (doc && !state.currentLibrary.doc) {
    state.currentLibrary.doc = doc;
    state.currentLibrary.description = doc;
  }

  state.currentLibraryDocLines = [];
}

function finalizePendingClassDocs(state: ParserState): void {
  finalizePendingLibraryDocs(state);

  if (!state.currentClass || state.currentClassDocLines.length === 0) {
    state.currentClassDocLines = [];
    return;
  }

  const doc = collapseDocLines(state.currentClassDocLines);
  if (doc && !state.currentClass.doc) {
    state.currentClass.doc = doc;
    state.currentClass.description = doc;
  }

  state.currentClassDocLines = [];
}

function normalizeLibraries(libraries: B4xLibrary[]): B4xLibrary[] {
  const merged = new Map<string, B4xLibrary>();

  for (const item of libraries) {
    const name = resolveLibraryName(item.name);
    const key = `${name.toLowerCase()}::${item.version}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.doc && item.doc) {
        existing.doc = item.doc;
        existing.description = item.description ?? item.doc;
      }
      continue;
    }

    merged.set(key, {
      ...item,
      name,
      classNames: [],
      doc: item.doc,
      description: item.description ?? item.doc,
    });
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeClasses(classes: B4xClass[], libraries: B4xLibrary[]): B4xClass[] {
  const merged = new Map<string, B4xClass>();

  for (const item of classes) {
    const name = resolveClassName(item);
    if (!name) {
      continue;
    }

    const libraryName = resolveLibraryName(item.libraryName);
    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      mergeClasses(existing, item, name, libraryName);
      continue;
    }

    merged.set(key, {
      ...item,
      name,
      libraryName,
      doc: item.doc,
      description: item.description ?? item.doc,
      methods: [...item.methods],
      properties: [...item.properties],
    });
  }

  const normalized = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));

  for (const item of normalized) {
    const owner = findOrCreateLibrary(item.libraryName, libraries);
    if (!owner.classNames.includes(item.name)) {
      owner.classNames.push(item.name);
      owner.classNames.sort((left, right) => left.localeCompare(right));
    }
  }

  return normalized;
}

function mergeClasses(target: B4xClass, source: B4xClass, name: string, libraryName: string): void {
  target.name = name;

  if (target.libraryName === 'Unknown' || target.libraryName === 'Predefined') {
    target.libraryName = libraryName;
  }

  if (!target.doc && source.doc) {
    target.doc = source.doc;
    target.description = source.description ?? source.doc;
  }

  for (const method of source.methods) {
    if (!target.methods.some((item) => item.rawSignature === method.rawSignature)) {
      target.methods.push(method);
    }
  }

  for (const property of source.properties) {
    if (!target.properties.some((item) => item.name.toLowerCase() === property.name.toLowerCase())) {
      target.properties.push(property);
    }
  }
}

function findOrCreateLibrary(libraryName: string, libraries: B4xLibrary[]): B4xLibrary {
  const existing = libraries.find((item) => item.name === libraryName);
  if (existing) {
    return existing;
  }

  const created: B4xLibrary = {
    name: libraryName,
    version: '',
    classNames: [],
  };
  libraries.push(created);
  return created;
}

function resolveClassName(item: B4xClass): string | undefined {
  if (!item.name.startsWith(placeholderClassPrefix)) {
    return item.name;
  }

  const doc = item.doc ?? item.description ?? '';
  const directMatch = /^(?<name>[A-Za-z_][A-Za-z0-9_]*) is a predefined object\b/.exec(doc);
  if (directMatch?.groups?.name) {
    return directMatch.groups.name;
  }

  if (/\bkey codes constants\b/i.test(doc)) {
    return 'KeyCodes';
  }

  if (/\bgravity\b/i.test(doc)) {
    return 'Gravity';
  }

  if (/dialogs return/i.test(doc)) {
    return 'DialogResponse';
  }

  if (/color constants/i.test(doc)) {
    return 'Colors';
  }

  if (/Each Service module includes a Service object/i.test(doc)) {
    return 'Service';
  }

  if (/Strings are immutable/i.test(doc)) {
    return 'String';
  }

  if (/Regex is a predefined object/i.test(doc)) {
    return 'Regex';
  }

  if (/DateTime is a predefined object/i.test(doc) || /Date and time related methods/i.test(doc)) {
    return 'DateTime';
  }

  if (/Bit is a predefined object/i.test(doc)) {
    return 'Bit';
  }

  if (looksLikeActivityObject(item)) {
    return 'Activity';
  }

  if (looksLikeCommonObject(item)) {
    return 'Common';
  }

  return undefined;
}

function resolveLibraryName(name: string): string {
  if (!name.trim() || name.startsWith(placeholderLibraryPrefix)) {
    return 'Predefined';
  }

  return name;
}

function looksLikeActivityObject(item: B4xClass): boolean {
  const methodNames = new Set(item.methods.map((method) => method.name));
  return methodNames.has('startActivityFromChild')
    || methodNames.has('onWindowFocusChanged')
    || methodNames.has('getDatabasePath')
    || methodNames.has('requestWindowFeature');
}

function looksLikeCommonObject(item: B4xClass): boolean {
  const methodNames = new Set(item.methods.map((method) => method.name));
  return methodNames.has('StartActivity')
    || methodNames.has('CallSubDelayed')
    || methodNames.has('Msgbox')
    || methodNames.has('ToastMessageShow');
}

function simplifyTypeName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const arraySuffix = trimmed.endsWith('[]') ? '[]' : '';
  const baseType = arraySuffix ? trimmed.slice(0, -2) : trimmed;
  const simpleName = baseType.split('.').pop() ?? baseType;
  return `${simpleName}${arraySuffix}`;
}

function cleanInlineText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function combineDocs(lines: string[], inlineDoc?: string): string | undefined {
  const parts = [...lines, inlineDoc].filter((item): item is string => Boolean(item && item.trim()));
  if (parts.length === 0) {
    return undefined;
  }

  return collapseDocLines(parts);
}

function collapseDocLines(lines: string[]): string | undefined {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function toPropertyAccess(access: string | undefined): B4xPropertyAccess {
  if (access === 'R') {
    return 'readonly';
  }

  if (access === 'W') {
    return 'writeonly';
  }

  return 'readwrite';
}

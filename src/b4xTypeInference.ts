import * as vscode from 'vscode';

import { ApiIndexStore, normalizeTypeName } from './apiIndex';
import { getLinePrefix, getMemberAccessInfo, parseTypedNameList, stripComment, getPostDesignStartLine } from './b4xDocParser';
import { collectLocalSymbols, collectLocalTypeDefinitions } from './b4xLocalSymbols';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import { B4xClass } from './types';

export function inferVariableTypes(
  document: vscode.TextDocument,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): Map<string, string> {
  const inferredTypes = new Map<string, string>();

  const startLine = getPostDesignStartLine(document);
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (!code) {
      continue;
    }

    registerDeclarationMatches(code, inferredTypes, apiIndex, workspaceClasses, xmlLibraries);
    registerSubParameterMatches(code, inferredTypes, apiIndex, workspaceClasses, xmlLibraries);
  }

  return inferredTypes;
}

export function inferCompletionOwnerClass(
  document: vscode.TextDocument,
  position: vscode.Position,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): B4xClass | undefined {
  const memberAccess = getMemberAccessInfo(getLinePrefix(document, position));
  if (!memberAccess) {
    return undefined;
  }

  const inferredTypes = inferVariableTypes(document, apiIndex, workspaceClasses, xmlLibraries);
  const ownerType = resolveExpressionType(memberAccess.expression, document, apiIndex, workspaceClasses, xmlLibraries, inferredTypes);
  if (ownerType) {
    return resolveKnownClass(ownerType, apiIndex, workspaceClasses, xmlLibraries);
  }

  return findOwnerClassFromLocalSymbols(memberAccess.expression, document, apiIndex, workspaceClasses, xmlLibraries);
}

export function getMemberCompletionPrefix(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | undefined {
  return getMemberAccessInfo(getLinePrefix(document, position))?.memberPrefix;
}

export function resolveExpressionType(
  expression: string,
  document: vscode.TextDocument,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  inferredTypes: Map<string, string> = inferVariableTypes(document, apiIndex, workspaceClasses, xmlLibraries),
): string | undefined {
  const localTypes = collectLocalTypeDefinitions(document);
  const segments = expression.split('.').map((part) => part.trim()).filter(Boolean);
  const firstSegment = segments[0];
  if (!firstSegment) {
    return undefined;
  }

  let currentType: string | undefined = inferredTypes.get(firstSegment.toLowerCase())
    ?? findTypeNameFromLocalSymbols(firstSegment, document, apiIndex, workspaceClasses, xmlLibraries)
    ?? resolveKnownOwner(firstSegment, apiIndex, workspaceClasses, xmlLibraries)?.name;
  if (!currentType) {
    return undefined;
  }

  for (const segment of segments.slice(1)) {
    const resolvedOwnerType: string = currentType;
    const nextType: string | undefined = apiIndex.resolveMemberType(resolvedOwnerType, segment)
      ?? workspaceClasses?.resolveMemberType(resolvedOwnerType, segment)
      ?? xmlLibraries?.resolveMemberType(resolvedOwnerType, segment)
      ?? resolveLocalTypeMemberType(resolvedOwnerType, segment, localTypes);
    if (!nextType) {
      return undefined;
    }

    currentType = resolveKnownOwner(nextType, apiIndex, workspaceClasses, xmlLibraries)?.name ?? nextType;
  }

  return currentType;
}

function registerDeclarationMatches(
  line: string,
  inferredTypes: Map<string, string>,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): void {
  const match = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(line);
  if (!match?.[1]) {
    return;
  }

  for (const declaration of parseTypedNameList(match[1])) {
    if (!declaration.type) {
      continue;
    }

    inferredTypes.set(declaration.name.toLowerCase(), resolveKnownTypeName(declaration.type, apiIndex, workspaceClasses, xmlLibraries));
  }
}

function registerSubParameterMatches(
  line: string,
  inferredTypes: Map<string, string>,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): void {
  const match = /^\s*(?:Public\s+|Private\s+)?Sub\s+[A-Za-z_][A-Za-z0-9_]*\s*\((?<parameters>[^)]*)\)/i.exec(line);
  const parameterList = match?.groups?.parameters?.trim();
  if (!parameterList) {
    return;
  }

  for (const declaration of parseTypedNameList(parameterList)) {
    if (!declaration.type) {
      continue;
    }

    inferredTypes.set(declaration.name.toLowerCase(), resolveKnownTypeName(declaration.type, apiIndex, workspaceClasses, xmlLibraries));
  }
}

function findOwnerClassFromLocalSymbols(
  expression: string,
  document: vscode.TextDocument,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): B4xClass | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(expression)) {
    return undefined;
  }

  const symbol = collectLocalSymbols(document).find(
    (item) => item.kind === 'variable' && item.name.toLowerCase() === expression.toLowerCase(),
  );
  if (!symbol?.typeName) {
    return undefined;
  }

  const normalizedType = normalizeTypeName(symbol.typeName) ?? symbol.typeName;
  return resolveKnownClass(normalizedType, apiIndex, workspaceClasses, xmlLibraries);
}

function findTypeNameFromLocalSymbols(
  symbolName: string,
  document: vscode.TextDocument,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): string | undefined {
  const symbol = collectLocalSymbols(document).find(
    (item) => item.kind === 'variable' && item.name.toLowerCase() === symbolName.toLowerCase(),
  );
  if (!symbol?.typeName) {
    return undefined;
  }

  const normalizedType = normalizeTypeName(symbol.typeName) ?? symbol.typeName;
  return resolveKnownClass(normalizedType, apiIndex, workspaceClasses, xmlLibraries)?.name ?? normalizedType;
}

function resolveKnownTypeName(
  typeName: string,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): string {
  const normalized = normalizeTypeName(typeName) ?? typeName.trim();
  return resolveKnownClass(normalized, apiIndex, workspaceClasses, xmlLibraries)?.name ?? normalized;
}

function resolveKnownClass(
  typeName: string,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): B4xClass | undefined {
  return workspaceClasses?.getClassByName(typeName) ?? xmlLibraries?.getClassByName(typeName) ?? apiIndex.getClassByName(typeName);
}

function resolveKnownOwner(
  ownerName: string,
  apiIndex: ApiIndexStore,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
): B4xClass | undefined {
  return workspaceClasses?.getDefinitionByName(ownerName) ?? xmlLibraries?.getClassByName(ownerName) ?? apiIndex.getClassByName(ownerName);
}

function resolveLocalTypeMemberType(
  ownerType: string,
  memberName: string,
  localTypes: ReturnType<typeof collectLocalTypeDefinitions>,
): string | undefined {
  const localType = localTypes.find((item) => item.name.toLowerCase() === ownerType.toLowerCase());
  const field = localType?.fields.find((item) => item.name.toLowerCase() === memberName.toLowerCase());
  return field?.typeName;
}

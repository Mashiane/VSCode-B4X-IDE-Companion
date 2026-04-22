import * as vscode from 'vscode';

import { normalizeTypeName } from './types';
import { getLinePrefix, getMemberAccessInfo, parseTypedNameList, stripComment, getPostDesignStartLine } from './b4xDocParser';
import { collectLocalSymbols, collectLocalTypeDefinitions } from './b4xLocalSymbols';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { XmlLibraryStore } from './xmlLibraryIndex';
import { PrimitiveTypeStore } from './primitiveTypeStore';
import { B4xClass } from './types';

export function inferVariableTypes(
  document: vscode.TextDocument,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): Map<string, string> {
  const inferredTypes = new Map<string, string>();

  const startLine = getPostDesignStartLine(document);
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (!code) {
      continue;
    }

    registerDeclarationMatches(code, inferredTypes, workspaceClasses, xmlLibraries, primitiveTypes);
    registerSubParameterMatches(code, inferredTypes, workspaceClasses, xmlLibraries, primitiveTypes);
  }

  return inferredTypes;
}

export function inferCompletionOwnerClass(
  document: vscode.TextDocument,
  position: vscode.Position,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): B4xClass | undefined {
  const memberAccess = getMemberAccessInfo(getLinePrefix(document, position));
  if (!memberAccess) {
    return undefined;
  }

  const inferredTypes = inferVariableTypes(document, workspaceClasses, xmlLibraries, primitiveTypes);
  const ownerType = resolveExpressionType(memberAccess.expression, document, workspaceClasses, xmlLibraries, inferredTypes, primitiveTypes);
  if (ownerType) {
    return resolveKnownClass(ownerType, workspaceClasses, xmlLibraries, primitiveTypes);
  }

  return findOwnerClassFromLocalSymbols(memberAccess.expression, document, workspaceClasses, xmlLibraries, primitiveTypes);
}


export function resolveExpressionType(
  expression: string,
  document: vscode.TextDocument,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  inferredTypes: Map<string, string> = new Map(),
  primitiveTypes?: PrimitiveTypeStore,
): string | undefined {
  const localTypes = collectLocalTypeDefinitions(document);
  const segments = expression.split('.').map((part) => part.trim()).filter(Boolean);
  const firstSegment = segments[0];
  if (!firstSegment) {
    return undefined;
  }

  let currentType: string | undefined = inferredTypes.get(firstSegment.toLowerCase())
    ?? findTypeNameFromLocalSymbols(firstSegment, document, workspaceClasses, xmlLibraries, primitiveTypes)
    ?? resolveKnownOwner(firstSegment, workspaceClasses, xmlLibraries, primitiveTypes)?.name;
  if (!currentType) {
    return undefined;
  }

  for (const segment of segments.slice(1)) {
    const resolvedOwnerType: string = currentType;
    const nextType: string | undefined =
      workspaceClasses?.resolveMemberType(resolvedOwnerType, segment)
      ?? xmlLibraries?.resolveMemberType(resolvedOwnerType, segment)
      ?? resolveLocalTypeMemberType(resolvedOwnerType, segment, localTypes);
    if (!nextType) {
      return undefined;
    }

    currentType = resolveKnownOwner(nextType, workspaceClasses, xmlLibraries, primitiveTypes)?.name ?? nextType;
  }

  return currentType;
}

function registerDeclarationMatches(
  line: string,
  inferredTypes: Map<string, string>,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): void {
  const match = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(line);
  if (!match?.[1]) {
    return;
  }

  for (const declaration of parseTypedNameList(match[1])) {
    if (!declaration.type) {
      continue;
    }

    inferredTypes.set(declaration.name.toLowerCase(), resolveKnownTypeName(declaration.type, workspaceClasses, xmlLibraries, primitiveTypes));
  }
}

function registerSubParameterMatches(
  line: string,
  inferredTypes: Map<string, string>,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
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

    inferredTypes.set(declaration.name.toLowerCase(), resolveKnownTypeName(declaration.type, workspaceClasses, xmlLibraries, primitiveTypes));
  }
}

function findOwnerClassFromLocalSymbols(
  expression: string,
  document: vscode.TextDocument,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
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
  return resolveKnownClass(normalizedType, workspaceClasses, xmlLibraries, primitiveTypes);
}

function findTypeNameFromLocalSymbols(
  symbolName: string,
  document: vscode.TextDocument,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): string | undefined {
  const symbol = collectLocalSymbols(document).find(
    (item) => item.kind === 'variable' && item.name.toLowerCase() === symbolName.toLowerCase(),
  );
  if (!symbol?.typeName) {
    return undefined;
  }

  const normalizedType = normalizeTypeName(symbol.typeName) ?? symbol.typeName;
  return resolveKnownClass(normalizedType, workspaceClasses, xmlLibraries, primitiveTypes)?.name ?? normalizedType;
}

function resolveKnownTypeName(
  typeName: string,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): string {
  const normalized = normalizeTypeName(typeName) ?? typeName.trim();
  return resolveKnownClass(normalized, workspaceClasses, xmlLibraries, primitiveTypes)?.name ?? normalized;
}

function resolveKnownClass(
  typeName: string,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): B4xClass | undefined {
  // First check if it's a primitive type that maps to a real class
  if (primitiveTypes) {
    const mappedType = primitiveTypes.resolvePrimitiveType(typeName);
    if (mappedType) {
      // Return the mapped class name - let the caller resolve it from XML
      typeName = mappedType;
    }
  }

  return workspaceClasses?.getDefinitionByName(typeName) ?? xmlLibraries?.getClassByName(typeName);
}

function resolveKnownOwner(
  ownerName: string,
  workspaceClasses?: WorkspaceClassStore,
  xmlLibraries?: XmlLibraryStore,
  primitiveTypes?: PrimitiveTypeStore,
): B4xClass | undefined {
  // First check if it's a primitive type that maps to a real class
  if (primitiveTypes) {
    const mappedType = primitiveTypes.resolvePrimitiveType(ownerName);
    if (mappedType) {
      ownerName = mappedType;
    }
  }

  return workspaceClasses?.getDefinitionByName(ownerName) ?? xmlLibraries?.getClassByName(ownerName);
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

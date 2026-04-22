import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import {
  B4xApiIndex,
  B4xClass,
  B4xMethod,
  B4xProperty,
} from './types';

export type B4xMemberEntry =
  | { kind: 'method'; item: B4xMethod }
  | { kind: 'property'; item: B4xProperty };

export interface B4xMethodEntry {
  ownerClass: B4xClass;
  method: B4xMethod;
}

export interface B4xPropertyEntry {
  ownerClass: B4xClass;
  property: B4xProperty;
}

export function normalizeTypeName(value: string | undefined): string | undefined {
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

export class ApiIndexStore {
  private readonly classes: B4xClass[];
  private readonly classesByName = new Map<string, B4xClass>();
  private readonly methods: B4xMethodEntry[] = [];
  private readonly properties: B4xPropertyEntry[] = [];
  private allowedLibraries?: ReadonlySet<string>;

  private constructor(private readonly index: B4xApiIndex) {
    this.classes = index.classes.length > 0
      ? index.classes
      : Object.values(index.classesByName ?? {});

    for (const item of this.classes) {
      this.classesByName.set(item.name.toLowerCase(), item);
      this.methods.push(...item.methods.map((method) => ({ ownerClass: item, method })));
      this.properties.push(...item.properties.map((property) => ({ ownerClass: item, property })));
    }
  }

  public static async load(context: vscode.ExtensionContext): Promise<ApiIndexStore | undefined> {
    const filePath = context.asAbsolutePath(path.join('data', 'b4x-api-index.json'));

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as B4xApiIndex;
      return new ApiIndexStore(parsed);
    } catch (error) {
      console.error(`Failed to load B4X API index from ${filePath}`, error);
      return undefined;
    }
  }

  public static empty(): ApiIndexStore {
    return new ApiIndexStore({
      version: 1,
      sourceFile: '',
      generatedAt: '',
      libraries: [],
      classes: [],
      classesByName: {},
    });
  }

  public get allClasses(): readonly B4xClass[] {
    return this.classes.filter((item) => this.isLibraryAllowed(item.libraryName));
  }

  public get allMethods(): readonly B4xMethodEntry[] {
    return this.methods.filter((item) => this.isLibraryAllowed(item.ownerClass.libraryName));
  }

  public get allProperties(): readonly B4xPropertyEntry[] {
    return this.properties.filter((item) => this.isLibraryAllowed(item.ownerClass.libraryName));
  }

  public setAllowedLibraries(allowedLibraries?: ReadonlySet<string>): void {
    this.allowedLibraries = allowedLibraries && allowedLibraries.size > 0 ? allowedLibraries : undefined;
  }

  public getClassByName(name: string | undefined): B4xClass | undefined {
    const normalized = normalizeTypeName(name)?.toLowerCase();
    const item = normalized ? this.classesByName.get(normalized) : undefined;
    return item && this.isLibraryAllowed(item.libraryName) ? item : undefined;
  }

  public findClassesByPrefix(prefix: string): B4xClass[] {
    const normalizedPrefix = prefix.toLowerCase();
    return this.classes.filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix) && this.isLibraryAllowed(item.libraryName));
  }

  public findMethodsByPrefix(prefix: string): B4xMethodEntry[] {
    const normalizedPrefix = prefix.toLowerCase();
    return this.methods.filter((item) => item.method.name.toLowerCase().startsWith(normalizedPrefix) && this.isLibraryAllowed(item.ownerClass.libraryName));
  }

  public findPropertiesByPrefix(prefix: string): B4xPropertyEntry[] {
    const normalizedPrefix = prefix.toLowerCase();
    return this.properties.filter((item) => item.property.name.toLowerCase().startsWith(normalizedPrefix) && this.isLibraryAllowed(item.ownerClass.libraryName));
  }

  public getMember(ownerType: string | undefined, memberName: string): B4xMemberEntry | undefined {
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

    if (member.kind === 'method') {
      return normalizeTypeName(member.item.returnType ?? member.item.rawReturnType);
    }

    return normalizeTypeName(member.item.type ?? member.item.rawType);
  }

  // Find a member by name across the API index (useful for hover on bare member names)
  public findMemberByName(memberName: string): { ownerClass: B4xClass; kind: 'method' | 'property'; item: B4xMethod | B4xProperty } | undefined {
    if (!memberName) return undefined;
    const name = memberName.toLowerCase();
    for (const entry of this.methods) {
      if (entry.method.name.toLowerCase() === name && this.isLibraryAllowed(entry.ownerClass.libraryName)) {
        return { ownerClass: entry.ownerClass, kind: 'method', item: entry.method };
      }
    }
    for (const entry of this.properties) {
      if (entry.property.name.toLowerCase() === name && this.isLibraryAllowed(entry.ownerClass.libraryName)) {
        return { ownerClass: entry.ownerClass, kind: 'property', item: entry.property };
      }
    }
    return undefined;
  }

  private isLibraryAllowed(libraryName: string | undefined): boolean {
    if (isAlwaysAvailableLibrary(libraryName)) {
      return true;
    }

    if (!this.allowedLibraries || this.allowedLibraries.size === 0) {
      return true;
    }

    if (!libraryName) {
      return false;
    }

    return this.allowedLibraries.has(libraryName.toLowerCase());
  }
}

function isAlwaysAvailableLibrary(libraryName: string | undefined): boolean {
  if (!libraryName) {
    return false;
  }

  const normalized = libraryName.trim().toLowerCase();
  return normalized === 'predefined';
}

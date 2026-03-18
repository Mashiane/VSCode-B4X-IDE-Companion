import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';

import { parseTypedNameList, stripComment, getPostDesignStartLine } from './b4xDocParser';
import { normalizeBasePath } from './projectFile';
import { B4xClass, B4xMethod, B4xParameter, B4xProperty } from './types';
import { libraryIndex, ParsedModuleBlob } from './storage/libraryIndexSqlite';

export interface WorkspaceMethodInfo extends B4xMethod {
  location: vscode.Location;
}

export interface WorkspacePropertyInfo extends B4xProperty {
  location: vscode.Location;
}

export interface WorkspaceClassInfo extends B4xClass {
  filePath: string;
  moduleType: 'class' | 'static';
  location: vscode.Location;
  methods: WorkspaceMethodInfo[];
  properties: WorkspacePropertyInfo[];
}

export class WorkspaceClassStore {
  private readonly workspaceClassesByName = new Map<string, WorkspaceClassInfo>();
  private readonly externalClassesByName = new Map<string, WorkspaceClassInfo>();
  private readonly workspaceFileToClassName = new Map<string, string>();
  private readonly externalFileToClassName = new Map<string, string>();
  private allowedModuleBasePaths?: ReadonlySet<string>;

  public static async load(): Promise<WorkspaceClassStore> {
    const store = new WorkspaceClassStore();
    await store.refresh();
    return store;
  }

  public setAllowedModuleBasePaths(allowedModuleBasePaths?: ReadonlySet<string>): void {
    this.allowedModuleBasePaths = allowedModuleBasePaths && allowedModuleBasePaths.size > 0
      ? allowedModuleBasePaths
      : undefined;
  }

  public async refresh(
    allowedModuleBasePaths: ReadonlySet<string> | undefined = this.allowedModuleBasePaths,
    projectDirectory?: string,
  ): Promise<void> {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.refresh.enter`);
    this.setAllowedModuleBasePaths(allowedModuleBasePaths);
    this.workspaceClassesByName.clear();
    this.workspaceFileToClassName.clear();

    // If the project explicitly listed ModuleN= entries, only load those
    // files (check both `.bas` and `.b4x` variants). Otherwise fall back to
    // scanning the workspace or project folder top-level files.
    if (this.allowedModuleBasePaths && this.allowedModuleBasePaths.size > 0) {
      const uniquePaths = new Set<string>();
      for (const base of this.allowedModuleBasePaths) {
        try {
          const candBas = path.resolve(`${base}.bas`);
          const candB4x = path.resolve(`${base}.b4x`);
          const statBas = await fs.stat(candBas).catch(() => undefined);
          if (statBas && statBas.isFile()) uniquePaths.add(candBas);
          const statB4x = await fs.stat(candB4x).catch(() => undefined);
          if (statB4x && statB4x.isFile()) uniquePaths.add(candB4x);
        } catch {
          // ignore missing candidates
        }
      }

      await Promise.all(Array.from(uniquePaths).map(async (filePath) => {
        try {
          // Try DB cache first
          const stat = await fs.stat(filePath).catch(() => undefined);
          if (stat) {
            const cached = libraryIndex.getParsedForPath(filePath);
            if (cached && cached.mtime === Math.floor(stat.mtimeMs) && cached.size === stat.size) {
              const parsed: ParsedModuleBlob = cached.parsed;
              const info = createWorkspaceClassFromParsed(filePath, parsed, 'workspace');
              const key = info.name.toLowerCase();
              this.workspaceClassesByName.set(key, info);
              this.workspaceFileToClassName.set(filePath.toLowerCase(), key);
              libraryIndex.touchFileSeen(filePath);
              return;
            }
          }

          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          this.upsertDocument(document, 'workspace');
          // Persist parsed blob for future runs
          try {
            const parsedDoc = parseWorkspaceClassDocument(document);
            if (parsedDoc) {
              const methods = parsedDoc.methods.map((m) => ({ name: m.name, params: m.params, returnType: m.returnType, signature: m.signature, doc: m.doc }));
              const properties = parsedDoc.properties.map((p) => ({ name: p.name, type: p.type, access: p.access, doc: p.doc }));
              const blob: ParsedModuleBlob = { moduleKind: parsedDoc.moduleType, name: parsedDoc.name, methods, properties, doc: parsedDoc.doc };
              const st = await fs.stat(filePath).catch(() => undefined);
              if (st) libraryIndex.upsertParsedForPath(filePath, Math.floor(st.mtimeMs), st.size, blob);
            }
          } catch { /* ignore */ }
        } catch (e) {
          console.warn('B4X: WorkspaceClassStore.refresh failed to open module file', filePath, e);
        }
      }));
      return;
    }

    let files: vscode.Uri[] = [];
    if (projectDirectory) {
      // Limit scanning to the selected project directory only.
      // Only include files directly in the project folder (no subfolders)
      const rel = new vscode.RelativePattern(projectDirectory, '*.{bas,b4x}');
      files = await vscode.workspace.findFiles(rel, '**/node_modules/**');
    } else {
      files = await vscode.workspace.findFiles('**/*.{bas,b4x}', '**/node_modules/**');
    }

    await Promise.all(files.map(async (uri) => {
      const filePath = uri.fsPath;
      try {
        const stat = await fs.stat(filePath).catch(() => undefined);
        if (stat) {
          const cached = libraryIndex.getParsedForPath(filePath);
          if (cached && cached.mtime === Math.floor(stat.mtimeMs) && cached.size === stat.size) {
            const parsed: ParsedModuleBlob = cached.parsed;
            const info = createWorkspaceClassFromParsed(filePath, parsed, 'workspace');
            const key = info.name.toLowerCase();
            this.workspaceClassesByName.set(key, info);
            this.workspaceFileToClassName.set(filePath.toLowerCase(), key);
            libraryIndex.touchFileSeen(filePath);
            return;
          }
        }

        const document = await vscode.workspace.openTextDocument(uri);
        this.upsertDocument(document, 'workspace');
        try {
          const parsedDoc = parseWorkspaceClassDocument(document);
          if (parsedDoc) {
            const methods = parsedDoc.methods.map((m) => ({ name: m.name, params: m.params, returnType: m.returnType, signature: m.signature, doc: m.doc }));
            const properties = parsedDoc.properties.map((p) => ({ name: p.name, type: p.type, access: p.access, doc: p.doc }));
            const blob: ParsedModuleBlob = { moduleKind: parsedDoc.moduleType, name: parsedDoc.name, methods, properties, doc: parsedDoc.doc };
            const st = await fs.stat(filePath).catch(() => undefined);
            if (st) libraryIndex.upsertParsedForPath(filePath, Math.floor(st.mtimeMs), st.size, blob);
          }
        } catch { /* ignore */ }
      } catch (e) {
        console.warn('B4X: WorkspaceClassStore.refresh failed for', filePath, e);
      }
    }));
  }

  public async replaceExternalSourceFiles(filePaths: string[]): Promise<void> {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.replaceExternalSourceFiles.enter -> ${filePaths.length} files`);
    this.externalClassesByName.clear();
    this.externalFileToClassName.clear();

    const uniquePaths = [...new Set(filePaths.map((item) => item.toLowerCase()))];
    await Promise.all(uniquePaths.map(async (filePath) => {
      try {
        // Consult DB cache first to avoid re-parsing large platform modules
        const stat = await fs.stat(filePath).catch(() => undefined);
        if (stat) {
          const cached = libraryIndex.getParsedForPath(filePath);
          if (cached && cached.mtime === Math.floor(stat.mtimeMs) && cached.size === stat.size) {
            // Rehydrate into workspaceClass store without opening document
            const parsed: ParsedModuleBlob = cached.parsed;
            const info = createWorkspaceClassFromParsed(filePath, parsed, 'external');
            const key = info.name.toLowerCase();
            this.externalClassesByName.set(key, info);
            this.externalFileToClassName.set(filePath.toLowerCase(), key);
            libraryIndex.touchFileSeen(filePath);
            return;
          }
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        this.upsertDocument(document, 'external');
        // After parsing, persist parsed blob for future runs if possible
        try {
          const parsedDoc = parseWorkspaceClassDocument(document);
          if (parsedDoc) {
            const methods = parsedDoc.methods.map((m) => ({ name: m.name, params: m.params, returnType: m.returnType, signature: m.signature, doc: m.doc }));
            const properties = parsedDoc.properties.map((p) => ({ name: p.name, type: p.type, access: p.access, doc: p.doc }));
            const blob: ParsedModuleBlob = { moduleKind: parsedDoc.moduleType, name: parsedDoc.name, methods, properties, doc: parsedDoc.doc };
            try {
              const st = await fs.stat(filePath).catch(() => undefined);
              if (st) libraryIndex.upsertParsedForPath(filePath, Math.floor(st.mtimeMs), st.size, blob);
            } catch { /* ignore */ }
          }
        } catch { /* ignore persistence errors */ }
      } catch (e) {
        console.warn('B4X: WorkspaceClassStore.replaceExternalSourceFiles failed for', filePath, e);
      }
    }));
  }

  public clear(): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.clear`);
    this.workspaceClassesByName.clear();
    this.externalClassesByName.clear();
    this.workspaceFileToClassName.clear();
    this.externalFileToClassName.clear();
    this.allowedModuleBasePaths = undefined;
  }

  public upsertDocument(document: vscode.TextDocument, source: 'workspace' | 'external' = 'workspace'): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.upsertDocument.enter -> ${document.uri.fsPath} (${source})`);
    const fileToClassName = source === 'workspace' ? this.workspaceFileToClassName : this.externalFileToClassName;
    const classesByName = source === 'workspace' ? this.workspaceClassesByName : this.externalClassesByName;
    const previousClassName = fileToClassName.get(document.uri.fsPath.toLowerCase());
    if (previousClassName) {
      classesByName.delete(previousClassName);
      fileToClassName.delete(document.uri.fsPath.toLowerCase());
    }

    if (!this.isModuleAllowed(document.uri.fsPath)) {
      return;
    }

    const parsed = parseWorkspaceClassDocument(document);
    if (!parsed) {
      return;
    }

    const key = parsed.name.toLowerCase();
    classesByName.set(key, parsed);
    fileToClassName.set(document.uri.fsPath.toLowerCase(), key);
  }

  public delete(uri: vscode.Uri): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.delete -> ${uri.fsPath}`);
    deleteFromSourceMaps(uri.fsPath, this.workspaceFileToClassName, this.workspaceClassesByName);
    deleteFromSourceMaps(uri.fsPath, this.externalFileToClassName, this.externalClassesByName);
  }

  public getDefinitionByName(name: string | undefined): WorkspaceClassInfo | undefined {
    if (!name) {
      return undefined;
    }

    const key = name.trim().toLowerCase();
    return this.workspaceClassesByName.get(key) ?? this.externalClassesByName.get(key);
  }

  public getClassByName(name: string | undefined): WorkspaceClassInfo | undefined {
    const definition = this.getDefinitionByName(name);
    return definition?.moduleType === 'class' ? definition : undefined;
  }

  public findClassesByPrefix(prefix: string): WorkspaceClassInfo[] {
    const normalizedPrefix = prefix.toLowerCase();
    const merged = new Map<string, WorkspaceClassInfo>();

    for (const item of this.externalClassesByName.values()) {
      if (item.name.toLowerCase().startsWith(normalizedPrefix)) {
        merged.set(item.name.toLowerCase(), item);
      }
    }

    for (const item of this.workspaceClassesByName.values()) {
      if (item.name.toLowerCase().startsWith(normalizedPrefix)) {
        merged.set(item.name.toLowerCase(), item);
      }
    }

    return [...merged.values()];
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

  public getMember(
    ownerType: string | undefined,
    memberName: string,
  ): { kind: 'method'; item: WorkspaceMethodInfo } | { kind: 'property'; item: WorkspacePropertyInfo } | undefined {
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

  // Find a member by name across workspace and external classes
  public findMemberByName(memberName: string): { owner: WorkspaceClassInfo; kind: 'method' | 'property'; item: WorkspaceMethodInfo | WorkspacePropertyInfo } | undefined {
    if (!memberName) return undefined;
    const name = memberName.toLowerCase();
    for (const owner of this.externalClassesByName.values()) {
      const m = owner.methods.find((mm) => mm.name.toLowerCase() === name);
      if (m) return { owner, kind: 'method', item: m };
      const p = owner.properties.find((pp) => pp.name.toLowerCase() === name);
      if (p) return { owner, kind: 'property', item: p };
    }
    for (const owner of this.workspaceClassesByName.values()) {
      const m = owner.methods.find((mm) => mm.name.toLowerCase() === name);
      if (m) return { owner, kind: 'method', item: m };
      const p = owner.properties.find((pp) => pp.name.toLowerCase() === name);
      if (p) return { owner, kind: 'property', item: p };
    }
    return undefined;
  }

  private isModuleAllowed(filePath: string): boolean {
    if (!this.allowedModuleBasePaths || this.allowedModuleBasePaths.size === 0) {
      return true;
    }

    return this.allowedModuleBasePaths.has(normalizeBasePath(filePath));
  }
}

function parseWorkspaceClassDocument(document: vscode.TextDocument): WorkspaceClassInfo | undefined {
  const moduleType = getWorkspaceModuleType(document);
  if (!moduleType) {
    return undefined;
  }

  const className = path.parse(document.uri.fsPath).name;
  const methods: WorkspaceMethodInfo[] = [];
  const properties: WorkspacePropertyInfo[] = [];
  let inExportsBlock = false;
  const exportsSubName = moduleType === 'class' ? 'Class_Globals' : 'Process_Globals';
  let moduleLocation: vscode.Location | undefined;

  const startLine = getPostDesignStartLine(document);
  // If the module `Type=` header exists before the post-design marker, prefer
  // that location for moduleLocation so Intellisense can link to the header.
  for (let i = 0; i < Math.min(document.lineCount, startLine || document.lineCount); i += 1) {
    const line = document.lineAt(i).text.trim();
    if (/^Type\s*=\s*(Class|StaticCode)$/i.test(line)) {
      moduleLocation = createLineLocation(document, i);
      break;
    }
  }
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (!code) {
      continue;
    }

    if (!moduleLocation && /^Type\s*=\s*(Class|StaticCode)$/i.test(code)) {
      moduleLocation = createLineLocation(document, lineNumber);
    }

    if (new RegExp(`^Sub\\s+${exportsSubName}\\b`, 'i').test(code)) {
      inExportsBlock = true;
      continue;
    }

    if (/^End\s+Sub\b/i.test(code)) {
      inExportsBlock = false;
      continue;
    }

    if (inExportsBlock) {
      properties.push(...parseClassGlobalDeclarations(document, lineNumber, code));
      continue;
    }

    const method = parseWorkspaceMethod(document, lineNumber, code);
    if (method) {
      methods.push(method);
    }
  }

  return {
    name: className,
    libraryName: moduleType === 'class' ? 'Workspace Class' : 'Workspace StaticCode',
    doc: `Workspace ${moduleType === 'class' ? 'class' : 'static module'} from ${path.basename(document.uri.fsPath)}`,
    methods,
    properties: dedupeProperties(properties),
    filePath: document.uri.fsPath,
    moduleType,
    location: moduleLocation ?? createLineLocation(document, 0),
  };
}

function getWorkspaceModuleType(document: vscode.TextDocument): WorkspaceClassInfo['moduleType'] | undefined {
  const filePath = document.uri.fsPath.toLowerCase();
  if (!filePath.endsWith('.bas') && !filePath.endsWith('.b4x')) {
    return undefined;
  }

  let isClassModule = false;
  let isStaticModule = false;
  let hasClassGlobals = false;
  let hasProcessGlobals = false;

  const startLine = getPostDesignStartLine(document);
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const code = stripComment(document.lineAt(lineNumber).text).trim();
    if (/^Type\s*=\s*Class$/i.test(code)) {
      isClassModule = true;
    }

    if (/^Type\s*=\s*StaticCode$/i.test(code)) {
      isStaticModule = true;
    }

    if (/^Sub\s+Class_Globals\b/i.test(code)) {
      hasClassGlobals = true;
    }

    if (/^Sub\s+Process_Globals\b/i.test(code)) {
      hasProcessGlobals = true;
    }
  }

  if (isClassModule && hasClassGlobals && !hasProcessGlobals) {
    return 'class';
  }

  if (isStaticModule && hasProcessGlobals && !hasClassGlobals) {
    return 'static';
  }

  return undefined;
}

function parseWorkspaceMethod(
  document: vscode.TextDocument,
  lineNumber: number,
  code: string,
): WorkspaceMethodInfo | undefined {
  const match = /^\s*(?<visibility>Public|Private)?\s*Sub\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((?<parameters>[^)]*)\))?(?:\s+As\s+(?<returnType>[A-Za-z_][A-Za-z0-9_\.\[\]]*))?$/i.exec(code);
  const name = match?.groups?.name;
  const visibility = match?.groups?.visibility?.toLowerCase();
  if (!name || /^Class_Globals$/i.test(name) || visibility !== 'public') {
    return undefined;
  }

  const parameters = parseWorkspaceParameters(match?.groups?.parameters ?? '');
  const rawReturnType = match?.groups?.returnType?.trim() ?? 'void';
  const signature = `${name}(${parameters.map((item) => `${item.name} As ${item.rawType ?? item.type}`).join(', ')})${rawReturnType === 'void' ? '' : ` As ${rawReturnType}`}`;

  return {
    kind: 'method',
    name,
    params: parameters,
    parameters,
    returnType: rawReturnType,
    rawReturnType,
    rawSignature: signature,
    signature,
    location: createNameLocation(document, lineNumber, name),
  };
}

function parseWorkspaceParameters(source: string): B4xParameter[] {
  return parseTypedNameList(source).map((item, index) => {
    const typeName = item.type?.trim() || 'Object';
    return {
      name: item.name || `arg${index + 1}`,
      type: typeName,
      rawType: typeName,
    };
  });
}

function parseClassGlobalDeclarations(
  document: vscode.TextDocument,
  lineNumber: number,
  code: string,
): WorkspacePropertyInfo[] {
  const match = /^\s*(?<visibility>Dim|Private|Public)\s+(.+)$/i.exec(code);
  if (!match?.[2] || match.groups?.visibility?.toLowerCase() !== 'public') {
    return [];
  }

  return parseTypedNameList(match[2]).map((item) => {
    const typeName = item.type?.trim() || 'Object';
    const signature = `${item.name} As ${typeName}`;
    return {
      kind: 'property',
      name: item.name,
      access: 'readwrite',
      type: typeName,
      rawType: typeName,
      rawSignature: signature,
      signature,
      location: createNameLocation(document, lineNumber, item.name),
    };
  });
}

function dedupeProperties(properties: WorkspacePropertyInfo[]): WorkspacePropertyInfo[] {
  const seen = new Set<string>();
  return properties.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createLineLocation(document: vscode.TextDocument, lineNumber: number): vscode.Location {
  const line = document.lineAt(lineNumber);
  return new vscode.Location(document.uri, line.range);
}

function createNameLocation(document: vscode.TextDocument, lineNumber: number, name: string): vscode.Location {
  const line = document.lineAt(lineNumber);
  const start = line.text.toLowerCase().indexOf(name.toLowerCase());
  if (start < 0) {
    return createLineLocation(document, lineNumber);
  }

  const range = new vscode.Range(lineNumber, start, lineNumber, start + name.length);
  return new vscode.Location(document.uri, range);
}

function deleteFromSourceMaps(
  filePath: string,
  fileToClassName: Map<string, string>,
  classesByName: Map<string, WorkspaceClassInfo>,
): void {
  const normalizedFilePath = filePath.toLowerCase();
  const className = fileToClassName.get(normalizedFilePath);
  if (!className) {
    return;
  }

  fileToClassName.delete(normalizedFilePath);
  classesByName.delete(className);
}

function createWorkspaceClassFromParsed(filePath: string, parsed: ParsedModuleBlob, source: 'workspace' | 'external'): WorkspaceClassInfo {
  const uri = vscode.Uri.file(filePath);
  const loc = new vscode.Location(uri, new vscode.Range(0, 0, 0, 0));
  const methods: WorkspaceMethodInfo[] = (parsed.methods || []).map((m: any) => ({
    kind: 'method',
    name: m.name,
    params: m.params || [],
    parameters: m.params || [],
    returnType: m.returnType || m.rawReturnType || 'void',
    rawReturnType: m.returnType || 'void',
    rawSignature: m.signature || `${m.name}()`,
    signature: m.signature || `${m.name}()`,
    doc: m.doc,
    location: loc,
  }));

  const properties: WorkspacePropertyInfo[] = (parsed.properties || []).map((p: any) => ({
    kind: 'property',
    name: p.name,
    access: p.access || 'public',
    type: p.type || p.rawType || 'Object',
    rawType: p.type || p.rawType || 'Object',
    rawSignature: `${p.name} As ${p.type || 'Object'}`,
    signature: `${p.name} As ${p.type || 'Object'}`,
    doc: p.doc,
    location: loc,
  }));

  const info: WorkspaceClassInfo = {
    name: parsed.name,
    libraryName: source === 'workspace' ? 'Workspace Class' : 'External Library',
    doc: parsed.doc || '',
    methods,
    properties: dedupeProperties(properties),
    filePath,
    moduleType: parsed.moduleKind === 'class' ? 'class' : 'static',
    location: loc,
  };

  return info;
}
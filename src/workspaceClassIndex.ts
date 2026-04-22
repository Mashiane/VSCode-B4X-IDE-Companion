import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';

import { parseTypedNameList, stripComment, getPostDesignStartLine } from './b4xDocParser';
import { normalizeBasePath } from './projectFile';
import { B4xClass, B4xEventDef, B4xFieldDef, B4xManifest, B4xMethod, B4xParameter, B4xProperty, B4xPropertyAccess } from './types';
import { libraryIndex, ParsedModuleBlob } from './storage/libraryIndexSqlite';

export interface WorkspaceMethodInfo extends B4xMethod {
  location: vscode.Location;
}

export interface WorkspacePropertyInfo extends B4xProperty {
  location: vscode.Location;
}

export interface WorkspaceClassInfo extends B4xClass {
  filePath: string;
  moduleType: 'class' | 'static' | 'service';
  location: vscode.Location;
  methods: WorkspaceMethodInfo[];
  properties: WorkspacePropertyInfo[];
  events: B4xEventDef[];
  fields: B4xFieldDef[];
}

export class WorkspaceClassStore {
  private readonly workspaceClassesByName = new Map<string, WorkspaceClassInfo>();
  private readonly referenceClassesByName = new Map<string, WorkspaceClassInfo>();
  private readonly workspaceFileToClassName = new Map<string, string>();
  private readonly referenceFileToClassName = new Map<string, string>();
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

  /** Returns all indexed source file paths (workspace modules + external/reference modules). */
  public get loadedFilePaths(): readonly string[] {
    const all = new Set<string>([
      ...this.workspaceFileToClassName.keys(),
      ...this.referenceFileToClassName.keys(),
    ]);
    return Array.from(all);
  }

  public async refresh(
    allowedModuleBasePaths: ReadonlySet<string> | undefined = this.allowedModuleBasePaths,
    // If provided, `preconfirmedFiles` is the list of verified module file paths
    // discovered by the caller (e.g. from the .b4a project). When present the
    // refresh should use these paths directly instead of probing candidate
    // base paths again. This eliminates duplicate filesystem checks.
    preconfirmedFiles?: string[],
  ): Promise<void> {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.refresh.enter`);
    console.log(`[B4X DEBUG] refresh called with allowedModuleBasePaths:`, allowedModuleBasePaths ? Array.from(allowedModuleBasePaths) : 'undefined');
    console.log(`[B4X DEBUG] refresh preconfirmedFiles:`, preconfirmedFiles);
    console.log(`[B4X DEBUG] refresh stack trace:`, new Error().stack);

    // Defensive: callers sometimes pass `undefined` here (see logs). Coerce to
    // an empty array so downstream logic can assume an array type.
    if (!Array.isArray(preconfirmedFiles)) {
      console.log(`[B4X DEBUG] preconfirmedFiles was ${typeof preconfirmedFiles}; coercing to []`);
      preconfirmedFiles = [];
    }
    this.setAllowedModuleBasePaths(allowedModuleBasePaths);
    this.workspaceClassesByName.clear();
    this.workspaceFileToClassName.clear();

    // Only load modules that are explicitly listed in .b4a via ModuleN entries.
    // If the caller supplied `preconfirmedFiles` use those (they were produced
    // by a targeted discovery routine) — this avoids re-checking candidates.
    const uniquePaths = new Set<string>();
    if (preconfirmedFiles.length > 0) {
      console.log(`[B4X DEBUG] using preconfirmedFiles:`, preconfirmedFiles);
      for (const p of preconfirmedFiles) uniquePaths.add(p);
    } else {
      if (!this.allowedModuleBasePaths || this.allowedModuleBasePaths.size === 0) {
        console.log(`[B4X DEBUG] early return - no allowedModuleBasePaths`);
        return;
      }

      console.log(`[B4X DEBUG] probing allowedModuleBasePaths:`, Array.from(this.allowedModuleBasePaths));
      for (const base of this.allowedModuleBasePaths) {
        try {
          const candBas = path.resolve(`${base}.bas`);
          console.log(`[B4X DEBUG] checking candidate: ${candBas}`);
          const statBas = await fs.stat(candBas).catch(() => undefined);
          if (statBas && statBas.isFile()) {
            console.log(`[B4X DEBUG] found: ${candBas}`);
            uniquePaths.add(candBas);
          } else {
            console.log(`[B4X DEBUG] not found: ${candBas}`);
          }
        } catch {
          // ignore missing candidates
        }
      }
    }

    await Promise.all(Array.from(uniquePaths).map(async (filePath) => {
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

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const parsedDoc = parseWorkspaceClassDocument(document);
        if (parsedDoc) {
          this.upsertDocumentFromParsed(document, parsedDoc, 'workspace');
          try {
            const methods = parsedDoc.methods.map((m) => ({ name: m.name, params: m.params, returnType: m.returnType, signature: m.signature, doc: m.doc }));
            const properties = parsedDoc.properties.map((p) => ({ name: p.name, type: p.type, access: p.access, doc: p.doc }));
            const blob: ParsedModuleBlob = { moduleKind: parsedDoc.moduleType, name: parsedDoc.name, methods, properties, doc: parsedDoc.doc, version: parsedDoc.version, events: parsedDoc.events };
            const st = await fs.stat(filePath).catch(() => undefined);
            if (st) libraryIndex.upsertParsedForPath(filePath, Math.floor(st.mtimeMs), st.size, blob);
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.warn('B4X: WorkspaceClassStore.refresh failed for', filePath, e);
      }
    }));

  }

  public async discoverWorkspaceModuleFiles(
    allowedModuleBasePaths: ReadonlySet<string> | undefined = this.allowedModuleBasePaths,
    projectDirectory?: string,
    sharedModuleFolders: readonly string[] = [],
  ): Promise<string[]> {
    // Only return module files explicitly declared in the .b4a project file.
    // Avoid scanning the entire workspace or shared folders.
    if (!allowedModuleBasePaths || allowedModuleBasePaths.size === 0) {
      return [];
    }

    const result = new Set<string>();

    for (const base of allowedModuleBasePaths) {
      const candidates: string[] = [];

      // If the base is already an absolute path, test it as-is.
      if (path.isAbsolute(base)) {
        candidates.push(base);
      } else {
        if (projectDirectory) {
          candidates.push(path.resolve(projectDirectory, base));
        }
        for (const shared of sharedModuleFolders) {
          candidates.push(path.resolve(shared, base));
        }
      }

      for (const cand of candidates) {
        const tryPaths = [`${cand}.bas`, cand];
        for (const p of tryPaths) {
          try {
            const stat = await fs.stat(p).catch(() => undefined);
            if (stat && stat.isFile()) {
              result.add(p);
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return Array.from(result);
  }

  public async replaceReferenceModules(referenceFilePaths: string[]): Promise<void> {
    const normalized = Array.from(new Set(referenceFilePaths.map((p) => path.resolve(p))));

    this.referenceClassesByName.clear();
    this.referenceFileToClassName.clear();

    await Promise.all(normalized.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath).catch(() => undefined);
        if (!stat?.isFile()) {
          return;
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        this.upsertDocument(document, 'external');
      } catch (err) {
        console.warn('B4X: replaceReferenceModules failed for', filePath, err);
      }
    }));
  }

  public clear(): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.clear`);
    this.workspaceClassesByName.clear();
    this.referenceClassesByName.clear();
    this.workspaceFileToClassName.clear();
    this.referenceFileToClassName.clear();
    this.allowedModuleBasePaths = undefined;
  }

  public upsertDocument(document: vscode.TextDocument, source: 'workspace' | 'external' = 'workspace', manifest?: B4xManifest): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.upsertDocument.enter -> ${document.uri.fsPath} (${source})`);
    const fileToClassName = source === 'workspace' ? this.workspaceFileToClassName : this.referenceFileToClassName;
    const classesByName = source === 'workspace' ? this.workspaceClassesByName : this.referenceClassesByName;
    const previousClassName = fileToClassName.get(document.uri.fsPath.toLowerCase());
    if (previousClassName) {
      classesByName.delete(previousClassName);
      fileToClassName.delete(document.uri.fsPath.toLowerCase());
    }

    // Accept workspace modules unconditionally here; project-scope is
    // enforced by `refresh()` which uses `allowedModuleBasePaths`.

    const parsed = parseWorkspaceClassDocument(document, manifest);
    if (!parsed) {
      return;
    }

    const key = parsed.name.toLowerCase();
    classesByName.set(key, parsed);
    fileToClassName.set(document.uri.fsPath.toLowerCase(), key);
  }

  /** Insert a pre-parsed document into the store (avoids double-parsing). */
  public upsertDocumentFromParsed(document: vscode.TextDocument, parsed: WorkspaceClassInfo, source: 'workspace' | 'external' = 'workspace'): void {
    const fileToClassName = source === 'workspace' ? this.workspaceFileToClassName : this.referenceFileToClassName;
    const classesByName = source === 'workspace' ? this.workspaceClassesByName : this.referenceClassesByName;
    const previousClassName = fileToClassName.get(document.uri.fsPath.toLowerCase());
    if (previousClassName) {
      classesByName.delete(previousClassName);
      fileToClassName.delete(document.uri.fsPath.toLowerCase());
    }
    const key = parsed.name.toLowerCase();
    classesByName.set(key, parsed);
    fileToClassName.set(document.uri.fsPath.toLowerCase(), key);
  }

  public delete(uri: vscode.Uri): void {
    console.log(`[B4X TRACE ${new Date().toISOString()}] WorkspaceClassStore.delete -> ${uri.fsPath}`);
    deleteFromSourceMaps(uri.fsPath, this.workspaceFileToClassName, this.workspaceClassesByName);
    deleteFromSourceMaps(uri.fsPath, this.referenceFileToClassName, this.referenceClassesByName);
  }

  public getDefinitionByName(name: string | undefined): WorkspaceClassInfo | undefined {
    if (!name) {
      return undefined;
    }

    const key = name.trim().toLowerCase();
    return this.workspaceClassesByName.get(key) ?? this.referenceClassesByName.get(key);
  }

  public getClassByName(name: string | undefined): WorkspaceClassInfo | undefined {
    const definition = this.getDefinitionByName(name);
    return definition?.moduleType === 'class' ? definition : undefined;
  }

  public findClassesByPrefix(prefix: string): WorkspaceClassInfo[] {
    const normalizedPrefix = prefix.toLowerCase();
    const merged = new Map<string, WorkspaceClassInfo>();

    for (const item of this.referenceClassesByName.values()) {
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

  /** Get all loaded classes from workspace and references. */
  public getAllClasses(): WorkspaceClassInfo[] {
    const merged = new Map<string, WorkspaceClassInfo>();
    for (const item of this.referenceClassesByName.values()) {
      merged.set(item.name.toLowerCase(), item);
    }
    for (const item of this.workspaceClassesByName.values()) {
      merged.set(item.name.toLowerCase(), item);
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

  /** Get all events for a class by name. */
  public getEvents(name: string | undefined): B4xEventDef[] {
    const owner = this.getDefinitionByName(name);
    return owner?.events ?? [];
  }

  /** Get all fields for a class by name. */
  public getFields(name: string | undefined): B4xFieldDef[] {
    const owner = this.getDefinitionByName(name);
    return owner?.fields ?? [];
  }

  public getMember(
    ownerType: string | undefined,
    memberName: string,
  ): { kind: 'method'; item: WorkspaceMethodInfo } | { kind: 'property'; item: WorkspacePropertyInfo } | undefined {
    const owner = this.getDefinitionByName(ownerType);
    if (!owner) {
      return undefined;
    }

    const method = owner.methods.find((item) => item.isPublic !== false && item.name.toLowerCase() === memberName.toLowerCase());
    if (method) {
      return { kind: 'method', item: method };
    }

    const property = owner.properties.find((item) => item.isPublic !== false && item.name.toLowerCase() === memberName.toLowerCase());
    if (property) {
      return { kind: 'property', item: property };
    }

    return undefined;
  }

  // Find a member by name across workspace and external classes
  public findMemberByName(memberName: string): { owner: WorkspaceClassInfo; kind: 'method' | 'property'; item: WorkspaceMethodInfo | WorkspacePropertyInfo } | undefined {
    if (!memberName) return undefined;
    const name = memberName.toLowerCase();
    for (const owner of this.referenceClassesByName.values()) {
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

  // `isModuleAllowed` removed — per-file gating is handled by project config
  // and the workspace refresh flow. Keeping this method caused redundant
  // and inconsistent checks between `refresh()` and `upsertDocument()`.
}

export function parseWorkspaceClassDocument(document: vscode.TextDocument, manifest?: B4xManifest): WorkspaceClassInfo | undefined {
  const moduleType = getWorkspaceModuleType(document);
  if (!moduleType) {
    return undefined;
  }

  const className = path.parse(document.uri.fsPath).name;
  const methods: WorkspaceMethodInfo[] = [];
  const properties: WorkspacePropertyInfo[] = [];
  const events: B4xEventDef[] = [];
  const headerTypes = new Map<string, B4xFieldDef[]>();
  let inExportsBlock = false;
  const exportsSubName = moduleType === 'class' ? 'Class_Globals' : 'Process_Globals';
  let moduleLocation: vscode.Location | undefined;

  // Accumulate leading comment lines before the first non-comment, non-blank line
  // as class-level documentation (matches b4xlib_to_xml.py behavior).
  const leadingComments: string[] = [];
  let seenContent = false;

  const startLine = getPostDesignStartLine(document);

  // Scan header for module type and Type declarations inside Class_Globals/Process_Globals
  for (let i = 0; i < Math.min(document.lineCount, startLine || document.lineCount); i += 1) {
    const line = document.lineAt(i).text.trim();
    if (/^Type\s*=\s*(Class|StaticCode)$/i.test(line)) {
      moduleLocation = createLineLocation(document, i);
    }
    // NOTE: Type declarations (Type X(...) ) must appear inside Class_Globals/Process_Globals,
    // not in the module header. Header-only Type= directives are module type markers, not Type definitions.
  }
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const rawLine = document.lineAt(lineNumber).text;
    const code = stripComment(rawLine).trim();

    // Track leading comments for class doc
    if (!seenContent) {
      const trimmed = rawLine.trim();
      const commentMatch = /^\s*'(.*)$/.exec(trimmed);
      if (commentMatch && commentMatch[1] && !/^#+$/.test(commentMatch[1].trim())) {
        leadingComments.push(commentMatch[1].trim());
        continue;
      }
      if (trimmed === '' || /^Type\s*=/i.test(trimmed) || /^@/i.test(trimmed) || /^#/i.test(trimmed)) {
        // Skip blank lines, Type= directives, attributes, and compiler directives
        if (trimmed !== '' && !/^Type\s*=/i.test(trimmed) && !/^@/i.test(trimmed)) {
          seenContent = true;
        }
      } else {
        seenContent = true;
      }
    }

    if (!code) {
      continue;
    }

    if (!moduleLocation && /^Type\s*=\s*(Class|StaticCode)$/i.test(code)) {
      moduleLocation = createLineLocation(document, lineNumber);
    }

    // Parse #Event: directives with parameter types
    // Format: #Event: EventName (Param1 As Type1, Param2 As Type2)
    const eventMatch = /^\s*#Event:\s*(.+)$/i.exec(rawLine);
    if (eventMatch && eventMatch[1]) {
      const raw = eventMatch[1].trim();
      const parenIdx = raw.indexOf('(');
      let eventName: string;
      let params: string[] = [];
      if (parenIdx >= 0) {
        eventName = raw.substring(0, parenIdx).trim();
        const closingParen = raw.lastIndexOf(')');
        if (closingParen > parenIdx) {
          const paramsStr = raw.substring(parenIdx + 1, closingParen).trim();
          params = paramsStr ? paramsStr.split(',').map(p => p.trim()).filter(Boolean) : [];
        }
      } else {
        const asIdx = raw.search(/\s+As\s+/i);
        eventName = asIdx >= 0 ? raw.substring(0, asIdx).trim() : raw;
      }
      events.push({ name: eventName, params, rawEvent: raw });
      continue;
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
      // Parse Type declarations ONLY inside Class_Globals/Process_Globals
      const typeMatch = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(code);
      if (typeMatch && typeMatch[1]) {
        const typeName = typeMatch[1];
        if (!headerTypes.has(typeName)) {
          const fieldsStr = (typeMatch[2] ?? '').trim();
          const fields = fieldsStr
            ? fieldsStr.split(',').map(f => f.trim()).filter(Boolean).map(f => {
                const parts = f.split(/\s+As\s+/i);
                return { name: (parts[0] ?? '').trim(), type: (parts[1] ?? 'Object').trim(), rawType: (parts[1] ?? 'Object').trim() };
              })
            : [];
          headerTypes.set(typeName, fields);
        }
      }

      properties.push(...parseClassGlobalDeclarations(document, lineNumber, code));
      continue;
    }

    const method = parseWorkspaceMethod(document, lineNumber, code);
    if (method) {
      methods.push(method);
    }
  }

  // Properly merge getter/setter pairs with combined parameters
  // (matches b4xlib_to_xml.py and b4xlib2XML B4J behavior)
  const mergedProperties = mergePropertiesWithAccessors(methods, properties);

  // Build class doc from accumulated leading comments
  let classDoc: string | undefined;
  if (leadingComments.length > 0) {
    classDoc = leadingComments.join(' ').replace(/\s+/g, ' ').trim();
  }
  if (!classDoc) {
    classDoc = manifest?.version
      ? `Library module from ${path.basename(document.uri.fsPath)} (v${manifest.version})`
      : `Workspace ${moduleType === 'class' ? 'class' : 'static module'} from ${path.basename(document.uri.fsPath)}`;
  }

  return {
    name: className,
    libraryName: moduleType === 'class' ? 'Workspace Class' : moduleType === 'service' ? 'Workspace Service' : 'Workspace StaticCode',
    doc: classDoc,
    description: classDoc,
    methods,
    properties: dedupeProperties(mergedProperties),
    events: events.length > 0 ? events : [],
    fields: headerTypes.size > 0
      ? Array.from(headerTypes.entries()).map(([typeName, flds]) => ({
          name: typeName,
          type: typeName,
          rawType: typeName,
          doc: `Type: ${typeName}(${flds.map(f => `${f.name} As ${f.type}`).join(', ')})`,
          description: `Type: ${typeName}(${flds.map(f => `${f.name} As ${f.type}`).join(', ')})`,
        }))
      : [],
    version: manifest?.version,
    manifest: manifest && Object.keys(manifest).length > 0 ? manifest : undefined,
    filePath: document.uri.fsPath,
    moduleType,
    location: moduleLocation ?? createLineLocation(document, 0),
  };
}

function getWorkspaceModuleType(document: vscode.TextDocument): WorkspaceClassInfo['moduleType'] | undefined {
  const filePath = document.uri.fsPath.toLowerCase();
  if (!filePath.endsWith('.bas')) {
    return undefined;
  }

  let isClassModule = false;
  let isStaticModule = false;
  let isServiceModule = false;
  let hasClassGlobals = false;
  let hasProcessGlobals = false;
  let hasServiceCreate = false;
  let hasServiceStart = false;

  const startLine = getPostDesignStartLine(document);

  // Scan the header section before @EndOfDesignText@ for Type= declarations,
  // since real .b4a modules place `Type=Class` / `Type=StaticCode` there.
  for (let i = 0; i < startLine; i += 1) {
    const headerLine = document.lineAt(i).text.trim();
    if (/^Type\s*=\s*Class$/i.test(headerLine)) {
      isClassModule = true;
    }
    if (/^Type\s*=\s*StaticCode$/i.test(headerLine)) {
      isStaticModule = true;
    }
    // Detect service modules via #StartAtBoot directive
    if (/^#StartAtBoot:/i.test(headerLine)) {
      isServiceModule = true;
    }
  }

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

    // Service modules have Service_Create and Service_Start subs
    if (/^Sub\s+Service_Create\b/i.test(code)) {
      hasServiceCreate = true;
    }
    if (/^Sub\s+Service_Start\b/i.test(code)) {
      hasServiceStart = true;
    }
  }

  // If we found service lifecycle subs but no explicit Type= header, mark as service
  if (hasServiceCreate && hasServiceStart && !isClassModule && !isStaticModule) {
    isServiceModule = true;
  }

  if (isClassModule && hasClassGlobals && !hasProcessGlobals) {
    return 'class';
  }

  if (isStaticModule && hasProcessGlobals && !hasClassGlobals) {
    return 'static';
  }

  if (isServiceModule) {
    return 'service';
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
  if (!name || /^Class_Globals$/i.test(name)) {
    return undefined;
  }

  // Skip private methods entirely — they should not be stored or indexed.
  if (visibility === 'private') {
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
    isPublic: true,
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
  if (!match?.[2]) {
    return [];
  }

  const visibility = (match.groups?.visibility ?? 'Dim').toLowerCase();
  // Skip private declarations entirely — they should not be stored or indexed.
  if (visibility === 'private') {
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
      isPublic: true,
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

/**
 * Merge getter/setter pairs into single properties with combined parameters.
 * Matches the b4xlib_to_xml.py and b4xlib2XML B4J behavior:
 * - `getValue() As String` + `setValue(Value As String)` → single property
 *   with type=String and setter parameter included
 * - Read-only properties from getter alone
 * - Read-write from both getter+setter
 * - Write-only from setter alone (rare)
 * - Existing class-global properties take priority over accessor inference
 */
function mergePropertiesWithAccessors(
  methods: WorkspaceMethodInfo[],
  existingProperties: WorkspacePropertyInfo[],
): WorkspacePropertyInfo[] {
  // Start with a copy of existing properties (class globals are highest priority)
  const resultMap = new Map<string, WorkspacePropertyInfo>();
  for (const prop of existingProperties) {
    resultMap.set(prop.name.toLowerCase(), { ...prop });
  }

  // Collect public accessor methods
  const getters = new Map<string, WorkspaceMethodInfo>();
  const setters = new Map<string, WorkspaceMethodInfo>();
  const booleanGetters = new Map<string, WorkspaceMethodInfo>(); // isX → property

  for (const method of methods) {
    if (!method.isPublic) continue;
    const name = method.name;
    const lower = name.toLowerCase();

    if (lower.startsWith('get') && name.length > 3) {
      const propName = name.slice(3);
      if (propName && method.parameters.length === 0) {
        getters.set(propName.toLowerCase(), method);
      }
    } else if (lower.startsWith('set') && name.length > 3) {
      const propName = name.slice(3);
      if (propName && method.parameters.length >= 1) {
        setters.set(propName.toLowerCase(), method);
      }
    } else if (lower.startsWith('is') && name.length > 2) {
      const propName = name.slice(2);
      if (propName && method.parameters.length === 0) {
        booleanGetters.set(propName.toLowerCase(), method);
      }
    }
  }

  // Merge getter+setter pairs
  const allPropNames = new Set([
    ...getters.keys(),
    ...setters.keys(),
    ...booleanGetters.keys(),
  ]);

  for (const lowerKey of allPropNames) {
    // Skip if already defined as explicit property
    if (resultMap.has(lowerKey)) continue;

    const getter = getters.get(lowerKey);
    const setter = setters.get(lowerKey);
    const boolGetter = booleanGetters.get(lowerKey);

    // Determine access
    const hasGetter = !!getter || !!boolGetter;
    const hasSetter = !!setter;
    const access: B4xPropertyAccess = hasGetter && hasSetter ? 'readwrite'
      : hasGetter ? 'readonly' : 'writeonly';

    // Determine type from getter return type or setter parameter type
    const primaryMethod = getter ?? boolGetter ?? setter!;
    const propType = getter
      ? (getter.returnType ?? getter.rawReturnType ?? 'Object')
      : boolGetter
        ? (boolGetter.returnType ?? boolGetter.rawReturnType ?? 'Boolean')
        : (setter?.parameters[0]?.rawType ?? setter?.parameters[0]?.type ?? 'Object');

    // Derive property name from the original method name (preserves case).
    // getUserName → UserName, isReady → Ready, setValue → Value
    const sourceMethod = getter ?? boolGetter ?? setter!;
    const sourceName = sourceMethod.name;
    let propName = sourceName;
    if (/^get/i.test(sourceName) && sourceName.length > 3) {
      propName = sourceName.slice(3);
    } else if (/^is/i.test(sourceName) && sourceName.length > 2) {
      propName = sourceName.slice(2);
    } else if (/^set/i.test(sourceName) && sourceName.length > 3) {
      propName = sourceName.slice(3);
    }

    // Build signature: "PropertyName As Type"
    const sig = `${propName} As ${propType}`;

    // Build merged property info
    const prop: WorkspacePropertyInfo = {
      kind: 'property',
      name: propName,
      access,
      type: propType,
      rawType: propType,
      rawSignature: sig,
      signature: sig,
      doc: getter?.doc ?? boolGetter?.doc ?? setter?.doc,
      isPublic: true,
      location: primaryMethod.location,
    };

    resultMap.set(lowerKey, prop);
  }

  return [...resultMap.values()];
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
    isPublic: m.isPublic !== undefined ? m.isPublic : true,
    location: loc,
  }));

  const properties: WorkspacePropertyInfo[] = (parsed.properties || []).map((p: any) => ({
    kind: 'property',
    name: p.name,
    access: (['readwrite', 'readonly', 'writeonly'] as const).includes(p.access) ? p.access : 'readwrite',
    type: p.type || p.rawType || 'Object',
    rawType: p.type || p.rawType || 'Object',
    rawSignature: `${p.name} As ${p.type || 'Object'}`,
    signature: `${p.name} As ${p.type || 'Object'}`,
    doc: p.doc,
    isPublic: p.isPublic !== undefined ? p.isPublic : true,
    location: loc,
  }));

  const events: B4xEventDef[] = (parsed.events || []).map((e: any) => ({
    name: e.name,
    params: e.params || [],
    rawEvent: e.rawEvent,
    doc: e.doc,
  }));

  const fields: B4xFieldDef[] = (parsed.fields || []).map((f: any) => ({
    name: f.name,
    type: f.type || f.rawType,
    rawType: f.rawType || f.type,
    doc: f.doc,
    description: f.doc,
  }));

  const info: WorkspaceClassInfo = {
    name: parsed.name,
    libraryName: source === 'workspace' ? 'Workspace Class' : 'External Library',
    doc: parsed.doc || '',
    description: parsed.doc || '',
    methods,
    properties: dedupeProperties(properties),
    events,
    fields,
    version: parsed.version,
    filePath,
    moduleType: parsed.moduleKind === 'class' ? 'class' : parsed.moduleKind === 'service' ? 'service' : 'static',
    location: loc,
  };

  return info;
}
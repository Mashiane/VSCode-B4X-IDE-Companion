export type B4xPropertyAccess = 'readwrite' | 'readonly' | 'writeonly';

export interface ParamDef {
  name: string;
  type: string;
  rawType?: string;
}

export interface MethodDef {
  kind: 'method';
  name: string;
  /** Parameter list. Use `params` — `parameters` is a deprecated alias kept for
   *  compatibility with older serialised blobs and will be removed in a future release. */
  params: ParamDef[];
  /** @deprecated Use `params` instead. */
  parameters: ParamDef[];
  returnType: string;
  rawReturnType?: string;
  rawSignature: string;
  signature: string;
  doc?: string;
  description?: string;
  isPublic: boolean;
}

export interface PropertyDef {
  kind: 'property';
  name: string;
  access: B4xPropertyAccess;
  type?: string;
  rawType?: string;
  rawSignature: string;
  signature: string;
  doc?: string;
  description?: string;
  isPublic: boolean;
}

/** Key/value pairs extracted from a .b4xlib's manifest.txt (version, author, etc.). */
export interface B4xManifest {
  version?: string;
  author?: string;
  [key: string]: string | undefined;
}

/** An event declared by a class (e.g. Button.Click, Spinner.ItemClick). */
export interface B4xEventDef {
  name: string;
  /** Parameter signatures — e.g. ['Position As Int', 'Value As Object'] */
  params: string[];
  /** Raw event string from XML — e.g. 'Click(Position As Int, Value As Object)' */
  rawEvent?: string;
  doc?: string;
}

/** A field declared in a class (constant or variable — not a getter/setter property). */
export interface B4xFieldDef {
  name: string;
  type?: string;
  rawType?: string;
  value?: string;
  doc?: string;
  description?: string;
}

export interface ClassDef {
  name: string;
  libraryName: string;
  doc?: string;
  description?: string;
  methods: MethodDef[];
  properties: PropertyDef[];
  /** Event definitions for the class. */
  events?: B4xEventDef[];
  /** Fields declared in the class (Type definitions, constants). */
  fields?: B4xFieldDef[];
  /** Library version (e.g. "1.75" for B4XPreferencesDialog, "13.4" for Core). */
  version?: string;
  /** Metadata from the library's manifest.txt file (version, author, etc.). */
  manifest?: B4xManifest;
}

export interface LibraryDef {
  name: string;
  version: string;
  classNames: string[];
  doc?: string;
  description?: string;
}

export type B4xLibrary = LibraryDef;
export type B4xClass = ClassDef;
export type B4xMethod = MethodDef;
export type B4xProperty = PropertyDef;
export type B4xParameter = ParamDef;

export interface B4xApiIndex {
  version: number;
  sourceFile: string;
  generatedAt: string;
  libraries: LibraryDef[];
  classes: ClassDef[];
  classesByName: Record<string, ClassDef>;
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

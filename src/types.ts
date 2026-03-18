export type B4xPropertyAccess = 'readwrite' | 'readonly' | 'writeonly';

export interface ParamDef {
  name: string;
  type: string;
  rawType?: string;
}

export interface MethodDef {
  kind: 'method';
  name: string;
  params: ParamDef[];
  parameters: ParamDef[];
  returnType: string;
  rawReturnType?: string;
  rawSignature: string;
  signature: string;
  doc?: string;
  description?: string;
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
}

export interface ClassDef {
  name: string;
  libraryName: string;
  doc?: string;
  description?: string;
  methods: MethodDef[];
  properties: PropertyDef[];
}

export interface LibraryDef {
  name: string;
  version: string;
  classNames: string[];
  doc?: string;
  description?: string;
}

export interface B4XApiIndex {
  version: number;
  sourceFile: string;
  generatedAt: string;
  libraries: LibraryDef[];
  classes: ClassDef[];
  classesByName: Record<string, ClassDef>;
}

export interface BuildSummary {
  libraries: number;
  classes: number;
  methods: number;
  properties: number;
}

export type B4xApiIndex = B4XApiIndex;
export type B4xLibrary = LibraryDef;
export type B4xClass = ClassDef;
export type B4xMethod = MethodDef;
export type B4xProperty = PropertyDef;
export type B4xParameter = ParamDef;

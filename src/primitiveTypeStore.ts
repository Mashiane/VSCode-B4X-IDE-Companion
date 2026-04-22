import { XmlLibraryStore } from './xmlLibraryIndex';
import { B4xClass, B4xMethod, B4xProperty, B4xFieldDef, B4xEventDef } from './types';

/**
 * Synthetic class definitions for primitive types that don't have explicit XML class entries.
 * These provide type information for hover, completion, and type checking.
 */
export interface PrimitiveClassDef {
  name: string;
  doc?: string;
  methods: B4xMethod[];
  properties: B4xProperty[];
  fields: B4xFieldDef[];
  events: B4xEventDef[];
  libraryName: string;
  version?: string;
}

/** Correct display names for primitive types that need special casing. */
const PRIMITIVE_DISPLAY_NAMES: Record<string, string> = {
  'stringbuilder': 'StringBuilder', // title-casing would produce "Stringbuilder"
};

/**
 * Store for primitive type class information.
 * Provides synthetic class definitions for B4A primitive types.
 */
export class PrimitiveTypeStore {
  private readonly primitiveClasses = new Map<string, PrimitiveClassDef>();
  private readonly typeMapping = new Map<string, string>();

  constructor() {
    this.initializePrimitiveTypes();
  }

  private initializePrimitiveTypes(): void {
    // String type - maps to String class (normalized from String2)
    this.typeMapping.set('string', 'String');

    // StringBuilder type - maps to StringBuilder class from XML
    this.typeMapping.set('stringbuilder', 'StringBuilder');

    // Int type - no methods, just a type marker
    this.primitiveClasses.set('B4AInt', {
      name: 'Int',
      libraryName: 'Core',
      doc: 'Represents a 32-bit signed integer value. Int is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Float type
    this.primitiveClasses.set('B4AFloat', {
      name: 'Float',
      libraryName: 'Core',
      doc: 'Represents a single-precision floating-point number. Float is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Double type
    this.primitiveClasses.set('B4ADouble', {
      name: 'Double',
      libraryName: 'Core',
      doc: 'Represents a double-precision floating-point number. Double is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Long type
    this.primitiveClasses.set('B4ALong', {
      name: 'Long',
      libraryName: 'Core',
      doc: 'Represents a 64-bit signed integer value. Long is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Byte type
    this.primitiveClasses.set('B4AByte', {
      name: 'Byte',
      libraryName: 'Core',
      doc: 'Represents an 8-bit signed integer value. Byte is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Short type
    this.primitiveClasses.set('B4AShort', {
      name: 'Short',
      libraryName: 'Core',
      doc: 'Represents a 16-bit signed integer value. Short is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Boolean type
    this.primitiveClasses.set('B4ABoolean', {
      name: 'Boolean',
      libraryName: 'Core',
      doc: 'Represents a boolean value (True/False). Boolean is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Char type
    this.primitiveClasses.set('B4AChar', {
      name: 'Char',
      libraryName: 'Core',
      doc: 'Represents a single Unicode code unit. Char is a primitive type and does not have methods.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });

    // Object type
    this.primitiveClasses.set('B4AObject', {
      name: 'Object',
      libraryName: 'Core',
      doc: 'The base type for all objects in B4A. Object is a generic type that can hold any reference type.',
      methods: [],
      properties: [],
      fields: [],
      events: [],
    });
  }

  /**
   * Sync the store with XML libraries — validates that mapped types still
   * exist in the loaded XML and removes stale mappings if they disappear.
   */
  public syncFrom(xmlLibraries: XmlLibraryStore): void {
    // If the XML no longer provides String, remove the mapping so callers
    // don't resolve "string" to a non-existent class.
    if (!xmlLibraries.getClassByName('String')) {
      this.typeMapping.delete('string');
    }
    if (!xmlLibraries.getClassByName('StringBuilder')) {
      this.typeMapping.delete('stringbuilder');
    }
  }

  /**
   * Resolve a primitive type name to its canonical class name.
   * Returns the mapped class name if it's a primitive type, otherwise undefined.
   */
  public resolvePrimitiveType(typeName: string): string | undefined {
    const normalized = typeName.toLowerCase().trim();
    return this.typeMapping.get(normalized);
  }

  /**
   * Get a synthetic class info for a primitive type.
   * Returns undefined for types that have XML class definitions (use XmlLibraryStore instead).
   */
  public getPrimitiveClassInfo(typeName: string): PrimitiveClassDef | undefined {
    const normalized = typeName.toLowerCase().trim();
    const mappedName = this.typeMapping.get(normalized);

    // If it maps to a real XML class, return undefined (let XmlLibraryStore handle it)
    if (mappedName) {
      return undefined;
    }

    // Otherwise, return the synthetic primitive class definition
    return this.primitiveClasses.get(`B4A${typeName.charAt(0).toUpperCase()}${typeName.slice(1).toLowerCase()}`);
  }

  /**
   * Check if a type name is a primitive type.
   */
  public isPrimitiveType(typeName: string): boolean {
    const normalized = typeName.toLowerCase().trim();
    return this.typeMapping.has(normalized) || this.primitiveClasses.has(`B4A${typeName.charAt(0).toUpperCase()}${typeName.slice(1).toLowerCase()}`);
  }

  /**
   * Get all primitive type names with correct display casing.
   */
  public getPrimitiveTypeNames(): string[] {
    const mappedTypes = [...this.typeMapping.keys()];
    const syntheticTypes = [...this.primitiveClasses.values()].map(c => c.name.toLowerCase());
    return [...new Set([...mappedTypes, ...syntheticTypes])];
  }

  /**
   * Get the correct display name for a primitive type key (lowercase).
   * e.g. "stringbuilder" → "StringBuilder" (not "Stringbuilder").
   */
  public getPrimitiveDisplayName(key: string): string {
    const normalized = key.toLowerCase();
    return PRIMITIVE_DISPLAY_NAMES[normalized] ?? (key.charAt(0).toUpperCase() + key.slice(1));
  }
}

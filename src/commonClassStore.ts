import { XmlLibraryStore, formatDocToMarkdown } from './xmlLibraryIndex';

/** Lightweight representation of the Common class methods/fields for bare-word completion. */
export interface CommonMemberInfo {
  name: string;
  kind: 'method' | 'property';
  signature: string;
  returnType?: string;
  params?: { name: string; type: string }[];
  doc?: string;
}

/**
 * Tracks the B4X `Common` class (from Core.xml, line 12646) and exposes its methods/fields
 * as bare-word global completions. In B4X these are called without the `Common.`
 * prefix — e.g. `Log("hello")` instead of `Common.Log("hello")`.
 *
 * Note: The Common class has NO <shortname> tag in the XML. The name "Common"
 * is derived programmatically by deriveShortName() in xmlLibraryIndex.ts.
 */
export class CommonClassStore {
  private commonClass: any | undefined;
  private members: CommonMemberInfo[] = [];

  /** Sync the store whenever XmlLibraryStore is reloaded. */
  public syncFrom(xmlLibraries: XmlLibraryStore): void {
    this.commonClass = xmlLibraries.getClassByName('common');
    this.members = [];

    if (!this.commonClass) {
      console.warn('B4X: Common class not found in XML libraries — bare-word completions (Log, Msgbox, CRLF, etc.) will be unavailable.');
      return;
    }

    // Methods → bare-word completions
    for (const method of this.commonClass.methods) {
      this.members.push({
        name: method.name,
        kind: 'method',
        signature: method.signature ?? method.rawSignature ?? `${method.name}()`,
        returnType: method.returnType ?? method.rawReturnType,
        params: method.params ?? method.parameters,
        doc: formatDocToMarkdown(method.doc ?? method.description),
      });
    }

    // Fields/properties → bare-word completions (CRLF, TAB, cPI, Colors, File, etc.)
    // Common class has <field> elements, NOT <property> elements
    const fields = this.commonClass.fields ?? [];
    for (const field of fields) {
      this.members.push({
        name: field.name,
        kind: 'property',
        signature: `${field.name} As ${field.type ?? field.rawType ?? 'Object'}`,
        returnType: field.type ?? field.rawType,
        doc: formatDocToMarkdown(field.doc ?? field.description),
      });
    }

    // Also check properties (in case some classes use properties instead of fields)
    for (const prop of this.commonClass.properties) {
      this.members.push({
        name: prop.name,
        kind: 'property',
        signature: prop.signature ?? prop.rawSignature ?? `${prop.name}`,
        returnType: prop.type ?? prop.rawType,
        doc: formatDocToMarkdown(prop.doc ?? prop.description),
      });
    }
  }

  /** All global members available from the Common class. */
  public getMembers(): readonly CommonMemberInfo[] {
    return this.members;
  }

  /** Find a member by exact name (case-insensitive). */
  public findMemberByName(name: string): CommonMemberInfo | undefined {
    const lower = name.toLowerCase();
    return this.members.find(m => m.name.toLowerCase() === lower);
  }

  /** Find members matching a prefix (case-insensitive). */
  public findMembersByPrefix(prefix: string): CommonMemberInfo[] {
    const lower = prefix.toLowerCase();
    return this.members.filter(m => m.name.toLowerCase().startsWith(lower));
  }

  /** Whether the Common class has been loaded. */
  public isLoaded(): boolean {
    return this.commonClass !== undefined;
  }
}

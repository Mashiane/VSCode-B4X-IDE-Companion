/**
 * Comprehensive test for .b4xlib extraction and parsing.
 *
 * Extracts ALL .b4xlib files in Understanding/b4a-Libraries, parses each .bas
 * module, validates structure, and dumps all content for inspection.
 *
 * Mirrors the extension's B4xLibStore → WorkspaceClassStore pipeline.
 *
 * Usage: npx ts-node scripts/tests/test-b4xlib-extraction.ts [--dump] [--verbose]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---- Inline B4X manifest parser ----

function parseManifest(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.substring(0, eqIdx).trim().toLowerCase();
      const value = line.substring(eqIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

// ---- Inline B4X module parser (mirrors parseWorkspaceClassDocument) ----

const MARKER = '@EndOfDesignText@';

function getPostDesignStartLine(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 2000); i += 1) {
    if ((lines[i] ?? '').includes(MARKER)) return i + 1;
  }
  return 0;
}

function stripComment(text: string): string {
  const idx = text.indexOf("'");
  return idx === -1 ? text : text.substring(0, idx);
}

function parseTypedNameList(clause: string): { name: string; type?: string }[] {
  const result: { name: string; type?: string }[] = [];
  const pendingNames: string[] = [];
  for (const rawSegment of splitTopLevelCommaSegments(clause)) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const typedMatch = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s+As\s+(?<type>[A-Za-z_][A-Za-z0-9_\.\[\]]*)(?:\s*=.+)?$/i.exec(segment);
    if (typedMatch?.groups?.name) {
      const names = [...pendingNames, typedMatch.groups.name];
      pendingNames.length = 0;
      for (const name of names) result.push({ name, type: typedMatch.groups.type });
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

function splitTopLevelCommaSegments(source: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of source) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      const s = current.trim();
      if (s) parts.push(s);
      current = '';
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

interface B4xlibMethodInfo {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
  signature: string;
  doc?: string;
  isPublic: boolean;
}

interface B4xlibPropertyInfo {
  name: string;
  access: 'readonly' | 'readwrite' | 'writeonly';
  type: string;
  signature: string;
  doc?: string;
  isPublic: boolean;
}

interface B4xlibEventInfo {
  name: string;
  params: string[];
  rawEvent: string;
}

interface B4xlibTypeInfo {
  name: string;
  fields: { name: string; type: string }[];
}

interface B4xlibModuleInfo {
  name: string;
  moduleType: 'class' | 'static' | 'service' | 'unknown';
  methods: B4xlibMethodInfo[];
  properties: B4xlibPropertyInfo[];
  events: B4xlibEventInfo[];
  types: B4xlibTypeInfo[];
  doc?: string;
}

interface B4xlibArchiveInfo {
  archive: string;
  manifest: Record<string, string>;
  modules: B4xlibModuleInfo[];
  stats: {
    totalModules: number;
    totalMethods: number;
    publicMethods: number;
    privateMethods: number;
    totalProperties: number;
    totalEvents: number;
    totalTypes: number;
    modulesWithDocs: number;
    modulesWithEvents: number;
    modulesWithTypes: number;
  };
  errors: string[];
}

function parseWorkspaceModule(content: string, fileName: string): B4xlibModuleInfo {
  const lines = content.split(/\r?\n/);
  const startLine = getPostDesignStartLine(lines);

  // Detect module type from header
  let isClassModule = false;
  let isStaticModule = false;
  let isServiceModule = false;
  let hasServiceCreate = false;
  let hasServiceStart = false;
  const typeDeclarations: B4xlibTypeInfo[] = [];

  // Scan header for Type= and #StartAtBoot only
  for (let i = 0; i < startLine; i += 1) {
    const h = (lines[i] ?? '').trim();
    if (/^Type\s*=\s*Class$/i.test(h)) isClassModule = true;
    if (/^Type\s*=\s*StaticCode$/i.test(h)) isStaticModule = true;
    if (/^#StartAtBoot:/i.test(h)) isServiceModule = true;
    // NOTE: Type declarations (Type X(...)) must appear inside Class_Globals/Process_Globals,
    // not in the module header. Header-only Type= directives are module type markers.
  }

  // Scan for service lifecycle subs and Type declarations inside Class_Globals/Process_Globals
  let inGlobalsBlock = false;
  for (let i = startLine; i < lines.length; i += 1) {
    const code = stripComment(lines[i] ?? '').trim();
    if (/^Sub\s+Service_Create\b/i.test(code)) hasServiceCreate = true;
    if (/^Sub\s+Service_Start\b/i.test(code)) hasServiceStart = true;

    // Track Class_Globals/Process_Globals boundaries
    const globalsSub = isClassModule ? 'Class_Globals' : isStaticModule ? 'Process_Globals' : null;
    if (globalsSub && new RegExp(`^Sub\\s+${globalsSub}\\b`, 'i').test(code)) inGlobalsBlock = true;
    if (/^End\s+Sub\b/i.test(code) && inGlobalsBlock) inGlobalsBlock = false;

    // Parse Type declarations ONLY inside Class_Globals/Process_Globals
    if (inGlobalsBlock) {
      const typeMatch = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(code);
      if (typeMatch && typeMatch[1]) {
        const typeName = typeMatch[1];
        if (!typeDeclarations.some(t => t.name === typeName)) {
          const fieldsStr = (typeMatch[2] ?? '').trim();
          const fields = fieldsStr
            ? fieldsStr.split(',').map(f => f.trim()).filter(Boolean).map(f => {
                const parts = f.split(/\s+As\s+/i);
                return { name: (parts[0] ?? '').trim(), type: (parts[1] ?? 'Object').trim() };
              })
            : [];
          typeDeclarations.push({ name: typeName, fields });
        }
      }
    }
  }
  if (hasServiceCreate && hasServiceStart && !isClassModule && !isStaticModule) isServiceModule = true;

  const className = path.parse(fileName).name;
  const methods: B4xlibMethodInfo[] = [];
  const properties: B4xlibPropertyInfo[] = [];
  const events: B4xlibEventInfo[] = [];
  const leadingComments: string[] = [];
  let seenContent = false;
  let inExportsBlock = false;
  const exportsSubName = isClassModule ? 'Class_Globals' : isStaticModule ? 'Process_Globals' : null;

  for (let lineNumber = startLine; lineNumber < lines.length; lineNumber += 1) {
    const rawLine = lines[lineNumber] ?? '';
    const code = stripComment(rawLine).trim();

    // Track leading comments
    if (!seenContent) {
      const trimmed = rawLine.trim();
      const commentMatch = /^\s*'(.*)$/.exec(trimmed);
      if (commentMatch && commentMatch[1] && !/^#+$/.test(commentMatch[1].trim())) {
        leadingComments.push(commentMatch[1].trim());
        continue;
      }
      if (trimmed !== '' && !/^Type\s*=/i.test(trimmed) && !/^@/i.test(trimmed) && !/^#/i.test(trimmed)) {
        seenContent = true;
      }
    }

    if (!code) continue;

    // Parse #Event: directives with parameter types
    // Format: #Event: EventName (Param1 As Type1, Param2 As Type2)
    // Also handles: #Event: EventName  (no params)
    // And: #Event: EventName As ReturnType
    const eventMatch = /^\s*#Event:\s*(.+)$/i.exec(rawLine);
    if (eventMatch && eventMatch[1]) {
      const raw = eventMatch[1].trim();
      // Split on first '(' to get event name and optional params
      const parenIdx = raw.indexOf('(');
      let eventName: string;
      let params: string[] = [];
      if (parenIdx >= 0) {
        eventName = raw.substring(0, parenIdx).trim();
        // Extract params from parentheses, handle trailing "As ReturnType"
        const closingParen = raw.lastIndexOf(')');
        if (closingParen > parenIdx) {
          const paramsStr = raw.substring(parenIdx + 1, closingParen).trim();
          params = paramsStr ? paramsStr.split(',').map(p => p.trim()).filter(Boolean) : [];
        }
      } else {
        // No parentheses — just event name, optionally followed by "As ReturnType"
        const asIdx = raw.search(/\s+As\s+/i);
        eventName = asIdx >= 0 ? raw.substring(0, asIdx).trim() : raw;
      }
      events.push({ name: eventName, params, rawEvent: raw });
      continue;
    }

    if (exportsSubName && new RegExp(`^Sub\\s+${exportsSubName}\\b`, 'i').test(code)) {
      inExportsBlock = true;
      continue;
    }

    if (/^End\s+Sub\b/i.test(code)) {
      inExportsBlock = false;
      continue;
    }

    if (inExportsBlock) {
      // Parse declarations
      const match = /^\s*(?<visibility>Dim|Private|Public)\s+(.+)$/i.exec(code);
      if (match?.[2]) {
        const visibility = (match.groups?.visibility ?? 'Dim').toLowerCase();
        const isPublic = visibility !== 'private';
        for (const decl of parseTypedNameList(match[2])) {
          const typeName = decl.type?.trim() || 'Object';
          properties.push({
            name: decl.name,
            access: 'readwrite',
            type: typeName,
            signature: `${decl.name} As ${typeName}`,
            isPublic,
          });
        }
      }
      continue;
    }

    // Parse methods
    const methodMatch = /^\s*(?<visibility>Public|Private)?\s*Sub\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((?<parameters>[^)]*)\))?(?:\s+As\s+(?<returnType>[A-Za-z_][A-Za-z0-9_\.\[\]]*))?$/i.exec(code);
    const methodName = methodMatch?.groups?.name;
    if (methodName && !/^Class_Globals$/i.test(methodName) && !/^Process_Globals$/i.test(methodName)) {
      const visibility = methodMatch.groups?.visibility?.toLowerCase();
      const parameters: { name: string; type: string }[] = parseTypedNameList(methodMatch.groups?.parameters ?? '').map((d, idx) => ({
        name: d.name || `arg${idx + 1}`,
        type: d.type?.trim() || 'Object',
      }));
      const returnType = methodMatch.groups?.returnType?.trim() ?? 'void';
      methods.push({
        name: methodName,
        params: parameters,
        returnType,
        signature: `${methodName}(${parameters.map(p => `${p.name} As ${p.type}`).join(', ')})${returnType === 'void' ? '' : ` As ${returnType}`}`,
        isPublic: visibility !== 'private',
      });
    }
  }

  const moduleType: 'class' | 'static' | 'service' | 'unknown' = isClassModule && !isStaticModule ? 'class' : isStaticModule && !isClassModule ? 'static' : isServiceModule ? 'service' : 'unknown';
  const doc = leadingComments.length > 0 ? leadingComments.join(' ').replace(/\s+/g, ' ').trim() : undefined;

  return {
    name: className,
    moduleType,
    methods,
    properties,
    events,
    types: typeDeclarations,
    doc,
  };
}

// ---- ZIP extraction (mirrors B4xLibStore, async) ----

async function extractFromZip(archivePath: string): Promise<{ modules: { name: string; content: string }[]; manifest: Record<string, string> }> {
  const StreamZip = require('node-stream-zip');
  return new Promise((resolve, reject) => {
    const zip = new StreamZip({ file: archivePath, storeEntries: true });
    zip.on('ready', () => {
      try {
        const entries = zip.entries();
        let modules: { name: string; content: string }[] = [];
        let manifest: Record<string, string> = {};

        for (const entryName of Object.keys(entries)) {
          const entry = entries[entryName];
          if (!entry || entry.isDirectory) continue;

          if (entry.name.toLowerCase() === 'manifest.txt') {
            const data = zip.entryDataSync(entryName).toString('utf8');
            manifest = parseManifest(data);
          } else if (entry.name.toLowerCase().endsWith('.bas') || entry.name.toLowerCase().endsWith('.b4x')) {
            const data = zip.entryDataSync(entryName).toString('utf8');
            modules.push({ name: path.basename(entry.name), content: data });
          }
        }

        zip.close(() => {});
        resolve({ modules, manifest });
      } catch (err) {
        try { zip.close(() => {}); } catch {}
        reject(err);
      }
    });
    zip.on('error', (err: Error) => reject(err));
  });
}

// ---- Test runner ----

async function main() {
  const args = process.argv.slice(2);
  const dumpAll = args.includes('--dump');
  const verbose = args.includes('--verbose');

  const libDir = path.join(__dirname, '..', '..', 'Understanding', 'b4a-Libraries');
  if (!fs.existsSync(libDir)) {
    console.error(`Library directory not found: ${libDir}`);
    process.exit(1);
  }

  const b4xlibFiles = fs.readdirSync(libDir)
    .filter(f => f.toLowerCase().endsWith('.b4xlib'))
    .map(f => path.join(libDir, f));

  console.log(`\n=== B4XLib Extraction Test ===`);
  console.log(`Found ${b4xlibFiles.length} .b4xlib files in ${libDir}\n`);

  const results: B4xlibArchiveInfo[] = [];
  let totalErrors = 0;
  let totalModules = 0;
  let totalMethods = 0;
  let totalProperties = 0;
  let totalEvents = 0;
  let totalTypes = 0;

  for (const archivePath of b4xlibFiles) {
    const archiveName = path.basename(archivePath);
    const errors: string[] = [];

    try {
      const { modules: rawModules, manifest } = await extractFromZip(archivePath);

      if (rawModules.length === 0) {
        errors.push('No .bas/.b4x modules found in archive');
      }

      const modules = rawModules.map(m => parseWorkspaceModule(m.content, m.name));

      // Validate
      for (const mod of modules) {
        if (!mod.name) errors.push(`Module has no name`);
        if (mod.moduleType === 'unknown') errors.push(`Module '${mod.name}' has unknown type (no Type= header and no service lifecycle methods)`);
        if (mod.methods.some(m => !m.name)) errors.push(`Module '${mod.name}' has method with no name`);
        if (mod.properties.some(p => !p.name)) errors.push(`Module '${mod.name}' has property with no name`);
      }

      const stats = {
        totalModules: modules.length,
        totalMethods: modules.reduce((s, m) => s + m.methods.length, 0),
        publicMethods: modules.reduce((s, m) => s + m.methods.filter(me => me.isPublic).length, 0),
        privateMethods: modules.reduce((s, m) => s + m.methods.filter(me => !me.isPublic).length, 0),
        totalProperties: modules.reduce((s, m) => s + m.properties.length, 0),
        totalEvents: modules.reduce((s, m) => s + m.events.length, 0),
        totalTypes: modules.reduce((s, m) => s + m.types.length, 0),
        modulesWithDocs: modules.filter(m => m.doc).length,
        modulesWithEvents: modules.filter(m => m.events.length > 0).length,
        modulesWithTypes: modules.filter(m => m.types.length > 0).length,
      };

      results.push({ archive: archiveName, manifest, modules, stats, errors });
      totalModules += stats.totalModules;
      totalMethods += stats.totalMethods;
      totalProperties += stats.totalProperties;
      totalEvents += stats.totalEvents;
      totalTypes += stats.totalTypes;
      totalErrors += errors.length;

      if (verbose) {
        console.log(`📦 ${archiveName}`);
        console.log(`   Manifest: version=${manifest.version || 'n/a'}, author=${manifest.author || 'n/a'}`);
        console.log(`   Modules: ${stats.totalModules} | Methods: ${stats.totalMethods} | Props: ${stats.totalProperties} | Events: ${stats.totalEvents} | Types: ${stats.totalTypes}`);
        console.log(`   Modules with docs: ${stats.modulesWithDocs} | Events: ${stats.modulesWithEvents} | Types: ${stats.modulesWithTypes}`);
        if (errors.length > 0) {
          for (const err of errors) console.log(`   ❌ ${err}`);
        } else {
          console.log(`   ✅ OK`);
        }
        // List each module
        for (const mod of modules) {
          const ev = mod.events.length > 0 ? ` | Events: ${mod.events.map(e => e.name).join(', ')}` : '';
          const tp = mod.types.length > 0 ? ` | Types: ${mod.types.map(t => t.name).join(', ')}` : '';
          console.log(`   └─ ${mod.name} (${mod.moduleType}) - ${mod.methods.length} methods, ${mod.properties.length} props${ev}${tp}${mod.doc ? ' [has doc]' : ''}`);
        }
        console.log();
      }

    } catch (err: any) {
      errors.push(`Extraction error: ${err.message}`);
      results.push({ archive: archiveName, manifest: {}, modules: [], stats: { totalModules: 0, totalMethods: 0, publicMethods: 0, privateMethods: 0, totalProperties: 0, totalEvents: 0, totalTypes: 0, modulesWithDocs: 0, modulesWithEvents: 0, modulesWithTypes: 0 }, errors });
      totalErrors++;
      console.log(`❌ ${archiveName}: ${err.message}`);
    }
  }

  // Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`Archives processed:  ${b4xlibFiles.length}`);
  console.log(`Total modules:     ${totalModules}`);
  console.log(`Total methods:     ${totalMethods}`);
  console.log(`  Public methods:  ${results.reduce((s, r) => s + r.stats.publicMethods, 0)}`);
  console.log(`  Private methods: ${results.reduce((s, r) => s + r.stats.privateMethods, 0)}`);
  console.log(`Total properties:  ${totalProperties}`);
  console.log(`Total events:      ${totalEvents}`);
  console.log(`Total types:       ${totalTypes}`);
  console.log(`Archives with errors: ${results.filter(r => r.errors.length > 0).length}`);
  console.log(`Total errors:      ${totalErrors}`);

  // Check manifest coverage
  const withManifest = results.filter(r => Object.keys(r.manifest).length > 0).length;
  console.log(`Archives with manifest: ${withManifest}/${b4xlibFiles.length}`);

  // Check module type coverage
  const unknownTypes = results.reduce((s, r) => s + r.modules.filter(m => m.moduleType === 'unknown').length, 0);
  console.log(`Modules with unknown type: ${unknownTypes}/${totalModules}`);

  if (totalErrors === 0) {
    console.log(`\n✅ ALL ${b4xlibFiles.length} B4XLIB ARCHIVES EXTRACTED SUCCESSFULLY`);
  } else {
    console.log(`\n❌ ${totalErrors} ERROR(S) FOUND`);
    for (const r of results) {
      if (r.errors.length > 0) {
        console.log(`\n${r.archive}:`);
        for (const err of r.errors) console.log(`  - ${err}`);
      }
    }
  }

  // Full dump
  if (dumpAll) {
    const dumpPath = path.join(__dirname, '..', '..', 'logs', 'b4xlib-extraction-dump.json');
    const dumpDir = path.dirname(dumpPath);
    if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });

    const dumpData = {
      generatedAt: new Date().toISOString(),
      totalArchives: results.length,
      totalModules,
      totalMethods,
      totalProperties,
      totalEvents,
      totalTypes,
      archives: results.map(r => ({
        archive: r.archive,
        manifest: r.manifest,
        modules: r.modules.map(m => ({
          name: m.name,
          moduleType: m.moduleType,
          doc: m.doc || undefined,
          methods: m.methods.map(me => ({
            name: me.name,
            signature: me.signature,
            isPublic: me.isPublic,
            hasDoc: !!me.doc,
          })),
          properties: m.properties.map(p => ({
            name: p.name,
            type: p.type,
            access: p.access,
            isPublic: p.isPublic,
          })),
          events: m.events.map(e => ({ name: e.name, params: e.params, rawEvent: e.rawEvent })),
          types: m.types.map(t => ({
            name: t.name,
            fields: t.fields,
          })),
        })),
        errors: r.errors,
      })),
    };

    fs.writeFileSync(dumpPath, JSON.stringify(dumpData, null, 2), 'utf8');
    console.log(`\n📁 Full dump written to: ${dumpPath}`);
    console.log(`   File size: ${(fs.statSync(dumpPath).size / 1024).toFixed(1)} KB`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();

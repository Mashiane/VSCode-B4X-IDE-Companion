#!/usr/bin/env node
/**
 * Test B4J library extraction: XML and b4xlib files
 * Uses the same parsers as the extension.
 * 
 * Usage: node scripts/tests/test-b4j-libraries.js
 */

const fs = require('fs');
const path = require('path');
const StreamZip = require('node-stream-zip');

const libDir = path.join(__dirname, '..', '..', 'Understanding', 'b4j-Libraries');
const outDir = path.join(__dirname, '..', '..', 'logs');

if (!fs.existsSync(libDir)) {
  console.error(`❌ Directory not found: ${libDir}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ---- Minimal VS Code shim ----
const shimUri = (filePath) => ({ fsPath: filePath, scheme: 'file' });
const shimPosition = (line, character) => ({ line, character });
const shimRange = (startLine, startChar, endLine, endChar) => ({
  start: shimPosition(startLine, startChar),
  end: shimPosition(endLine, endChar),
});
const shimDocument = (filePath, content) => ({
  uri: shimUri(filePath),
  getText: () => content,
  lineCount: content.split(/\r?\n/).length,
  lineAt: (i) => {
    const lines = content.split(/\r?\n/);
    const text = lines[i] ?? '';
    return { text, range: shimRange(i, 0, i, text.length) };
  },
  positionAt: (offset) => {
    let line = 0, char = 0;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') { line++; char = 0; } else { char++; }
    }
    return shimPosition(line, char);
  },
});

// ---- Inline parser helpers (copied from xmlLibraryIndex.ts) ----

function decodeXml(v) {
  return v.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function formatDocToMarkdown(raw) {
  if (!raw || !raw.trim()) return undefined;
  let text = decodeXml(raw);
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, body) => {
    return '\n```b4x\n' + body.replace(/^\s*\n/, '').replace(/\n\s*$/, '') + '\n```\n';
  });
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<link>([^|]+)\|([^<]+)<\/link>/gi, '[$1]($2)');
  return text.trim();
}

function extractTagValue(block, tagName) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'i').exec(block);
  return match?.[1]?.trim();
}

function deriveShortName(fqdn) {
  if (!fqdn) return '';
  const lastDot = fqdn.lastIndexOf('.');
  return lastDot >= 0 ? fqdn.substring(lastDot + 1) : fqdn;
}

function parseXmlLibraryText(text, filePath) {
  const classes = [];
  const versionMatch = /<version>([^<]+)<\/version>/i.exec(text);
  const docletVersionMatch = /<doclet-version-NOT-library-version>([^<]+)<\/doclet-version-NOT-library-version>/i.exec(text);
  const libraryVersion = (versionMatch && versionMatch[1] !== '0' ? versionMatch[1] : docletVersionMatch?.[1]) ?? undefined;

  let pos = 0;
  while (pos < text.length) {
    const classStart = text.indexOf('<class>', pos);
    if (classStart < 0) break;
    let depth = 1, i = classStart + 7;
    while (i < text.length && depth > 0) {
      if (text.startsWith('<class>', i)) { depth++; i += 7; }
      else if (text.startsWith('</class>', i)) { depth--; i += 8; }
      else { i++; }
    }
    if (depth !== 0) break;

    const block = text.substring(classStart + 7, i - 8);
    pos = i;

    const shortName = decodeXml(extractTagValue(block, 'shortname') ?? '');
    const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
    const effectiveName = shortName || deriveShortName(rawName);
    if (!effectiveName) continue;

    const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
    const methods = [], properties = [], fields = [], events = [];

    // Methods
    const methodPattern = /<method>([\s\S]*?)<\/method>/gi;
    let m;
    while ((m = methodPattern.exec(block)) !== null) {
      const mb = m[1] ?? '';
      const name = decodeXml(extractTagValue(mb, 'name') ?? '');
      if (!name) continue;
      const params = [];
      const paramP = /<parameter>([\s\S]*?)<\/parameter>/gi;
      let pm;
      while ((pm = paramP.exec(mb)) !== null) {
        const pb = pm[1] ?? '';
        params.push({
          name: decodeXml(extractTagValue(pb, 'name') ?? '') || `arg${params.length + 1}`,
          type: decodeXml(extractTagValue(pb, 'type') ?? 'Object'),
        });
      }
      const returnType = decodeXml(extractTagValue(mb, 'returntype') ?? 'void');
      const sig = `${name}(${params.map(p => `${p.name} As ${p.type}`).join(', ')})${returnType === 'void' ? '' : ` As ${returnType}`}`;
      const doc = formatDocToMarkdown(decodeXml(extractTagValue(mb, 'comment') ?? ''));
      methods.push({ name, params, returnType, signature: sig, doc });
    }

    // Properties
    const propP = /<property>([\s\S]*?)<\/property>/gi;
    let pp;
    while ((pp = propP.exec(block)) !== null) {
      const pb = pp[1] ?? '';
      const pname = decodeXml(extractTagValue(pb, 'name') ?? '');
      if (!pname) continue;
      const ptype = decodeXml(extractTagValue(pb, 'returntype') ?? 'Object');
      const writable = /<parameter>/.test(pb);
      properties.push({ name: pname, type: ptype, access: writable ? 'readwrite' : 'readonly' });
    }

    // Fields
    const fieldP = /<field>([\s\S]*?)<\/field>/gi;
    let fp;
    while ((fp = fieldP.exec(block)) !== null) {
      const fb = fp[1] ?? '';
      const fname = decodeXml(extractTagValue(fb, 'name') ?? '');
      if (!fname) continue;
      const ftype = decodeXml(extractTagValue(fb, 'returntype') ?? 'Object');
      fields.push({ name: fname, type: ftype });
    }

    // Events
    const eventP = /<event>([\s\S]*?)<\/event>/gi;
    let ep;
    while ((ep = eventP.exec(block)) !== null) {
      const raw = (ep[1] ?? '').trim();
      if (!raw) continue;
      const em = /^(\w+)\s*(?:\(([^)]*)\))?$/.exec(raw);
      if (!em || !em[1]) continue;
      events.push({ name: em[1], params: em[2] ? em[2].split(',').map(p => p.trim()).filter(Boolean) : [] });
    }

    classes.push({
      name: effectiveName,
      doc: formatDocToMarkdown(comment),
      methods, properties, fields, events,
    });
  }

  return { libraryVersion, classes, file: path.basename(filePath) };
}

// ---- b4xlib extraction ----

function stripComment(text) {
  const idx = text.indexOf("'");
  return idx === -1 ? text : text.substring(0, idx);
}

function getPostDesignStartLine(lines) {
  for (let i = 0; i < Math.min(lines.length, 2000); i++) {
    if ((lines[i] ?? '').includes('@EndOfDesignText@')) return i + 1;
  }
  return 0;
}

function parseTypedNameList(clause) {
  const result = [];
  const pending = [];
  for (const seg of clause.split(',').map(s => s.trim()).filter(Boolean)) {
    const typed = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s+As\s+(?<type>[A-Za-z_][A-Za-z0-9_\.\[\]]*)/i.exec(seg);
    if (typed?.groups?.name) {
      for (const n of [...pending, typed.groups.name]) result.push({ name: n, type: typed.groups.type });
      pending.length = 0;
    } else {
      const nameOnly = /^([A-Za-z_][A-Za-z0-9_]*)/i.exec(seg);
      if (nameOnly) { pending.push(nameOnly[1]); result.push({ name: nameOnly[1] }); }
    }
  }
  return result;
}

function parseWorkspaceModule(content, fileName) {
  const lines = content.split(/\r?\n/);
  const startLine = getPostDesignStartLine(lines);

  let isClassModule = false, isStaticModule = false;
  const typeDeclarations = [];

  for (let i = 0; i < startLine; i++) {
    const h = (lines[i] ?? '').trim();
    if (/^Type\s*=\s*Class$/i.test(h)) isClassModule = true;
    if (/^Type\s*=\s*StaticCode$/i.test(h)) isStaticModule = true;
  }

  let inGlobalsBlock = false;
  const exportsSub = isClassModule ? 'Class_Globals' : isStaticModule ? 'Process_Globals' : null;

  for (let i = startLine; i < lines.length; i++) {
    const code = stripComment(lines[i] ?? '').trim();
    if (/^Sub\s+Service_Create\b/i.test(code)) {} // service detection
    if (/^Sub\s+Service_Start\b/i.test(code)) {}

    if (exportsSub && new RegExp(`^Sub\\s+${exportsSub}\\b`, 'i').test(code)) inGlobalsBlock = true;
    if (/^End\s+Sub\b/i.test(code) && inGlobalsBlock) inGlobalsBlock = false;

    // Type declarations ONLY inside Class_Globals/Process_Globals
    if (inGlobalsBlock) {
      const tm = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(code);
      if (tm && tm[1] && !typeDeclarations.some(t => t.name === tm[1])) {
        const fieldsStr = (tm[2] ?? '').trim();
        const fields = fieldsStr ? fieldsStr.split(',').map(f => f.trim()).filter(Boolean).map(f => {
          const parts = f.split(/\s+As\s+/i);
          return { name: (parts[0] ?? '').trim(), type: (parts[1] ?? 'Object').trim() };
        }) : [];
        typeDeclarations.push({ name: tm[1], fields });
      }
    }
  }

  const methods = [], properties = [], events = [];

  for (let i = startLine; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const code = stripComment(rawLine).trim();
    if (!code) continue;

    // Events
    const evMatch = /^\s*#Event:\s*(.+)$/i.exec(rawLine);
    if (evMatch && evMatch[1]) {
      const raw = evMatch[1].trim();
      const pi = raw.indexOf('(');
      let ename = '', eparams = [];
      if (pi >= 0) {
        ename = raw.substring(0, pi).trim();
        const cp = raw.lastIndexOf(')');
        if (cp > pi) {
          eparams = raw.substring(pi + 1, cp).split(',').map(p => p.trim()).filter(Boolean);
        }
      } else {
        const ai = raw.search(/\s+As\s+/i);
        ename = ai >= 0 ? raw.substring(0, ai).trim() : raw;
      }
      events.push({ name: ename, params: eparams });
      continue;
    }

    // Methods (skip Class_Globals/Process_Globals, skip private)
    if (exportsSub && new RegExp(`^Sub\\s+${exportsSub}\\b`, 'i').test(code)) {
      let depth = 1, j = i + 1;
      while (j < lines.length && depth > 0) {
        const lc = stripComment(lines[j] ?? '').trim();
        if (/^Sub\s+/i.test(lc) && !/Class_Globals|Process_Globals/i.test(lc)) depth++;
        if (/^End\s+Sub\b/i.test(lc)) depth--;
        j++;
      }
      // Inside globals block: parse Type and Dim
      for (let k = i + 1; k < j - 1; k++) {
        const gc = stripComment(lines[k] ?? '').trim();
        // Type inside globals
        const tm = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(gc);
        if (tm && tm[1] && !typeDeclarations.some(t => t.name === tm[1])) {
          const fieldsStr = (tm[2] ?? '').trim();
          const fields = fieldsStr ? fieldsStr.split(',').map(f => f.trim()).filter(Boolean).map(f => {
            const parts = f.split(/\s+As\s+/i);
            return { name: (parts[0] ?? '').trim(), type: (parts[1] ?? 'Object').trim() };
          }) : [];
          typeDeclarations.push({ name: tm[1], fields });
        }
        // Dim/Public declarations
        const dm = /^\s*(?<visibility>Dim|Private|Public)\s+(.+)$/i.exec(gc);
        if (dm?.[2]) {
          const vis = (dm.groups?.visibility ?? 'Dim').toLowerCase();
          if (vis === 'private') continue; // EXCLUDED
          for (const d of parseTypedNameList(dm[2])) {
            const t = d.type?.trim() || 'Object';
            properties.push({ name: d.name, type: t, access: 'readwrite' });
          }
        }
      }
      i = j - 1;
      continue;
    }

    // Regular methods (skip private)
    const mm = /^\s*(?<visibility>Public|Private)?\s*Sub\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((?<parameters>[^)]*)\))?(?:\s+As\s+(?<returnType>[A-Za-z_][A-Za-z0-9_\.\[\]]*))?$/i.exec(code);
    const mname = mm?.groups?.name;
    const vis = mm?.groups?.visibility?.toLowerCase();
    if (mname && vis !== 'private') {
      const params = parseTypedNameList(mm.groups?.parameters ?? '').map((d, idx) => ({
        name: d.name || `arg${idx + 1}`, type: d.type?.trim() || 'Object',
      }));
      const rt = mm.groups?.returnType?.trim() ?? 'void';
      methods.push({ name: mname, params, returnType: rt, signature: `${mname}(${params.map(p => `${p.name} As ${p.type}`).join(', ')})${rt === 'void' ? '' : ` As ${rt}`}`, isPublic: true });
    }
  }

  return {
    name: path.parse(fileName).name,
    moduleType: isClassModule ? 'class' : isStaticModule ? 'static' : 'unknown',
    methods, properties, events, types: typeDeclarations,
  };
}

async function extractB4xlib(filePath) {
  return new Promise((resolve, reject) => {
    const zip = new StreamZip({ file: filePath, storeEntries: true });
    zip.on('ready', () => {
      try {
        const entries = zip.entries();
        let manifest = {};
        const modules = [];

        for (const entryName of Object.keys(entries)) {
          const entry = entries[entryName];
          if (!entry || entry.isDirectory) continue;

          if (entry.name.toLowerCase() === 'manifest.txt') {
            const data = zip.entryDataSync(entryName).toString('utf8');
            for (const line of data.split(/\r?\n/)) {
              const eq = line.indexOf('=');
              if (eq > 0) manifest[line.substring(0, eq).trim().toLowerCase()] = line.substring(eq + 1).trim();
            }
          } else if (entry.name.toLowerCase().endsWith('.bas') || entry.name.toLowerCase().endsWith('.b4x')) {
            const data = zip.entryDataSync(entryName).toString('utf8');
            modules.push({ name: path.basename(entry.name), content: data });
          }
        }

        zip.close(() => {});
        resolve({ manifest, modules });
      } catch (err) {
        zip.close(() => {});
        reject(err);
      }
    });
    zip.on('error', e => reject(e));
  });
}

// ---- Main test runner ----

async function main() {
  console.log('=== B4J Library Extraction Test ===\n');
  console.log(`Directory: ${libDir}\n`);

  const xmlFiles = fs.readdirSync(libDir).filter(f => f.toLowerCase().endsWith('.xml'));
  const b4xlibFiles = fs.readdirSync(libDir).filter(f => f.toLowerCase().endsWith('.b4xlib'));

  console.log(`Found ${xmlFiles.length} XML files, ${b4xlibFiles.length} b4xlib files\n`);

  // ---- XML Parsing ----
  console.log('=== XML Parsing ===\n');
  const xmlResults = [];
  let xmlTotalClasses = 0, xmlTotalMethods = 0, xmlTotalProps = 0, xmlTotalFields = 0, xmlTotalEvents = 0;

  for (const f of xmlFiles.sort()) {
    const content = fs.readFileSync(path.join(libDir, f), 'utf8');
    const result = parseXmlLibraryText(content, path.join(libDir, f));
    xmlResults.push(result);

    const clsCount = result.classes.length;
    const mCount = result.classes.reduce((s, c) => s + c.methods.length, 0);
    const pCount = result.classes.reduce((s, c) => s + c.properties.length, 0);
    const fCount = result.classes.reduce((s, c) => s + c.fields.length, 0);
    const eCount = result.classes.reduce((s, c) => s + c.events.length, 0);

    xmlTotalClasses += clsCount;
    xmlTotalMethods += mCount;
    xmlTotalProps += pCount;
    xmlTotalFields += fCount;
    xmlTotalEvents += eCount;

    const v = result.libraryVersion ? ` v${result.libraryVersion}` : '';
    console.log(`📄 ${f}${v}`);
    console.log(`   Classes: ${clsCount} | Methods: ${mCount} | Props: ${pCount} | Fields: ${fCount} | Events: ${eCount}`);
    if (clsCount > 0) {
      result.classes.forEach(c => {
        console.log(`   └─ ${c.name}: ${c.methods.length} methods, ${c.properties.length} props, ${c.fields.length} fields, ${c.events.length} events`);
      });
    }
    console.log();
  }

  // ---- b4xlib Extraction ----
  console.log('=== b4xlib Extraction ===\n');
  const b4xlibResults = [];
  let b4xlibTotalModules = 0, b4xlibTotalMethods = 0, b4xlibTotalProps = 0, b4xlibTotalEvents = 0, b4xlibTotalTypes = 0;
  let b4xlibTotalPublic = 0, b4xlibTotalPrivate = 0;

  for (const f of b4xlibFiles.sort()) {
    const filePath = path.join(libDir, f);
    const { manifest, modules } = await extractB4xlib(filePath);

    const parsedModules = modules.map(m => parseWorkspaceModule(m.content, m.name));

    // Count private methods (should be 0 in parsed output)
    const privCount = modules.reduce((s, m) => {
      return s + m.content.split('\n').filter(l => /^\s*Private\s+Sub\s+/i.test(l)).length;
    }, 0);

    b4xlibResults.push({
      archive: f,
      manifest,
      modules: parsedModules.map(m => ({
        name: m.name,
        moduleType: m.moduleType,
        methods: m.methods.length,
        properties: m.properties.length,
        events: m.events.length,
        types: m.types.length,
        typeDetails: m.types,
      })),
      rawPrivateMethodsInSource: privCount,
    });

    const modCount = parsedModules.length;
    const mCount = parsedModules.reduce((s, m) => s + m.methods.length, 0);
    const pCount = parsedModules.reduce((s, m) => s + m.properties.length, 0);
    const eCount = parsedModules.reduce((s, m) => s + m.events.length, 0);
    const tCount = parsedModules.reduce((s, m) => s + m.types.length, 0);

    b4xlibTotalModules += modCount;
    b4xlibTotalMethods += mCount;
    b4xlibTotalProps += pCount;
    b4xlibTotalEvents += eCount;
    b4xlibTotalTypes += tCount;
    b4xlibTotalPrivate += privCount;

    const v = manifest.version ? ` v${manifest.version}` : '';
    console.log(`📦 ${f}${v}`);
    console.log(`   Manifest: version=${manifest.version || 'n/a'}, author=${manifest.author || 'n/a'}`);
    console.log(`   Modules: ${modCount} | Methods: ${mCount} | Props: ${pCount} | Events: ${eCount} | Types: ${tCount}`);
    console.log(`   Private methods in source (excluded): ${privCount}`);
    parsedModules.forEach(m => {
      const ev = m.events.length > 0 ? ` | Events: ${m.events.map(e => e.name).join(', ')}` : '';
      const tp = m.types.length > 0 ? ` | Types: ${m.types.map(t => t.name).join(', ')}` : '';
      console.log(`   └─ ${m.name} (${m.moduleType}) - ${m.methods.length} methods, ${m.properties.length} props${ev}${tp}`);
    });
    console.log();
  }

  // ---- Summary ----
  console.log('=== SUMMARY ===');
  console.log(`XML files parsed:     ${xmlFiles.length}`);
  console.log(`  Total classes:      ${xmlTotalClasses}`);
  console.log(`  Total methods:      ${xmlTotalMethods}`);
  console.log(`  Total properties:   ${xmlTotalProps}`);
  console.log(`  Total fields:       ${xmlTotalFields}`);
  console.log(`  Total events:       ${xmlTotalEvents}`);
  console.log(`b4xlib files parsed:  ${b4xlibFiles.length}`);
  console.log(`  Total modules:      ${b4xlibTotalModules}`);
  console.log(`  Total methods:      ${b4xlibTotalMethods}`);
  console.log(`  Total properties:   ${b4xlibTotalProps}`);
  console.log(`  Total events:       ${b4xlibTotalEvents}`);
  console.log(`  Total types:        ${b4xlibTotalTypes}`);
  console.log(`  Private excluded:   ${b4xlibTotalPrivate} (not stored)`);

  // ---- Dumps ----
  fs.writeFileSync(path.join(outDir, 'b4j-xml-dump.json'), JSON.stringify(xmlResults, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'b4j-b4xlib-dump.json'), JSON.stringify(b4xlibResults, null, 2), 'utf8');
  console.log(`\n📁 Dumps written to:`);
  console.log(`   ${path.join(outDir, 'b4j-xml-dump.json')} (${(fs.statSync(path.join(outDir, 'b4j-xml-dump.json')).size / 1024).toFixed(1)} KB)`);
  console.log(`   ${path.join(outDir, 'b4j-b4xlib-dump.json')} (${(fs.statSync(path.join(outDir, 'b4j-b4xlib-dump.json')).size / 1024).toFixed(1)} KB)`);

  // ---- Comparison with B4A ----
  console.log('\n=== B4J vs B4A Comparison ===');

  // Load B4A data for comparison
  const b4aDir = path.join(__dirname, '..', '..', 'Understanding', 'b4a-Libraries');
  if (fs.existsSync(b4aDir)) {
    const b4aXml = fs.readdirSync(b4aDir).filter(f => f.toLowerCase().endsWith('.xml'));
    const b4aLib = fs.readdirSync(b4aDir).filter(f => f.toLowerCase().endsWith('.b4xlib'));

    console.log(`\nB4A Libraries:`);
    console.log(`  XML files:  ${b4aXml.length}`);
    console.log(`  b4xlib:     ${b4aLib.length}`);
    console.log(`\nB4J Libraries:`);
    console.log(`  XML files:  ${xmlFiles.length}`);
    console.log(`  b4xlib:     ${b4xlibFiles.length}`);

    // Common libraries
    const b4aXmlNames = new Set(b4aXml.map(f => f.toLowerCase()));
    const b4jXmlNames = new Set(xmlFiles.map(f => f.toLowerCase()));
    const b4aLibNames = new Set(b4aLib.map(f => f.toLowerCase()));
    const b4jLibNames = new Set(b4xlibFiles.map(f => f.toLowerCase()));

    const commonXml = [...b4jXmlNames].filter(f => b4aXmlNames.has(f));
    const onlyB4jXml = [...b4jXmlNames].filter(f => !b4aXmlNames.has(f));
    const commonLib = [...b4jLibNames].filter(f => b4aLibNames.has(f));
    const onlyB4jLib = [...b4jLibNames].filter(f => !b4aLibNames.has(f));

    console.log(`\nShared XML files: ${commonXml.length}`);
    commonXml.slice(0, 10).forEach(f => console.log(`  ✓ ${f}`));
    if (commonXml.length > 10) console.log(`  ... and ${commonXml.length - 10} more`);

    console.log(`\nB4J-only XML files: ${onlyB4jXml.length}`);
    onlyB4jXml.forEach(f => console.log(`  + ${f}`));

    console.log(`\nShared b4xlib files: ${commonLib.length}`);
    commonLib.slice(0, 10).forEach(f => console.log(`  ✓ ${f}`));
    if (commonLib.length > 10) console.log(`  ... and ${commonLib.length - 10} more`);

    console.log(`\nB4J-only b4xlib files: ${onlyB4jLib.length}`);
    onlyB4jLib.forEach(f => console.log(`  + ${f}`));

    // Structural differences
    console.log('\nStructural differences found:');
    for (const f of commonXml) {
      const b4aContent = fs.readFileSync(path.join(b4aDir, f), 'utf8');
      const b4jContent = fs.readFileSync(path.join(libDir, f), 'utf8');

      const b4aResult = parseXmlLibraryText(b4aContent, path.join(b4aDir, f));
      const b4jResult = parseXmlLibraryText(b4jContent, path.join(libDir, f));

      if (b4aResult.classes.length !== b4jResult.classes.length) {
        console.log(`  ⚠ ${f}: B4A has ${b4aResult.classes.length} classes, B4J has ${b4jResult.classes.length} classes`);
      }

      for (const cls of b4jResult.classes) {
        const b4aCls = b4aResult.classes.find(c => c.name.toLowerCase() === cls.name.toLowerCase());
        if (b4aCls) {
          if (b4aCls.methods.length !== cls.methods.length) {
            console.log(`  ⚠ ${f}/${cls.name}: B4A has ${b4aCls.methods.length} methods, B4J has ${cls.methods.length} methods`);
          }
        }
      }
    }
  }

  console.log('\n✅ Done');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

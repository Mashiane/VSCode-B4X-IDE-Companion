"use strict";
/**
 * Comprehensive test for XML library parsing.
 *
 * Tests ALL XML files in Understanding/b4a-Libraries against the extension's
 * parseXmlLibraryDocument() function, validates structure, and dumps all content
 * for inspection.
 *
 * Usage: npx ts-node scripts/tests/test-xml-libraries.ts [--dump] [--verbose]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// ---- Inline the XML parser (copy of xmlLibraryIndex.ts logic) ----
function decodeXml(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
function formatDocToMarkdown(raw) {
    if (!raw || !raw.trim())
        return undefined;
    let text = decodeXml(raw);
    text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, body) => {
        let trimmed = body.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
        return `\n\`\`\`b4x\n${trimmed}\n\`\`\`\n`;
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
    if (!fqdn)
        return '';
    const lastDot = fqdn.lastIndexOf('.');
    return lastDot >= 0 ? fqdn.substring(lastDot + 1) : fqdn;
}
function parseXmlLibraryText(text, filePath) {
    const classes = [];
    let pos = 0;
    while (pos < text.length) {
        const classStart = text.indexOf('<class>', pos);
        if (classStart < 0)
            break;
        let depth = 1;
        let i = classStart + 7;
        while (i < text.length && depth > 0) {
            if (text.startsWith('<class>', i)) {
                depth++;
                i += 7;
            }
            else if (text.startsWith('</class>', i)) {
                depth--;
                i += 8;
            }
            else {
                i++;
            }
        }
        if (depth !== 0)
            break;
        const blockStart = classStart;
        const block = text.substring(classStart + 7, i - 8);
        pos = i;
        const shortName = decodeXml(extractTagValue(block, 'shortname') ?? '');
        const rawName = decodeXml(extractTagValue(block, 'name') ?? '');
        const effectiveName = shortName || deriveShortName(rawName);
        if (!effectiveName)
            continue;
        const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
        const methods = parseMethods(block);
        const properties = parseProperties(block);
        const fields = parseFields(block);
        const events = parseEvents(block);
        classes.push({
            name: effectiveName,
            shortname: effectiveName,
            doc: formatDocToMarkdown(comment),
            methods,
            properties,
            fields,
            events,
        });
    }
    return classes;
}
function parseMethods(classBlock) {
    const result = [];
    const pattern = /<method>([\s\S]*?)<\/method>/gi;
    let match;
    while ((match = pattern.exec(classBlock)) !== null) {
        const block = match[1] ?? '';
        const name = decodeXml(extractTagValue(block, 'name') ?? '');
        if (!name)
            continue;
        const params = parseParameters(block);
        const rawReturnType = decodeXml(extractTagValue(block, 'returntype') ?? 'void');
        const signature = `${name}(${params.map(p => `${p.name} As ${p.type}`).join(', ')})${rawReturnType === 'void' ? '' : ` As ${rawReturnType}`}`;
        const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
        result.push({
            name,
            params,
            returnType: rawReturnType,
            signature,
            doc: formatDocToMarkdown(comment) || undefined,
        });
    }
    return result;
}
function parseProperties(classBlock) {
    const result = [];
    const pattern = /<property>([\s\S]*?)<\/property>/gi;
    let match;
    while ((match = pattern.exec(classBlock)) !== null) {
        const block = match[1] ?? '';
        const name = decodeXml(extractTagValue(block, 'name') ?? '');
        if (!name)
            continue;
        const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
        const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
        const writable = /<parameter>/.test(block);
        result.push({
            name,
            access: writable ? 'readwrite' : 'readonly',
            type: rawType,
            signature: `${name} As ${rawType}`,
            doc: formatDocToMarkdown(comment) || undefined,
        });
    }
    return result;
}
function parseFields(classBlock) {
    const result = [];
    const pattern = /<field>([\s\S]*?)<\/field>/gi;
    let match;
    while ((match = pattern.exec(classBlock)) !== null) {
        const block = match[1] ?? '';
        const name = decodeXml(extractTagValue(block, 'name') ?? '');
        if (!name)
            continue;
        const rawType = decodeXml(extractTagValue(block, 'returntype') ?? 'Object');
        const comment = decodeXml(extractTagValue(block, 'comment') ?? '');
        result.push({
            name,
            type: rawType,
            signature: `${name} As ${rawType}`,
            doc: formatDocToMarkdown(comment) || undefined,
        });
    }
    return result;
}
function parseParameters(block) {
    const result = [];
    const pattern = /<parameter>([\s\S]*?)<\/parameter>/gi;
    let match;
    while ((match = pattern.exec(block)) !== null) {
        const pblock = match[1] ?? '';
        const name = decodeXml(extractTagValue(pblock, 'name') ?? '') || `arg${result.length + 1}`;
        const type = decodeXml(extractTagValue(pblock, 'type') ?? 'Object');
        result.push({ name, type });
    }
    return result;
}
function parseEvents(classBlock) {
    const result = [];
    const pattern = /<event>([\s\S]*?)<\/event>/gi;
    let match;
    while ((match = pattern.exec(classBlock)) !== null) {
        const raw = (match[1] ?? '').trim();
        if (!raw)
            continue;
        const eventMatch = /^(\w+)\s*(?:\(([^)]*)\))?$/.exec(raw);
        if (!eventMatch || !eventMatch[1])
            continue;
        const eventName = eventMatch[1];
        const paramsStr = eventMatch[2] ?? '';
        const params = paramsStr ? paramsStr.split(',').map(p => p.trim()).filter(Boolean) : [];
        const commentRaw = extractTagValue(`<event>${match[1]}</event>`, 'comment');
        result.push({
            name: eventName,
            params,
            rawEvent: raw,
            doc: commentRaw ? formatDocToMarkdown(commentRaw) : undefined,
        });
    }
    return result;
}
function main() {
    const args = process.argv.slice(2);
    const dumpAll = args.includes('--dump');
    const verbose = args.includes('--verbose');
    const libDir = path.join(__dirname, '..', '..', 'Understanding', 'b4a-Libraries');
    if (!fs.existsSync(libDir)) {
        console.error(`Library directory not found: ${libDir}`);
        process.exit(1);
    }
    const xmlFiles = fs.readdirSync(libDir)
        .filter(f => f.toLowerCase().endsWith('.xml'))
        .map(f => path.join(libDir, f));
    console.log(`\n=== XML Library Validation Test ===`);
    console.log(`Found ${xmlFiles.length} XML files in ${libDir}\n`);
    const reports = [];
    let totalErrors = 0;
    let totalClasses = 0;
    let totalMethods = 0;
    let totalProperties = 0;
    let totalFields = 0;
    let totalEvents = 0;
    for (const xmlFile of xmlFiles) {
        const content = fs.readFileSync(xmlFile, 'utf8');
        const errors = [];
        try {
            const classes = parseXmlLibraryText(content, xmlFile);
            // Validate each class
            for (const cls of classes) {
                if (!cls.name)
                    errors.push(`Class has no name`);
                if (cls.methods.some(m => !m.name))
                    errors.push(`Class '${cls.name}' has method with no name`);
                if (cls.properties.some(p => !p.name))
                    errors.push(`Class '${cls.name}' has property with no name`);
                if (cls.fields.some(f => !f.name))
                    errors.push(`Class '${cls.name}' has field with no name`);
                if (cls.events.some(e => !e.name))
                    errors.push(`Class '${cls.name}' has event with no name`);
            }
            const stats = {
                totalClasses: classes.length,
                totalMethods: classes.reduce((sum, c) => sum + c.methods.length, 0),
                totalProperties: classes.reduce((sum, c) => sum + c.properties.length, 0),
                totalFields: classes.reduce((sum, c) => sum + c.fields.length, 0),
                totalEvents: classes.reduce((sum, c) => sum + c.events.length, 0),
                classesWithDocs: classes.filter(c => c.doc).length,
                classesWithEvents: classes.filter(c => c.events.length > 0).length,
                classesWithFields: classes.filter(c => c.fields.length > 0).length,
            };
            reports.push({ file: xmlFile, classes, errors, stats });
            totalClasses += stats.totalClasses;
            totalMethods += stats.totalMethods;
            totalProperties += stats.totalProperties;
            totalFields += stats.totalFields;
            totalEvents += stats.totalEvents;
            totalErrors += errors.length;
            if (verbose) {
                console.log(`📄 ${path.basename(xmlFile)}`);
                console.log(`   Classes: ${stats.totalClasses} | Methods: ${stats.totalMethods} | Props: ${stats.totalProperties} | Fields: ${stats.totalFields} | Events: ${stats.totalEvents}`);
                console.log(`   Classes with docs: ${stats.classesWithDocs} | Events: ${stats.classesWithEvents} | Fields: ${stats.classesWithFields}`);
                if (errors.length > 0) {
                    for (const err of errors)
                        console.log(`   ❌ ${err}`);
                }
                else {
                    console.log(`   ✅ OK`);
                }
                console.log();
            }
        }
        catch (err) {
            errors.push(`Parse error: ${err.message}`);
            reports.push({ file: xmlFile, classes: [], errors, stats: { totalClasses: 0, totalMethods: 0, totalProperties: 0, totalFields: 0, totalEvents: 0, classesWithDocs: 0, classesWithEvents: 0, classesWithFields: 0 } });
            totalErrors++;
            console.log(`❌ ${path.basename(xmlFile)}: ${err.message}`);
        }
    }
    // Summary
    console.log(`\n=== SUMMARY ===`);
    console.log(`Files parsed:    ${xmlFiles.length}`);
    console.log(`Total classes:   ${totalClasses}`);
    console.log(`Total methods:   ${totalMethods}`);
    console.log(`Total properties: ${totalProperties}`);
    console.log(`Total fields:    ${totalFields}`);
    console.log(`Total events:    ${totalEvents}`);
    console.log(`Files with errors: ${reports.filter(r => r.errors.length > 0).length}`);
    console.log(`Total errors:    ${totalErrors}`);
    if (totalErrors === 0) {
        console.log(`\n✅ ALL ${xmlFiles.length} XML FILES PARSED SUCCESSFULLY`);
    }
    else {
        console.log(`\n❌ ${totalErrors} ERROR(S) FOUND`);
        for (const r of reports) {
            if (r.errors.length > 0) {
                console.log(`\n${r.file}:`);
                for (const err of r.errors)
                    console.log(`  - ${err}`);
            }
        }
    }
    // Full dump
    if (dumpAll) {
        const dumpPath = path.join(__dirname, '..', '..', 'logs', 'xml-libraries-dump.json');
        const dumpDir = path.dirname(dumpPath);
        if (!fs.existsSync(dumpDir))
            fs.mkdirSync(dumpDir, { recursive: true });
        const dumpData = {
            generatedAt: new Date().toISOString(),
            totalFiles: reports.length,
            totalClasses,
            totalMethods,
            totalProperties,
            totalFields,
            totalEvents,
            files: reports.map(r => ({
                file: path.basename(r.file),
                classes: r.classes.map(c => ({
                    name: c.name,
                    doc: c.doc ? c.doc.substring(0, 100) : undefined,
                    methods: c.methods.map(m => ({ name: m.name, signature: m.signature, hasDoc: !!m.doc })),
                    properties: c.properties.map(p => ({ name: p.name, signature: p.signature, hasDoc: !!p.doc })),
                    fields: c.fields.map(f => ({ name: f.name, signature: f.signature, hasDoc: !!f.doc })),
                    events: c.events.map(e => ({ name: e.name, params: e.params, hasDoc: !!e.doc })),
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

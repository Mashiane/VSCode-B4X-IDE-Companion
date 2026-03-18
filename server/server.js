#!/usr/bin/env node
// LSP server for B4X IntelliSense (cleaned, with logging and persistence hooks)
try {
  const { createConnection, TextDocuments, ProposedFeatures } = require('vscode-languageserver');
  const { DocumentManager } = require('./indexer/documentManager');
  const { WorkerPool } = require('./indexer/workerPool');
  const logger = require('./logger');

  const docManager = new DocumentManager();
  const workerPool = new WorkerPool();
  let workspaceRoot = null;

  let connection;
  try {
    connection = createConnection(ProposedFeatures.all);
  } catch (e) {
    try {
      connection = createConnection(process.stdin, process.stdout, ProposedFeatures.all);
    } catch (e2) {
      throw e;
    }
  }
  const documents = new TextDocuments();

  connection.onInitialize((params) => {
    try {
      const root = (params && (params.rootPath || params.rootUri)) || null;
      workspaceRoot = root;
      logger.info('initialize', { root });
      try { docManager.loadFromDisk(root); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    return {
      capabilities: {
        textDocumentSync: documents.syncKind,
        completionProvider: { resolveProvider: false },
        hoverProvider: true,
        definitionProvider: true,
        documentFormattingProvider: false,
        semanticTokensProvider: {
          legend: { tokenTypes: [], tokenModifiers: [] },
          range: false,
          full: false,
        },
      },
    };
  });

  documents.onDidChangeContent((change) => {
    try {
      docManager.changeDocument(change.document.uri, change.document.getText());
    } catch (err) { /* ignore indexing errors */ }
  });

  documents.onDidOpen((change) => {
    try { docManager.openDocument(change.document.uri, change.document.getText()); } catch (err) { }
  });

  documents.onDidClose((change) => {
    try { docManager.closeDocument(change.document.uri); } catch (err) { }
  });

  documents.onDidSave((change) => {
    try {
      const text = change.document.getText();
      const uri = change.document.uri;
      workerPool.queueParse(uri, text).then((res) => {
        if (res && res.symbols) {
          try {
            docManager.setSymbolsForUri(uri, res.symbols);
            try { docManager.saveSnapshot(workspaceRoot, [uri]); } catch (_) { }
          } catch (e) { }
        }
      }).catch(() => {});
    } catch (err) { }
  });

  connection.onCompletion(async (textDocumentPosition, token) => {
    const start = Date.now();
    try {
      if (token && token.isCancellationRequested) {
        logger.info('completion.cancelled', { uri: textDocumentPosition && textDocumentPosition.textDocument && textDocumentPosition.textDocument.uri });
        return [];
      }
      const prefix = '';
      const raw = docManager.getCompletions(prefix) || [];
      const items = raw.slice(0, 100).map((s) => ({
        label: s.name,
        kind: 3,
        detail: `${s.kind} — ${s.file}:${s.line + 1}`,
        data: { file: s.file, line: s.line },
      }));
      logger.info('completion', { durationMs: Date.now() - start, resultCount: items.length });
      return items;
    } catch (err) {
      logger.error('completion.error', { error: err && (err.stack || err.message) });
      return [];
    }
  });

  connection.onHover(async (params, token) => {
    const start = Date.now();
    try {
      if (token && token.isCancellationRequested) {
        logger.info('hover.cancelled', { uri: params && params.textDocument && params.textDocument.uri });
        return { contents: { kind: 'plaintext', value: 'Cancelled' } };
      }
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return { contents: { kind: 'plaintext', value: 'LSP scaffold running.' } };
      const dmEntry = docManager.docs.get(params.textDocument.uri);
      const text = dmEntry ? dmEntry.text : doc.getText();
      const lines = text.split(/\r?\n/);
      const line = lines[params.position.line] || '';
      const ch = params.position.character;
      let startIdx = ch;
      while (startIdx > 0 && /[A-Za-z0-9_]/.test(line.charAt(startIdx - 1))) startIdx--;
      let end = ch;
      while (end < line.length && /[A-Za-z0-9_]/.test(line.charAt(end))) end++;
      const word = line.substring(startIdx, end);
      if (!word) return { contents: { kind: 'plaintext', value: 'LSP scaffold running.' } };
      const def = docManager.findDefinition(word);
      if (def) {
        const fs = require('fs');
        let snippet = '';
        try {
          const content = fs.readFileSync(def.file, 'utf8');
          const defLines = content.split(/\r?\n/);
          const from = Math.max(0, def.line - 2);
          const to = Math.min(defLines.length - 1, def.line + 2);
          snippet = defLines.slice(from, to + 1).join('\n');
        } catch (err) {
          snippet = `${def.name} (${def.file}:${def.line + 1})`;
        }
        logger.info('hover', { uri: params.textDocument.uri, word, durationMs: Date.now() - start });
        return { contents: { kind: 'markdown', value: '```\n' + snippet + '\n```' } };
      }
      logger.info('hover.miss', { uri: params.textDocument.uri, word, durationMs: Date.now() - start });
      return { contents: { kind: 'plaintext', value: 'LSP scaffold running.' } };
    } catch (err) {
      logger.error('hover.error', { error: err && (err.stack || err.message) });
      return { contents: { kind: 'plaintext', value: 'LSP scaffold running.' } };
    }
  });

  connection.onDefinition(async (params, token) => {
    try {
      if (token && token.isCancellationRequested) {
        logger.info('definition.cancelled', { uri: params && params.textDocument && params.textDocument.uri });
        return null;
      }
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const dmEntry = docManager.docs.get(params.textDocument.uri);
      const text = dmEntry ? dmEntry.text : doc.getText();
      const lines = text.split(/\r?\n/);
      const line = lines[params.position.line] || '';
      const ch = params.position.character;
      let start = ch;
      while (start > 0 && /[A-Za-z0-9_]/.test(line.charAt(start - 1))) start--;
      let end = ch;
      while (end < line.length && /[A-Za-z0-9_]/.test(line.charAt(end))) end++;
      const word = line.substring(start, end);
      if (!word) return null;
      const def = docManager.findDefinition(word);
      if (!def) return null;
      const { pathToFileURL } = require('url');
      const fileUri = pathToFileURL(require('path').resolve(def.file)).toString();
      const nameLen = (def.name || word).length;
      return { uri: fileUri, range: { start: { line: def.line, character: 0 }, end: { line: def.line, character: nameLen } } };
    } catch (err) {
      logger.error('definition.error', { error: err && (err.stack || err.message) });
      return null;
    }
  });

  connection.onRenameRequest((params) => {
    try {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const lines = doc.getText().split(/\r?\n/);
      const line = lines[params.position.line] || '';
      const ch = params.position.character;
      let start = ch; while (start > 0 && /[A-Za-z0-9_]/.test(line.charAt(start - 1))) start--;
      let end = ch; while (end < line.length && /[A-Za-z0-9_]/.test(line.charAt(end))) end++;
      const oldName = line.substring(start, end);
      const newName = params.newName;
      if (!oldName || !newName) return null;
      const def = docManager.findDefinition(oldName);
      if (!def) return null;
      const fs = require('fs');
      const { pathToFileURL } = require('url');
      const pathMod = require('path');
      const candidateFilePaths = new Set();
      for (const [uri, entry] of docManager.docs.entries()) {
        try { const u = new URL(uri); const p = u.pathname.replace(/^\/(.:)/, '$1'); candidateFilePaths.add(pathMod.resolve(p)); } catch (_) { candidateFilePaths.add(pathMod.resolve(uri)); }
      }
      const sameNamed = docManager.global.getByExactName(oldName);
      for (const s of sameNamed) if (s.file) candidateFilePaths.add(pathMod.resolve(s.file));
      if (def.file) { candidateFilePaths.add(pathMod.resolve(def.file)); candidateFilePaths.add(pathMod.resolve(pathMod.dirname(def.file))); }
      const editsByUri = {};
      const wordRegex = new RegExp('\\b' + oldName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
      function isInQuotedString(lineText, matchIndex) { const before = lineText.substring(0, matchIndex); const dq = (before.match(/\"/g) || []).length; const sq = (before.match(/\'/g) || []).length; return ((dq % 2) === 1) || ((sq % 2) === 1); }
      function isCommentLine(lineText, matchIndex) { const idxA = lineText.indexOf("'"); const idxB = lineText.indexOf('//'); const commentIdx = (idxA === -1) ? idxB : (idxB === -1 ? idxA : Math.min(idxA, idxB)); return commentIdx !== -1 && commentIdx < matchIndex; }
      function preserveCase(matched, replacement) { if (matched.toUpperCase() === matched) return replacement.toUpperCase(); if (matched.toLowerCase() === matched) return replacement.toLowerCase(); if (/^[A-Z][a-z]/.test(matched)) return replacement.charAt(0).toUpperCase() + replacement.slice(1); return replacement; }
      for (const filePath of candidateFilePaths) {
        let content; try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
        let match; while ((match = wordRegex.exec(content)) !== null) {
          const offset = match.index;
          const before = content.substring(0, offset);
          const startPos = (() => { const lines = before.split(/\r?\n/); const ln = lines.length - 1; const chPos = lines[lines.length - 1].length; return { line: ln, character: chPos }; })();
          const endPos = (() => { const beforeMatch = content.substring(0, offset + match[0].length); const lines = beforeMatch.split(/\r?\n/); const ln = lines.length - 1; const chPos = lines[lines.length - 1].length; return { line: ln, character: chPos }; })();
          const fileLines = content.split(/\r?\n/);
          const lineText = fileLines[startPos.line] || '';
          if (isInQuotedString(lineText, startPos.character) || isCommentLine(lineText, startPos.character)) continue;
          const fileUri = pathToFileURL(filePath).toString(); if (!editsByUri[fileUri]) editsByUri[fileUri] = [];
          editsByUri[fileUri].push({ range: { start: startPos, end: endPos }, newText: preserveCase(match[0], newName) });
        }
      }
      if (Object.keys(editsByUri).length === 0) return null;
      return { changes: editsByUri };
    } catch (err) { return null; }
  });

  connection.onRequest('b4x/extractMethod', async (params, token) => {
    try {
      if (token && token.isCancellationRequested) { logger.info('extractMethod.cancelled', { file: params && params.uri }); return { cancelled: true }; }
      const uri = params.uri; const range = params.range; const newName = params.newName || 'ExtractedMethod'; if (!uri || !range) return null;
      const fs = require('fs'); const { URL } = require('url'); const pathMod = require('path');
      let filePath;
      try { const u = new URL(uri); filePath = u.pathname.replace(/^\/(.:)/, '$1'); } catch (_) { filePath = uri; }
      let content; try { content = fs.readFileSync(filePath, 'utf8'); } catch (err) { return null; }
      let paramsToUse = params.params;
      if (!paramsToUse) {
        try {
          const selStart = range.start.line; const selEnd = range.end.line; const lines = content.split(/\r?\n/); const selText = lines.slice(selStart, selEnd + 1).join('\n');
          const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g; const ids = new Set(); let m; while ((m = idRegex.exec(selText)) !== null) ids.add(m[0]);
          const declaredInSelection = new Set(); const selLines = selText.split(/\r?\n/); for (const l of selLines) { const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(l); if (dm) declaredInSelection.add(dm[1]); const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); if (asgn) declaredInSelection.add(asgn[1]); }
          let subStart = 0; for (let i = selStart; i >= 0; i--) { const l = lines[i] || ''; if (/^\s*Sub\b/i.test(l)) { subStart = i; break; } }
          let subEnd = lines.length - 1; for (let i = selEnd; i < lines.length; i++) { const l = lines[i] || ''; if (/^\s*End\s+Sub\b/i.test(l)) { subEnd = i; break; } }
          const declaredOutsideSelection = new Set(); for (let i = subStart; i <= subEnd; i++) { if (i >= selStart && i <= selEnd) continue; const l = lines[i] || ''; const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(l); if (dm) declaredOutsideSelection.add(dm[1]); const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); if (asgn) declaredOutsideSelection.add(asgn[1]); const sig = /^\s*Sub\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/i.exec(l); if (sig && sig[1]) { const parts = sig[1].split(',').map(p => p.trim()).filter(Boolean); for (const p of parts) { const pn = p.split(' ')[0]; if (pn) declaredOutsideSelection.add(pn); } } }
          const globalDeclared = new Set(); for (let i = 0; i < lines.length; i++) { const l = lines[i] || ''; if (/^\s*Sub\s+Class_/i.test(l) || /^\s*Sub\s+Process_Globals/i.test(l)) { for (let j = i + 1; j < lines.length; j++) { const lj = lines[j] || ''; const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(lj); if (dm) globalDeclared.add(dm[1]); if (/^\s*End\s+Sub\b/i.test(lj)) { break; } } } }
          const candidateParams = [...ids].filter((id) => !declaredInSelection.has(id) && !/^Sub$|^End$|^Type$|^End Type$|^End Sub$/i.test(id));
          const candidatesFiltered = candidateParams.filter((id) => {
            if (declaredOutsideSelection.has(id)) return true; if (globalDeclared.has(id)) return true; const before = lines.slice(subStart, selStart).join('\n'); const after = lines.slice(selEnd + 1, subEnd + 1).join('\n'); const regex = new RegExp('\\b' + id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i'); if (regex.test(before) || regex.test(after)) return true; return false;
          });
          const keywords = new Set(['If','Then','Else','For','Next','Do','Loop','While','End','Sub','Type','Return','Select']);
          const filtered = candidatesFiltered.filter((id) => id.length > 1 && !keywords.has(id));
          const scored = filtered.map((id) => { let score = 0; if (declaredOutsideSelection.has(id)) score += 20; const beforeText = lines.slice(subStart, selStart).join('\n'); const afterText = lines.slice(selEnd + 1, subEnd + 1).join('\n'); const idRegexEsc = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); const nearBefore = new RegExp('\\b' + idRegexEsc + '\\b', 'i').test(beforeText); const nearAfter = new RegExp('\\b' + idRegexEsc + '\\b', 'i').test(afterText); if (nearBefore) score += 10; if (nearAfter) score += 8; if (globalDeclared.has(id)) score -= 5; return { id, score }; });
          scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          paramsToUse = scored.filter(s => s.score > 0).map(s => s.id);
        } catch (e) { paramsToUse = []; }
      }
      const { createExtractMethodEdit } = require('./indexer/extractMethod');
      const edit = createExtractMethodEdit(filePath, range, newName, content, paramsToUse);
      logger.info('extractMethod', { file: filePath });
      return edit;
    } catch (err) { logger.error('extractMethod.error', { error: err && (err.stack || err.message) }); return null; }
  });

  function publishDiagnosticsForUri(uri) {
    try {
      const entry = docManager.docs.get(uri);
      if (!entry) return;
      const diagnostics = [];
      const symbols = entry.symbols || [];
      for (const s of symbols) {
        const others = docManager.global.getByExactName(s.name).filter((o) => o.file !== s.file);
        if (others.length > 0) diagnostics.push({ severity: 2, range: { start: { line: s.line, character: 0 }, end: { line: s.line, character: 200 } }, message: `Symbol '${s.name}' is also defined in other files (${others.map((o) => o.file).join(', ')})`, source: 'b4x-lsp' });
      }
      for (const s of symbols.filter((x) => x.kind === 'type')) {
        const lines = (entry.text || '').split(/\r?\n/);
        const startLine = Math.max(0, s.line - 6);
        let found = false;
        for (let i = startLine; i < s.line; i++) { const l = lines[i] || ''; if (/^\s*Sub\s+Class_/i.test(l) || /^\s*Sub\s+Process_Globals/i.test(l)) { found = true; break; } }
        if (!found) diagnostics.push({ severity: 1, range: { start: { line: s.line, character: 0 }, end: { line: s.line, character: 200 } }, message: `Type '${s.name}' appears outside Class_Globals/Process_Globals (heuristic)`, source: 'b4x-lsp' });
      }
      connection.sendDiagnostics({ uri, diagnostics });
    } catch (err) { }
  }

  documents.onDidChangeContent((change) => { publishDiagnosticsForUri(change.document.uri); });
  documents.onDidOpen((change) => { publishDiagnosticsForUri(change.document.uri); });
  documents.onDidSave((change) => { publishDiagnosticsForUri(change.document.uri); });

  documents.listen(connection);
  connection.listen();
  console.log('LSP server started (stdio)');
} catch (err) {
  console.error('Failed to start LSP server. Missing dependency `vscode-languageserver`?');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

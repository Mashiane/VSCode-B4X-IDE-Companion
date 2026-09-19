#!/usr/bin/env node
// LSP server for B4X IntelliSense (cleaned, with logging and persistence hooks)
try {
  const { createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind } = require('vscode-languageserver');
  const { TextDocument } = require('vscode-languageserver-textdocument');
  const { DocumentManager } = require('./indexer/documentManager');
  const { WorkerPool } = require('./indexer/workerPool');
  const logger = require('./logger');
  const fs = require('fs');
  const pathMod = require('path');
  const { pathToFileURL } = require('url');

  const docManager = new DocumentManager();
  const workerPool = new WorkerPool();
  let workspaceRoot = null;
  let parseSequence = 0; // monotonic counter to discard stale worker results

  /**
   * Convert a file:// URI to a platform-native file path.
   * Handles Windows drive letters (/C:/... -> C:/...) and Unix paths uniformly.
   */
  function uriToFilePath(uri) {
    if (!uri.startsWith('file://')) return uri;
    try {
      const { pathToFileURL } = require('url');
      const decoded = decodeURIComponent(new URL(uri).pathname);
      // Strip leading slash for Windows paths like /C:/...
      return decoded.replace(/^\/([A-Za-z]:)/, '$1');
    } catch {
      return uri.replace('file://', '');
    }
  }

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
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((params) => {
    try {
      // Prefer explicit projectRoot from initializationOptions (set by the
      // extension from lastOpenedProjectFile). This ensures the server indexes
      // the correct B4X project directory even when the workspace folders
      // don't include it (e.g. autoOpenProjectFolderOnOpen = false).
      const root = (params && params.initializationOptions && params.initializationOptions.projectRoot)
        || (params && (params.rootPath || params.rootUri))
        || null;
      workspaceRoot = root;
      logger.info('initialize', { root, source: (params && params.initializationOptions && params.initializationOptions.projectRoot) ? 'initializationOptions' : 'workspace' });
      // Start async disk load without blocking init response. Pass the
      // language-server connection so the indexer can notify the client
      // about progress (start/progress/done).
      docManager.loadFromDisk(root, connection, workerPool).catch((e) => {
        logger.error('loadFromDisk.error', { error: e && (e.stack || e.message) });
        // Notify the client that indexing failed so the user can see something is wrong
        try {
          if (connection && typeof connection.sendNotification === 'function') {
            connection.sendNotification('b4x/indexingFailed', { error: e && (e.message || String(e)) });
          }
        } catch (_) {}
      });
    } catch (e) { logger.error('onInitialize.error', { error: e && (e.stack || e.message) }); }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: { resolveProvider: false },
        hoverProvider: true,
        definitionProvider: true,
        renameProvider: { prepareProvider: true },
      },
    };
  });

  // Document lifecycle handlers: indexing + diagnostics.
  // With Full sync, onDidOpen fires then onDidChangeContent fires immediately with the same text.
  // openDocument checks if already tracked to avoid redundant parsing.
  documents.onDidChangeContent((change) => {
    // If this file was previously blacklisted due to a worker crash, clear
    // the blacklist entry so the file can be re-indexed on the next save.
    try { workerPool.clearFailedFile(change.document.uri); } catch (_) {}
    try { docManager.changeDocument(change.document.uri, change.document.getText()); } catch (err) { logger.error('onDidChangeContent.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
    try { publishDiagnosticsForUri(change.document.uri); } catch (err) { logger.error('onDidChangeContent.diagnostics.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
  });

  documents.onDidOpen((change) => {
    // Skip if already indexed by onDidChangeContent to avoid double-parsing
    if (docManager.docs.has(change.document.uri)) return;
    try { docManager.openDocument(change.document.uri, change.document.getText()); } catch (err) { logger.error('onDidOpen.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
    try { publishDiagnosticsForUri(change.document.uri); } catch (err) { logger.error('onDidOpen.diagnostics.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
  });

  documents.onDidClose((change) => {
    try { docManager.closeDocument(change.document.uri); } catch (err) { logger.error('onDidClose.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
  });

  documents.onDidSave((change) => {
    try {
      const text = change.document.getText();
      const uri = change.document.uri;
      const seq = ++parseSequence; // capture current sequence
      workerPool.queueParse(uri, text).then((res) => {
        if (res && res.symbols) {
          // Discard stale results: only apply if no newer save has occurred
          if (seq >= parseSequence) {
            try {
              docManager.setSymbolsForUri(uri, res.symbols);
            } catch (e) { logger.error('onDidSave.setSymbols.error', { uri, error: e && (e.stack || e.message) }); }
          }
        }
      }).catch((err) => { logger.error('onDidSave.queueParse.error', { uri, error: err && (err.stack || err.message) }); });
    } catch (err) { logger.error('onDidSave.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
    try { publishDiagnosticsForUri(change.document.uri); } catch (err) { logger.error('onDidSave.diagnostics.error', { uri: change.document.uri, error: err && (err.stack || err.message) }); }
  });

  connection.onCompletion(async (textDocumentPosition, token) => {
    const start = Date.now();
    try {
      if (token && token.isCancellationRequested) {
        logger.info('completion.cancelled', { uri: textDocumentPosition && textDocumentPosition.textDocument && textDocumentPosition.textDocument.uri });
        return [];
      }
      // Extract word at cursor position for contextual completions
      const doc = documents.get(textDocumentPosition.textDocument.uri);
      let prefix = '';
      if (doc) {
        const lines = doc.getText().split(/\r?\n/);
        const line = lines[textDocumentPosition.position.line] || '';
        const ch = textDocumentPosition.position.character;
        let startIdx = ch;
        while (startIdx > 0 && /[A-Za-z0-9_]/.test(line.charAt(startIdx - 1))) startIdx--;
        prefix = line.substring(startIdx, ch);
      }
      const raw = docManager.getCompletions(prefix) || [];
      const items = raw.slice(0, 100).map((s) => ({
        label: s.name,
        kind: 3,
        detail: `${s.kind} â€” ${s.file}:${s.line + 1}`,
        data: { file: s.file, line: s.line },
      }));
      logger.info('completion', { durationMs: Date.now() - start, resultCount: items.length, prefix });
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
        let snippet = '';
        try {
          const content = await fs.promises.readFile(def.file, 'utf8');
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
      const fileUri = pathToFileURL(pathMod.resolve(def.file)).toString();
      const nameLen = (def.name || word).length;
      return { uri: fileUri, range: { start: { line: def.line, character: 0 }, end: { line: def.line, character: nameLen } } };
    } catch (err) {
      logger.error('definition.error', { error: err && (err.stack || err.message) });
      return null;
    }
  });

  connection.onRenameRequest(async (params, token) => {
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
      const candidateFilePaths = new Set();
      for (const [uri, entry] of docManager.docs.entries()) {
        try {
          const p = uriToFilePath(uri);
          if (p) candidateFilePaths.add(pathMod.resolve(p));
        } catch (_) { candidateFilePaths.add(pathMod.resolve(uri)); }
      }
      const sameNamed = docManager.global.getByExactName(oldName);
      for (const s of sameNamed) if (s.file) candidateFilePaths.add(pathMod.resolve(s.file));
      if (def.file) { candidateFilePaths.add(pathMod.resolve(def.file)); candidateFilePaths.add(pathMod.resolve(pathMod.dirname(def.file))); }
      const editsByUri = {};
      const escapedName = oldName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      function isInQuotedString(lineText, matchIndex) { const before = lineText.substring(0, matchIndex); let dq = 0; for (let i = 0; i < before.length; i++) { if (before[i] === '"') { if (i + 1 < before.length && before[i + 1] === '"') { i++; } else { dq++; } } } const sq = (before.match(/'/g) || []).length; return (dq % 2 === 1) || (sq % 2 === 1); }
      function isCommentLine(lineText, matchIndex) { const idxA = lineText.indexOf("'"); const idxB = lineText.indexOf('//'); const commentIdx = (idxA === -1) ? idxB : (idxB === -1 ? idxA : Math.min(idxA, idxB)); return commentIdx !== -1 && commentIdx < matchIndex; }
      function preserveCase(matched, replacement) { if (matched.toUpperCase() === matched) return replacement.toUpperCase(); if (matched.toLowerCase() === matched) return replacement.toLowerCase(); if (/^[A-Z][a-z]/.test(matched)) return replacement.charAt(0).toUpperCase() + replacement.slice(1); return replacement; }

      // Process files with bounded concurrency to avoid overwhelming memory
      const CONCURRENCY = 4;
      const filePaths = [...candidateFilePaths];
      let fileIndex = 0;
      async function processNextFile() {
        while (true) {
          if (token && token.isCancellationRequested) return;
          const idx = fileIndex++;
          if (idx >= filePaths.length) return;
          const filePath = filePaths[idx];
          let content; try { content = await fs.promises.readFile(filePath, 'utf8'); } catch (_) { continue; }
          // Create a fresh regex per file to avoid lastIndex state issues
          const wordRegex = new RegExp('\\b' + escapedName + '\\b', 'gi');
          let match; while ((match = wordRegex.exec(content)) !== null) {
            const offset = match.index;
            const before = content.substring(0, offset);
            const startPos = (() => { const beforeLines = before.split(/\r?\n/); const ln = beforeLines.length - 1; const chPos = beforeLines[beforeLines.length - 1].length; return { line: ln, character: chPos }; })();
            const endPos = (() => { const beforeMatch = content.substring(0, offset + match[0].length); const bmLines = beforeMatch.split(/\r?\n/); const ln = bmLines.length - 1; const chPos = bmLines[bmLines.length - 1].length; return { line: ln, character: chPos }; })();
            const fileLines = content.split(/\r?\n/);
            const lineText = fileLines[startPos.line] || '';
            if (isInQuotedString(lineText, startPos.character) || isCommentLine(lineText, startPos.character)) continue;
            const fileUri = pathToFileURL(filePath).toString(); if (!editsByUri[fileUri]) editsByUri[fileUri] = [];
            editsByUri[fileUri].push({ range: { start: startPos, end: endPos }, newText: preserveCase(match[0], newName) });
          }
        }
      }
      // Launch CONCURRENCY workers that share the fileIndex counter
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, () => processNextFile()));
      if (token && token.isCancellationRequested) return null;
      if (Object.keys(editsByUri).length === 0) return null;
      return { changes: editsByUri };
    } catch (err) {
      logger.error('rename.error', { error: err && (err.stack || err.message) });
      return null;
    }
  });

  connection.onRequest('b4x/extractMethod', async (params, token) => {
    try {
      if (token && token.isCancellationRequested) { logger.info('extractMethod.cancelled', { file: params && params.uri }); return { cancelled: true }; }
      const uri = params.uri; const range = params.range; const newName = params.newName || 'ExtractedMethod'; if (!uri || !range) return null;
      const fs = require('fs'); const pathMod = require('path');
      const filePath = uriToFilePath(uri) || uri;
      let content; try { content = await fs.promises.readFile(filePath, 'utf8'); } catch (err) { return null; }
      let paramsToUse = params.params;
      if (!paramsToUse) {
        try {
          const selStart = range.start.line; const selEnd = range.end.line; const lines = content.split(/\r?\n/); const selText = lines.slice(selStart, selEnd + 1).join('\n');
          const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g; const ids = new Set(); let m; while ((m = idRegex.exec(selText)) !== null) ids.add(m[0]);
          const declaredInSelection = new Set(); const selLines = selText.split(/\r?\n/); for (const l of selLines) { const dimMatch = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(l); if (dimMatch) { for (const seg of dimMatch[1].split(',')) { const name = seg.trim().replace(/\s+As\s+.+$/i, '').replace(/\s*=.+$/, '').trim(); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) declaredInSelection.add(name); } } const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); if (asgn) declaredInSelection.add(asgn[1]); }
          let subStart = 0; for (let i = selStart; i >= 0; i--) { const l = lines[i] || ''; if (/^\s*Sub\b/i.test(l)) { subStart = i; break; } }
          let subEnd = lines.length - 1; for (let i = selEnd; i < lines.length; i++) { const l = lines[i] || ''; if (/^\s*End\s+Sub\b/i.test(l)) { subEnd = i; break; } }
          const declaredOutsideSelection = new Set(); for (let i = subStart; i <= subEnd; i++) { if (i >= selStart && i <= selEnd) continue; const l = lines[i] || ''; const dimMatch = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(l); if (dimMatch) { for (const seg of dimMatch[1].split(',')) { const name = seg.trim().replace(/\s+As\s+.+$/i, '').replace(/\s*=.+$/, '').trim(); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) declaredOutsideSelection.add(name); } } const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); if (asgn) declaredOutsideSelection.add(asgn[1]); const sig = /^\s*Sub\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/i.exec(l); if (sig && sig[1]) { const parts = sig[1].split(',').map(p => p.trim()).filter(Boolean); for (const p of parts) { const pn = p.split(' ')[0]; if (pn) declaredOutsideSelection.add(pn); } } }
          const globalDeclared = new Set(); for (let i = 0; i < lines.length; i++) { const l = lines[i] || ''; if (/^\s*Sub\s+Class_/i.test(l) || /^\s*Sub\s+Process_Globals/i.test(l)) { for (let j = i + 1; j < lines.length; j++) { const lj = lines[j] || ''; const dimMatch = /^\s*(?:Dim|Private|Public)\s+(.+)$/i.exec(lj); if (dimMatch) { for (const seg of dimMatch[1].split(',')) { const name = seg.trim().replace(/\s+As\s+.+$/i, '').replace(/\s*=.+$/, '').trim(); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) globalDeclared.add(name); } } if (/^\s*End\s+Sub\b/i.test(lj)) { break; } } } }
          const candidateParams = [...ids].filter((id) => !declaredInSelection.has(id) && !/^Sub$|^End$|^Type$|^End Sub$/i.test(id));
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
        const B4A_STANDARD_SUBS = new Set(["process_globals","globals","class_globals","initialize","activity_create","activity_resume","activity_pause","activity_click","activity_longclick","activity_touch","activity_keypress","activity_keyup","activity_windowfocuschanged","activity_actionbarhomeclick","activity_permissionresult","activity_permissonresult","ime_heightchanged","create_menu","service_create","service_start","service_destroy","msgbox_result","inputlist_result","inputmap_result","b4xpage_created","b4xpage_appear","b4xpage_disappear","b4xpage_resize","b4xpage_closerequest","b4xpage_backkeypressed","b4xpage_keyboardstatechanged","b4xpage_permissionresult","b4xpage_menuclick","b4xpage_foreground","b4xpage_background","b4xpage_iconifiedchanged","mainform_closerequest","mainform_closed","mainform_focuschanged","mainform_iconifiedchanged","mainform_resize","b4ipage_appear","b4ipage_disappear","b4ipage_resize","b4ipage_barbuttonclick","b4ipage_keyboardstatechanged","application_start"]);
      const symNameLower = (s.name || '').toLowerCase();
      if (B4A_STANDARD_SUBS.has(symNameLower) || symNameLower.startsWith('b4xpage_')) {
        continue;
      }
      }
      for (const s of symbols.filter((x) => x.kind === 'type')) {
        const lines = (entry.text || '').split(/\r?\n/);
        const startLine = Math.max(0, s.line - 6);
        let found = false;
        for (let i = startLine; i < s.line; i++) { const l = lines[i] || ''; if (/^\s*Sub\s+Class_/i.test(l) || /^\s*Sub\s+Process_Globals/i.test(l)) { found = true; break; } }
        if (!found) {
          const lineLen = (lines[s.line] || '').length || 1;
          diagnostics.push({ severity: 1, range: { start: { line: s.line, character: 0 }, end: { line: s.line, character: lineLen } }, message: `Type '${s.name}' appears outside Class_Globals/Process_Globals (heuristic)`, source: 'b4x-lsp' });
        }
      }
      connection.sendDiagnostics({ uri, diagnostics });
    } catch (err) { }
  }

  documents.listen(connection);
  let shutdownRequested = false;
  connection.onShutdown(async () => {
    shutdownRequested = true;
    logger.info('shutdown', {});
    try {
      await docManager.saveSnapshot(workspaceRoot);
      workerPool.dispose();
    } catch (_) { /* ignore */ }
    return Promise.resolve();
  });
  connection.onExit(() => {
    logger.info('exit', { shutdownRequested });
    process.exit(0);
  });
  connection.listen();
  // LSP server started - silent for production
} catch (err) {
  // Failed to start LSP server â€” log the error before exiting so the
  // client-side can at least see what went wrong in developer tools.
  process.stderr.write('B4X LSP server failed to start: ' + (err && (err.stack || err.message || String(err))) + '\n');
  process.exit(1);
}


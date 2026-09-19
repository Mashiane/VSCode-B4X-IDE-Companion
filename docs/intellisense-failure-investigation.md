# IntelliSense Failure Investigation Report

**Date:** 2026-05-29  
**Branch:** `audit-decomposition`  
**Version:** 0.1.345  
**Investigated By:** Claude Code (glm-5.1:cloud) — multi-agent systematic debugging  
**Investigation Agents:**
- Agent 1: Activation & LSP Startup Trace
- Agent 2: Completion Pipeline Trace
- Agent 3: Indexing & Worker Pool Trace

**Method:** Systematic debugging Phase 1 (Root Cause Investigation) across three parallel traces using `sp-ecc:systematic-debugging` skill. No changes were applied — findings only.

---

## 🔴 CRITICAL — Causes "IntelliSense not working at all"

| # | Finding | Source | Symptom | Likelihood |
|---|---------|--------|---------|------------|
| **C1** | **LSP server never started on auto-reload** | `extension.ts:3924` | After VS Code restart with a previously opened B4X project, the auto-reload path calls `reloadPlatformAssets()` but does **NOT** call `startLanguageClient()`. The LSP server-side features (diagnostics, rename, extract method, server-side definitions) are completely dead. | **HIGH** — every user who restarts VS Code |
| **C2** | **LSP server crash exits silently with code 1** | `server/server.js:359-362` | Entire server body wrapped in single try/catch → `process.exit(1)` with **no logging, no error output, no notification**. If any `require()` fails or module has a syntax error, zero diagnostic output. | **MEDIUM** |
| **C3** | **loadFromDisk failure invisible to user** | `server/server.js:54-56` | If initial workspace indexing fails, error is only logged to file. `initialize` response already sent — client thinks server is ready. **Zero completions from LSP with no indication.** | **MEDIUM-HIGH** |

### C1 — LSP server never started on auto-reload (Detail)

The activation chain at `extension.ts` has two paths for loading a B4X project:

1. **Explicit path** (`openB4xProject` command, line ~2282): Calls `startLanguageClient()` ✅
2. **Auto-reload path** (line ~3890-3931): Calls `reloadPlatformAssets()` but **does NOT call** `startLanguageClient()` ❌

This means after a VS Code restart with a previously opened B4X project, the extension shows "Ready" but:
- No server-side diagnostics
- No server-side rename
- No extract method
- No server-side go-to-definition
- The LSP channel is entirely dead

**Recommended fix:** Add `startLanguageClient()` call to the auto-reload path, mirroring the logic at lines 2268-2318.

### C2 — LSP server crash is completely silent (Detail)

```javascript
// server/server.js:359-362
} catch (err) {
  /* Failed to start LSP server - silently exit */
  process.exit(1);
}
```

If ANY `require()` fails (`vscode-languageserver`, `documentManager`, `workerPool`, `logger`) or any top-level construction throws, the server exits with code 1 and **no error message**. The client sees the process terminate but has no information about why.

**Recommended fix:** Log the error before exiting:
```javascript
process.stderr.write('B4X LSP server failed: ' + (err && err.stack || err) + '\n');
process.exit(1);
```

### C3 — loadFromDisk failure invisible (Detail)

```javascript
// server/server.js:54-56
docManager.loadFromDisk(root, connection, workerPool).catch((e) => {
  logger.error('loadFromDisk.error', { error: e && (e.stack || e.message) });
});
```

The `onInitialize` handler starts `loadFromDisk()` asynchronously but immediately returns capabilities. If indexing fails, the error is logged to a file but **no notification is sent to the VS Code client**. The client thinks the server is ready, but the symbol table is empty.

---

## 🟠 HIGH — Causes degraded or missing IntelliSense

| # | Finding | Source | Symptom | Likelihood |
|---|---------|--------|---------|------------|
| **H1** | **O(n) full-document re-scan × 3-4 on every dot-completion** | `b4xTypeInference.ts:11-52`, `b4xLocalSymbols.ts:24-50` | Every dot-triggered completion calls `inferVariableTypes`, `collectLocalTypeDefinitions`, and `collectLocalSymbols` — **3-4 full scans per keystroke**. On large files (1000+ lines), causes noticeable lag. | **HIGH** |
| **H2** | **Worker crash permanently blacklists files for the session** | `workerPool.js:66-68` | A file that causes a worker crash once is added to `failedFiles` and **never retried**. Even if the user edits the file to fix the issue, it stays blacklisted until VS Code restart. | **MEDIUM** |
| **H3** | **sql.js fallback causes write amplification + extension host freeze** | `libraryIndexSqlite.ts:252` | Every `INSERT/UPDATE/DELETE` calls `fs.writeFileSync` with a full `db.export()`. With many libraries, this **blocks the extension host thread** and can trigger "Window Unresponsive". | **HIGH** on sql.js path |
| **H4** | **Missing library XML files silently filtered out** | `extension.ts:1539-1540` | If a library XML referenced in the project doesn't exist on disk, it's silently dropped. **No user warning.** Library completions simply absent. | **HIGH** — users frequently have uninstalled library references |
| **H5** | **Dual provider registration creates conflicts** | `extension.ts:3523-3807` + `server.js:107-211` | Both extension-side and LSP-side register Completion, Definition, Hover, Rename. VS Code merges results — can produce **duplicate completions, doubled hovers, or ambiguous definitions**. | **HIGH** — always present when LSP runs |
| **H6** | **All server-side document handlers silently catch errors** | `server/server.js:72-105` | 12+ catch blocks use `/* ignore */`. If `changeDocument` or `openDocument` throws, the document's symbols go stale silently. | **MEDIUM** |
| **H7** | **Worker error events silently ignored** | `workerPool.js:22` | `worker.on('error', (err) => { /* silently handle */ })` — when workers crash, **zero log evidence** explaining why. | **MEDIUM** |
| **H8** | **sql.js silently swallows all SQL errors** | `libraryIndexSqlite.ts:226-254` | Multiple `try { ... } catch { return { changes: 0 }; }` blocks. Library data silently disappears or is never persisted. | **MEDIUM** |

### H1 — O(n) full-document re-scan × 3-4 (Detail)

When a user types a dot for member completion, the completion provider at `extension.ts:4295` calls `inferCompletionOwnerClass`, which internally:

1. Calls `inferVariableTypes` — full scan from `@EndOfDesignText@` onward
2. Calls `collectLocalTypeDefinitions` — another full scan
3. Calls `findOwnerClassFromLocalSymbols` → `collectLocalSymbols` — yet another full scan

If the type cannot be resolved, `inferVariableTypes` is called **again** at line 4300 — a fourth scan.

Each scan iterates every line, calling `stripComment` and `parseTypedNameList`. The 10,000-line scan cap in `getPostDesignStartLine` bounds this, but O(10,000) × 4 per keystroke is significant.

**Recommended fix:** Cache `inferVariableTypes` and `collectLocalSymbols` results per document version, invalidating only when the document changes.

### H2 — Worker crash permanently blacklists files (Detail)

```javascript
// workerPool.js:66-68
if (this.failedFiles.has(uri)) {
  return Promise.reject(new Error(`File previously failed: ${uri}`));
}
```

A file that caused a worker crash once is permanently blacklisted. Even if the user edits the file, the blacklist is never cleared during the session. The `queueParse` rejection prevents re-attempting. The only recovery is restarting VS Code.

**Recommended fix:** Clear the `failedFiles` entry when the file is modified (on `didChange` event), allowing a retry.

### H3 — sql.js write amplification (Detail)

```javascript
// libraryIndexSqlite.ts:252
try { fs.writeFileSync(dbPath, Buffer.from(_db.export())); } catch {}
```

Every mutating SQL statement triggers a full database export to disk. For workspaces with many library files, this causes extreme I/O and blocks the extension host thread since `writeFileSync` is synchronous. This can trigger VS Code's "Window Unresponsive" dialog.

**Recommended fix:** Batch writes using a debounced timer (e.g., write after 500ms of inactivity instead of after every statement).

### H4 — Missing library XML files (Detail)

```javascript
// extension.ts:1539-1540
const existingXml = platformXmlFiles.filter(f => fs.existsSync(f));
const missingXml = platformXmlFiles.filter(f => !fs.existsSync(f));
```

The `missingXml` array is computed but never surfaced to the user. If a B4X platform's Libraries folder is not configured correctly, library completions are silently absent.

**Recommended fix:** Show a warning notification when libraries referenced in the project are missing from disk, listing the missing file names.

---

## 🟡 MEDIUM — Causes subtle or intermittent issues

| # | Finding | Source | Symptom | Likelihood |
|---|---------|--------|---------|------------|
| **M1** | **Server reports readiness before indexing completes** | `server/server.js:46-67` | `loadFromDisk()` is async; `onInitialize` returns capabilities immediately. First few seconds: empty LSP results. | **HIGH** (transient) |
| **M2** | **Snapshot not atomic — corruption on crash** | `documentManager.js:146-148` | Non-atomic `writeFile` → crash produces partial `.b4x-index.json` → silently discarded on next load → full re-index every session. | **MEDIUM** |
| **M3** | **Stale symbols persist after empty parse** | `globalSymbolTable.js:22` | `applyFileSymbols([])` early-returns without removing old entries. Editing a file to produce zero symbols leaves **ghost completions**. | **MEDIUM-HIGH** |
| **M4** | **deactivate() doesn't await LSP shutdown** | `extension.ts:4247-4262` | `client.stop()` returns a Promise but is fire-and-forget'd. Snapshot may not be saved on VS Code exit. | **MEDIUM** |
| **M5** | **getMemberAccessInfo matches dots inside string literals** | `b4xDocParser.ts:103-114` | `"File.Exists"` in a string triggers member completion logic → **wrong suggestions**. | **MEDIUM** |
| **M6** | **CommonClassStore depends on exact "common" class name** | `commonClassStore.ts:27` | If `getClassByName('common')` returns undefined (B4J/B4i projects), bare-word globals like `Log`, `Msgbox` are completely absent from completions. | **MEDIUM** for B4J/B4i |
| **M7** | **collectLocalSymbols dedup hides shadowed variables** | `b4xLocalSymbols.ts:153-160` | `Dim x As Button` inside a Sub that shadows global `Dim x As EditText` → wrong type used for completion. | **MEDIUM** |
| **M8** | **Regex XML parser fails on malformed input** | `xmlLibraryIndex.ts:180-192` | Manual `<class>` depth counting breaks on XML comments/CDATA containing `<class>`. **Missing library methods silently.** | **LOW-MEDIUM** |
| **M9** | **Worker crash → infinite recreate loop with no backoff** | `workerPool.js:24-44` | Systematic worker crash (e.g., syntax error in workerTask) → infinite spawn-crash cycle, high CPU. | **LOW** (production), **HIGH** (dev) |
| **M10** | **SimpleInMemoryDB uses fragile SQL string matching** | `libraryIndexSqlite.ts:35-169` | SQL pattern matching like `t.startsWith('SELECT PARSEDBLOB')`. Any SQL change that doesn't update patterns → operations silently do nothing. | **MEDIUM** |

---

## 🟢 LOW — Minor or unlikely to affect users directly

| # | Finding | Source | Symptom | Likelihood |
|---|---------|--------|---------|------------|
| **L1** | `onStartupFinished` activates in all workspaces | `package.json:893-894` | Extension loads even in non-B4X workspaces, wasting resources. | **HIGH** but low impact |
| **L2** | Log file grows unbounded, never rotated | `server/logger.js:4-6` | `server.log` can reach hundreds of MB. | **HIGH** for long sessions |
| **L3** | Log queue overflow silently drops entries | `server/logger.js:44-49` | Key diagnostic entries may be missing when debugging. | **MEDIUM** |
| **L4** | `PrimitiveTypeStore` key casing breaks multi-word types | `primitiveTypeStore.ts:171-182` | `StringBuilder` → looks up `B4AStringbuilder` instead of `B4AStringBuilder`. | **LOW** |
| **L5** | Untyped Dim invisible to completion | `b4xDocParser.ts:323-353` | `Dim x` (no `As` clause) → no dot-completion. | **HIGH** but expected B4X behavior |
| **L6** | `sendRequest()` callable before LSP client initialized | `lspClient.ts:88-93` | Unhandled promise rejection if extract method called before project opened. | **LOW** |
| **L7** | Trie `_removeFromTrie` doesn't prune empty nodes | `globalSymbolTable.js:116-123` | Minor memory leak over long sessions. | **NEGLIGIBLE** |

---

## 🎯 Most Likely Causes of "IntelliSense Not Working" User Reports

Ranked by probability a real user would hit this and notice:

| Rank | Finding | Why it's the most likely culprit |
|------|---------|--------------------------------|
| **1** | **C1 — LSP not started on auto-reload** | Every user who restarts VS Code with a previously opened B4X project. They see "Ready" but server-side features are dead. |
| **2** | **H4 — Missing library XML files** | Users have library references in `.b4a` projects that point to files not installed locally. Completions silently absent for those libraries. |
| **3** | **C2 + C3 — Silent server crash / failed indexing** | If the LSP server fails for ANY reason, the user gets zero indication. Extension appears installed but produces nothing. |
| **4** | **H1 — O(n) re-scanning performance** | On slower machines or large files, the 3-4× full scan per keystroke causes completions to appear laggy or time out entirely. |
| **5** | **H2 — Permanent file blacklist** | One worker crash permanently blocks a file's IntelliSense for the entire session. User must restart VS Code to recover. |
| **6** | **M6 — Missing "common" class for B4J/B4i** | If the B4J/B4i XML doesn't have a class named exactly "common", all bare-word globals (`Log`, `Msgbox`, etc.) are gone. |

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 8 |
| 🟡 Medium | 10 |
| 🟢 Low | 7 |
| **Total** | **28** |

---

## Related Skills Used

- `sp-ecc:systematic-debugging` — Phase 1: Root Cause Investigation
- `sp-ecc:brainstorming` — Failure category generation
- `vscode-extension-development` — ExtensionController pattern context
- `sp-ecc:code-reviewer` — Multi-agent code trace (×3 parallel agents)

---

*End of Investigation Report*
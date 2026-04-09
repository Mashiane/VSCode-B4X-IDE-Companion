// Document manager for the LSP server — tracks open documents, their text,
// parsed symbols, and delegates to the global symbol table.

const fs = require('fs');
const path = require('path');
const { GlobalSymbolTable } = require('./globalSymbolTable');
const { parseFile } = require('./fileSymbolParser');

class DocumentManager {
  constructor() {
    /** @type {Map<string, { text: string, symbols: Array }>} */
    this.docs = new Map();
    this.global = new GlobalSymbolTable();
  }

  /**
   * Scan .bas / .b4x files from a workspace root and index them.
   * Uses async fs APIs to avoid blocking the event loop.
   */
  async loadFromDisk(root) {
    if (!root) return;
    let rootPath = root;
    // Handle file:// URIs
    if (rootPath.startsWith('file://')) {
      try {
        rootPath = new URL(rootPath).pathname.replace(/^\/(.:)/, '$1');
      } catch {
        rootPath = rootPath.replace('file://', '');
      }
    }
    if (!fs.existsSync(rootPath)) return;

    const files = await this._walkDir(rootPath);
    for (const filePath of files) {
      try {
        const text = await fs.promises.readFile(filePath, 'utf8');
        const symbols = parseFile(text, filePath);
        const uri = this._pathToUri(filePath);
        this.docs.set(uri, { text, symbols });
        this.global.applyFileSymbols(symbols);
      } catch {
        // skip unreadable files
      }
    }
  }

  openDocument(uri, text) {
    const symbols = parseFile(text, this._uriToPath(uri));
    this.docs.set(uri, { text, symbols });
    this.global.applyFileSymbols(symbols);
  }

  changeDocument(uri, text) {
    const symbols = parseFile(text, this._uriToPath(uri));
    this.docs.set(uri, { text, symbols });
    this.global.applyFileSymbols(symbols);
  }

  closeDocument(uri) {
    // Remove from open docs map but keep symbols in global table.
    // The file was indexed by loadFromDisk and its symbols remain valid
    // since the file still exists on disk. This ensures completions and
    // go-to-definition continue working for closed files.
    this.docs.delete(uri);
  }

  setSymbolsForUri(uri, symbols) {
    const entry = this.docs.get(uri);
    if (!entry) return; // only update documents that are actually open
    entry.symbols = symbols;
    this.global.applyFileSymbols(symbols);
  }

  /**
   * Persist a snapshot to disk. Currently a no-op — can be wired up to write
   * a JSON cache file for faster cold-start in the future.
   */
  saveSnapshot(_root, _uris) {
    // intentional no-op
  }

  getCompletions(prefix) {
    return this.global.getByPrefix(prefix || '', 100);
  }

  findDefinition(word) {
    const matches = this.global.getByExactName(word);
    return matches.length > 0 ? matches[0] : null;
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Recursively walk a directory for .bas/.b4x files.
   * Uses async fs APIs and tracks visited real paths to prevent symlink cycles.
   */
  async _walkDir(dir, visitedRealPaths) {
    const results = [];
    // Track real paths to detect symlink cycles
    if (!visitedRealPaths) visitedRealPaths = new Set();
    let realDir;
    try {
      realDir = await fs.promises.realpath(dir);
    } catch {
      return results;
    }
    if (visitedRealPaths.has(realDir)) return results;
    visitedRealPaths.add(realDir);

    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip common non-source dirs
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const subResults = await this._walkDir(full, visitedRealPaths);
        results.push(...subResults);
      } else if (entry.isFile() && /\.(bas|b4x)$/i.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  _pathToUri(filePath) {
    try {
      const { pathToFileURL } = require('url');
      return pathToFileURL(path.resolve(filePath)).toString();
    } catch {
      return filePath;
    }
  }

  _uriToPath(uri) {
    if (!uri.startsWith('file://')) return uri;
    try {
      return new URL(uri).pathname.replace(/^\/(.:)/, '$1');
    } catch {
      return uri.replace('file://', '');
    }
  }
}

module.exports = { DocumentManager };

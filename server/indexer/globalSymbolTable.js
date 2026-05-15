// In-memory global symbol table for quick prefix searches and lookups.
// Uses a trie (prefix tree) for O(prefix-length) lookups instead of O(n) linear scan.
// Supports incremental updates: only affected trie nodes are modified, not the entire trie.

class TrieNode {
  constructor() {
    this.children = new Map();
    this.symbolIds = new Set(); // symbol IDs stored at this leaf
  }
}

class GlobalSymbolTable {
  constructor() {
    this.byName = new Map(); // name (lower) -> [{ name, kind, file, line, _id }]
    this._trie = new TrieNode();
    this._symbolId = 0; // monotonically increasing symbol ID
    this._symbolStore = new Map(); // id -> symbol
    this._fileToIds = new Map(); // filePath -> Set<symbolId>
  }

  applyFileSymbols(fileSymbols) {
    if (!fileSymbols || fileSymbols.length === 0) return;

    const filePath = fileSymbols[0].file;

    // Step 1: Remove previous entries for this file from byName and trie
    const oldIds = this._fileToIds.get(filePath);
    if (oldIds) {
      for (const id of oldIds) {
        const sym = this._symbolStore.get(id);
        if (sym) {
          const key = sym.name.toLowerCase();
          const arr = this.byName.get(key);
          if (arr) {
            const idx = arr.findIndex((s) => s._id === id);
            if (idx !== -1) arr.splice(idx, 1);
            if (arr.length === 0) {
              this.byName.delete(key);
              this._removeFromTrie(key, id);
            }
          }
          this._symbolStore.delete(id);
        }
      }
      this._fileToIds.delete(filePath);
    }

    // Step 2: Add new entries to byName, trie, and symbol store
    const newIds = new Set();
    for (const sym of fileSymbols) {
      const id = ++this._symbolId;
      const symWithId = { ...sym, _id: id };
      this._symbolStore.set(id, symWithId);
      newIds.add(id);

      const key = sym.name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, []);
      this.byName.get(key).push(symWithId);
      this._insertIntoTrie(key, id);
    }
    this._fileToIds.set(filePath, newIds);
  }

  removeFile(filePath) {
    const ids = this._fileToIds.get(filePath);
    if (!ids) return;

    for (const id of ids) {
      const sym = this._symbolStore.get(id);
      if (sym) {
        const key = sym.name.toLowerCase();
        const arr = this.byName.get(key);
        if (arr) {
          const idx = arr.findIndex((s) => s._id === id);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) {
            this.byName.delete(key);
            this._removeFromTrie(key, id);
          }
        }
        this._symbolStore.delete(id);
      }
    }
    this._fileToIds.delete(filePath);
  }

  getByExactName(name) {
    return this.byName.get(name.toLowerCase()) || [];
  }

  getByPrefix(prefix, limit = 50) {
    const p = prefix.toLowerCase();
    // Walk the trie to the prefix node
    let node = this._trie;
    for (const ch of p) {
      if (!node.children.has(ch)) return []; // no match
      node = node.children.get(ch);
    }
    // Collect all symbols under this node
    const results = [];
    this._collectSymbols(node, results, limit);
    return results;
  }

  // ── Trie internals ─────────────────────────────────────────────────────

  _insertIntoTrie(lowerName, symbolId) {
    let node = this._trie;
    for (const ch of lowerName) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.symbolIds.add(symbolId);
  }

  _removeFromTrie(lowerName, symbolId) {
    let node = this._trie;
    for (const ch of lowerName) {
      if (!node.children.has(ch)) return; // path doesn't exist
      node = node.children.get(ch);
    }
    node.symbolIds.delete(symbolId);
  }

  _collectSymbols(node, results, limit) {
    if (results.length >= limit) return;
    for (const id of node.symbolIds) {
      const sym = this._symbolStore.get(id);
      if (sym) {
        results.push(sym);
        if (results.length >= limit) return;
      }
    }
    for (const child of node.children.values()) {
      if (results.length >= limit) return;
      this._collectSymbols(child, results, limit);
    }
  }

  serialize() {
    return JSON.stringify({
      symbolStore: Array.from(this._symbolStore.entries()),
      fileToIds: Array.from(this._fileToIds.entries()).map(([file, ids]) => [file, Array.from(ids)]),
      lastId: this._symbolId
    });
  }

  deserialize(json) {
    try {
      const data = JSON.parse(json);
      this._symbolStore = new Map(data.symbolStore);
      this._fileToIds = new Map(data.fileToIds.map(([file, ids]) => [file, new Set(ids)]));
      this._symbolId = data.lastId;

      // Rebuild byName and Trie, validating symbols
      this.byName = new Map();
      this._trie = new TrieNode();

      for (const [id, sym] of this._symbolStore.entries()) {
        if (!sym || typeof sym.name !== 'string' || typeof sym.kind !== 'string' ||
            typeof sym.file !== 'string' || typeof sym.line !== 'number') {
          this._symbolStore.delete(id);
          continue;
        }
        const key = sym.name.toLowerCase();
        if (!this.byName.has(key)) this.byName.set(key, []);
        this.byName.get(key).push(sym);
        if (typeof sym._id === 'number') {
          this._insertIntoTrie(key, sym._id);
        }
      }
    } catch (e) {
      // Failed to deserialize GlobalSymbolTable - silently continue
    }
  }
}

module.exports = { GlobalSymbolTable };

// In-memory global symbol table for quick prefix searches and lookups.

class GlobalSymbolTable {
  constructor() {
    this.byName = new Map(); // name (lower) -> [{ name, kind, file, line }]
  }

  applyFileSymbols(fileSymbols) {
    // Remove previous entries for this file
    const touchedFiles = new Set(fileSymbols.map((s) => s.file));
    for (const [name, arr] of this.byName.entries()) {
      const filtered = arr.filter((s) => !touchedFiles.has(s.file));
      if (filtered.length === 0) this.byName.delete(name);
      else this.byName.set(name, filtered);
    }

    // Add new
    for (const sym of fileSymbols) {
      const key = sym.name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, []);
      this.byName.get(key).push(sym);
    }
  }

  removeFile(filePath) {
    for (const [name, arr] of this.byName.entries()) {
      const filtered = arr.filter((s) => s.file !== filePath);
      if (filtered.length === 0) this.byName.delete(name);
      else this.byName.set(name, filtered);
    }
  }

  getByExactName(name) {
    return this.byName.get(name.toLowerCase()) || [];
  }

  getByPrefix(prefix, limit = 50) {
    const p = prefix.toLowerCase();
    const results = [];
    for (const [name, arr] of this.byName.entries()) {
      if (name.startsWith(p)) {
        for (const s of arr) {
          results.push(s);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }
}

module.exports = { GlobalSymbolTable };

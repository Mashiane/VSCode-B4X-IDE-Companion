import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Try to load the native `better-sqlite3`. If unavailable (CI/dev without
// build tools), fall back to a lightweight in-memory JS implementation used
// only for tests and local runs where persistence is not critical.
let BetterSqlite3: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  BetterSqlite3 = require('better-sqlite3');
} catch (err) {
  BetterSqlite3 = null;
}

// Minimal in-memory fallback DB implementing the tiny subset of the
// better-sqlite3 API used by this module: `exec`, `prepare(sql).run/get/all`,
// `transaction(fn)`, and `close()`.
class SimpleInMemoryDB {
  private tables: { files: any[]; projects: any[]; xml_classes: any[]; b4xlibs: any[]; b4xlib_inner: any[] };
  private idCounters: { files: number; projects: number; xml_classes: number; b4xlibs: number; b4xlib_inner: number };

  constructor() {
    this.tables = { files: [], projects: [], xml_classes: [], b4xlibs: [], b4xlib_inner: [] };
    this.idCounters = { files: 1, projects: 1, xml_classes: 1, b4xlibs: 1, b4xlib_inner: 1 };
  }

  exec(_sql: string) {
    // No-op for schema statements.
  }

  prepare(sql: string) {
    const s = this;
    const t = sql.trim().toUpperCase();

    if (t.includes('FROM FILES')) {
      return { get(key: any) {
        const abs = typeof key === 'object' && key.absPath ? key.absPath : key;
        const row = s.tables.files.find((r) => r.absPath === abs);
        return row ? { parsedBlob: row.parsedBlob, mtime: row.mtime, size: row.size } : undefined;
      } };
    }

    if (t.startsWith('INSERT INTO FILES')) {
      return { run(params: any) {
        const absPath = params.absPath || params[0];
        const mtime = params.mtime || params[1] || 0;
        const size = params.size || params[2] || 0;
        const blob = params.blob || params.parsedBlob || params[3] || '';
        const now = params.now || Date.now();
        let existing = s.tables.files.find((r) => r.absPath === absPath);
        if (existing) {
          existing.mtime = mtime; existing.size = size; existing.parsedBlob = blob; existing.lastParsed = now; existing.lastSeen = now;
        } else {
          existing = { id: s.idCounters.files++, absPath, mtime, size, parsedBlob: blob, lastParsed: now, lastSeen: now };
          s.tables.files.push(existing);
        }
        return { changes: 1 };
      } };
    }

    if (t.includes('FROM XML_CLASSES')) {
      return { get(name: any) {
        const key = typeof name === 'object' && name.className ? name.className : name;
        const row = s.tables.xml_classes.find((r) => r.className === key);
        return row ? { classBlob: row.classBlob } : undefined;
      } };
    }

    if (t.includes('INSERT OR REPLACE INTO XML_CLASSES') || t.includes('INSERT INTO XML_CLASSES')) {
      return { run(xmlPath: string, className: string, classBlob: string) {
        let existing = s.tables.xml_classes.find((r) => r.xmlPath === xmlPath && r.className === className);
        if (existing) existing.classBlob = classBlob;
        else s.tables.xml_classes.push({ id: s.idCounters.xml_classes++, xmlPath, className, classBlob });
        return { changes: 1 };
      } };
    }

    if (t.startsWith('INSERT INTO B4XLIBS')) {
      return { run(...args: any[]) {
        const archivePath = args[0]; const mtime = args[1] || 0; const extractedAt = args[2] || Date.now(); const extractedDir = args[3] || '';
        let existing = s.tables.b4xlibs.find((r) => r.archivePath === archivePath);
        if (existing) { existing.mtime = mtime; existing.extractedAt = extractedAt; existing.extractedDir = extractedDir; }
        else s.tables.b4xlibs.push({ id: s.idCounters.b4xlibs++, archivePath, mtime, extractedAt, extractedDir });
        return { changes: 1 };
      } };
    }

    if (t.startsWith('SELECT ID FROM B4XLIBS')) {
      return { get(ap: string) { const lib = s.tables.b4xlibs.find((r) => r.archivePath === ap); return lib ? { id: lib.id } : undefined; } };
    }

    if (t.includes('DELETE FROM B4XLIB_INNER')) {
      return { run(id: number) { s.tables.b4xlib_inner = s.tables.b4xlib_inner.filter((r) => r.b4xlib_id !== id); return { changes: 1 }; } };
    }

    if (t.includes('INSERT INTO B4XLIB_INNER')) {
      return { run(b4xlib_id: number, relPath: string, absPath: string, mtime: number, size: number) {
        const existing = s.tables.b4xlib_inner.find((r) => r.absPath === absPath);
        if (!existing) s.tables.b4xlib_inner.push({ id: s.idCounters.b4xlib_inner++, b4xlib_id, relPath, absPath, mtime, size });
        return { changes: 1 };
      } };
    }

    if (t.includes('FROM B4XLIB_INNER')) {
      return { all(libId: number) { return s.tables.b4xlib_inner.filter((r) => r.b4xlib_id === libId).map((r) => ({ relPath: r.relPath, absPath: r.absPath, mtime: r.mtime, size: r.size })); } };
    }

    if (t.startsWith('UPDATE FILES SET LASTSEEN')) {
      return { run(now: number, absPath: string) { const row = s.tables.files.find((r) => r.absPath === absPath); if (row) row.lastSeen = now; return { changes: 1 }; } };
    }

    if (t.startsWith('INSERT INTO PROJECTS')) {
      return { run(root: string, lastAccessed: number, lastAccessed2?: number) { let existing = s.tables.projects.find((r) => r.root === root); if (existing) existing.lastAccessed = lastAccessed2 || lastAccessed; else s.tables.projects.push({ id: s.idCounters.projects++, root, lastAccessed }); return { changes: 1 }; } };
    }

    if (t.startsWith('SELECT COUNT(*)')) {
      return { get() { return { cnt: s.tables.projects.length }; } };
    }

    if (t.startsWith('SELECT ROOT FROM PROJECTS')) {
      return { all(limit: number) { return s.tables.projects.sort((a,b) => a.lastAccessed - b.lastAccessed).slice(0, limit).map(r => ({ root: r.root })); } };
    }

    // fallback
    return { run() { return {}; }, get() { return undefined; }, all() { return []; } };
  }

  transaction(fn: (items: any[]) => void) {
    return (items: any[]) => fn(items);
  }

  close() { /* no-op */ }
}

export interface ParsedModuleBlob {
  moduleKind: 'class' | 'static';
  name: string;
  methods: any[];
  properties: any[];
  doc?: string;
}

class LibraryIndex {
  private db: any | null = null;
  private dbPath: string | null = null;
  private baseDir: string | null = null;

  public init(storageBase?: string): void {
    if (this.db) return;
    const base = storageBase || path.join(os.homedir(), '.b4x-intellisense');
    this.baseDir = base;
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch { /* ignore */ }
    const dbPath = path.join(base, 'library-index.sqlite');
    this.dbPath = dbPath;
    if (BetterSqlite3) {
      this.db = new BetterSqlite3(dbPath, { fileMustExist: false });
    } else {
      // Use in-memory fallback when native module not available.
      // This keeps tests runnable in environments without native build tools.
      // Note: fallback does not persist to disk.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.db = new (SimpleInMemoryDB as any)();
    }
    this.ensureSchema();
    // ensure cache dir
    try { fs.mkdirSync(path.join(base, 'b4xlib-cache'), { recursive: true }); } catch {}
  }

  private ensureSchema(): void {
    if (!this.db) return;
    const s = this.db;
    s.exec(`PRAGMA journal_mode = WAL;`);
    s.exec(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      absPath TEXT UNIQUE,
      mtime INTEGER,
      size INTEGER,
      sha1 TEXT,
      parsedBlob TEXT,
      lastParsed INTEGER,
      lastSeen INTEGER
    );`);
    s.exec(`CREATE INDEX IF NOT EXISTS idx_files_path ON files(absPath);`);
    s.exec(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      root TEXT UNIQUE,
      lastAccessed INTEGER
    );`);
    s.exec(`CREATE INDEX IF NOT EXISTS idx_projects_accessed ON projects(lastAccessed);`);
    s.exec(`CREATE TABLE IF NOT EXISTS xml_classes (
      id INTEGER PRIMARY KEY,
      xmlPath TEXT,
      className TEXT,
      classBlob TEXT,
      UNIQUE(xmlPath, className)
    );`);
    s.exec(`CREATE INDEX IF NOT EXISTS idx_xml_classname ON xml_classes(className);`);
    s.exec(`CREATE TABLE IF NOT EXISTS b4xlibs (
      id INTEGER PRIMARY KEY,
      archivePath TEXT UNIQUE,
      mtime INTEGER,
      extractedAt INTEGER,
      extractedDir TEXT
    );`);
    s.exec(`CREATE TABLE IF NOT EXISTS b4xlib_inner (
      id INTEGER PRIMARY KEY,
      b4xlib_id INTEGER,
      relPath TEXT,
      absPath TEXT UNIQUE,
      mtime INTEGER,
      size INTEGER
    );`);
    s.exec(`CREATE INDEX IF NOT EXISTS idx_b4xlib_archive ON b4xlibs(archivePath);`);
  }

  public close(): void {
    try {
      if (this.db) this.db.close();
    } catch { /* ignore */ }
    this.db = null;
    this.dbPath = null;
  }

  public getDbPath(): string | null {
    return this.dbPath;
  }

  public getParsedForPath(absPath: string): { parsed: ParsedModuleBlob; mtime: number; size: number } | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT parsedBlob, mtime, size FROM files WHERE absPath = ?').get(absPath);
    if (!row || !row.parsedBlob) return null;
    try {
      const parsed: ParsedModuleBlob = JSON.parse(row.parsedBlob);
      return { parsed, mtime: row.mtime ?? 0, size: row.size ?? 0 };
    } catch {
      return null;
    }
  }

  public upsertParsedForPath(absPath: string, mtime: number, size: number, parsed: ParsedModuleBlob): void {
    if (!this.db) return;
    const now = Date.now();
    const blob = JSON.stringify(parsed);
    const stmt = this.db.prepare(`INSERT INTO files(absPath, mtime, size, parsedBlob, lastParsed, lastSeen)
      VALUES(@absPath, @mtime, @size, @blob, @now, @now)
      ON CONFLICT(absPath) DO UPDATE SET mtime = @mtime, size = @size, parsedBlob = @blob, lastParsed = @now, lastSeen = @now;`);
    stmt.run({ absPath, mtime, size, blob, now });
  }

  public upsertXmlClasses(xmlPath: string, classes: { name: string; methods: any[]; properties: any[]; doc?: string }[]): void {
    if (!this.db) return;
    const insert = this.db.prepare('INSERT OR REPLACE INTO xml_classes(xmlPath, className, classBlob) VALUES(?, ?, ?)');
    const now = Date.now();
    const tx = this.db.transaction((items: any[]) => {
      for (const cls of items) {
        insert.run(xmlPath, cls.name, JSON.stringify(cls));
      }
    });
    try { tx(classes); } catch { /* ignore */ }
  }

  public getXmlClassByName(className: string): any | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT classBlob FROM xml_classes WHERE className = ? LIMIT 1').get(className);
    if (!row) return null;
    try { return JSON.parse(row.classBlob); } catch { return null; }
  }

  public getCacheDir(): string {
    return this.baseDir ? path.join(this.baseDir, 'b4xlib-cache') : path.join(os.homedir(), '.b4x-intellisense', 'b4xlib-cache');
  }

  public upsertB4xlibArchive(archivePath: string, mtime: number, extractedDir: string, innerFiles: { relPath: string; absPath: string; mtime: number; size: number }[]): void {
    if (!this.db) return;
    const now = Date.now();
    const up = this.db.prepare('INSERT INTO b4xlibs(archivePath, mtime, extractedAt, extractedDir) VALUES(?, ?, ?, ?) ON CONFLICT(archivePath) DO UPDATE SET mtime = ?, extractedAt = ?, extractedDir = ?');
    up.run(archivePath, mtime, now, extractedDir, mtime, now, extractedDir);
    const lib = this.db.prepare('SELECT id FROM b4xlibs WHERE archivePath = ?').get(archivePath);
    if (!lib) return;
    const libId = lib.id;
    const del = this.db.prepare('DELETE FROM b4xlib_inner WHERE b4xlib_id = ?');
    del.run(libId);
    const ins = this.db.prepare('INSERT INTO b4xlib_inner(b4xlib_id, relPath, absPath, mtime, size) VALUES(?, ?, ?, ?, ?)');
    const tx = this.db.transaction((items: any[]) => {
      for (const f of items) ins.run(libId, f.relPath, f.absPath, f.mtime, f.size);
    });
    try { tx(innerFiles); } catch { /* ignore */ }
  }

  public getInnerFilesForArchive(archivePath: string): { relPath: string; absPath: string; mtime: number; size: number }[] {
    if (!this.db) return [];
    const lib = this.db.prepare('SELECT id FROM b4xlibs WHERE archivePath = ?').get(archivePath);
    if (!lib) return [];
    return this.db.prepare('SELECT relPath, absPath, mtime, size FROM b4xlib_inner WHERE b4xlib_id = ?').all(lib.id);
  }

  public touchFileSeen(absPath: string): void {
    if (!this.db) return;
    const now = Date.now();
    this.db.prepare('UPDATE files SET lastSeen = ? WHERE absPath = ?').run(now, absPath);
  }

  public touchProject(root: string): void {
    if (!this.db) return;
    const now = Date.now();
    this.db.prepare('INSERT INTO projects(root, lastAccessed) VALUES(?, ?) ON CONFLICT(root) DO UPDATE SET lastAccessed = ?').run(root, now, now);
    // prune oldest projects if more than 10
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM projects').get();
    const cnt = countRow?.cnt ?? 0;
    if (cnt > 10) {
      const toRemove = this.db.prepare('SELECT root FROM projects ORDER BY lastAccessed ASC LIMIT ?').all(cnt - 10);
      const del = this.db.prepare('DELETE FROM projects WHERE root = ?');
      for (const r of toRemove) del.run(r.root);
    }
  }
}

export const libraryIndex = new LibraryIndex();

export default libraryIndex;

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import StreamZip from 'node-stream-zip';
import * as vscode from 'vscode';

import { libraryIndex } from './storage/libraryIndexSqlite';
import { WorkspaceClassStore } from './workspaceClassIndex';
import { log } from './logging';

/**
 * Supports loading `.b4xlib` archives into IntelliSense by extracting contained
 * `.bas`/`.b4x` modules and feeding them to the WorkspaceClassStore as "external" modules.
 */
export class B4xLibStore {
  private readonly workspaceClasses: WorkspaceClassStore;
  private loadedArchives = new Map<string, string[]>(); // archive -> extracted module file paths

  public constructor(workspaceClasses: WorkspaceClassStore) {
    this.workspaceClasses = workspaceClasses;
  }

  /**
   * Clear all loaded archives and unregister their extracted modules from the workspace store.
   */
  public async clear(): Promise<void> {
    try {
      const archives = Array.from(this.loadedArchives.keys());
      for (const a of archives) {
        try {
          this.removeArchive(a);
        } catch {
          // ignore per-archive errors
        }
      }
      this.loadedArchives.clear();
    } catch {
      // ignore
    }
  }

  public async replaceB4xlibFiles(archivePaths: string[]): Promise<void> {
    const normalized = Array.from(new Set(archivePaths.map((p) => path.resolve(p))));

    // Remove any archives that are no longer present
    for (const existing of Array.from(this.loadedArchives.keys())) {
      if (!normalized.includes(existing)) {
        this.removeArchive(existing);
      }
    }

    // Add/update archives
    await Promise.all(normalized.map(async (archivePath) => {
      try {
        await this.loadArchive(archivePath);
      } catch (err) {
        console.warn('B4X: failed to load .b4xlib archive', archivePath, err);
      }
    }));
  }

  private async loadArchive(archivePath: string): Promise<void> {
    const stat = await fs.promises.stat(archivePath).catch(() => undefined);
    if (!stat || !stat.isFile()) {
      return;
    }

    const mtime = Math.floor(stat.mtimeMs);
    const cacheDir = this.getCacheDirForArchive(archivePath);

    const archiveRecord = libraryIndex.getB4xlibArchive(archivePath);
    const cacheExists = fs.existsSync(cacheDir);
    const alreadyExtracted = Boolean(archiveRecord && archiveRecord.mtime === mtime && cacheExists);

    if (!alreadyExtracted) {
      log(`b4xlib.loadArchive: extracting ${archivePath} -> ${cacheDir}`);
      await this.clearCacheForArchive(archivePath);
      await this.extractArchiveFiles(archivePath, cacheDir);
      await this.persistArchiveContents(archivePath, mtime, cacheDir);
      log(`b4xlib.loadArchive: extraction complete ${archivePath}`);
    } else {
      log(`b4xlib.loadArchive: using cached extraction for ${archivePath}`);
    }

    // Register extracted modules with the workspace store
    const moduleFiles = await this.getExtractedModuleFiles(cacheDir);
    this.loadedArchives.set(archivePath, moduleFiles);
    await Promise.all(moduleFiles.map(async (file) => {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        this.workspaceClasses.upsertDocument(document, 'external');
      } catch (err) {
        // ignore anything that fails to parse via vscode
      }
    }));
    log(`b4xlib.loadArchive: registered ${moduleFiles.length} modules from ${archivePath}`);
  }

  private removeArchive(archivePath: string): void {
    const files = this.loadedArchives.get(archivePath) ?? [];
    for (const file of files) {
      try {
        this.workspaceClasses.delete(vscode.Uri.file(file));
      } catch {
        // ignore
      }
    }
    this.loadedArchives.delete(archivePath);
    this.clearCacheForArchive(archivePath).catch(() => undefined);
  }

  private async extractArchiveFiles(archivePath: string, outDir: string): Promise<void> {
    await fs.promises.mkdir(outDir, { recursive: true });
    // Extract .bas/.b4x files only
    const zip = new StreamZip({ file: archivePath, storeEntries: true });
    await new Promise<void>((resolve, reject) => {
      zip.on('ready', () => resolve());
      zip.on('error', (err) => reject(err));
    });

    try {
      log(`b4xlib.extractArchiveFiles: opening ${archivePath}`);
      const entries = zip.entries();
      const tasks: Promise<void>[] = [];
      for (const entryName of Object.keys(entries)) {
        const entry = entries[entryName];
        if (!entry || entry.isDirectory) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.bas' && ext !== '.b4x') continue;
        const outPath = path.join(outDir, entry.name.replace(/\\/g, '/'));
        const outFolder = path.dirname(outPath);
        await fs.promises.mkdir(outFolder, { recursive: true });
        tasks.push((async () => {
          const data = zip.entryDataSync(entry.name);
          await fs.promises.writeFile(outPath, data);
        })());
      }
      await Promise.all(tasks);
      log(`b4xlib.extractArchiveFiles: extracted ${tasks.length} entries to ${outDir}`);
    } finally {
      await new Promise<void>((resolve) => zip.close(resolve));
    }
  }

  private async getExtractedModuleFiles(cacheDir: string): Promise<string[]> {
    const result: string[] = [];
    try {
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(abs);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.bas' || ext === '.b4x') {
              result.push(abs);
            }
          }
        }
      };
      await walk(cacheDir);
    } catch {
      // ignore
    }
    return result;
  }

  private async clearCacheForArchive(archivePath: string): Promise<void> {
    const cacheDir = this.getCacheDirForArchive(archivePath);
    try {
      await fs.promises.rm(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  private getCacheDirForArchive(archivePath: string): string {
    const base = libraryIndex.getCacheDir();
    const hash = crypto.createHash('sha1').update(archivePath).digest('hex').slice(0, 8);
    const name = path.basename(archivePath, path.extname(archivePath));
    return path.join(base, 'b4xlib', `${name}-${hash}`);
  }

  private async persistArchiveContents(archivePath: string, mtime: number, extractedDir: string): Promise<void> {
    const moduleFiles = await this.getExtractedModuleFiles(extractedDir);
    const inner = await Promise.all(moduleFiles.map(async (absPath) => {
      const stat = await fs.promises.stat(absPath).catch(() => undefined);
      return {
        relPath: path.relative(extractedDir, absPath).replace(/\\/g, '/'),
        absPath,
        mtime: stat?.mtimeMs ?? 0,
        size: stat?.size ?? 0,
      };
    }));

    libraryIndex.upsertB4xlibArchive(archivePath, mtime, extractedDir, inner);
  }
}

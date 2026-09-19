import * as fs from 'node:fs';
import * as path from 'node:path';

/** Directories to skip when scanning for B4X source files. */
const SKIP_DIRS = new Set([
  'objects', '.git', 'node_modules', 'bin', 'obj', 'dist', 'build',
]);

/** B4X source file extensions. */
const B4X_EXTENSIONS = new Set(['.bas', '.b4a', '.b4i', '.b4j', '.b4r']);

/** Recursively find all B4X source files under a directory. */
export function findB4xFilesOnDisk(rootDir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        files.push(...findB4xFilesOnDisk(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (B4X_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // ignore
  }
  return files;
}
import * as path from 'node:path';

export function pathKey(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function normalizeModuleBasePath(filePath: string): string {
  const parsed = path.parse(filePath);
  const basePath = path.join(parsed.dir, parsed.name);
  return process.platform === 'win32' ? basePath.toLowerCase() : basePath;
}

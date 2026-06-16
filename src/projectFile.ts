import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { B4xPlatformName } from './platformConfig';
import { isWindowsLikePath, resolveB4xRelativePath, translateWinePathToHost } from './winePaths';
import { normalizeModuleBasePath, pathKey } from './pathUtils';

/** All recognised B4X project file extensions (lower-case, with leading dot). */
const B4X_PROJECT_EXTENSIONS = ['.b4a', '.b4i', '.b4j', '.b4r'];

/** Map from project file extension to platform name. */
const EXTENSION_TO_PLATFORM: Record<string, B4xPlatformName> = {
  '.b4a': 'b4a',
  '.b4i': 'b4i',
  '.b4j': 'b4j',
  '.b4r': 'b4r',
};

/** Detect platform from a project file path (e.g. "MyApp.b4j" → "b4j"). */
export function detectPlatformFromPath(filePath: string): B4xPlatformName | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_PLATFORM[ext];
}

function isB4xProjectFile(name: string): boolean {
  const lower = name.toLowerCase();
  return B4X_PROJECT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export interface B4xProjectConfig {
  projectFilePath?: string;
  projectDirectory?: string;
  /** Detected platform from project file extension (.b4a, .b4i, .b4j, .b4r). */
  platform?: B4xPlatformName;
  /**
   * Library names parsed from the project file (e.g. "core", "b4xpages").
   * This is the canonical list of referenced libraries and is used when
   * resolving library file paths from the B4X install/additional folders.
   */
  allowedLibraries?: ReadonlySet<string>;

  /**
   * Base paths derived from ModuleN entries (without extension). Used by the
   * workspace scanner to locate .bas files.
   */
  allowedModuleBasePaths?: ReadonlySet<string>;

  /**
   * The actual module files resolved on disk for each ModuleN entry.
   */
  allowedModuleFiles?: string[];

  /**
   * External module files that live outside the current workspace.
   */
  externalModuleFiles?: readonly string[];
}

export async function loadWorkspaceProjectConfig(
  sharedModuleFolders: readonly string[] = [],
  preferredDocumentUri?: vscode.Uri,
): Promise<B4xProjectConfig> {
  // Fast-path: if we previously resolved a project config and the caller
  // provides a preferred document that lives inside that project directory
  // then we can reuse the cached config and avoid running a workspace-wide
  // search for .b4a files.
  if (preferredDocumentUri && cachedProjectConfig?.projectDirectory) {
    try {
      const preferredPath = pathKey(preferredDocumentUri.fsPath);
      const normalizedCached = pathKey(cachedProjectConfig.projectDirectory);
      if (preferredPath === normalizedCached || preferredPath.startsWith(`${normalizedCached}${path.sep}`)) {
        return cachedProjectConfig;
      }
    } catch {
      // ignore and fall back to full search
    }
  }

  const projectFiles = await findProjectFiles(preferredDocumentUri);
  if (projectFiles.length === 0) {
    return {};
  }

  const parsedConfigs = await Promise.all(projectFiles.map(async (projectFile) => {
    const document = await vscode.workspace.openTextDocument(projectFile);
    return parseProjectFile(document, sharedModuleFolders);
  }));

  if (!preferredDocumentUri) {
    const selected = parsedConfigs.sort((left, right) => scoreProjectConfig(left) - scoreProjectConfig(right))[0] ?? {};
    cachedProjectConfig = selected;
    return selected;
  }

  const selectedPref = parsedConfigs.sort((left, right) => {
    return scoreProjectConfig(left, preferredDocumentUri) - scoreProjectConfig(right, preferredDocumentUri);
  })[0] ?? {};
  cachedProjectConfig = selectedPref;
  return selectedPref;
}

// Simple in-memory cache for the last-resolved project config. This speeds up
// frequent lookups (e.g. hovers) where callers pass a `preferredDocumentUri`.
let cachedProjectConfig: B4xProjectConfig | undefined;

/** Clear the cached project config so the next call to
 *  `loadWorkspaceProjectConfig` performs a fresh search. */
export function clearProjectConfigCache(): void {
  cachedProjectConfig = undefined;
}

async function parseProjectFile(
  document: vscode.TextDocument,
  sharedModuleFolders: readonly string[],
): Promise<B4xProjectConfig> {
  const projectDirectory = path.dirname(document.uri.fsPath);
  const libraries = new Set<string>();
  const moduleBasePaths = new Set<string>();
  const resolvedModuleFiles: string[] = [];

  // Read file directly from disk to avoid VS Code document issues
  let fileContent: string;
  try {
    fileContent = await fs.readFile(document.uri.fsPath, 'utf8');
  } catch (err) {
    console.error(`[B4X ERROR] Failed to read file ${document.uri.fsPath}`, err);
    // Fall back to document-based parsing
    fileContent = document.getText();
  }

  // Split by line endings (handle \r\n, \n, or \r)
  // Use a simple replace + split approach to avoid regex issues
  const normalizedContent = fileContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.split('\n');

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    if (!line) continue;
    let rawLine = line.trim();

    // Strip BOM and any invisible characters
    rawLine = rawLine.replace(/^\ufeff/, '').trim();

    if (rawLine.includes('@EndOfDesignText@')) {
      break;
    }
    if (!rawLine || !rawLine.includes('=')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');
    let key = rawLine.slice(0, separatorIndex).trim().toLowerCase();
    let value = rawLine.slice(separatorIndex + 1).trim();

    // Strip BOM from value if present
    value = value.replace(/^\ufeff/, '').trim();

    if (!value) {
      continue;
    }

    if (/^library\d+$/i.test(key)) {
      // Trim whitespace to tolerate malformed project files and be resilient to
      // stray trailing spaces (e.g. "B4XPages ") that would otherwise fail
      // to match the corresponding library files.
      libraries.add(value.trim().toLowerCase());
      continue;
    }

    if (/^module\d+$/i.test(key)) {
      const moduleSpec = parseModuleSpec(value);
      const modulePath = resolveModuleCandidate(projectDirectory, moduleSpec.path);

      // Prefer modules that actually exist. Try project-local first, then
      // fall back to shared modules folders.
      let resolvedFile = await resolveExistingModuleFile(modulePath);

      if (!resolvedFile) {
        for (const shared of sharedModuleFolders) {
          const sharedCandidate = resolveModuleCandidate(shared, moduleSpec.path);
          resolvedFile = await resolveExistingModuleFile(sharedCandidate);
          if (resolvedFile) break;
        }
      }

      const baseToStore = normalizeBasePath(resolvedFile ?? modulePath);
      moduleBasePaths.add(baseToStore);

      if (resolvedFile) {
        resolvedModuleFiles.push(resolvedFile);
      }
    }
  }

  // Ensure any Main code embedded in the .b4a after @EndOfDesignText@ is generated
  await ensureGeneratedMainFile(document, projectDirectory);

  return {
    projectFilePath: document.uri.fsPath,
    projectDirectory,
    platform: detectPlatformFromPath(document.uri.fsPath),
    allowedLibraries: libraries,
    allowedModuleBasePaths: moduleBasePaths,
    allowedModuleFiles: resolvedModuleFiles,
    externalModuleFiles: Array.from(new Set(resolvedModuleFiles)).filter((filePath) => !isInsideWorkspace(filePath)),
  };
}

// Extract Main-code (post @EndOfDesignText@) from .b4a project files and write a generated .b4x file
async function ensureGeneratedMainFile(document: vscode.TextDocument, projectDirectory: string): Promise<void> {
  try {
    const fullText = document.getText();
    const marker = '@EndOfDesignText@';
    const idx = fullText.indexOf(marker);
    if (idx === -1) return;
    const after = fullText.substring(idx + marker.length).trim();
    if (!after) return;

    const genDir = path.join(projectDirectory, '.vscode', 'b4x-main');
    await fs.mkdir(genDir, { recursive: true }).catch(() => undefined);
    const projectName = path.basename(projectDirectory);
    const outPath = path.join(genDir, `${projectName}_Main.b4x`);

    // Only write if content changed to avoid churn
    let existing = '';
    try { existing = await fs.readFile(outPath, 'utf8'); } catch {}
    if (existing !== after) {
      await fs.writeFile(outPath, after, 'utf8');
    }
  } catch (err) {
    // don't fail project parsing on generated file errors
    console.warn('B4X: failed to generate Main module from .b4a', err);
  }
}


type B4xModulePathKind = 'relative' | 'absolute' | 'shared' | 'plain';

interface ParsedModuleSpec {
  kind: B4xModulePathKind;
  path: string;
}

function parseModuleSpec(value: string): ParsedModuleSpec {
  const match = value.match(/^\|(?<kind>relative|absolute|shared)\|(?<rest>.*)$/i);
  const kind = match?.groups?.kind;
  const rest = match?.groups?.rest;
  if (!kind || rest === undefined) {
    return { kind: 'plain', path: value.trim() };
  }
  return {
    kind: kind.toLowerCase() as B4xModulePathKind,
    path: rest.trim(),
  };
}

function resolveModuleCandidate(baseDir: string, modulePath: string): string {
  const translatedAbsolute = translateWinePathToHost(modulePath);
  if (translatedAbsolute && (translatedAbsolute.startsWith(path.sep) || isWindowsLikePath(modulePath))) {
    return path.normalize(translatedAbsolute);
  }
  return resolveB4xRelativePath(baseDir, modulePath);
}

export function normalizeBasePath(filePath: string): string {
  return normalizeModuleBasePath(filePath);
}

/**
 * Parse `B4X.DependsOn` entries from a b4xlib manifest.
 * Manifest format example:
 *   Version=1.12
 *   B4A.DependsOn=B4XCollections, XUI, JavaObject
 *   B4J.DependsOn=B4XCollections, JavaObject, jXUI
 *   B4i.DependsOn=B4XCollections, iXUI
 *
 * Returns library names specific to the given platform.
 */
export function parseManifestDependsOn(manifest: Record<string, string>, platform: B4xPlatformName): string[] {
  const targetKey = `${platform.toUpperCase()}.dependson`;
  // Case-insensitive key lookup — manifests may use "B4A.DependsOn", "b4a.dependson", etc.
  const value = Object.entries(manifest).find(
    ([k]) => k.toLowerCase() === targetKey,
  )?.[1];
  if (!value) return [];
  return value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function getProjectRootFromProjectFile(projectFilePath: string): string {
  // Return the directory containing the project file.
  // For B4X projects this will be the platform folder (e.g., B4A/).
  // The workspace will be set to this folder to keep the file tree clean.
  return path.dirname(projectFilePath);
}

/**
 * Returns the actual project root (parent of platform folders) for B4X multi-platform projects.
 * Used for resolving relative module paths that go outside the platform folder.
 */
export function getB4xProjectRoot(projectFilePath: string): string {
  const dir = path.dirname(projectFilePath);
  const dirName = path.basename(dir).toLowerCase();
  
  // For B4X multi-platform projects, the .b4a/.b4j/.b4i files are inside
  // platform subfolders (B4A/, B4J/, B4i/, B4R/). The actual project root
  // is the PARENT directory of these platform folders.
  const platformFolders = ['b4a', 'b4j', 'b4i', 'b4r'];
  if (platformFolders.includes(dirName)) {
    return path.dirname(dir);
  }
  
  return dir;
}

async function findProjectFiles(preferredDocumentUri?: vscode.Uri): Promise<vscode.Uri[]> {
  // If a preferred document is provided and it's itself a B4X project file,
  // return it immediately to avoid scanning the whole workspace.
  if (preferredDocumentUri && isB4xProjectFile(preferredDocumentUri.fsPath)) {
    return [preferredDocumentUri];
  }

  // If a preferred document is provided and is inside a project, walk upward
  // from its directory and look for B4X project files in each ancestor. This
  // avoids a workspace-wide search while still finding a nearby project file.
  if (preferredDocumentUri) {
    try {
      let dir = path.dirname(preferredDocumentUri.fsPath);
      const seen = new Set<string>();
      while (dir && !seen.has(dir)) {
        seen.add(dir);
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const matches = entries
            .filter((d) => d.isFile() && isB4xProjectFile(d.name))
            .map((d) => vscode.Uri.file(path.join(dir, d.name)));
          if (matches.length > 0) {
            return matches.sort((left, right) => scoreProjectFile(left.fsPath) - scoreProjectFile(right.fsPath));
          }
        } catch {
          // ignore and continue to parent
        }

        const parent = path.dirname(dir);
        if (!parent || parent === dir) break;
        dir = parent;
      }
    } catch {
      // ignore and fall back to workspace search
    }
  }

  // No workspace-wide fallback: if we couldn't find a B4X project file by
  // walking ancestors then assume there's no project here. This prevents
  // scanning unrelated workspace folders which is important when the user
  // opens a single project.
  return [];
}

// Scoring offsets for project config selection (larger = more preferred).
// Exact match > module match > same project root > path length tiebreaker.
const SCORE_EXACT_PROJECT_MATCH = -200000;
const SCORE_MODULE_MATCH = -150000;
const SCORE_PROJECT_ROOT_MATCH = -50000;
const SCORE_PLATFORM_FOLDER_PENALTY = 1000;

function scoreProjectFile(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const inPlatformFolder = /\/(b4a|b4i|b4j|b4r)\//.test(normalized) ? 0 : SCORE_PLATFORM_FOLDER_PENALTY;
  return inPlatformFolder + normalized.length;
}

function scoreProjectConfig(config: B4xProjectConfig, preferredDocumentUri?: vscode.Uri): number {
  const projectFilePath = config.projectFilePath;
  if (!projectFilePath) {
    return Number.MAX_SAFE_INTEGER;
  }

  let score = scoreProjectFile(projectFilePath);
  if (!preferredDocumentUri) {
    return score;
  }

  const preferredPath = pathKey(preferredDocumentUri.fsPath);
  if (preferredPath === pathKey(projectFilePath)) {
    return SCORE_EXACT_PROJECT_MATCH + score;
  }

  const preferredBasePath = normalizeBasePath(preferredPath);
  if (config.allowedModuleBasePaths?.has(preferredBasePath)) {
    return SCORE_MODULE_MATCH + score;
  }

  const projectRoot = getProjectRootFromProjectFile(projectFilePath);
  const normalizedRoot = pathKey(projectRoot);
  if (preferredPath.startsWith(`${normalizedRoot}${path.posix.sep}`) || preferredPath === normalizedRoot) {
    return SCORE_PROJECT_ROOT_MATCH + score;
  }

  return score;
}

async function resolveExistingModuleFile(modulePath: string): Promise<string | undefined> {
  // B4X project files may list modules with or without file extensions.
  // Try the path as-is first, then try the .bas extension.
  try {
    const stat = await fs.stat(modulePath);
    if (stat.isFile()) return path.resolve(modulePath);
  } catch { /* ignore */ }
  try {
    const stat = await fs.stat(`${modulePath}.bas`);
    if (stat.isFile()) return path.resolve(`${modulePath}.bas`);
  } catch { /* ignore */ }
  return undefined;
}

export function isInsideWorkspace(filePath: string): boolean {
  const normalizedFilePath = pathKey(filePath);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    // No workspace open — treat everything as "inside" since there's no
    // workspace boundary to violate.
    return true;
  }
  return folders.some((folder) => {
    const normalizedFolder = pathKey(folder.uri.fsPath);
    return normalizedFilePath === normalizedFolder || normalizedFilePath.startsWith(`${normalizedFolder}${path.posix.sep}`);
  });
}
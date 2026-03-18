import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface B4aProjectConfig {
  projectFilePath?: string;
  projectDirectory?: string;
  allowedLibraries?: ReadonlySet<string>;
  allowedModuleBasePaths?: ReadonlySet<string>;
  externalModuleFiles?: readonly string[];
}

export async function loadWorkspaceProjectConfig(
  sharedModuleFolders: readonly string[] = [],
  preferredDocumentUri?: vscode.Uri,
): Promise<B4aProjectConfig> {
  // Fast-path: if we previously resolved a project config and the caller
  // provides a preferred document that lives inside that project directory
  // then we can reuse the cached config and avoid running a workspace-wide
  // search for .b4a files.
  if (preferredDocumentUri && cachedProjectConfig?.projectDirectory) {
    try {
      const preferredPath = path.resolve(preferredDocumentUri.fsPath).toLowerCase();
      const normalizedCached = path.resolve(cachedProjectConfig.projectDirectory).toLowerCase();
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
let cachedProjectConfig: B4aProjectConfig | undefined;

async function parseProjectFile(
  document: vscode.TextDocument,
  sharedModuleFolders: readonly string[],
): Promise<B4aProjectConfig> {
  const projectDirectory = path.dirname(document.uri.fsPath);
  const libraries = new Set<string>();
  const moduleBasePaths = new Set<string>();
  const moduleFiles = new Set<string>();

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const rawLine = document.lineAt(lineNumber).text.trim();
    if (rawLine.includes('@EndOfDesignText@')) {
      break;
    }
    if (!rawLine || !rawLine.includes('=')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');
    const key = rawLine.slice(0, separatorIndex).trim().toLowerCase();
    const value = rawLine.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (/^library\d+$/i.test(key)) {
      libraries.add(value.toLowerCase());
      continue;
    }

    if (/^module\d+$/i.test(key)) {
      const modulePaths = resolveModulePaths(projectDirectory, value, sharedModuleFolders);
      for (const modulePath of modulePaths) {
        moduleBasePaths.add(normalizeBasePath(modulePath));

        const resolvedFile = await resolveExistingModuleFile(modulePath);
        if (resolvedFile) {
          moduleFiles.add(resolvedFile.toLowerCase());
        }
      }
    }
  }

  // Ensure any Main code embedded in the .b4a after @EndOfDesignText@ is generated
  await ensureGeneratedMainFile(document, projectDirectory);

  return {
    projectFilePath: document.uri.fsPath,
    projectDirectory,
    allowedLibraries: libraries,
    allowedModuleBasePaths: moduleBasePaths,
    externalModuleFiles: [...moduleFiles].filter((filePath) => !isInsideWorkspace(filePath)),
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

function resolveModulePaths(
  projectDirectory: string,
  source: string,
  sharedModuleFolders: readonly string[],
): string[] {
  const relativePrefix = '|relative|';
  const absolutePrefix = '|absolute|';

  if (source.startsWith(relativePrefix)) {
    const relativePath = source.slice(relativePrefix.length);
    const roots = sharedModuleFolders.length > 0 ? sharedModuleFolders : [projectDirectory];
    return roots.map((folder) => path.resolve(folder, relativePath));
  }

  if (source.startsWith(absolutePrefix)) {
    return [path.resolve(source.slice(absolutePrefix.length))];
  }

  return [path.resolve(projectDirectory, source)];
}

export function normalizeBasePath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, parsed.name).toLowerCase();
}

export function getProjectRootFromProjectFile(projectFilePath: string): string {
  const projectDirectory = path.dirname(projectFilePath);
  const folderName = path.basename(projectDirectory).toLowerCase();
  if (folderName === 'b4a' || folderName === 'b4i' || folderName === 'b4j' || folderName === 'b4r') {
    return path.dirname(projectDirectory);
  }

  return projectDirectory;
}

async function findProjectFiles(preferredDocumentUri?: vscode.Uri): Promise<vscode.Uri[]> {
  // If a preferred document is provided and it's itself a .b4a project file,
  // return it immediately to avoid scanning the whole workspace.
  if (preferredDocumentUri && preferredDocumentUri.fsPath.toLowerCase().endsWith('.b4a')) {
    return [preferredDocumentUri];
  }

  // If a preferred document is provided and is inside a project, walk upward
  // from its directory and look for .b4a files in each ancestor. This avoids a
  // workspace-wide search while still finding a nearby project file.
  if (preferredDocumentUri) {
    try {
      let dir = path.dirname(preferredDocumentUri.fsPath);
      const seen = new Set<string>();
      while (dir && !seen.has(dir)) {
        seen.add(dir);
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const matches = entries
            .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.b4a'))
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

  // No workspace-wide fallback: if we couldn't find a .b4a by walking ancestors
  // then assume there's no project here. This prevents scanning unrelated
  // workspace folders which is important when the user opens a single project.
  return [];
}

function scoreProjectFile(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const inPlatformFolder = /\/(b4a|b4i|b4j|b4r)\//.test(normalized) ? 0 : 1000;
  return inPlatformFolder + normalized.length;
}

function scoreProjectConfig(config: B4aProjectConfig, preferredDocumentUri?: vscode.Uri): number {
  const projectFilePath = config.projectFilePath;
  if (!projectFilePath) {
    return Number.MAX_SAFE_INTEGER;
  }

  let score = scoreProjectFile(projectFilePath);
  if (!preferredDocumentUri) {
    return score;
  }

  const preferredPath = path.resolve(preferredDocumentUri.fsPath).toLowerCase();
  if (preferredPath === path.resolve(projectFilePath).toLowerCase()) {
    return -200000 + score;
  }

  const preferredBasePath = normalizeBasePath(preferredPath);
  if (config.allowedModuleBasePaths?.has(preferredBasePath)) {
    return -150000 + score;
  }

  const projectRoot = getProjectRootFromProjectFile(projectFilePath);
  const normalizedRoot = path.resolve(projectRoot).toLowerCase();
  if (preferredPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return -50000 + score;
  }

  return score;
}

async function resolveExistingModuleFile(modulePath: string): Promise<string | undefined> {
  const candidates = [
    modulePath,
    `${modulePath}.bas`,
    `${modulePath}.b4x`,
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return path.resolve(candidate);
      }
    } catch {
      // Ignore missing candidates.
    }
  }

  return undefined;
}

export function isInsideWorkspace(filePath: string): boolean {
  const normalizedFilePath = path.resolve(filePath).toLowerCase();
  return vscode.workspace.workspaceFolders?.some((folder) => {
    const normalizedFolder = path.resolve(folder.uri.fsPath).toLowerCase();
    return normalizedFilePath === normalizedFolder || normalizedFilePath.startsWith(`${normalizedFolder}${path.sep}`);
  }) ?? false;
}
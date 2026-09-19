import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import AdmZip from 'adm-zip';

export interface LibraryInfo {
  name: string;
  forumThread: string;
  version: string;
}

export interface DistributeResult {
  zipPath: string;
  included: string[];
  missing: string[];
}

interface ExternalLibraryEntry {
  lib: string;
  found: boolean;
  files: string[];
  info?: LibraryInfo;
}

/**
 * Collect all additional (AdditionalLibrariesFolder) library files referenced by
 * the current project and zip them into "<ProjectName> libraries.zip" in the
 * project directory. Only libraries explicitly declared in LibraryN= entries
 * are included. Internal platform libraries are intentionally skipped.
 *
 * A "<ProjectName> Libraries.txt" file is added to the zip listing every external
 * library used by the project (missing entries first, then found entries), each
 * numbered from 1 onwards and showing its B4X forum thread link when available.
 */
export async function distributeAdditionalLibraries(
  projectDirectory: string | undefined,
  projectFilePath: string | undefined,
  allowedLibraries: ReadonlySet<string> | undefined,
  internalLibrariesFolder: string | undefined,
  additionalLibrariesFolder: string | undefined,
  getLibraryInfo?: (libName: string) => LibraryInfo | undefined,
): Promise<DistributeResult | undefined> {
  if (!projectDirectory) {
    void vscode.window.showErrorMessage('B4X: No project is currently open.');
    return undefined;
  }
  if (!allowedLibraries || allowedLibraries.size === 0) {
    void vscode.window.showWarningMessage('B4X: The current project does not reference any libraries.');
    return undefined;
  }
  if (!additionalLibrariesFolder) {
    void vscode.window.showErrorMessage(
      'B4X: No Additional Libraries folder is configured. Set it in the B4X IDE (Tools > Configure Paths) so the extension can locate your additional libraries.',
    );
    return undefined;
  }

  const zip = new AdmZip();
  const included: string[] = [];
  const missing: string[] = [];
  const externals: ExternalLibraryEntry[] = [];

  for (const lib of allowedLibraries) {
    // Skip internal libraries silently — they ship with the platform
    if (internalLibrariesFolder && existsInFolder(internalLibrariesFolder, lib)) {
      continue;
    }

    const candidates = buildLibraryCandidates(additionalLibrariesFolder, lib);
    const foundFiles: string[] = [];
    let added = false;

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const relative = path.relative(additionalLibrariesFolder, candidate);
        zip.addLocalFile(candidate, path.dirname(relative));
        included.push(relative);
        foundFiles.push(relative);
        added = true;
      }
    }

    const entry: ExternalLibraryEntry = {
      lib,
      found: added,
      files: foundFiles,
      info: getLibraryInfo?.(lib),
    };

    externals.push(entry);

    if (!added) {
      missing.push(lib);
    }
  }

  if (included.length === 0) {
    void vscode.window.showWarningMessage(
      'B4X: None of the project libraries were found in the Additional Libraries folder.',
    );
    return undefined;
  }

  const projectName = projectFilePath
    ? path.basename(projectFilePath, path.extname(projectFilePath))
    : path.basename(projectDirectory);

  // Build the report: missing first, then found, all numbered from 1
  const missingEntries = externals.filter((e) => !e.found);
  const foundEntries = externals.filter((e) => e.found);

  if (externals.length > 0) {
    const lines: string[] = [];
    lines.push(`${projectName} Libraries`);
    lines.push('='.repeat(`${projectName} Libraries`.length));
    lines.push('');
    lines.push('This document lists all external (additional) libraries declared by the project.');
    lines.push('Internal platform libraries are excluded — they ship with the IDE.');
    lines.push('');

    let num = 0;

    if (missingEntries.length > 0) {
      lines.push('Missing Libraries');
      lines.push('-----------------');
      lines.push('The following libraries could not be found in the Additional Libraries folder.');
      lines.push('You may need to download them manually.');
      lines.push('');

      for (const entry of missingEntries) {
        num += 1;
        lines.push(`${num}. Library: ${entry.lib}`);
        lines.push(`   Status: Missing`);
        lines.push(`   Redistributable: User must confirm`);
        lines.push(`   Library Version: ${entry.info?.version || '(unknown)'}`);
        if (entry.info?.forumThread) {
          lines.push(`   Forum Thread: ${entry.info.forumThread}`);
        } else {
          lines.push(`   Forum Thread: (no link available in catalog)`);
        }
        lines.push('');
      }

      if (foundEntries.length > 0) {
        lines.push('Found Libraries');
        lines.push('---------------');
        lines.push('');
      }
    }

    for (const entry of foundEntries) {
      num += 1;
      lines.push(`${num}. Library: ${entry.lib}`);
      lines.push(`   Status: Found`);
      lines.push(`   Files: ${entry.files.join(', ')}`);
      lines.push(`   Redistributable: User must confirm`);
      lines.push(`   Library Version: ${entry.info?.version || '(unknown)'}`);
      if (entry.info?.forumThread) {
        lines.push(`   Forum Thread: ${entry.info.forumThread}`);
      } else {
        lines.push(`   Forum Thread: (no link available in catalog)`);
      }
      lines.push('');
    }

    const reportContent = lines.join('\r\n');
    zip.addFile(`${projectName} Libraries.txt`, Buffer.from(reportContent, 'utf8'));
  }

  // Redistribution notice
  const noticeContent = [
    'This archive was generated automatically.',
    '',
    'It may contain third-party components subject to separate licensing terms.',
    '',
    'The distributor of this archive is responsible for ensuring compliance with all library licenses and redistribution restrictions.',
  ].join('\r\n');
  zip.addFile('REDISTRIBUTION_NOTICE.txt', Buffer.from(noticeContent, 'utf8'));

  const zipFileName = `${projectName} libraries.zip`;
  const zipPath = path.join(projectDirectory, zipFileName);

  try {
    zip.writeZip(zipPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`B4X: Failed to write zip: ${message}`);
    return undefined;
  }

  return { zipPath, included, missing };
}

function existsInFolder(folder: string, lib: string): boolean {
  const lowerLib = lib.toLowerCase();
  const candidates = [
    path.join(folder, `${lib}.xml`),
    path.join(folder, `${lowerLib}.xml`),
    path.join(folder, `${lib}.b4xlib`),
    path.join(folder, `${lowerLib}.b4xlib`),
    path.join(folder, lib, `${lib}.xml`),
    path.join(folder, lowerLib, `${lowerLib}.xml`),
    path.join(folder, lib, `${lib}.b4xlib`),
    path.join(folder, lowerLib, `${lowerLib}.b4xlib`),
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function buildLibraryCandidates(folder: string, lib: string): string[] {
  const lowerLib = lib.toLowerCase();
  return [
    // Flat layout
    path.join(folder, `${lib}.xml`),
    path.join(folder, `${lowerLib}.xml`),
    path.join(folder, `${lib}.b4xlib`),
    path.join(folder, `${lowerLib}.b4xlib`),
    // Nested folder layout
    path.join(folder, lib, `${lib}.xml`),
    path.join(folder, lowerLib, `${lowerLib}.xml`),
    path.join(folder, lib, `${lib}.b4xlib`),
    path.join(folder, lowerLib, `${lowerLib}.b4xlib`),
    // Companion JARs (flat and nested)
    path.join(folder, `${lib}.jar`),
    path.join(folder, `${lowerLib}.jar`),
    path.join(folder, lib, `${lib}.jar`),
    path.join(folder, lowerLib, `${lowerLib}.jar`),
  ];
}

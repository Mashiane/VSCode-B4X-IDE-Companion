/**
 * B4X Workspace Symbol Provider
 * Provides Ctrl+T (Go to Symbol in Workspace) functionality.
 * Searches across all workspace classes (local + XML libraries) for Subs, methods, properties, and types.
 */

import * as vscode from 'vscode';

export class B4xWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  constructor(
    private readonly workspaceClasses: any, // WorkspaceClassStore
    private readonly xmlLibraries: any, // XmlLibraryStore
  ) {}

  provideWorkspaceSymbols(
    query: string,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.SymbolInformation[]> {
    const symbols: vscode.SymbolInformation[] = [];
    const queryLower = query.toLowerCase();
    const seen = new Set<string>();

    // Search workspace classes (user's own code)
    const allClasses = this.getAllWorkspaceClasses();
    for (const cls of allClasses) {
      // Search methods
      for (const method of cls.methods || []) {
        const methodName = method.name || method.signature?.split('(')[0]?.trim();
        if (!methodName) continue;
        if (query && !methodName.toLowerCase().includes(queryLower) && !cls.name.toLowerCase().includes(queryLower)) {
          continue;
        }
        const key = `method:${cls.name}:${methodName}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        // Use params (primary field) with fallback to deprecated parameters
        const params = (method.params || method.parameters || [])
          .map((p: any) => `${p.name} As ${p.type || p.rawType || ''}`.trim())
          .join(', ');
        const detail = params ? `(${params})` : '';

        symbols.push(
          new vscode.SymbolInformation(
            `${methodName}${detail ? `: ${detail}` : ''}`,
            vscode.SymbolKind.Method,
            cls.name,
            new vscode.Location(
              this.uriForClass(cls),
              new vscode.Position(0, 0),
            ),
          ),
        );
      }

      // Search properties/fields
      for (const prop of cls.properties || []) {
        const propName = prop.name;
        if (!propName) continue;
        if (query && !propName.toLowerCase().includes(queryLower) && !cls.name.toLowerCase().includes(queryLower)) {
          continue;
        }
        const key = `property:${cls.name}:${propName}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        symbols.push(
          new vscode.SymbolInformation(
            propName,
            vscode.SymbolKind.Property,
            cls.name,
            new vscode.Location(
              this.uriForClass(cls),
              new vscode.Position(0, 0),
            ),
          ),
        );
      }

      // Add the class itself as a symbol
      if (!query || cls.name.toLowerCase().includes(queryLower)) {
        const key = `class:${cls.name}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push(
            new vscode.SymbolInformation(
              cls.name,
              vscode.SymbolKind.Class,
              cls.libraryName ?? '',
              new vscode.Location(
                this.uriForClass(cls),
                new vscode.Position(0, 0),
              ),
            ),
          );
        }
      }
    }

    // Limit results for performance
    return symbols.slice(0, 500);
  }

  /**
   * Combine workspace classes and XML library classes.
   */
  private getAllWorkspaceClasses(): any[] {
    const classes: any[] = [];

    try {
      if (this.workspaceClasses?.getAllClasses) {
        classes.push(...this.workspaceClasses.getAllClasses());
      } else if (this.workspaceClasses?.findClassesByPrefix) {
        classes.push(...this.workspaceClasses.findClassesByPrefix(''));
      }
    } catch {
      // ignore
    }

    try {
      if (this.xmlLibraries?.getAllClasses) {
        classes.push(...this.xmlLibraries.getAllClasses());
      }
    } catch {
      // ignore
    }

    return classes;
  }

  /**
   * Get the URI for a class's source file.
   */
  private uriForClass(cls: any): vscode.Uri {
    if (cls.filePath) return vscode.Uri.file(cls.filePath);
    if (cls.sourceFile) return vscode.Uri.file(cls.sourceFile);
    // Fallback: search workspace folders for a matching .bas file
    if (cls.name) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        for (const folder of folders) {
          try {
            const files = this.findB4xFilesInFolder(folder.uri.fsPath);
            for (const f of files) {
              if (f.toLowerCase().includes(cls.name.toLowerCase())) {
                return vscode.Uri.file(f);
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }
    return vscode.Uri.parse('untitled:unknown.bas');
  }

  private findB4xFilesInFolder(rootDir: string): string[] {
    const fs = require('fs');
    const path = require('path');
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (lower === 'objects' || lower === '.git' || lower === 'node_modules') continue;
          files.push(...this.findB4xFilesInFolder(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.bas') files.push(fullPath);
        }
      }
    } catch {
      // ignore
    }
    return files;
  }
}

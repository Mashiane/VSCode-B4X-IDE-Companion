/**
 * B4X Document Link Provider
 * Provides clickable links for:
 * - #AdditionalJar: path/to/file.jar
 * - #AdditionalRes: path/to/res
 * - Activity.LoadLayout("Name") → links to .bal files
 * - B4XPages.ShowPage("Name") → links to page modules
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class B4xDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const dir = path.dirname(document.uri.fsPath);
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // #AdditionalJar: path
      const jarMatch = line.match(/(#AdditionalJar:\s*)(.+)/i);
      if (jarMatch && jarMatch[2]) {
        const jarPath = jarMatch[2].trim();
        const jarUri = this.resolvePath(jarPath, dir);
        if (jarUri) {
          const colStart = line.indexOf(jarMatch[1] ?? '') + (jarMatch[1]?.length ?? 0);
          const range = new vscode.Range(i, colStart, i, colStart + jarPath.length);
          links.push(new vscode.DocumentLink(range, jarUri));
        }
      }

      // #AdditionalRes: path
      const resMatch = line.match(/(#AdditionalRes:\s*)(.+)/i);
      if (resMatch && resMatch[2]) {
        const resPath = resMatch[2].trim();
        const resUri = this.resolvePath(resPath, dir);
        if (resUri) {
          const colStart = line.indexOf(resMatch[1] ?? '') + (resMatch[1]?.length ?? 0);
          const range = new vscode.Range(i, colStart, i, colStart + resPath.length);
          links.push(new vscode.DocumentLink(range, resUri));
        }
      }

      // LoadLayout("Name") → find .bal/.bil/.bjl file
      const layoutMatch = line.match(/LoadLayout\s*\(\s*"([^"]+)"\s*\)/i);
      if (layoutMatch && layoutMatch[1]) {
        const layoutName = layoutMatch[1];
        const layoutResult = this.findLayoutFile(layoutName, dir);
        if (layoutResult) {
          const colStart = line.indexOf(layoutMatch[1]);
          const range = new vscode.Range(i, colStart + 1, i, colStart + 1 + layoutName.length);
          const link = new vscode.DocumentLink(range, layoutResult.uri);
          link.tooltip = layoutResult.tooltip;
          links.push(link);
        }
      }

      // B4XPages.ShowPage("Name") → find page module
      const pageMatch = line.match(/(?:ShowPage|AddPage)\s*\(\s*"([^"]+)"\s*\)/i);
      if (pageMatch && pageMatch[1]) {
        const pageName = pageMatch[1];
        const pageUri = this.findPageModule(pageName, dir);
        if (pageUri) {
          const colStart = line.indexOf(pageMatch[1]);
          const range = new vscode.Range(i, colStart + 1, i, colStart + 1 + pageName.length);
          const link = new vscode.DocumentLink(range, pageUri);
          link.tooltip = `Open page module: ${pageName}`;
          links.push(link);
        }
      }
    }

    return links;
  }

  /**
   * Resolve a relative path to a file URI.
   */
  private resolvePath(p: string, baseDir: string): vscode.Uri | undefined {
    const fullPath = path.isAbsolute(p) ? p : path.join(baseDir, p);
    if (fs.existsSync(fullPath)) {
      return vscode.Uri.file(fullPath);
    }
    return undefined;
  }

  /**
   * Find a .bal/.bil/.bjl layout file by name in common locations.
   * Returns { uri, tooltip } if found.
   */
  private findLayoutFile(name: string, baseDir: string): { uri: vscode.Uri; tooltip: string } | undefined {
    const extensions = ['.bal', '.bil', '.bjl'];
    const candidates: string[] = [];

    for (const ext of extensions) {
      candidates.push(path.join(baseDir, `${name}${ext}`));
      candidates.push(path.join(baseDir, 'Files', `${name}${ext}`));
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const ext = path.extname(c).toLowerCase();
        return { uri: vscode.Uri.file(c), tooltip: `Open layout file: ${name}${ext}` };
      }
    }
    return undefined;
  }

  /**
   * Find a B4XPages page module by name.
   */
  private findPageModule(pageName: string, baseDir: string): vscode.Uri | undefined {
    // Common conventions: B4XPage_{Name}.bas, {Name}Page.bas, {Name}.bas
    const candidates = [
      path.join(baseDir, `B4XPage_${pageName}.bas`),
      path.join(baseDir, `B4XPage_${pageName}.b4x`),
      path.join(baseDir, `${pageName}Page.bas`),
      path.join(baseDir, `${pageName}.bas`),
      path.join(baseDir, 'B4XPages', `${pageName}.bas`),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return vscode.Uri.file(c);
      }
    }
    return undefined;
  }
}

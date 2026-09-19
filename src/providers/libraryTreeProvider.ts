import * as vscode from 'vscode';
import * as path from 'node:path';
import { LibraryCatalog, LibraryEntry, B4xPlatform } from '../libraryCatalog';

const PLATFORM_ORDER: B4xPlatform[] = ['B4X', 'B4A', 'B4J', 'B4i', 'B4R'];

const PLATFORM_LABELS: Record<B4xPlatform, string> = {
  B4X: 'B4X (Cross-Platform)',
  B4A: 'B4A (Android)',
  B4J: 'B4J (Desktop)',
  B4i: 'B4i (iOS)',
  B4R: 'B4R (Arduino)',
};

const PLATFORM_THEME_ICONS: Record<B4xPlatform, string> = {
  B4X: 'symbol-class',
  B4A: 'device-mobile',
  B4J: 'browser',
  B4i: 'device-mobile',
  B4R: 'circuit-board',
};

type TreeElement = PlatformNode | LibraryNode;

class PlatformNode extends vscode.TreeItem {
  constructor(public readonly platform: B4xPlatform, count: number, _b4iIconUri?: vscode.Uri) {
    super(PLATFORM_LABELS[platform], vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(PLATFORM_THEME_ICONS[platform]);
    this.description = `${count}`;
    this.contextValue = 'platform';
  }
}

class LibraryNode extends vscode.TreeItem {
  constructor(public readonly entry: LibraryEntry) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(entry.library_type === 'b4xlib' ? 'package' : 'library');
    const authorLine = entry.author ? `\nby ${entry.author}` : '';
    this.tooltip = `${entry.title}${authorLine}\n${entry.platform} · ${entry.library_type}`;
    this.contextValue = 'library';
    this.command = {
      command: 'b4xIntellisense.openLibraryDetail',
      title: 'Open Library Detail',
      arguments: [entry],
    };
  }
}

export class LibraryTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: LibraryEntry[] = [];
  private readonly b4iIconUri: vscode.Uri;

  constructor(private catalog: LibraryCatalog, extensionUri: vscode.Uri) {
    this.b4iIconUri = vscode.Uri.joinPath(extensionUri, 'media', 'b4i-icon.svg');
    catalog.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.entries = this.catalog.getEntries();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): Thenable<TreeElement[]> {
    if (!element) {
      const groups = this.groupByPlatform();
      return Promise.resolve(
        PLATFORM_ORDER
          .filter(p => (groups[p]?.length ?? 0) > 0)
          .map(p => new PlatformNode(p, groups[p]!.length, this.b4iIconUri)),
      );
    }
    if (element instanceof PlatformNode) {
      const groups = this.groupByPlatform();
      const libs: LibraryEntry[] = groups[element.platform] ?? [];
      return Promise.resolve(
        libs.sort((a, b) => a.name.localeCompare(b.name)).map(l => new LibraryNode(l)),
      );
    }
    return Promise.resolve([]);
  }

  private groupByPlatform(): Record<string, LibraryEntry[]> {
    const groups: Record<string, LibraryEntry[]> = {};
    for (const entry of this.entries) {
      if (!groups[entry.platform]) {
        groups[entry.platform] = [];
      }
      groups[entry.platform]!.push(entry);
    }
    return groups;
  }
}
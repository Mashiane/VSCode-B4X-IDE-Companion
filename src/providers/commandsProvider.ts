import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class CommandsProvider implements vscode.TreeDataProvider<CommandsProvider.CommandItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CommandsProvider.CommandItem | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: CommandsProvider.CommandItem[] = [];
  private treeView: vscode.TreeView<CommandsProvider.CommandItem> | undefined;

  constructor(private context: vscode.ExtensionContext) {
    // Watch for config changes so the root label can be updated without a full reload
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('b4xIntellisense.projectsViewName')) this.reload().catch(() => {});
    }));
    void this.reload();
  }

  /** Binds the provider to its tree view so we can update the title dynamically. */
  public bindView(view: vscode.TreeView<CommandsProvider.CommandItem>): void {
    this.treeView = view;
    // Initial title update if we already finished a reload
    this.updateViewTitle();
  }

  private updateViewTitle(): void {
    if (!this.treeView) return;
    try {
      const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
      let title = cfg.get<string>('projectsViewName', 'Projects');
      const lastProjectFile = this.context.globalState?.get<string>('b4x.lastOpenedProjectFile') || '';
      if (lastProjectFile && typeof lastProjectFile === 'string' && lastProjectFile.trim() !== '') {
        const base = path.basename(lastProjectFile);
        const projectTitle = base.substring(0, base.length - path.extname(base).length);
        if (projectTitle) title = projectTitle;
      }
      this.treeView.title = title;
    } catch { /* best-effort */ }
  }

  public async reload(): Promise<void> {
    try {
      const pkgPath = path.join(this.context.extensionPath, 'package.json');
      const content = await fs.promises.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      const menuEntries = (pkg && pkg.contributes && pkg.contributes.menus && pkg.contributes.menus.commandPalette) || [];
      // Build allowed set from commandPalette menus. Commands explicitly hidden with `when: "false"`
      // will be excluded.
      let allowed: Set<string> | null = null;
      if (Array.isArray(menuEntries) && menuEntries.length > 0) {
        allowed = new Set<string>();
        for (const me of menuEntries) {
          if (!me) continue;
          if (typeof me === 'string') { allowed.add(me); continue; }
          const cmd = (me as any).command;
          if (!cmd) continue;
          const when = (me as any).when;
          if (typeof when === 'string' && when.trim().toLowerCase() === 'false') continue;
          allowed.add(cmd);
        }
      }

      const cmds = (pkg && pkg.contributes && pkg.contributes.commands) || [];
      if (allowed && allowed.size > 0) {
        const contributedIds = new Set<string>(cmds.map((c: any) => c.command));
        this.items = cmds
          .filter((c: any) => allowed!.has(c.command))
          .map((c: any) => new CommandsProvider.CommandItem(c.title || c.command, c.command));
        // If there are allowed commands not listed under contributes.commands, add them by id
        for (const id of Array.from(allowed)) {
          if (!contributedIds.has(id)) {
            this.items.push(new CommandsProvider.CommandItem(id, id));
          }
        }
      } else {
        this.items = cmds.map((c: any) => new CommandsProvider.CommandItem(c.title || c.command, c.command));
      }

      // Filter out VS Code auto-generated view-focus commands so they don't appear
      // in our Projects tree (these are built-in workbench commands like
      // "workbench.view.extension.<id>"). We cannot remove those built-in
      // commands from the global Command Palette, but we can keep them out
      // of our extension's tree view.
      this.items = this.items.filter((it: CommandsProvider.CommandItem) => {
        return !(typeof it.commandId === 'string' && it.commandId.startsWith('workbench.view.extension.'));
      });

      // Update the tree view title to reflect the current project name
      this.updateViewTitle();
      this._onDidChangeTreeData.fire(undefined);
    } catch (err) {
      // fallback: list all registered commands filtered by prefix
      try {
        const all = await vscode.commands.getCommands(true);
        const filtered = all.filter((id) => typeof id === 'string' && id.startsWith('b4xIntellisense.'));
        this.items = filtered.map((id) => new CommandsProvider.CommandItem(id, id));
        this._onDidChangeTreeData.fire(undefined);
      } catch {
        this.items = [];
      }
    }
  }

  getTreeItem(element: CommandsProvider.CommandItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandsProvider.CommandItem): Thenable<CommandsProvider.CommandItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(this.items);
  }
}

export namespace CommandsProvider {
  export class CommandItem extends vscode.TreeItem {
    constructor(
      public readonly label: string,
      public readonly commandId: string,
    ) {
      super(label, vscode.TreeItemCollapsibleState.None);
      this.tooltip = `${this.label}`;
      this.command = {
        title: this.label,
        command: this.commandId,
      };
      // Use the generic terminal icon for commands to differentiate them from files
      this.iconPath = new vscode.ThemeIcon('terminal');
      this.contextValue = 'command';
    }
  }
}

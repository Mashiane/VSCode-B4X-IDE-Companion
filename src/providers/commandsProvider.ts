import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class CommandsProvider implements vscode.TreeDataProvider<CommandsProvider.CommandItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CommandsProvider.CommandItem | undefined | void> =
    new vscode.EventEmitter<CommandsProvider.CommandItem | undefined | void>();
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
        const folders = vscode.workspace.workspaceFolders ?? [];
        const normFile = path.resolve(lastProjectFile).toLowerCase();
        const isInWorkspace = folders.length === 0 || folders.some((f) => {
          const normFolder = path.resolve(f.uri.fsPath).toLowerCase();
          return normFile.startsWith(normFolder + path.sep) || normFile === normFolder;
        });
        if (isInWorkspace && fs.existsSync(lastProjectFile)) {
          const base = path.basename(lastProjectFile);
          const projectTitle = base.substring(0, base.length - path.extname(base).length);
          if (projectTitle) title = projectTitle;
        }
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

      // Dynamically inject "Open in B4X IDE" when a project file is loaded.
      const lastProjectFile = this.context.globalState?.get<string>('b4x.lastOpenedProjectFile') || '';
      if (lastProjectFile && typeof lastProjectFile === 'string' && lastProjectFile.trim() !== '') {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const normFile = path.resolve(lastProjectFile).toLowerCase();
        const isInWorkspace = folders.length === 0 || folders.some((f) => {
          const normFolder = path.resolve(f.uri.fsPath).toLowerCase();
          return normFile.startsWith(normFolder + path.sep) || normFile === normFolder;
        });
        if (isInWorkspace && fs.existsSync(lastProjectFile)) {
          const ext = path.extname(lastProjectFile).toLowerCase();
        if (ext === '.b4a' || ext === '.b4i' || ext === '.b4j' || ext === '.b4r') {
          const platformName = ext.slice(1).toUpperCase();
          const openPlatformItem = new CommandsProvider.CommandItem(
            `Open in ${platformName} IDE`,
            'b4xIntellisense.openPlatform',
          );
          // Insert right after "Open B4X Project..." if present, otherwise at top
          const openProjectIdx = this.items.findIndex(
            (it) => it.commandId === 'b4xIntellisense.openB4xProject',
          );
          if (openProjectIdx >= 0) {
            this.items.splice(openProjectIdx + 1, 0, openPlatformItem);
          } else {
            this.items.unshift(openPlatformItem);
          }
        }
        }
      }

      // Group Ollama and DeepSeek launch commands into a collapsible submenu
      const ollamaCmdIds = [
        'b4xIntellisense.ollamaLaunchClaude',
        'b4xIntellisense.ollamaLaunchCopilot',
        'b4xIntellisense.ollamaLaunchOpenCode',
        'b4xIntellisense.ollamaLaunchCodex',
        'b4xIntellisense.deepseekLaunch',
      ];
      const ollamaItems = this.items.filter((it) => it.commandId && ollamaCmdIds.includes(it.commandId));
      if (ollamaItems.length > 0) {
        const firstOllamaIdx = this.items.findIndex((it) => it.commandId && ollamaCmdIds.includes(it.commandId));
        // Remove individual items from top level
        this.items = this.items.filter((it) => !it.commandId || !ollamaCmdIds.includes(it.commandId));
        // Clean child labels
        const children = ollamaItems.map((it) => {
          let cleanLabel = it.label.replace(/^Ollama Launch\s+/i, '').replace(/\s+Launch$/i, '');
          return new CommandsProvider.CommandItem(cleanLabel, it.commandId);
        });
        const groupItem = new CommandsProvider.CommandItem(
          'Ollama Launch',
          'group.ollama',
          children,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.items.splice(firstOllamaIdx, 0, groupItem);
      }

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
      return Promise.resolve(element.children || []);
    }
    return Promise.resolve(this.items);
  }
}

export namespace CommandsProvider {
  export class CommandItem extends vscode.TreeItem {
    public children?: CommandItem[];

    constructor(
      public readonly label: string,
      public readonly commandId?: string,
      children?: CommandItem[],
      collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
      super(
        label,
        children && children.length > 0
          ? (collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed)
          : vscode.TreeItemCollapsibleState.None,
      );
      this.children = children;
      this.tooltip = `${this.label}`;
      if (this.commandId && (!children || children.length === 0)) {
        this.command = {
          title: this.label,
          command: this.commandId,
        };
      }
      // Assign contextual ThemeIcon based on command or parent category
      this.iconPath = CommandItem.getIconForCommand(commandId, children);
      this.contextValue = children && children.length > 0 ? 'folder' : 'command';
    }

    private static getIconForCommand(id?: string, children?: CommandItem[]): vscode.ThemeIcon {
      if (children && children.length > 0) {
        return new vscode.ThemeIcon('hubot');
      }
      switch (id) {
        case 'b4xIntellisense.ollamaLaunchClaude':
        case 'b4xIntellisense.ollamaLaunchCopilot':
        case 'b4xIntellisense.ollamaLaunchOpenCode':
        case 'b4xIntellisense.ollamaLaunchCodex':
          return new vscode.ThemeIcon('play');
        case 'b4xIntellisense.deepseekLaunch':
          return new vscode.ThemeIcon('terminal');
        case 'b4xIntellisense.copyAiContextBundle':
        case 'b4xIntellisense.packageCodeBundle':
          return new vscode.ThemeIcon('sparkle');
        case 'b4xIntellisense.remapJavaStackTrace':
          return new vscode.ThemeIcon('debug-alt');
        case 'b4xIntellisense.doctor':
        case 'b4xIntellisense.checkHealth':
          return new vscode.ThemeIcon('heart');
        case 'b4xIntellisense.packageB4XLib':
          return new vscode.ThemeIcon('package');
        case 'b4xIntellisense.exportLayoutJson':
          return new vscode.ThemeIcon('export');
        case 'b4xIntellisense.importLayoutJson':
          return new vscode.ThemeIcon('import');
        case 'b4xIntellisense.reloadProject':
          return new vscode.ThemeIcon('refresh');
        case 'b4xIntellisense.openB4xProject':
          return new vscode.ThemeIcon('folder-opened');
        case 'b4xIntellisense.newB4xProjectFromTemplate':
          return new vscode.ThemeIcon('new-file');
        case 'b4xIntellisense.captureScreenshots':
          return new vscode.ThemeIcon('device-camera');
        case 'b4xIntellisense.captureGif':
          return new vscode.ThemeIcon('device-camera-video');
        case 'b4xIntellisense.startEmulator':
          return new vscode.ThemeIcon('device-mobile');
        case 'b4xIntellisense.openBjlEditor':
          return new vscode.ThemeIcon('layout');
        case 'b4xIntellisense.browseLibraries':
          return new vscode.ThemeIcon('library');
        case 'b4xIntellisense.showProjectStatistics':
          return new vscode.ThemeIcon('graph');
        case 'b4xIntellisense.openSettings':
          return new vscode.ThemeIcon('settings-gear');
        default:
          return new vscode.ThemeIcon('terminal');
      }
    }
  }
}

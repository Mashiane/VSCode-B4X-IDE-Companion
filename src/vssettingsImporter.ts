import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const key = m[1] ?? '';
    const val = m[2] ?? '';
    if (key) attrs[key] = val;
  }
  return attrs;
}

function normalizeColor(color?: string): string | undefined {
  if (!color) return undefined;
  // VS .vssettings colors may be #AARRGGBB or #RRGGBB; convert to #RRGGBB
  let hex = color.replace(/^#/, '');
  // also accept 0xAARRGGBB format
  if (/^0x[0-9a-fA-F]{8}$/.test(color)) {
    hex = color.slice(2);
  }
  if (hex.length === 8) {
    // hex is AARRGGBB => preserve alpha by returning rgba if not fully opaque
    const aa = parseInt(hex.slice(0, 2), 16);
    const rr = parseInt(hex.slice(2, 4), 16);
    const gg = parseInt(hex.slice(4, 6), 16);
    const bb = parseInt(hex.slice(6, 8), 16);
    if (aa === 255) {
      return `#${hex.slice(2)}`;
    }
    const a = +(aa / 255).toFixed(3);
    return `rgba(${rr}, ${gg}, ${bb}, ${a})`;
  }
  if (hex.length === 6) {
    return `#${hex}`;
  }
  return undefined;
}

function extractItemsFromVsSettings(xml: string): Array<{ name: string; foreground?: string; background?: string; bold?: boolean; italic?: boolean }> {
  const items: Array<any> = [];
  // Look for <Item ... /> or <Item ...></Item>
  const re = /<Item\s+([^>]+?)\s*(?:\/\s*>|>\s*<\/Item>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrText = m[1] ?? '';
    const attrs = parseAttributes(attrText);
    if (attrs['Name']) {
      items.push({
        name: attrs['Name'],
        foreground: normalizeColor(attrs['Foreground'] ?? attrs['ForegroundColor']),
        background: normalizeColor(attrs['Background'] ?? attrs['BackgroundColor']),
        bold: attrs['Bold'] ? attrs['Bold'].toLowerCase() === 'true' : undefined,
        italic: attrs['Italic'] ? attrs['Italic'].toLowerCase() === 'true' : undefined,
      });
    }
  }

  return items;
}

const vsToScope: Record<string, string[]> = {
  'Plain Text': ['source'],
  Keyword: ['keyword'],
  Identifier: ['variable'],
  String: ['string'],
  Comment: ['comment'],
  Number: ['constant.numeric'],
  'User Types': ['entity.name.type'],
  'User Types - Value': ['variable.other.constant'],
  'User Types - Methods': ['entity.name.function'],
  'User Types - Members': ['variable.other.property'],
  'XML Attribute': ['entity.other.attribute-name'],
  'XML Element': ['entity.name.tag'],
  'HTML Tag': ['entity.name.tag'],
  Function: ['entity.name.function'],
  Method: ['entity.name.function'],
  Property: ['variable.other.property'],
  Operator: ['keyword.operator'],
  Delimiter: ['punctuation.separator'],
  Punctuation: ['punctuation.definition'],
  Preprocessor: ['meta.preprocessor'],
  Keyword2: ['storage.type'],
  'Type (Name)': ['entity.name.type'],
  'Type (Value)': ['variable.other.constant'],
  'Identifier (User)': ['variable.other'],
  'Selection': ['markup.selection'],
  'Line Number': ['meta.line-number'],
  'XML Comment': ['comment'],
};

// UI/editor mappings: map VS Fonts & Colors item names to VS Code theme.colors keys
const uiToThemeColor: Record<string, { key: string; prefer: 'foreground' | 'background' }> = {
  'Line Numbers': { key: 'editorLineNumber.foreground', prefer: 'foreground' },
  'Current Line': { key: 'editor.lineHighlightBackground', prefer: 'background' },
  'Current Statement': { key: 'editor.lineHighlightBorder', prefer: 'background' },
  'Selection Highlight': { key: 'editor.selectionBackground', prefer: 'background' },
  'Indentation Guides': { key: 'editorIndentGuide.background', prefer: 'foreground' },
  'Find Match Highlight': { key: 'editor.findMatchBackground', prefer: 'background' },
  'Plain Text': { key: 'editor.foreground', prefer: 'foreground' },
  'Whitespace': { key: 'editorWhitespace.foreground', prefer: 'foreground' },
  'Syntax Error': { key: 'editorError.foreground', prefer: 'foreground' },
  'Warning': { key: 'editorWarning.foreground', prefer: 'foreground' },
  'Selection': { key: 'editor.selectionBackground', prefer: 'background' },
  'Line Number': { key: 'editorLineNumber.foreground', prefer: 'foreground' },
};

export async function importVsSettingsFile(uri?: vscode.Uri, autoApply: boolean = false): Promise<void> {
  try {
    let fileUri = uri;
    if (!fileUri) {
      const picks = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'VS Settings': ['vssettings', 'xml'] }, openLabel: 'Import .vssettings' });
      if (!picks || picks.length === 0) return;
      fileUri = picks[0];
    }
    if (!fileUri) return;
    const filePath = fileUri.fsPath;
    const raw = await fs.readFile(filePath, 'utf8');
    const items = extractItemsFromVsSettings(raw);
    const tokenColors: any[] = [];
  const themeColors: Record<string, string> = {};

    for (const item of items) {
      try {
        // First check UI/editor mapping
        const ui = uiToThemeColor[item.name];
        if (ui) {
          const colorSource = ui.prefer === 'background' ? item.background || item.foreground : item.foreground || item.background;
          const col = normalizeColor(colorSource);
          if (col) {
            themeColors[ui.key] = col;
          }
          continue;
        }

        const scopes = vsToScope[item.name];
        if (!scopes) {
          // ignore unmapped items silently
          continue;
        }

        const settingsObj: any = {};
        if (item.foreground) settingsObj.foreground = item.foreground;
        if (item.background) settingsObj.background = item.background;
        const fontStyles: string[] = [];
        if (item.bold) fontStyles.push('bold');
        if (item.italic) fontStyles.push('italic');
        if (fontStyles.length > 0) settingsObj.fontStyle = fontStyles.join(' ');
        if (Object.keys(settingsObj).length === 0) continue;
        tokenColors.push({ scope: scopes, settings: settingsObj });
      } catch (err) {
        // ignore individual item errors to keep import resilient
        console.warn('B4X: failed to map vssettings item', item.name, err);
        continue;
      }
    }

    if (tokenColors.length === 0) {
      void vscode.window.showWarningMessage('No mappable Fonts & Colors items found in the selected .vssettings file.');
      return;
    }

    // Build theme object
    const theme: any = {
      name: `B4X Imported Theme (${path.basename(filePath)})`,
      type: 'dark',
      colors: themeColors,
      tokenColors,
    };

    // Determine output folder: workspace or ask
    let outFolder: string | undefined;
    const wf = vscode.workspace.workspaceFolders;
    if (wf && wf.length > 0) {
      outFolder = wf[0]!.uri.fsPath;
    } else {
      const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Select folder to save theme' });
      if (!pick || pick.length === 0) return;
      outFolder = pick[0]!.fsPath;
    }

    const vscodeDir = path.join(outFolder, '.vscode');
    try { await fs.mkdir(vscodeDir, { recursive: true }); } catch {}
    const themePath = path.join(vscodeDir, 'b4x-imported-theme.json');
    await fs.writeFile(themePath, JSON.stringify(theme, null, 2), 'utf8');

    void vscode.window.showInformationMessage(`B4X: Generated theme at ${path.relative(outFolder, themePath)}. Apply it from Color Theme settings.`);

    // Optionally merge the generated theme colors and token rules into workspace settings
    const mergeIntoWorkspaceSettings = async (): Promise<void> => {
      try {
        const workbenchCfg = vscode.workspace.getConfiguration();
        // Merge color customizations
        const existingColors = workbenchCfg.get<Record<string, string>>('workbench.colorCustomizations') || {};
        const mergedColors = Object.assign({}, existingColors, theme.colors || {});
        await workbenchCfg.update('workbench.colorCustomizations', mergedColors, vscode.ConfigurationTarget.Workspace);

        // Merge token color customizations (textMateRules)
        const existingTokenCustom = workbenchCfg.get<any>('editor.tokenColorCustomizations') || {};
        const existingRules: any[] = existingTokenCustom.textMateRules || [];
        // Convert tokenColors into textMateRules entries
        const newRules = tokenColors.map((r: any) => ({ name: r.name, scope: r.scope, settings: r.settings }));
        const combinedRules = [...existingRules, ...newRules];
        existingTokenCustom.textMateRules = combinedRules;
        await workbenchCfg.update('editor.tokenColorCustomizations', existingTokenCustom, vscode.ConfigurationTarget.Workspace);

        void vscode.window.showInformationMessage(`B4X: Applied generated theme colors to workspace settings.`);
      } catch (err) {
        console.warn('B4X: failed to merge generated theme into workspace settings', err);
        void vscode.window.showErrorMessage('B4X: Failed to apply generated theme to workspace settings. Check console for details.');
      }
    };

    if (autoApply) {
      await mergeIntoWorkspaceSettings();
    } else {
      const apply = 'Apply Now';
      const answer = await vscode.window.showInformationMessage('Apply generated theme now?', apply, 'No');
      if (answer === apply) {
        await mergeIntoWorkspaceSettings();
      }
    }
  } catch (err) {
    console.error('Failed to import .vssettings', err);
    void vscode.window.showErrorMessage('Failed to import .vssettings file. See console for details.');
  }
}

export default importVsSettingsFile;

export async function tryImportThemeFromB4aInstall(installPath: string, themeHint: string): Promise<string | null> {
  try {
    const themesDir = path.join(installPath, 'Themes');
    const stat = await fs.stat(themesDir).catch(() => undefined);
    if (!stat || !stat.isDirectory()) return null;

    const entries = await fs.readdir(themesDir, { withFileTypes: true });
    const candidates: string[] = [];
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.vssettings')) {
        candidates.push(path.join(themesDir, e.name));
      }
    }

    const hint = (themeHint || '').toLowerCase();
    // prefer filename match
    let match = candidates.find((c) => path.basename(c).toLowerCase().includes(hint));
    if (!match) {
      // fallback: search inside files
      for (const c of candidates) {
        const content = await fs.readFile(c, 'utf8').catch(() => '');
        if (content.toLowerCase().includes(hint)) { match = c; break; }
      }
    }

    if (!match) return null;
    return match;
  } catch (err) {
    console.warn('Failed to search Themes folder for .vssettings', err);
    return null;
  }
}

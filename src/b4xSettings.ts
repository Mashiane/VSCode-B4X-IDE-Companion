import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

function readWorkspaceSettingsObject(): Record<string, any> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    try {
      const settingsPath = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore malformed workspace settings and continue
    }
  }
  return {};
}

export function getB4xStringSetting(key: string, fallback = ''): string {
  const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
  const direct = cfg.get<string>(key, fallback);
  if (typeof direct === 'string' && direct.trim() !== '') return direct;
  const workspaceSettings = readWorkspaceSettingsObject();
  const raw = workspaceSettings[`b4xIntellisense.${key}`];
  return typeof raw === 'string' ? raw : fallback;
}

export function getB4xBooleanSetting(key: string, fallback = false): boolean {
  const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
  const direct = cfg.get<boolean>(key, fallback);
  if (typeof direct === 'boolean' && direct !== fallback) return direct;
  const workspaceSettings = readWorkspaceSettingsObject();
  const raw = workspaceSettings[`b4xIntellisense.${key}`];
  return typeof raw === 'boolean' ? raw : direct;
}

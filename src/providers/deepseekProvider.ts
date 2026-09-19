import * as vscode from 'vscode';

export async function isDeepSeekRunning(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(3_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function promptForDeepSeekModel(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Enter DeepSeek Model Name',
    value: 'deepseek-v4-pro:cloud',
    placeHolder: 'e.g. deepseek-v4-pro:cloud',
    ignoreFocusOut: true,
  });
}
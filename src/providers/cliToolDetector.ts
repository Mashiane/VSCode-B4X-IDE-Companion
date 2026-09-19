import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface CliToolInfo {
  id: string;
  name: string;
  command: string;
  installCommand: string;
}

export const CLI_TOOLS: Record<'claude' | 'copilot' | 'opencode' | 'codex', CliToolInfo> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    installCommand: 'npm install -g @github/copilot',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    installCommand: 'npm install -g opencode-ai',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    installCommand: 'npm install -g @openai/codex',
  },
};

/**
 * Checks whether the given CLI binary is available on the system PATH.
 */
export async function isCliInstalled(toolCommand: string): Promise<boolean> {
  const lookupCmd = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise<boolean>((resolve) => {
    cp.execFile(lookupCmd, [toolCommand], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout || stdout.trim().length === 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Ensures a CLI tool is installed. If missing, prompts the user to install it.
 * Returns true if the tool is installed, or false if not installed / cancelled.
 */
export async function ensureCliToolInstalled(tool: CliToolInfo): Promise<boolean> {
  const installed = await isCliInstalled(tool.command);
  if (installed) {
    return true;
  }

  const selection = await vscode.window.showWarningMessage(
    `${tool.name} ("${tool.command}") is not installed or not in PATH. Would you like to install it now?`,
    'Install Now',
    'Cancel'
  );

  if (selection !== 'Install Now') {
    return false;
  }

  const term = vscode.window.createTerminal({ name: `Install ${tool.name}` });
  term.show(true);
  term.sendText(tool.installCommand, true);

  void vscode.window.showInformationMessage(
    `Running: "${tool.installCommand}". Once installation finishes, run the launch command again.`
  );

  return false;
}

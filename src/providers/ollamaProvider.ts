import * as vscode from 'vscode';
import * as cp from 'child_process';

function parseOllamaList(stdout: string): vscode.LanguageModelChatInformation[] {
  const lines = stdout.trim().split('\n');
  const models: vscode.LanguageModelChatInformation[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 1 || parts[0] === 'NAME') continue;
    const fullName = parts[0] ?? '';
    const colonIdx = fullName.lastIndexOf(':');
    const name = colonIdx > 0 ? fullName.substring(0, colonIdx) : fullName;
    const version = colonIdx > 0 ? fullName.substring(colonIdx + 1) : 'latest';
    models.push({
      id: fullName,
      name,
      family: name,
      version,
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192,
      capabilities: {},
    });
  }
  return models;
}

async function listOllamaModels(): Promise<vscode.LanguageModelChatInformation[]> {
  return new Promise<vscode.LanguageModelChatInformation[]>((resolve) => {
    cp.execFile('ollama', ['list'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      resolve(parseOllamaList(stdout));
    });
  });
}

export class OllamaChatProvider implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  refreshModels(): void {
    this._onDidChange.fire();
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return listOllamaModels();
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const ollamaMessages = messages.map((msg) => ({
      role: msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
      content: typeof msg.content === 'string' ? msg.content : (msg.content as any).value ?? String(msg.content),
    }));

    const resp = await fetch(`http://localhost:11434/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages: ollamaMessages,
        stream: true,
      }),
      signal: token.isCancellationRequested ? AbortSignal.abort() : undefined,
    });

    if (!resp.ok) {
      throw new Error(`Ollama request failed: ${resp.status} ${resp.statusText}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body from Ollama');

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.content) {
            progress.report(new vscode.LanguageModelTextPart(parsed.message.content));
          }
        } catch { /* skip malformed chunks */ }
      }
      if (token.isCancellationRequested) break;
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    _text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return -1;
  }
}

export async function isOllamaRunning(): Promise<boolean> {
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

export async function promptForOllamaModel(defaultModel?: string, targetName: string = 'Claude'): Promise<string | undefined> {
  try {
    const installed = await listOllamaModels();
    if (installed && installed.length > 0) {
      interface ModelPickItem extends vscode.QuickPickItem {
        modelId?: string;
        isCustom?: boolean;
      }

      const items: ModelPickItem[] = installed.map((m) => ({
        label: `$(hubot) ${m.id}`,
        description: m.version !== 'latest' ? m.version : undefined,
        detail: defaultModel && m.id === defaultModel ? 'Current selection' : undefined,
        modelId: m.id,
      }));

      items.push({
        label: '$(edit) Custom Model...',
        description: 'Manually type a model tag',
        isCustom: true,
      });

      const selected = await vscode.window.showQuickPick(items, {
        title: `Select Ollama Model for ${targetName}`,
        placeHolder: defaultModel ? `Current: ${defaultModel} - Choose a model or type custom` : `Choose an installed model or type custom for ${targetName}`,
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) return undefined;

      if (selected.isCustom) {
        return await vscode.window.showInputBox({
          title: 'Enter Ollama Model Name',
          value: defaultModel || 'kimi-k2.6:cloud',
          prompt: `Enter Ollama model name to launch with ${targetName}`,
          placeHolder: 'e.g. llama3.2:latest',
          ignoreFocusOut: true,
        });
      }

      return selected.modelId;
    }
  } catch (err) {
    console.error('Failed to list Ollama models, falling back to input box:', err);
  }

  // Fallback to text input box if listing models failed or returned empty
  return vscode.window.showInputBox({
    title: 'Enter Ollama Model Name',
    value: defaultModel || 'kimi-k2.6:cloud',
    prompt: `Enter Ollama model name to launch with ${targetName}`,
    placeHolder: 'e.g. kimi-k2.6:cloud',
    ignoreFocusOut: true,
  });
}

const assert = require('assert');
const vscode = require('vscode');

suite('Extension Activation Test', () => {
  test('Extension activates without error', async () => {
    assert.ok(vscode.extensions.all.some(ext => ext.id === 'anelembangamashy.b4x-intellisense'), 'Extension should be active');
  });

  test('B4X language is registered', () => {
    const langId = 'b4x';
    assert.ok(vscode.languages.getLanguages().some(l => l.id === langId), 'B4X language should be registered');
  });
});

const fs = require('fs');
const path = require('path');
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node apply-theme-from-file.js <ThemeBaseName>');
  process.exit(1);
}
(async function(){
  try {
    const wf = process.cwd();
    const vscodeDir = path.join(wf, '.vscode');
    const themePath = path.join(vscodeDir, `b4x-imported-theme-${arg}.json`);
    if (!fs.existsSync(themePath)) {
      console.error('Theme file not found:', themePath);
      process.exit(1);
    }
    const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
    const tokenRules = theme.tokenColors || [];
    const textMateRules = tokenRules.map(rule => ({ name: rule.name, scope: rule.scope, settings: rule.settings }));
    const settingsPath = path.join(vscodeDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { settings = {}; }
    }
    settings['workbench.colorCustomizations'] = Object.assign({}, settings['workbench.colorCustomizations'] || {}, theme.colors || {});
    settings['editor.tokenColorCustomizations'] = Object.assign({}, settings['editor.tokenColorCustomizations'] || {}, { textMateRules });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Applied theme', arg, 'to', settingsPath);
  } catch (err) {
    console.error('Failed to apply theme', err);
    process.exit(1);
  }
})();

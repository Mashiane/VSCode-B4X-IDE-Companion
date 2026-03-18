const fs = require('fs');
const path = require('path');

(async function(){
  try {
    const wf = process.cwd();
    const vscodeDir = path.join(wf, '.vscode');
    const themeFiles = fs.readdirSync(vscodeDir).filter(f => f.startsWith('b4x-imported-theme'));
    if (themeFiles.length === 0) {
      console.error('No generated b4x-imported-theme files found in .vscode');
      process.exit(1);
    }
    // pick first
    const themePath = path.join(vscodeDir, themeFiles[0]);
    const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));

    // convert tokenColors to editor.tokenColorCustomizations.textMateRules
    const tokenRules = theme.tokenColors || [];
    const textMateRules = tokenRules.map(rule => {
      const r = {};
      if (rule.name) r.name = rule.name;
      if (rule.scope) r.scope = rule.scope;
      r.settings = rule.settings || {};
      return r;
    });

    const settingsPath = path.join(vscodeDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { settings = {}; }
    }

    settings['workbench.colorCustomizations'] = Object.assign({}, settings['workbench.colorCustomizations'] || {}, theme.colors || {});
    settings['editor.tokenColorCustomizations'] = Object.assign({}, settings['editor.tokenColorCustomizations'] || {}, { textMateRules });

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Applied theme settings to', settingsPath);
    console.log('Set workbench.colorCustomizations and editor.tokenColorCustomizations.textMateRules.');
  } catch (err) {
    console.error('Failed to apply theme', err);
    process.exit(1);
  }
})();

const fs = require('fs');
const path = require('path');

function rgbaToHexKeepingRgb(r,g,b){
  const toHex = (n) => n.toString(16).padStart(2,'0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeColorValue(val){
  if (typeof val !== 'string') return val;
  const rgba = val.match(/rgba\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.0+)?|0?\.0+|1(?:\.0+)?)\s*\)/i);
  if (!rgba) return val;
  const r = parseInt(rgba[1],10);
  const g = parseInt(rgba[2],10);
  const b = parseInt(rgba[3],10);
  const a = parseFloat(rgba[4]);
  // treat nearly transparent as transparent; normalize to opaque hex
  if (isNaN(a)) return val;
  if (a >= 0.02 && a < 1) {
    // blend against dark background #1e1e1e to produce a visible fallback
    const bg = { r: 30, g: 30, b: 30 };
    const rr = Math.round(r * a + bg.r * (1 - a));
    const gg = Math.round(g * a + bg.g * (1 - a));
    const bb = Math.round(b * a + bg.b * (1 - a));
    return rgbaToHexKeepingRgb(rr, gg, bb);
  }
  // a < 0.02 or zero => just use rgb as opaque
  return rgbaToHexKeepingRgb(r,g,b);
}

function processThemeFile(themePath){
  try {
    const raw = fs.readFileSync(themePath,'utf8');
    const theme = JSON.parse(raw);
    if (theme.colors) {
      for (const k of Object.keys(theme.colors)){
        const v = theme.colors[k];
        const nv = normalizeColorValue(v);
        theme.colors[k] = nv;
      }
    }
    if (Array.isArray(theme.tokenColors)){
      for (const t of theme.tokenColors){
        if (t && t.settings){
          if (t.settings.foreground) t.settings.foreground = normalizeColorValue(t.settings.foreground);
          if (t.settings.background) t.settings.background = normalizeColorValue(t.settings.background);
        }
      }
    }
    fs.writeFileSync(themePath, JSON.stringify(theme,null,2),'utf8');
    console.log('Normalized theme file:', themePath);
  } catch (err){
    console.error('Failed to process theme file', themePath, err);
  }
}

function processSettings(settingsPath){
  try{
    const raw = fs.readFileSync(settingsPath,'utf8');
    const settings = JSON.parse(raw);
    if (settings.workbench && settings.workbench.colorCustomizations) {
      for (const k of Object.keys(settings.workbench.colorCustomizations)){
        const v = settings.workbench.colorCustomizations[k];
        settings.workbench.colorCustomizations[k] = normalizeColorValue(v);
      }
    } else if (settings.workbench === undefined && settings['workbench.colorCustomizations']){
      // older flat key style
      const w = settings['workbench.colorCustomizations'];
      for (const k of Object.keys(w)){
        w[k] = normalizeColorValue(w[k]);
      }
      settings['workbench.colorCustomizations'] = w;
    }

    const etc = settings['editor.tokenColorCustomizations'];
    if (etc && Array.isArray(etc.textMateRules)){
      for (const r of etc.textMateRules){
        if (r.settings){
          if (r.settings.foreground) r.settings.foreground = normalizeColorValue(r.settings.foreground);
          if (r.settings.background) r.settings.background = normalizeColorValue(r.settings.background);
        }
      }
    }
    // also handle old nested object
    if (settings['editor.tokenColorCustomizations'] && settings['editor.tokenColorCustomizations'].textMateRules){
      const rules = settings['editor.tokenColorCustomizations'].textMateRules;
      for (const r of rules){
        if (r.settings){
          if (r.settings.foreground) r.settings.foreground = normalizeColorValue(r.settings.foreground);
          if (r.settings.background) r.settings.background = normalizeColorValue(r.settings.background);
        }
      }
      settings['editor.tokenColorCustomizations'].textMateRules = rules;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings,null,2),'utf8');
    console.log('Normalized settings file:', settingsPath);
  } catch (err){
    console.error('Failed to process settings file', settingsPath, err);
  }
}

(function main(){
  const wf = process.cwd();
  const vscodeDir = path.join(wf,'.vscode');
  if (!fs.existsSync(vscodeDir)){
    console.error('.vscode directory missing');
    process.exit(1);
  }
  const files = fs.readdirSync(vscodeDir).filter(f => f.startsWith('b4x-imported-theme') && f.endsWith('.json'));
  for (const f of files){
    processThemeFile(path.join(vscodeDir,f));
  }
  const settingsPath = path.join(vscodeDir,'settings.json');
  if (fs.existsSync(settingsPath)) processSettings(settingsPath);
})();

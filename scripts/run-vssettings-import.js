const fs = require('fs');
const path = require('path');

// Minimal re-implementation of the importer logic to run outside VS Code
function parseAttributes(attrText) {
  const attrs = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function normalizeColor(color) {
  if (!color) return undefined;
  let hex = color.replace(/^#/, '');
  if (/^0x[0-9a-fA-F]{8}$/.test(color)) hex = color.slice(2);
  if (hex.length === 8) {
    const aa = parseInt(hex.slice(0,2),16);
    const rr = parseInt(hex.slice(2,4),16);
    const gg = parseInt(hex.slice(4,6),16);
    const bb = parseInt(hex.slice(6,8),16);
    if (aa === 255) return `#${hex.slice(2)}`;
    const a = +(aa/255).toFixed(3);
    return `rgba(${rr}, ${gg}, ${bb}, ${a})`;
  }
  if (hex.length === 6) return `#${hex}`;
  return undefined;
}

function extractItems(xml) {
  const items = [];
  const re = /<Item\s+([^>]+?)\s*(?:\/\s*>|>\s*<\/Item>)/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrText = m[1] || '';
    const attrs = parseAttributes(attrText);
    if (attrs['Name']) {
      items.push({
        name: attrs['Name'],
        foreground: normalizeColor(attrs['Foreground'] || attrs['ForegroundColor']),
        background: normalizeColor(attrs['Background'] || attrs['BackgroundColor']),
        bold: attrs['Bold'] ? attrs['Bold'].toLowerCase() === 'true' : undefined,
        italic: attrs['Italic'] ? attrs['Italic'].toLowerCase() === 'true' : undefined,
      });
    }
  }
  return items;
}

const uiToThemeColor = {
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

const vsToScope = {
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

(async function main(){
  try {
    const filePath = path.join(__dirname, '..', 'Dark.vssettings');
    if (!fs.existsSync(filePath)) {
      console.error('Dark.vssettings not found:', filePath);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const items = extractItems(raw);
    const tokenColors = [];
    const themeColors = {};
    for (const item of items) {
      const ui = uiToThemeColor[item.name];
      if (ui) {
        const colorSource = ui.prefer === 'background' ? item.background || item.foreground : item.foreground || item.background;
        const col = colorSource;
        if (col) themeColors[ui.key] = col;
        continue;
      }
      const scopes = vsToScope[item.name];
      if (!scopes) continue;
      const settingsObj = {};
      if (item.foreground) settingsObj.foreground = item.foreground;
      if (item.background) settingsObj.background = item.background;
      const fontStyles = [];
      if (item.bold) fontStyles.push('bold');
      if (item.italic) fontStyles.push('italic');
      if (fontStyles.length>0) settingsObj.fontStyle = fontStyles.join(' ');
      if (Object.keys(settingsObj).length===0) continue;
      tokenColors.push({ scope: scopes, settings: settingsObj });
    }
    if (tokenColors.length === 0 && Object.keys(themeColors).length === 0) {
      console.warn('No mappable items found.');
    }
    const theme = {
      name: 'B4X Imported Theme (Dark.vssettings)',
      type: 'dark',
      colors: themeColors,
      tokenColors,
    };
    const outDir = path.join(__dirname, '..', '.vscode');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const outPath = path.join(outDir, 'b4x-imported-theme.json');
    fs.writeFileSync(outPath, JSON.stringify(theme, null, 2), 'utf8');
    console.log('Generated theme at', outPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

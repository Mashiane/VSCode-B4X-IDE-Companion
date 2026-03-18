// Very small heuristic parser for B4X-like files to extract symbols for indexing.
// This is intentionally minimal — it finds Subs, Types, and Class declarations and their ranges.

function parseFile(text, filePath) {
  const lines = text.split(/\r?\n/);
  const symbols = [];

  const subRegex = /^\s*Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const typeRegex = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const classRegex = /^\s*Sub\s+Class_?\s*([A-Za-z_][A-Za-z0-9_]*)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = classRegex.exec(line);
    if (m) {
      const name = m[1] || 'Class';
      symbols.push({ kind: 'class', name, line: i, file: filePath });
      continue;
    }

    m = typeRegex.exec(line);
    if (m) {
      symbols.push({ kind: 'type', name: m[1], line: i, file: filePath });
      continue;
    }

    m = subRegex.exec(line);
    if (m) {
      symbols.push({ kind: 'sub', name: m[1], line: i, file: filePath });
      continue;
    }
  }

  return symbols;
}

module.exports = { parseFile };

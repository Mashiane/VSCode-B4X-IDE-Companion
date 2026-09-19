// Heuristic parser for B4X-like files — extracts Subs, Types, Classes, and Variables.
// Variables declared INSIDE a Sub are tagged scope:'local' so the cross-file duplicate
// check can skip them (local variables are never visible across module boundaries).

function parseFile(text, filePath) {
  const lines = text.split(/\r?\n/);
  const symbols = [];

  const subStartRegex = /^\s*Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const subEndRegex   = /^\s*End\s+Sub\b/i;
  const typeRegex     = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const classRegex    = /^\s*Sub\s+Class_?\s*([A-Za-z_][A-Za-z0-9_]*)/i;
  const varRegex      = /^\s*(?:Dim|Private|Public)\s+([A-Za-z_][A-Za-z0-9_]*)/i;

  // Scope state: null = module level, string = name of current Sub
  let currentSub = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect End Sub — return to module scope
    if (subEndRegex.test(line)) {
      currentSub = null;
      continue;
    }

    // Detect class-level Subs (Class_Globals, etc.) first
    let m = classRegex.exec(line);
    if (m) {
      const name = m[1] || 'Class';
      symbols.push({ kind: 'class', name, line: i, file: filePath, scope: 'module' });
      currentSub = name;
      continue;
    }

    // Detect Type declarations (always module-level in B4X)
    m = typeRegex.exec(line);
    if (m) {
      symbols.push({ kind: 'type', name: m[1], line: i, file: filePath, scope: 'module' });
      continue;
    }

    // Detect Sub start
    m = subStartRegex.exec(line);
    if (m) {
      symbols.push({ kind: 'sub', name: m[1], line: i, file: filePath, scope: 'module' });
      currentSub = m[1];
      continue;
    }

    // Detect variable declarations — scope depends on whether we're inside a Sub
    m = varRegex.exec(line);
    if (m) {
      const scope = currentSub ? 'local' : 'module';
      symbols.push({ kind: 'variable', name: m[1], line: i, file: filePath, scope });
      continue;
    }
  }

  return symbols;
}

module.exports = { parseFile };

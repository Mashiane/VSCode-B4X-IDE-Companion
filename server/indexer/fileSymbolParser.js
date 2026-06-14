// Heuristic parser for B4X-like files used by the LSP indexer.
//
// Goals:
// - Index real top-level symbols useful across files: Subs, Types, and globals
//   declared inside Process_Globals / Globals / Class_Globals.
// - Avoid indexing local Dim variables inside arbitrary Subs. Those caused a lot
//   of false duplicate-symbol diagnostics (Email, Response, Parser, etc.).
// - Support `Public Sub` / `Private Sub` in addition to plain `Sub`.
// - Avoid treating keywords like `As` as variable names when parsing
//   multi-variable declarations.

const GLOBAL_SECTION_NAMES = new Set(['process_globals', 'globals', 'class_globals']);

function parseFile(text, filePath) {
  const lines = text.split(/\r?\n/);
  const symbols = [];

  const subRegex = /^\s*(?:(?:Public|Private)\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const typeRegex = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  const endSubRegex = /^\s*End\s+Sub\b/i;
  const globalsDeclRegex = /^\s*(?:Dim|Public|Private)\s+(.+)$/i;

  let insideGlobalsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = subRegex.exec(line);
    if (m) {
      const name = m[1];
      const lower = name.toLowerCase();

      // Enter globals block, but do not index the synthetic block name itself as
      // a normal symbol: Process_Globals / Globals / Class_Globals exist in many
      // modules by design and should never trigger duplicate warnings.
      if (GLOBAL_SECTION_NAMES.has(lower)) {
        insideGlobalsSection = true;
        continue;
      }

      insideGlobalsSection = false;
      symbols.push({ kind: 'sub', name, line: i, file: filePath });
      continue;
    }

    if (endSubRegex.test(line)) {
      insideGlobalsSection = false;
      continue;
    }

    m = typeRegex.exec(line);
    if (m) {
      symbols.push({ kind: 'type', name: m[1], line: i, file: filePath });
      continue;
    }

    // Only index variable declarations inside the dedicated globals sections.
    if (insideGlobalsSection) {
      m = globalsDeclRegex.exec(line);
      if (m) {
        for (const variableName of extractDeclaredNames(m[1])) {
          symbols.push({ kind: 'variable', name: variableName, line: i, file: filePath });
        }
      }
    }
  }

  return symbols;
}

function extractDeclaredNames(declarationTail) {
  // Examples:
  //   "Email As String"
  //   "A, B, C As Int"
  //   "A As String, B As Int"
  //   "Response As Map = CreateMap(...)"
  //
  // Strategy: split on commas, then take the FIRST identifier from each segment.
  // This avoids ever treating `As` as a variable name.
  const result = [];
  const parts = declarationTail.split(',');
  for (const part of parts) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/.exec(part);
    if (!match) continue;
    const name = match[1];
    if (!name) continue;
    result.push(name);
  }
  return result;
}

module.exports = { parseFile };

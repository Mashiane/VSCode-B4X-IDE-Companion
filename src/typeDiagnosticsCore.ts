export interface MisplacedTypeRange {
  startLine: number;
  endLine: number;
}

/** Strip B4X comments from a line, respecting string literals ("..." with "" escapes). */
function stripB4xComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') { i++; continue; }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === "'") return line.slice(0, i);
    }
  }
  return line;
}

export function findMisplacedTypeRanges(lines: string[]): MisplacedTypeRange[] {
  const results: MisplacedTypeRange[] = [];
  let inAllowedGlobals = false;
  let typeStart = 0;
  // Ignore any header/design metadata before the @EndOfDesignText@ marker
  let startIndex = 0;
  for (let m = 0; m < lines.length; m += 1) {
    if ((lines[m] ?? '').includes('@EndOfDesignText@')) { startIndex = m + 1; break; }
  }

  for (let i = startIndex; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const code = stripB4xComment(raw).trim();
    if (!code) continue;

    if (/^\s*Sub\s+(?:Class_Globals|Globals|Process_Globals)\b/i.test(code)) {
      inAllowedGlobals = true;
      continue;
    }

    if (/^\s*End\s+Sub\b/i.test(code)) {
      inAllowedGlobals = false;
      continue;
    }

    if (/^\s*Type\b/i.test(code)) {
      typeStart = i;
      // B4X `Type Name(...)` is a single-line declaration.
      // In B4A / B4X, Type declarations are valid inside:
      // Sub Class_Globals, Sub Globals, or Sub Process_Globals.
      if (!inAllowedGlobals) {
        results.push({ startLine: typeStart, endLine: typeStart });
      }
      continue;
    }
  }

  return results;
}

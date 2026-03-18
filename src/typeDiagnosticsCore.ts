export interface MisplacedTypeRange {
  startLine: number;
  endLine: number;
}

export function findMisplacedTypeRanges(lines: string[]): MisplacedTypeRange[] {
  const results: MisplacedTypeRange[] = [];
  let inClassGlobals = false;
  let inProcessGlobals = false;
  let inType = false;
  let typeStart = 0;
  // Ignore any header/design metadata before the @EndOfDesignText@ marker
  let startIndex = 0;
  for (let m = 0; m < lines.length; m += 1) {
    if ((lines[m] ?? '').includes('@EndOfDesignText@')) { startIndex = m + 1; break; }
  }

  for (let i = startIndex; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const code = raw.replace(/'.*$/, '').trim();
    if (!code) continue;

    if (/^\s*Sub\s+Class_Globals\b/i.test(code)) {
      inClassGlobals = true;
      inProcessGlobals = false;
      continue;
    }

    if (/^\s*Sub\s+Process_Globals\b/i.test(code)) {
      inProcessGlobals = true;
      inClassGlobals = false;
      continue;
    }

    if (/^\s*End\s+Sub\b/i.test(code)) {
      inClassGlobals = false;
      inProcessGlobals = false;
      continue;
    }

    if (/^\s*Type\b/i.test(code)) {
      inType = true;
      typeStart = i;
      if (!inClassGlobals && !inProcessGlobals) {
        // find end
        let end = i;
        for (let j = i + 1; j < lines.length; j += 1) {
          const c = (lines[j] ?? '').replace(/'.*$/, '').trim();
          if (/^\s*End\s+Type\b/i.test(c)) { end = j; break; }
        }
        results.push({ startLine: typeStart, endLine: end });
      }
      continue;
    }

    if (inType && /^\s*End\s+Type\b/i.test(code)) {
      inType = false;
      continue;
    }
  }

  return results;
}

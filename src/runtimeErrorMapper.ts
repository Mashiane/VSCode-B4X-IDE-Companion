/**
 * Core pure functions for mapping Java runtime stack traces back to B4X source code.
 * Grounded in B4XMcpServer's RuntimeErrorMapper.cs:
 * Parses raw Java/Android/B4J exception traces and maps frames back to exact
 * .bas files, Sub names, and line numbers via //BA.debugLineNum comments in Objects/src/.
 *
 * No VS Code dependencies for clean unit-testing.
 */

export interface ParsedJavaFrame {
  raw: string;
  method: string;
  file?: string;
  line?: number;
  isNative?: boolean;
}

export interface ResolvedB4xFrame {
  javaMethod: string;
  javaFile?: string;
  javaLine?: number;
  moduleName?: string;
  subName?: string;
  b4xFile?: string;
  b4xLine?: number;
  isProjectFrame: boolean;
  suspectedCause?: string;
}

export interface RemapResult {
  exceptionType?: string;
  exceptionMessage?: string;
  suspectedCause?: string;
  frames: ResolvedB4xFrame[];
  topProjectFrame?: ResolvedB4xFrame;
}

/**
 * Heuristic root-cause detector for common B4X runtime crashes.
 */
export function detectSuspectedCause(trace: string): string | undefined {
  if (/NullPointerException/i.test(trace)) {
    return 'NullPointerException: An object or view was referenced before being initialized (e.g. missing .Initialize or missing Root.LoadLayout).';
  }
  if (/ClassCastException/i.test(trace)) {
    return 'ClassCastException: An object was passed or cast to an incompatible type (e.g. casting a Label to Button or mismatching a Sub parameter).';
  }
  if (/IndexOutOfBoundsException|ArrayIndexOutOfBoundsException/i.test(trace)) {
    return 'IndexOutOfBoundsException: Attempted to access a List, Array, or Map key at an index outside its bounds.';
  }
  if (/NumberFormatException/i.test(trace)) {
    return 'NumberFormatException: String could not be parsed to a numeric type (contains non-numeric characters or empty).';
  }
  if (/TargetInvocationException/i.test(trace) || /InvocationTargetException/i.test(trace)) {
    return 'TargetInvocationException: An exception was thrown inside a CallSub / reflection target. Check the inner exception message.';
  }
  return undefined;
}

/**
 * Parses raw Java stack trace string into structured frames.
 */
export function parseJavaStackTrace(trace: string): { exceptionHeader?: string; frames: ParsedJavaFrame[] } {
  const lines = trace.split(/\r?\n/);
  const frames: ParsedJavaFrame[] = [];
  let exceptionHeader: string | undefined;

  const frameRegex = /^\s*at\s+([^\s(]+)(?:\(([^)]+)\))?/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = frameRegex.exec(line);
    if (m && m[1]) {
      const method = m[1];
      const loc = (m[2] ?? '').trim();
      let file: string | undefined;
      let lineNum: number | undefined;
      let isNative = false;

      if (loc.toLowerCase() === 'native method') {
        isNative = true;
      } else if (loc) {
        const colonIdx = loc.lastIndexOf(':');
        if (colonIdx > 0) {
          file = loc.substring(0, colonIdx);
          const num = parseInt(loc.substring(colonIdx + 1), 10);
          if (!isNaN(num)) lineNum = num;
        } else {
          file = loc;
        }
      }

      frames.push({
        raw: line,
        method,
        file,
        line: lineNum,
        isNative,
      });
    } else if (!exceptionHeader && (/Exception/i.test(trimmed) || /Error/i.test(trimmed))) {
      exceptionHeader = trimmed;
    }
  }

  return { exceptionHeader, frames };
}

/**
 * Scans generated Java source code backwards from a target Java line number
 * to find the closest //BA.debugLineNum marker inserted by the B4X compiler.
 */
export function resolveDebugLine(javaSource: string, javaLine: number): number | undefined {
  if (!javaSource || javaLine <= 0) return undefined;

  const lines = javaSource.split(/\r?\n/);
  const limit = Math.min(javaLine - 1, lines.length - 1);

  const debugRegex = /\/\/\s*BA\.debugLineNum\s*=\s*(\d+)/i;

  for (let i = limit; i >= 0; i--) {
    const line = lines[i] ?? '';
    const m = debugRegex.exec(line);
    if (m && m[1]) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num)) return num;
    }
  }

  return undefined;
}

/**
 * Maps parsed Java frames back to B4X source code locations.
 *
 * @param trace Raw stack trace
 * @param getJavaSource Callback to fetch generated Java source in Objects/src/ for a given module
 */
export function remapJavaStackTrace(
  trace: string,
  getJavaSource?: (moduleName: string) => string | undefined
): RemapResult {
  const { exceptionHeader, frames } = parseJavaStackTrace(trace);
  const suspectedCause = detectSuspectedCause(trace);
  const resolvedFrames: ResolvedB4xFrame[] = [];

  for (const f of frames) {
    let moduleName: string | undefined;
    let subName: string | undefined;
    let isProjectFrame = false;

    // B4X compiled methods have pattern: package.modulename._subname
    // e.g. b4a.example.b4xmainpage._btnsubmit_click or b4j.example.main._appstart
    if (f.method.includes('._')) {
      const parts = f.method.split('._');
      if (parts[0] && parts[1]) {
        const pkgParts = parts[0].split('.');
        moduleName = pkgParts[pkgParts.length - 1];
        subName = parts[1];
        isProjectFrame = true;
      }
    }

    let b4xLine: number | undefined;
    if (moduleName && f.line && getJavaSource) {
      const javaSource = getJavaSource(moduleName);
      if (javaSource) {
        b4xLine = resolveDebugLine(javaSource, f.line);
      }
    }

    const b4xFile = moduleName ? `${moduleName}.bas` : undefined;

    resolvedFrames.push({
      javaMethod: f.method,
      javaFile: f.file,
      javaLine: f.line,
      moduleName,
      subName,
      b4xFile,
      b4xLine,
      isProjectFrame,
    });
  }

  const topProjectFrame = resolvedFrames.find((rf) => rf.isProjectFrame);

  let exType: string | undefined;
  let exMsg: string | undefined;
  if (exceptionHeader) {
    const colon = exceptionHeader.indexOf(':');
    if (colon > 0) {
      exType = exceptionHeader.substring(0, colon).trim();
      exMsg = exceptionHeader.substring(colon + 1).trim();
    } else {
      exType = exceptionHeader;
    }
  }

  return {
    exceptionType: exType,
    exceptionMessage: exMsg,
    suspectedCause,
    frames: resolvedFrames,
    topProjectFrame,
  };
}

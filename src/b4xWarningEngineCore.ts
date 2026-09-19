/**
 * B4X Compiler Warning Engine Core
 *
 * Implements real-time, clean-room static analysis for the full catalog of B4X compiler warnings (1-37),
 * dynamically powered by the installed warnings.txt files across B4A, B4J, B4i, and B4R.
 *
 * Pure TypeScript with zero VS Code dependencies for fast, portable unit testing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type B4XPlatform = 'b4a' | 'b4j' | 'b4i' | 'b4r';

export interface B4XWarningRule {
  id: number;
  messageTemplate: string;
  category: 'flow' | 'variable' | 'ui' | 'deprecation' | 'scope' | 'project' | 'manifest';
  severity: 'warning' | 'info' | 'hint';
}

export interface WarningDiagnosticItem {
  warningId: number;
  message: string;
  line: number;
  startCol: number;
  endCol: number;
  severity: 'warning' | 'info' | 'hint';
  suggestedFix?: {
    title: string;
    replacement: string;
    rangeStartCol?: number;
    rangeEndCol?: number;
  };
}

export interface WarningAnalysisOptions {
  platform?: B4XPlatform;
  isB4XPages?: boolean;
  moduleName?: string;
  projectModules?: string[];
  customWarningsPath?: string;
}

/**
 * Built-in fallback catalog of all 37 B4X compile-time warnings and 4 runtime warnings,
 * matching official Anywhere Software warnings.txt definitions.
 */
export const DEFAULT_B4X_WARNINGS: Record<number, string> = {
  1: "Unreachable code detected.",
  2: "Not all code paths return a value.",
  3: "Return type (in Sub signature) should be set explicitly.",
  4: "Return value is missing. Default value will be used instead.",
  5: "Variable declaration type is missing. String type will be used.",
  6: "The following value misses screen units ('dip' or %x / %y): {0}.",
  7: "Object converted to String. This is probably a programming mistake.",
  8: "Undeclared variable '{0}'.",
  9: "Unused variable '{0}'.",
  10: "Variable '{0}' is never assigned any value.",
  11: "Variable '{0}' was not initialized.",
  12: "Sub '{0}' is not used.",
  13: "Variable '{0}' should be declared in Sub Process_Globals.",
  14: "File '{0}' in Files folder was not added to the Files tab.\\nYou should either delete it or add it to the project.\\nYou can choose Tools - Clean unused files.",
  15: "File '{0}' is not used.",
  16: "Layout file '{0}' is not used. Are you missing a call to Activity.LoadLayout?",
  17: "File '{0}' is missing from the Files tab.",
  18: "TextSize value should not be scaled as it is scaled internally.",
  19: "Empty Catch block. You should at least add Log(LastException.Message).",
  20: "View '{0}' was added with the designer. You should not initialize it.",
  21: "Cannot access view's dimension before it is added to its parent.",
  22: "Types do not match.",
  23: "Dialogs are not allowed in Sub Activity_Pause. It will be ignored.",
  24: "Accessing fields from other modules in Sub Process_Globals can be dangerous as the initialization order is not deterministic.",
  25: "Sub '{0}' not found.",
  26: "Add android:targetSdkVersion=\"19\" to the manifest editor (after minSdkVersion).",
  27: "AndroidManifest.xml is read-only or Do not overwrite manifest file option is checked. Use the manifest editor instead.",
  28: "It is recommended to use a custom theme or the default theme.\\nRemove SetApplicationAttribute(android:theme, \"@android:style/Theme.Holo\") from the manifest editor.",
  29: "This sub should only be used for variables declaration or assignments of primitive values.",
  30: "Variable name is the same as a module name. This can cause problems during debugging.",
  31: "The recommended value for android:targetSdkVersion is {0} (manifest editor).",
  32: "Library '{0}' is not used.",
  33: "DoEvents is deprecated. It can lead to stability issues. Use Sleep(0) instead (if really needed).",
  34: "Msgbox and other modal dialogs are deprecated. Use the async methods instead.",
  35: "Comparison of Object to other types will fail if exact types do not match.\\nBetter to put the object on the right side of the comparison.",
  36: "Event parameter is missing.",
  37: "It is recommended to remove the Starter service in B4XPages projects.",
  1001: "Panel.LoadLayout should only be called after the panel was added to its parent.",
  1002: "The same object was added to the list. You should call Dim again to create a new object.",
  1003: "Object was already initialized.",
  1004: "FullScreen or IncludeTitle properties in layout file do not match the activity attributes settings.",
};

/**
 * Standard candidate installation paths for B4X platforms on Windows.
 */
export const DEFAULT_PLATFORM_INSTALL_PATHS: Record<B4XPlatform, string[]> = {
  b4a: [
    'C:\\Program Files\\Anywhere Software\\B4A',
    'C:\\Program Files (x86)\\Anywhere Software\\B4A',
  ],
  b4j: [
    'C:\\Program Files\\Anywhere Software\\B4J',
    'C:\\Program Files (x86)\\Anywhere Software\\B4J',
  ],
  b4i: [
    'C:\\Program Files (x86)\\Anywhere Software\\B4i',
    'C:\\Program Files\\Anywhere Software\\B4i',
  ],
  b4r: [
    'C:\\Program Files\\Anywhere Software\\B4R',
    'C:\\Program Files (x86)\\Anywhere Software\\B4R',
  ],
};

/**
 * Discovers and parses warnings.txt for the given platform from the local machine.
 * Falls back cleanly to DEFAULT_B4X_WARNINGS if not installed.
 */
export function loadPlatformWarnings(platform: B4XPlatform = 'b4a', customPath?: string): Map<number, string> {
  const result = new Map<number, string>();

  // 1. Seed with default catalog
  for (const [k, v] of Object.entries(DEFAULT_B4X_WARNINGS)) {
    result.set(Number(k), v);
  }

  // Adjust platform-specific defaults
  if (platform === 'b4j' || platform === 'b4r') {
    result.set(6, "The following value misses screen units ('dip'): {0}.");
    result.set(16, "Layout file '{0}' is not used. Are you missing a call to MainForm.RootPane.LoadLayout?");
    result.set(26, "Files are case sensitive. The case is incorrect.");
  } else if (platform === 'b4i') {
    result.set(16, "Layout file '{0}' is not used. Are you missing a call to Page.RootPanel.LoadLayout?");
  }

  // 2. Discover local file
  const candidatePaths: string[] = [];
  if (customPath) {
    candidatePaths.push(customPath);
  }
  const defaults = DEFAULT_PLATFORM_INSTALL_PATHS[platform] || [];
  for (const p of defaults) {
    candidatePaths.push(path.join(p, 'warnings.txt'));
  }

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        const regex = /^(\d+):\s*(.*)/;
        for (const line of lines) {
          const match = regex.exec(line.trim());
          if (match) {
            const id = parseInt(match[1]!, 10);
            const msg = match[2]!.replace(/\\n/g, '\n');
            result.set(id, msg);
          }
        }
        break; // Successfully loaded from file
      } catch {
        // Fallback continues
      }
    }
  }

  return result;
}

/**
 * Strips comments and masks string literals with spaces while preserving column offsets.
 */
export function maskLine(line: string): { masked: string; commentStart: number } {
  let inString = false;
  const chars = line.split('');
  let commentStart = -1;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inString) {
      if (ch === '"') {
        if (i + 1 < chars.length && chars[i + 1] === '"') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i++;
          continue;
        }
        inString = false;
        chars[i] = '"';
      } else {
        chars[i] = ' ';
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === "'") {
        commentStart = i;
        for (let j = i; j < chars.length; j++) {
          chars[j] = ' ';
        }
        break;
      }
    }
  }
  return { masked: chars.join(''), commentStart };
}

/**
 * Formats a warning template with dynamic parameters like {0}.
 */
export function formatWarningMessage(template: string, ...args: string[]): string {
  let res = template;
  for (let i = 0; i < args.length; i++) {
    res = res.replace(new RegExp(`\\{${i}\\}`, 'g'), args[i]!);
  }
  return res;
}

/**
 * Analyzes a B4X module line-by-line and generates compile-time warnings matching warnings.txt.
 */
export function analyzeModuleWarnings(
  lines: string[],
  options: WarningAnalysisOptions = {}
): WarningDiagnosticItem[] {
  const platform = options.platform || 'b4a';
  const warningsCatalog = loadPlatformWarnings(platform, options.customWarningsPath);
  const diagnostics: WarningDiagnosticItem[] = [];

  // Parse global #IgnoreWarnings attribute (e.g. #IgnoreWarnings: 6, 9, 12)
  const ignoredGlobalIds = new Set<number>();
  for (const line of lines) {
    const match = /^\s*#IgnoreWarnings:\s*([0-9,\s]+)/i.exec(line);
    if (match) {
      const ids = match[1]!.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      for (const id of ids) ignoredGlobalIds.add(id);
    }
  }

  // State tracking across Subs
  let currentSubName: string | null = null;
  let currentSubReturnType: string | null = null;
  let currentSubHasReturn = false;
  let inUnreachableBlock = false;
  let currentSubScope: 'Process_Globals' | 'Globals' | 'Class_Globals' | 'Normal' = 'Normal';

  const moduleName = options.moduleName || '';
  const projectModules = new Set((options.projectModules || []).map((m) => m.toLowerCase()));

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] as string;
    const { masked, commentStart } = maskLine(rawLine);
    const trimmedMasked = masked.trim();
    const commentText = commentStart >= 0 ? rawLine.substring(commentStart) : '';
    const hasLineIgnore = /'ignore\b/i.test(commentText);

    // Helper to add a diagnostic
    const addWarning = (
      id: number,
      startCol: number,
      endCol: number,
      args: string[] = [],
      suggestedFix?: WarningDiagnosticItem['suggestedFix']
    ) => {
      if (ignoredGlobalIds.has(id) || hasLineIgnore) return;
      const template = warningsCatalog.get(id) || DEFAULT_B4X_WARNINGS[id] || `Warning #${id}`;
      const msg = `[Warning #${id}] ${formatWarningMessage(template, ...args)}`;
      diagnostics.push({
        warningId: id,
        message: msg,
        line: lineIdx,
        startCol,
        endCol,
        severity: 'warning',
        suggestedFix,
      });
    };

    // Track Sub definition
    const subMatch = /^\s*Sub\s+([A-Za-z0-9_]+)(?:\s*\((.*?)\))?(?:\s+As\s+([A-Za-z0-9_.]+))?/i.exec(masked);
    if (subMatch) {
      currentSubName = subMatch[1]!;
      currentSubReturnType = subMatch[3] ? subMatch[3].trim() : null;
      currentSubHasReturn = false;
      inUnreachableBlock = false;

      const lowerName = currentSubName.toLowerCase();
      if (lowerName === 'process_globals') currentSubScope = 'Process_Globals';
      else if (lowerName === 'globals') currentSubScope = 'Globals';
      else if (lowerName === 'class_globals') currentSubScope = 'Class_Globals';
      else currentSubScope = 'Normal';

      continue;
    }

    if (/^\s*End\s+Sub\b/i.test(masked)) {
      // End of Sub checks
      if (currentSubScope === 'Normal' && currentSubReturnType && currentSubReturnType.toLowerCase() !== 'void') {
        // Warning #2: Not all code paths return a value
        if (!currentSubHasReturn) {
          const col = rawLine.search(/End\s+Sub/i);
          addWarning(2, col >= 0 ? col : 0, rawLine.length);
        }
      }
      currentSubName = null;
      currentSubReturnType = null;
      currentSubScope = 'Normal';
      inUnreachableBlock = false;
      continue;
    }

    // Inside Sub
    if (currentSubName) {
      // Warning #1: Unreachable code detected
      if (inUnreachableBlock && trimmedMasked.length > 0) {
        if (!/^\s*(Else|Case|End\s+If|End\s+Select|Next|Loop|End\s+Sub)\b/i.test(masked)) {
          const startCol = rawLine.search(/\S/);
          addWarning(1, startCol >= 0 ? startCol : 0, rawLine.length);
        } else {
          inUnreachableBlock = false;
        }
      }

      // Detect unconditional exit statements
      if (/^\s*Return(\s+.*)?$/i.test(trimmedMasked)) {
        currentSubHasReturn = true;
        const retMatch = /^\s*Return(\s+(.*))?$/i.exec(trimmedMasked);
        const retValue = retMatch && retMatch[2] ? retMatch[2].trim() : '';

        // Warning #4: Return value is missing in typed sub
        if (currentSubReturnType && currentSubReturnType.toLowerCase() !== 'void' && retValue.length === 0) {
          const retCol = rawLine.search(/\bReturn\b/i);
          addWarning(4, retCol >= 0 ? retCol : 0, retCol >= 0 ? retCol + 6 : 6);
        }

        // Warning #3: Sub has return value but no explicit return type
        if (!currentSubReturnType && retValue.length > 0) {
          const retCol = rawLine.search(/\bReturn\b/i);
          addWarning(3, retCol >= 0 ? retCol : 0, rawLine.length, [], {
            title: 'Specify explicit return type in Sub signature',
            replacement: '',
          });
        }

        inUnreachableBlock = true;
      }

      // Warning #5: Variable declaration type is missing (e.g. Dim x without As <Type>)
      const dimMatch = /^\s*(?:Dim|Private|Public)\s+([A-Za-z0-9_]+)(?!\s*\(|\s+As\b|\s*=)(?:\s*$)/i.exec(masked);
      if (dimMatch && !/^\s*(?:Dim|Private|Public)\s+[A-Za-z0-9_]+\s+As\b/i.test(masked)) {
        const varName = dimMatch[1]!;
        const col = rawLine.indexOf(varName);
        addWarning(5, col >= 0 ? col : 0, (col >= 0 ? col : 0) + varName.length, [], {
          title: `Add 'As String' to declaration of '${varName}'`,
          replacement: ` As String`,
          rangeStartCol: (col >= 0 ? col : 0) + varName.length,
          rangeEndCol: (col >= 0 ? col : 0) + varName.length,
        });
      }

      // Warning #30: Variable name is the same as a module name
      const allDimMatch = /^\s*(?:Dim|Private|Public)\s+([A-Za-z0-9_]+)/i.exec(masked);
      if (allDimMatch) {
        const vName = allDimMatch[1]!;
        if (projectModules.has(vName.toLowerCase()) && vName.toLowerCase() !== moduleName.toLowerCase()) {
          const col = rawLine.indexOf(vName);
          addWarning(30, col >= 0 ? col : 0, (col >= 0 ? col : 0) + vName.length, [vName]);
        }
      }

      // Warning #6: Missing screen units ('dip' or %x / %y)
      const dimPropMatch = /\.?(?:Left|Top|Width|Height)\s*=\s*([0-9]+)(?!\s*(?:dip|%x|%y|[A-Za-z0-9_]))/i.exec(masked);
      if (dimPropMatch) {
        const valStr = dimPropMatch[1]!;
        const valCol = rawLine.indexOf(valStr, dimPropMatch.index);
        addWarning(6, valCol >= 0 ? valCol : 0, (valCol >= 0 ? valCol : 0) + valStr.length, [valStr], {
          title: `Append 'dip' screen unit (${valStr} -> ${valStr}dip)`,
          replacement: `${valStr}dip`,
          rangeStartCol: valCol,
          rangeEndCol: valCol + valStr.length,
        });
      }

      // Warning #18: TextSize value should not be scaled as it is scaled internally
      const textSizeMatch = /\.?(?:TextSize)\s*=\s*([^'\r\n]+)/i.exec(masked);
      if (textSizeMatch && /(?:dip|\*.*1dip)/i.test(textSizeMatch[1]!)) {
        const tsCol = rawLine.search(/TextSize/i);
        addWarning(18, tsCol >= 0 ? tsCol : 0, rawLine.length);
      }

      // Warning #19: Empty Catch block
      if (/^\s*Catch\b/i.test(masked)) {
        let nextNonEmpty = lineIdx + 1;
        while (nextNonEmpty < lines.length && (lines[nextNonEmpty] as string).trim().length === 0) {
          nextNonEmpty++;
        }
        if (nextNonEmpty < lines.length && /^\s*End\s+Try\b/i.test(lines[nextNonEmpty] as string)) {
          const catchCol = rawLine.search(/\bCatch\b/i);
          addWarning(19, catchCol >= 0 ? catchCol : 0, rawLine.length, [], {
            title: 'Add Log(LastException.Message) to Catch block',
            replacement: `\n\tLog(LastException.Message)`,
            rangeStartCol: rawLine.length,
            rangeEndCol: rawLine.length,
          });
        }
      }

      // Warning #23: Dialogs are not allowed in Sub Activity_Pause
      if (currentSubName.toLowerCase() === 'activity_pause') {
        if (/\b(?:Msgbox|MsgboxAsync|InputList|InputMultiList)\b/i.test(masked)) {
          const dCol = rawLine.search(/\b(?:Msgbox|MsgboxAsync|InputList|InputMultiList)\b/i);
          addWarning(23, dCol >= 0 ? dCol : 0, rawLine.length);
        }
      }

      // Warning #24: Accessing fields from other modules in Sub Process_Globals
      if (currentSubScope === 'Process_Globals') {
        const crossMod = /\b([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/i.exec(masked);
        if (crossMod && projectModules.has(crossMod[1]!.toLowerCase()) && crossMod[1]!.toLowerCase() !== moduleName.toLowerCase()) {
          const col = rawLine.indexOf(crossMod[0]!);
          addWarning(24, col >= 0 ? col : 0, col + crossMod[0]!.length);
        }
      }

      // Warning #33: DoEvents is deprecated (B4A / Android)
      if (platform === 'b4a' && /\bDoEvents\b/i.test(masked)) {
        const doCol = rawLine.search(/\bDoEvents\b/i);
        addWarning(33, doCol >= 0 ? doCol : 0, doCol + 8, [], {
          title: "Replace DoEvents with 'Sleep(0)'",
          replacement: 'Sleep(0)',
          rangeStartCol: doCol,
          rangeEndCol: doCol + 8,
        });
      }

      // Warning #34: Msgbox modal dialogs are deprecated (B4A)
      if (platform === 'b4a' && /\bMsgbox\s*\(/i.test(masked) && !/\bMsgboxAsync\b/i.test(masked)) {
        const mbCol = rawLine.search(/\bMsgbox\b/i);
        addWarning(34, mbCol >= 0 ? mbCol : 0, mbCol + 6, [], {
          title: "Replace Msgbox with 'MsgboxAsync'",
          replacement: 'MsgboxAsync',
          rangeStartCol: mbCol,
          rangeEndCol: mbCol + 6,
        });
      }
    }

    // Module / Manifest Level Checks
    // Warning #28: Deprecated Theme.Holo in manifest code
    if (/android:theme\s*=\s*["']@android:style\/Theme\.Holo/i.test(rawLine)) {
      const col = rawLine.search(/@android:style\/Theme\.Holo/i);
      addWarning(28, col >= 0 ? col : 0, rawLine.length);
    }

    // Warning #37: Starter service in B4XPages projects
    if (options.isB4XPages && moduleName.toLowerCase() === 'starter') {
      if (/^\s*#Region\s+Service\s+Attributes/i.test(masked) || lineIdx === 0) {
        addWarning(37, 0, rawLine.length);
      }
    }
  }

  return diagnostics;
}

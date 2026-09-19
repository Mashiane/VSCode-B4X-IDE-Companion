/**
 * Core pure functions for detecting B4X "Code Smells" and anti-patterns.
 * Grounded in Erel's recommendations:
 * 1. Code Smells: https://www.b4x.com/android/forum/threads/b4x-code-smells-common-mistakes-and-other-tips.116651/
 * 2. Features to Avoid: https://www.b4x.com/android/forum/threads/b4x-features-that-erel-recommends-to-avoid.133280/
 * 3. BANano & ABMaterial Architecture Reference Rules (B4X-CS018 to B4X-CS022)
 * 4. CustomView & B4XLib Quality Rules (B4X-CS023 to B4X-CS028)
 * 5. Modern B4A 13.5+ & B4XPages Rules (B4X-CS029 to B4X-CS030)
 *
 * No VS Code dependencies for clean unit-testing.
 */

export interface CodeSmellItem {
  ruleId: string;
  severity: 'warning' | 'info';
  message: string;
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Returns a version of the line with string literal contents replaced by spaces (preserving length and columns)
 * and comments stripped out completely (from ' onwards).
 */
export function maskStringsAndStripComments(line: string): { masked: string; commentStart: number } {
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

export function findCodeSmells(lines: string[]): CodeSmellItem[] {
  const items: CodeSmellItem[] = [];

  // Skip any header metadata before @EndOfDesignText@
  let startIndex = 0;
  for (let m = 0; m < lines.length; m++) {
    if ((lines[m] ?? '').includes('@EndOfDesignText@')) {
      startIndex = m + 1;
      break;
    }
  }

  // Pre-process lines and comment markers
  const maskedLines: string[] = [];
  const commentStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i < startIndex) {
      maskedLines.push('');
      commentStarts.push(-1);
    } else {
      const res = maskStringsAndStripComments(lines[i] ?? '');
      maskedLines.push(res.masked);
      commentStarts.push(res.commentStart);
    }
  }

  // Identify variables declared as BANanoElement (B4X-CS018)
  const bananoElementVars = new Set<string>(['melement']);
  for (let i = startIndex; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const declMatch = /\b([a-zA-Z0-9_]+)\s+As\s+BANanoElement\b/gi;
    let m: RegExpExecArray | null;
    while ((m = declMatch.exec(raw)) !== null) {
      if (m[1]) {
        bananoElementVars.add(m[1].toLowerCase());
      }
    }
  }

  let inSmartString = false;
  let hasAddRows = false;
  let firstAddRowsLine = -1;
  let firstAddRowsCol = 0;
  let hasBuildGrid = false;

  // CustomView & B4XLib tracking (B4X-CS023 to B4X-CS028)
  let isCustomView = false;
  let hasDesignerCreateView = false;
  let hasBaseResize = false;
  let hasMBase = false;
  let classGlobalsLine = -1;
  let firstDesignerPropLine = -1;
  let firstDesignerPropCol = 0;
  const designerKeys = new Set<string>();
  const designerColorKeys = new Set<string>();
  const validFieldTypes = new Set(['boolean', 'color', 'int', 'float', 'string', 'list']);

  // Modern B4A & B4XPages tracking (B4X-CS029 to B4X-CS030)
  let isB4XPage = false;
  let isStarterService = false;

  for (let i = startIndex; i < lines.length; i++) {
    const masked = maskedLines[i] ?? '';
    if (!masked.trim()) continue;

    // B4X-CS001: DoEvents (deprecated blocking call)
    const doEventsMatch = /\bDoEvents\b/i.exec(masked);
    if (doEventsMatch) {
      items.push({
        ruleId: 'B4X-CS001',
        severity: 'warning',
        message: 'DoEvents is deprecated and can cause crashes or stack overflows. Use Sleep(0) instead.',
        line: i,
        startCol: doEventsMatch.index,
        endCol: doEventsMatch.index + doEventsMatch[0].length,
      });
    }

    // B4X-CS002: Msgbox(...) (synchronous blocking dialog, but NOT MsgboxAsync / Msgbox2Async)
    const msgboxMatch = /\bMsgbox\s*\(/i.exec(masked);
    if (msgboxMatch) {
      const prefix = masked.slice(Math.max(0, msgboxMatch.index - 5), msgboxMatch.index + 6);
      if (!/MsgboxAsync/i.test(prefix)) {
        items.push({
          ruleId: 'B4X-CS002',
          severity: 'warning',
          message: 'Synchronous Msgbox is deprecated and blocks the UI thread. Use MsgboxAsync or xui.MsgboxAsync with Wait For.',
          line: i,
          startCol: msgboxMatch.index,
          endCol: msgboxMatch.index + 6,
        });
      }
    }

    // B4X-CS003: Map.GetKeyAt / Map.GetValueAt (legacy non-cross-platform methods)
    const mapMatch = /\b(GetKeyAt|GetValueAt)\b/i.exec(masked);
    if (mapMatch) {
      const methodName = mapMatch[1] ?? 'GetKeyAt';
      items.push({
        ruleId: 'B4X-CS003',
        severity: 'warning',
        message: `${methodName} is a legacy non-cross-platform Map method. Use 'For Each key As String In Map.Keys' instead.`,
        line: i,
        startCol: mapMatch.index,
        endCol: mapMatch.index + methodName.length,
      });
    }

    // B4X-CS004: File.DirDefaultExternal (always a mistake in modern Android)
    const dirDefaultMatch = /\bFile\.DirDefaultExternal\b/i.exec(masked);
    if (dirDefaultMatch) {
      items.push({
        ruleId: 'B4X-CS004',
        severity: 'warning',
        message: 'File.DirDefaultExternal is inaccessible or discouraged on modern Android. Use XUI.DefaultFolder (=File.DirInternal) or RuntimePermissions.GetSafeDirDefaultExternal.',
        line: i,
        startCol: dirDefaultMatch.index,
        endCol: dirDefaultMatch.index + dirDefaultMatch[0].length,
      });
    }

    // B4X-CS005: File.DirRootExternal (restricted by modern scoped storage)
    const dirRootMatch = /\bFile\.DirRootExternal\b/i.exec(masked);
    if (dirRootMatch) {
      items.push({
        ruleId: 'B4X-CS005',
        severity: 'warning',
        message: 'File.DirRootExternal is restricted by modern Android scoped storage. Use ContentChooser or ExternalStorage class.',
        line: i,
        startCol: dirRootMatch.index,
        endCol: dirRootMatch.index + dirRootMatch[0].length,
      });
    }

    // B4X-CS006: SQL queries with string concatenation instead of parameterized ExecNonQuery2 / ExecQuery2
    const sqlMatch = /\b(ExecNonQuery|ExecQuery)\s*\(([^)]+)\)/i.exec(masked);
    if (sqlMatch) {
      const callTarget = sqlMatch[1] ?? '';
      const args = sqlMatch[2] ?? '';
      if (args.includes('&') && !/ExecNonQuery2|ExecQuery2/i.test(callTarget)) {
        items.push({
          ruleId: 'B4X-CS006',
          severity: 'warning',
          message: `Possible SQL injection or syntax error with string concatenation in ${callTarget}. Use parameterized queries (${callTarget}2 with ? placeholders) instead.`,
          line: i,
          startCol: sqlMatch.index,
          endCol: sqlMatch.index + callTarget.length,
        });
      }
    }

    // B4X-CS007: Dim ... As Cursor (B4A only object, ResultSet is cross platform)
    const cursorMatch = /\bAs\s+Cursor\b/i.exec(masked);
    if (cursorMatch) {
      items.push({
        ruleId: 'B4X-CS007',
        severity: 'info',
        message: 'Cursor is a B4A-only type. Consider using cross-platform ResultSet.',
        line: i,
        startCol: cursorMatch.index,
        endCol: cursorMatch.index + cursorMatch[0].length,
      });
    }

    // B4X-CS008: Redundant object initialization:
    // Line i: varName.Initialize(...)
    // Line i+1: varName = otherObject
    const initMatch = /^\s*([a-zA-Z0-9_]+)\.Initialize\b/i.exec(masked);
    if (initMatch && i + 1 < lines.length) {
      const varName = initMatch[1] ?? '';
      const nextMasked = (maskedLines[i + 1] ?? '').trim();
      const assignRegex = new RegExp(`^${varName}\\s*=\\s*[^=]`, 'i');
      if (assignRegex.test(nextMasked)) {
        items.push({
          ruleId: 'B4X-CS008',
          severity: 'warning',
          message: `Redundant initialization of '${varName}'. The object is initialized and then immediately reassigned on the next line.`,
          line: i,
          startCol: initMatch.index,
          endCol: initMatch.index + varName.length + 11,
        });
      }
    }

    // B4X-CS009: Redundant boolean logic:
    // 'If ... Then Return True Else Return False'
    const boolReturnMatch = /\bIf\s+(.+?)\s+Then\s+Return\s+True\s+Else\s+Return\s+False\b/i.exec(masked);
    if (boolReturnMatch) {
      items.push({
        ruleId: 'B4X-CS009',
        severity: 'info',
        message: "'If ... Then Return True Else Return False' is redundant. Return the boolean expression directly.",
        line: i,
        startCol: boolReturnMatch.index,
        endCol: boolReturnMatch.index + boolReturnMatch[0].length,
      });
    }

    // B4X-CS010: Excessive string concatenation using & QUOTE & or & CRLF &
    const quoteCount = (masked.match(/\bQUOTE\b/i) || []).length;
    const crlfCount = (masked.match(/\bCRLF\b/i) || []).length;
    if (quoteCount + crlfCount >= 2 && masked.includes('&')) {
      const firstConcat = masked.indexOf('&');
      items.push({
        ruleId: 'B4X-CS010',
        severity: 'info',
        message: 'Multiple string concatenations with QUOTE/CRLF. Consider using Smart Strings ($"..."$) with interpolation.',
        line: i,
        startCol: firstConcat,
        endCol: masked.length,
      });
    }

    // B4X-CS011: ListView / TableView -> xCustomListView
    const listViewMatch = /\bAs\s+(ListView|TableView)\b/i.exec(masked);
    if (listViewMatch) {
      const viewType = listViewMatch[1] ?? 'ListView';
      items.push({
        ruleId: 'B4X-CS011',
        severity: 'warning',
        message: `${viewType} is legacy and cannot be easily customized or ported. Use xCustomListView instead.`,
        line: i,
        startCol: listViewMatch.index,
        endCol: listViewMatch.index + listViewMatch[0].length,
      });
    }

    // B4X-CS012: ExecQuerySingleResult (returns "null" as string if no rows) -> ExecQuery2
    const singleResultMatch = /\bExecQuerySingleResult\s*\(/i.exec(masked);
    if (singleResultMatch && !/ExecQuerySingleResult2/i.test(masked.slice(singleResultMatch.index - 5, singleResultMatch.index + 25))) {
      items.push({
        ruleId: 'B4X-CS012',
        severity: 'warning',
        message: 'ExecQuerySingleResult returns "null" as a string if no rows match. Use ExecQuery2 with ResultSet to safely check for empty results.',
        line: i,
        startCol: singleResultMatch.index,
        endCol: singleResultMatch.index + 20,
      });
    }

    // B4X-CS013: StartServiceAt / StartServiceAtExact -> StartReceiverAt / StartReceiverAtExact
    const startServiceMatch = /\b(StartServiceAt|StartServiceAtExact)\b/i.exec(masked);
    if (startServiceMatch) {
      const funcName = startServiceMatch[1] ?? 'StartServiceAt';
      items.push({
        ruleId: 'B4X-CS013',
        severity: 'warning',
        message: `${funcName} is restricted on modern Android. Use StartReceiverAt / StartReceiverAtExact with a Receiver module instead.`,
        line: i,
        startCol: startServiceMatch.index,
        endCol: startServiceMatch.index + funcName.length,
      });
    }

    // B4X-CS014: VideoView -> ExoPlayer
    const videoViewMatch = /\bAs\s+VideoView\b/i.exec(masked);
    if (videoViewMatch) {
      items.push({
        ruleId: 'B4X-CS014',
        severity: 'warning',
        message: 'VideoView is legacy. Use the ExoPlayer library for modern codec, adaptive streaming, and background playback support.',
        line: i,
        startCol: videoViewMatch.index,
        endCol: videoViewMatch.index + videoViewMatch[0].length,
      });
    }

    // B4X-CS015: Sub JobDone callback -> Wait For (j) JobDone(j)
    const jobDoneMatch = /^\s*Sub\s+JobDone\b/i.exec(masked);
    if (jobDoneMatch) {
      items.push({
        ruleId: 'B4X-CS015',
        severity: 'warning',
        message: "Sub JobDone is the legacy HttpUtils event pattern. Use 'Wait For (j) JobDone(j)' with a local HttpJob instance instead.",
        line: i,
        startCol: jobDoneMatch.index,
        endCol: jobDoneMatch.index + jobDoneMatch[0].length,
      });
    }

    // B4X-CS016: Round2 -> NumberFormat / B4XFormatter
    const round2Match = /\bRound2\s*\(/i.exec(masked);
    if (round2Match) {
      items.push({
        ruleId: 'B4X-CS016',
        severity: 'info',
        message: 'Round2 modifies the numerical value. For displaying formatted numbers with decimals, use NumberFormat or B4XFormatter.',
        line: i,
        startCol: round2Match.index,
        endCol: round2Match.index + 6,
      });
    }

    // B4X-CS017: TextReader / TextWriter -> File.ReadString / File.ReadList / AsyncStreams
    const textReaderWriterMatch = /\bAs\s+(TextReader|TextWriter)\b/i.exec(masked);
    if (textReaderWriterMatch) {
      const typeName = textReaderWriterMatch[1] ?? 'TextReader';
      items.push({
        ruleId: 'B4X-CS017',
        severity: 'info',
        message: `Consider using File.ReadString / File.ReadList (or AsyncStreams for network streams) instead of manual ${typeName}.`,
        line: i,
        startCol: textReaderWriterMatch.index,
        endCol: textReaderWriterMatch.index + textReaderWriterMatch[0].length,
      });
    }

    // B4X-CS018: BANanoElement .IsInitialized anti-pattern
    const isInitMatch = /\b([a-zA-Z0-9_]+)\.IsInitialized\b/i.exec(masked);
    if (isInitMatch) {
      const varName = isInitMatch[1] ?? '';
      if (bananoElementVars.has(varName.toLowerCase())) {
        items.push({
          ruleId: 'B4X-CS018',
          severity: 'warning',
          message: `'${varName}' (BANanoElement) does not support .IsInitialized. Check against '<> Null' instead.`,
          line: i,
          startCol: isInitMatch.index,
          endCol: isInitMatch.index + isInitMatch[0].length,
        });
      }
    }

    // B4X-CS019: Redundant double-double quotes inside SmartStrings ($"..."$)
    const rawLine = lines[i] ?? '';
    const commentStart = commentStarts[i] ?? -1;
    const parseLimit = (!inSmartString && commentStart >= 0) ? commentStart : rawLine.length;
    let p = 0;
    while (p < parseLimit) {
      if (!inSmartString) {
        if (rawLine[p] === '$' && p + 1 < parseLimit && rawLine[p + 1] === '"') {
          inSmartString = true;
          p += 2;
          continue;
        }
        p++;
      } else {
        if (rawLine[p] === '"' && p + 1 < parseLimit && rawLine[p + 1] === '$') {
          inSmartString = false;
          p += 2;
          continue;
        }
        if (rawLine[p] === '"' && p + 1 < parseLimit && rawLine[p + 1] === '"') {
          if (p + 2 < parseLimit && rawLine[p + 2] === '$') {
            p += 2;
            continue;
          }
          items.push({
            ruleId: 'B4X-CS019',
            severity: 'warning',
            message: 'Doubled quotes ("") inside a SmartString ($"...$) are redundant. Use single double quotes (") instead.',
            line: i,
            startCol: p,
            endCol: p + 2,
          });
          p += 2;
          continue;
        }
        p++;
      }
    }

    // Track ABMaterial grid rows and BuildGrid for B4X-CS020
    if (/\b(AddRows|AddRowsM)\b/i.test(masked)) {
      hasAddRows = true;
      if (firstAddRowsLine === -1) {
        const m = /\b(AddRows|AddRowsM)\b/i.exec(masked);
        firstAddRowsLine = i;
        firstAddRowsCol = m ? m.index : 0;
      }
    }
    if (/\bBuildGrid\b/i.test(masked)) {
      hasBuildGrid = true;
    }

    // B4X-CS021: Static CSS injection via BANano.Header.Append
    if (/BANano\.Header\.Append/i.test(rawLine) && /<style/i.test(rawLine)) {
      const match = /BANano\.Header\.Append/i.exec(rawLine);
      if (match) {
        items.push({
          ruleId: 'B4X-CS021',
          severity: 'info',
          message: "Avoid injecting static CSS via 'BANano.Header.Append'. Define styles in '#If CSS ... #End If' blocks for better maintainability and performance.",
          line: i,
          startCol: match.index,
          endCol: match.index + match[0].length,
        });
      }
    }

    // B4X-CS022: Unguarded CallSub on callback target without SubExists
    const callSubMatch = /\b(CallSub[23]?)\s*\(\s*mCallBack\s*,/i.exec(masked);
    if (callSubMatch) {
      let isGuarded = false;
      for (let prev = Math.max(startIndex, i - 5); prev <= i; prev++) {
        if (/\bSubExists\s*\(\s*mCallBack\b/i.test(maskedLines[prev] ?? '')) {
          isGuarded = true;
          break;
        }
      }
      if (!isGuarded) {
        items.push({
          ruleId: 'B4X-CS022',
          severity: 'warning',
          message: `Unguarded '${callSubMatch[1]}' on 'mCallBack'. Wrap with 'If SubExists(mCallBack, ...) Then' to prevent runtime crashes if the callback sub is missing.`,
          line: i,
          startCol: callSubMatch.index,
          endCol: callSubMatch.index + callSubMatch[0].length,
        });
      }
    }

    // --- CustomView & B4XLib Quality Checks (B4X-CS025, B4X-CS026, B4X-CS027) ---
    const dpMatch = /^\s*#DesignerProperty:\s*(.*)/i.exec(rawLine);
    if (dpMatch) {
      isCustomView = true;
      if (firstDesignerPropLine === -1) {
        firstDesignerPropLine = i;
        firstDesignerPropCol = dpMatch.index;
      }
      const attrs = dpMatch[1] ?? '';
      const keyMatch = /\bKey:\s*([a-zA-Z0-9_]+)/i.exec(attrs);
      const typeMatch = /\bFieldType:\s*([a-zA-Z0-9_]+)/i.exec(attrs);

      if (keyMatch && keyMatch[1]) {
        const k = keyMatch[1];
        const kLower = k.toLowerCase();
        if (designerKeys.has(kLower)) {
          items.push({
            ruleId: 'B4X-CS026',
            severity: 'warning',
            message: `Duplicate #DesignerProperty key '${k}'. Property keys must be unique.`,
            line: i,
            startCol: keyMatch.index,
            endCol: keyMatch.index + keyMatch[0].length,
          });
        } else {
          designerKeys.add(kLower);
        }

        if (typeMatch && typeMatch[1]) {
          const t = typeMatch[1];
          if (!validFieldTypes.has(t.toLowerCase())) {
            items.push({
              ruleId: 'B4X-CS026',
              severity: 'warning',
              message: `Invalid FieldType '${t}' in #DesignerProperty. Valid types: Boolean, Color, Int, Float, String, List.`,
              line: i,
              startCol: typeMatch.index,
              endCol: typeMatch.index + typeMatch[0].length,
            });
          }
          if (t.toLowerCase() === 'color') {
            designerColorKeys.add(kLower);
          }
        }
      } else {
        items.push({
          ruleId: 'B4X-CS026',
          severity: 'warning',
          message: "Malformed #DesignerProperty: Missing required 'Key' attribute.",
          line: i,
          startCol: dpMatch.index,
          endCol: dpMatch.index + 17,
        });
      }
    }

    if (/^\s*#CustomView:/i.test(rawLine)) {
      isCustomView = true;
    }

    const evMatch = /^\s*#Event:\s*(.*)/i.exec(rawLine);
    if (evMatch) {
      isCustomView = true;
      const evContent = (evMatch[1] ?? '').trim();
      const evNameMatch = /^([a-zA-Z0-9_]+)\s*(?:\((.*)\))?/i.exec(evContent);
      if (!evNameMatch || !evNameMatch[1]) {
        items.push({
          ruleId: 'B4X-CS027',
          severity: 'warning',
          message: "Malformed #Event declaration. Expected syntax: '#Event: EventName (Param1 As Type, ...)'",
          line: i,
          startCol: evMatch.index,
          endCol: evMatch.index + evMatch[0].length,
        });
      }
    }

    if (/^\s*(?:Public\s+)?Sub\s+DesignerCreateView\b/i.test(masked)) {
      hasDesignerCreateView = true;
    }
    if (/^\s*(?:Private|Public)?\s*Sub\s+Base_Resize\b/i.test(masked)) {
      hasBaseResize = true;
    }
    if (/^\s*Sub\s+Class_Globals\b/i.test(masked)) {
      classGlobalsLine = i;
    }
    if (/\b(?:mBase|Base)\s+As\s+B4XView\b/i.test(masked)) {
      hasMBase = true;
    }

    // B4X-CS025: Unsafe Designer color read without PaintOrColorToColor
    const propGetMatch = /\bProps\.GetDefault\s*\(\s*"([^"]+)"\s*,\s*([^)]+)\)/i.exec(rawLine);
    if (propGetMatch && propGetMatch[1]) {
      const propKey = propGetMatch[1].toLowerCase();
      const isColorProp = designerColorKeys.has(propKey) || /color/i.test(propKey);
      const isColorTarget = /\b(?:mColor|Color|Clr|mFaceColor|mTextColor|mBgColor)\b/i.test(rawLine);
      if ((isColorProp || isColorTarget) && !/xui\.PaintOrColorToColor/i.test(rawLine)) {
        items.push({
          ruleId: 'B4X-CS025',
          severity: 'warning',
          message: `Designer color property '${propGetMatch[1]}' should be read using 'xui.PaintOrColorToColor(Props.GetDefault(...))' for cross-platform color compatibility.`,
          line: i,
          startCol: propGetMatch.index,
          endCol: propGetMatch.index + propGetMatch[0].length,
        });
      }
    }

    // --- Modern B4A & B4XPages Rules (B4X-CS029, B4X-CS030) ---
    if (/\bB4XPages\b/i.test(masked) || /B4XPage_/i.test(masked)) {
      isB4XPage = true;
    }
    if (/Starter/i.test(rawLine) && /#Region\s+(?:Service|Starter)/i.test(rawLine)) {
      isStarterService = true;
    }

    if (isStarterService && /^\s*Sub\s+Service_Create\b/i.test(masked)) {
      const m = /^\s*Sub\s+Service_Create\b/i.exec(masked);
      items.push({
        ruleId: 'B4X-CS029',
        severity: 'warning',
        message: "The Starter service is deprecated in B4A v13.5+. In modern B4XPages apps, declare process-global variables and initialization in B4XMainPage or Main instead.",
        line: i,
        startCol: m ? m.index : 0,
        endCol: m ? m.index + m[0].length : 18,
      });
    }

    if (isB4XPage) {
      const actMatch = /^\s*Sub\s+(Activity_Create|Activity_Resume|Activity_Pause)\b/i.exec(masked);
      if (actMatch) {
        items.push({
          ruleId: 'B4X-CS030',
          severity: 'warning',
          message: `Legacy Activity lifecycle sub '${actMatch[1]}' should not be used in B4XPages. Use 'B4XPage_Created', 'B4XPage_Appear', or 'B4XPage_Disappear' instead.`,
          line: i,
          startCol: actMatch.index,
          endCol: actMatch.index + actMatch[0].length,
        });
      }
    }
  }

  // B4X-CS020: ABMaterial page adds grid rows but never calls BuildGrid
  if (hasAddRows && !hasBuildGrid && firstAddRowsLine !== -1) {
    items.push({
      ruleId: 'B4X-CS020',
      severity: 'warning',
      message: "ABMaterial grid rows added but 'BuildGrid' was never called. Components will not render without BuildGrid.",
      line: firstAddRowsLine,
      startCol: firstAddRowsCol,
      endCol: firstAddRowsCol + 10,
    });
  }

  // B4X-CS023 & B4X-CS024 & B4X-CS028: CustomView structure requirements
  if (isCustomView) {
    if (!hasDesignerCreateView && firstDesignerPropLine !== -1) {
      items.push({
        ruleId: 'B4X-CS023',
        severity: 'warning',
        message: "CustomView is missing required 'DesignerCreateView(Base As Object, Lbl As Label, Props As Map)' implementation.",
        line: firstDesignerPropLine,
        startCol: firstDesignerPropCol,
        endCol: firstDesignerPropCol + 17,
      });
    }
    if (!hasBaseResize && firstDesignerPropLine !== -1) {
      items.push({
        ruleId: 'B4X-CS024',
        severity: 'info',
        message: "CustomView is missing recommended 'Base_Resize(Width As Double, Height As Double)' implementation.",
        line: firstDesignerPropLine,
        startCol: firstDesignerPropCol,
        endCol: firstDesignerPropCol + 17,
      });
    }
    if (!hasMBase && classGlobalsLine !== -1) {
      items.push({
        ruleId: 'B4X-CS028',
        severity: 'warning',
        message: "CustomView should declare 'Public mBase As B4XView' in Class_Globals for cross-platform compatibility.",
        line: classGlobalsLine,
        startCol: 0,
        endCol: 17,
      });
    }
  }

  return items;
}

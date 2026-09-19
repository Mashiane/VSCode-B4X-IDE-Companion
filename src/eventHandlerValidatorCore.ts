/**
 * Core pure functions for statically validating B4X event handler Subs.
 * Grounded in B4XMcpServer's EventHandlerValidator.cs:
 * Detects parameter count, name, and type mismatches in event handler Subs
 * (e.g. Button1_Click, clv_ItemClick) against library and core event definitions.
 *
 * No VS Code dependencies for clean unit-testing.
 */

export interface EventParamInfo {
  name: string;
  type: string;
}

export interface ExpectedEventDef {
  eventName: string;
  typeName: string;
  parameters: EventParamInfo[];
  rawSignature: string;
}

export interface EventHandlerMismatchItem {
  ruleId: 'B4X-EV001';
  severity: 'warning';
  message: string;
  line: number;
  startCol: number;
  endCol: number;
  controlName: string;
  eventName: string;
  expectedSignature: string;
  foundSignature: string;
}

/**
 * Standard event signatures for built-in B4X and XUI controls.
 * Used for instant validation and fallback when library XML is still loading.
 */
export const DEFAULT_CORE_EVENT_SIGNATURES: Record<string, Record<string, { params: EventParamInfo[]; raw: string }>> = {
  button: {
    click: { params: [], raw: 'Click' },
    longclick: { params: [], raw: 'LongClick' },
  },
  timer: {
    tick: { params: [], raw: 'Tick' },
  },
  customlistview: {
    itemclick: {
      params: [
        { name: 'Index', type: 'Int' },
        { name: 'Value', type: 'Object' },
      ],
      raw: 'ItemClick (Index As Int, Value As Object)',
    },
    visiblerangechanged: {
      params: [
        { name: 'FirstIndex', type: 'Int' },
        { name: 'LastIndex', type: 'Int' },
      ],
      raw: 'VisibleRangeChanged (FirstIndex As Int, LastIndex As Int)',
    },
    reachsend: { params: [], raw: 'ReachEnd' },
  },
  xcustomlistview: {
    itemclick: {
      params: [
        { name: 'Index', type: 'Int' },
        { name: 'Value', type: 'Object' },
      ],
      raw: 'ItemClick (Index As Int, Value As Object)',
    },
    visiblerangechanged: {
      params: [
        { name: 'FirstIndex', type: 'Int' },
        { name: 'LastIndex', type: 'Int' },
      ],
      raw: 'VisibleRangeChanged (FirstIndex As Int, LastIndex As Int)',
    },
    reachsend: { params: [], raw: 'ReachEnd' },
  },
  edittext: {
    textchanged: {
      params: [
        { name: 'Old', type: 'String' },
        { name: 'New', type: 'String' },
      ],
      raw: 'TextChanged (Old As String, New As String)',
    },
    focuschanged: {
      params: [{ name: 'HasFocus', type: 'Boolean' }],
      raw: 'FocusChanged (HasFocus As Boolean)',
    },
    enterpressed: { params: [], raw: 'EnterPressed' },
  },
  b4xfloattextfield: {
    textchanged: {
      params: [
        { name: 'Old', type: 'String' },
        { name: 'New', type: 'String' },
      ],
      raw: 'TextChanged (Old As String, New As String)',
    },
    enterpressed: { params: [], raw: 'EnterPressed' },
  },
  checkbox: {
    checkedchange: {
      params: [{ name: 'Checked', type: 'Boolean' }],
      raw: 'CheckedChange (Checked As Boolean)',
    },
  },
  b4xswitch: {
    valuechanged: {
      params: [{ name: 'Value', type: 'Boolean' }],
      raw: 'ValueChanged (Value As Boolean)',
    },
  },
  b4xcombobox: {
    selectedindexchanged: {
      params: [{ name: 'Index', type: 'Int' }],
      raw: 'SelectedIndexChanged (Index As Int)',
    },
  },
  b4xview: {
    click: { params: [], raw: 'Click' },
    longclick: { params: [], raw: 'LongClick' },
    touch: {
      params: [
        { name: 'Action', type: 'Int' },
        { name: 'X', type: 'Float' },
        { name: 'Y', type: 'Float' },
      ],
      raw: 'Touch (Action As Int, X As Float, Y As Float)',
    },
  },
};

/**
 * Parses parameter string like "(Index As Int, Value As Object)" into structured parameter list.
 */
export function parseParameterString(paramString: string): EventParamInfo[] {
  let inner = paramString.trim();
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.substring(1, inner.length - 1).trim();
  }
  if (!inner) {
    return [];
  }

  const result: EventParamInfo[] = [];
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  for (const part of parts) {
    const m = /^\s*([a-zA-Z0-9_]+)\s+As\s+([a-zA-Z0-9_]+(?:\([^)]*\))?)/i.exec(part);
    if (m && m[1] && m[2]) {
      result.push({ name: m[1], type: m[2] });
    } else {
      const bareName = part.trim().split(/\s+/)[0];
      if (bareName) {
        result.push({ name: bareName, type: 'Object' });
      }
    }
  }

  return result;
}

/**
 * Extracts declared variable names and their types from B4X source code lines.
 * Matches: Dim/Private/Public/Globals <names> As <Type>
 */
export function extractControlTypes(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const declRegex = /^\s*(?:Dim|Private|Public|Globals)\s+([a-zA-Z0-9_]+(?:\s*,\s*[a-zA-Z0-9_]+)*)\s+As\s+([a-zA-Z0-9_]+)/i;

  for (const line of lines) {
    const m = declRegex.exec(line);
    if (!m || !m[1] || !m[2]) continue;

    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    const typeName = m[2].trim();

    for (const name of names) {
      map.set(name.toLowerCase(), typeName);
    }
  }

  return map;
}

/**
 * Validates Sub event handler signatures in the document lines.
 *
 * @param lines Array of source code lines
 * @param customControlTypes Optional control-to-type map (e.g. from layout files or workspace)
 * @param externalEventSignatures Optional external library event definitions (from xmlLibraryIndex)
 */
export function validateEventHandlers(
  lines: string[],
  customControlTypes?: Map<string, string>,
  externalEventSignatures?: Map<string, Map<string, { parameters: EventParamInfo[]; rawSignature: string }>>
): EventHandlerMismatchItem[] {
  const items: EventHandlerMismatchItem[] = [];

  const controlMap = extractControlTypes(lines);
  if (customControlTypes) {
    for (const [k, v] of customControlTypes.entries()) {
      controlMap.set(k.toLowerCase(), v);
    }
  }

  const subRegex = /^\s*(?:Private\s+|Public\s+)?Sub\s+([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const m = subRegex.exec(rawLine);
    if (!m || !m[1] || !m[2]) continue;

    const controlName = m[1];
    const eventName = m[2];
    const rawParams = m[3] ?? '';

    if (/^b4xpage$/i.test(controlName) || /^activity$/i.test(controlName) || /^service$/i.test(controlName)) {
      continue;
    }

    const typeName = controlMap.get(controlName.toLowerCase());
    if (!typeName) continue;

    const typeLower = typeName.toLowerCase();
    const eventLower = eventName.toLowerCase();

    let expected: { parameters: EventParamInfo[]; rawSignature: string } | undefined;
    if (externalEventSignatures) {
      const typeEvents = externalEventSignatures.get(typeLower);
      if (typeEvents) {
        expected = typeEvents.get(eventLower);
      }
    }

    if (!expected) {
      const coreType = DEFAULT_CORE_EVENT_SIGNATURES[typeLower];
      if (coreType && coreType[eventLower]) {
        expected = {
          parameters: coreType[eventLower].params,
          rawSignature: coreType[eventLower].raw,
        };
      }
    }

    if (!expected) continue;

    const actualParams = parseParameterString(rawParams);

    let mismatch = false;
    let reason = '';

    if (actualParams.length !== expected.parameters.length) {
      mismatch = true;
      reason = `Parameter count mismatch (expected ${expected.parameters.length}, found ${actualParams.length})`;
    } else {
      for (let p = 0; p < expected.parameters.length; p++) {
        const expP = expected.parameters[p]!;
        const actP = actualParams[p]!;
        if (expP.type.toLowerCase() !== actP.type.toLowerCase()) {
          if (actP.type.toLowerCase() !== 'object') {
            mismatch = true;
            reason = `Parameter ${p + 1} ('${actP.name}') type mismatch: expected '${expP.type}', found '${actP.type}'`;
            break;
          }
        }
      }
    }

    if (mismatch) {
      const subStart = rawLine.toLowerCase().indexOf(`sub ${controlName.toLowerCase()}_${eventName.toLowerCase()}`);
      const startCol = subStart >= 0 ? subStart : 0;
      const endCol = m[0].length;

      const expectedFormatted = expected.parameters.length === 0
        ? `${controlName}_${eventName}`
        : `${controlName}_${eventName}(${expected.parameters.map((p) => `${p.name} As ${p.type}`).join(', ')})`;

      const actualFormatted = actualParams.length === 0
        ? `${controlName}_${eventName}`
        : `${controlName}_${eventName}(${actualParams.map((p) => `${p.name} As ${p.type}`).join(', ')})`;

      items.push({
        ruleId: 'B4X-EV001',
        severity: 'warning',
        message: `Event handler signature mismatch for '${controlName}_${eventName}'. ${reason}. Expected: '${expectedFormatted}'.`,
        line: i,
        startCol,
        endCol,
        controlName,
        eventName,
        expectedSignature: expectedFormatted,
        foundSignature: actualFormatted,
      });
    }
  }

  return items;
}

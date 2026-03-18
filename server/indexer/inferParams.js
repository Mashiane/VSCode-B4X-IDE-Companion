// Heuristic parameter inference for Extract Method
// Returns an ordered array of parameter names
function inferParamsForSelection(fileContent, range) {
  const lines = fileContent.split(/\r?\n/);
  const selStart = range.start.line;
  const selEnd = range.end.line;
  const selText = lines.slice(selStart, selEnd + 1).join('\n');

  const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
  const ids = new Set();
  let m;
  while ((m = idRegex.exec(selText)) !== null) ids.add(m[0]);

  // Find ids declared within selection (Dim, assignment)
  const declaredInSelection = new Set();
  const selLines = selText.split(/\r?\n/);
  for (const l of selLines) {
    const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(l);
    if (dm) declaredInSelection.add(dm[1]);
    const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    if (asgn) declaredInSelection.add(asgn[1]);
  }

  // Find containing Sub boundaries
  let subStart = 0;
  for (let i = selStart; i >= 0; i--) {
    const l = lines[i] || '';
    if (/^\s*Sub\b/i.test(l)) { subStart = i; break; }
  }
  let subEnd = lines.length - 1;
  for (let i = selEnd; i < lines.length; i++) {
    const l = lines[i] || '';
    if (/^\s*End\s+Sub\b/i.test(l)) { subEnd = i; break; }
  }

  // Collect identifiers declared outside selection but within the same Sub
  const declaredOutsideSelection = new Set();
  for (let i = subStart; i <= subEnd; i++) {
    if (i >= selStart && i <= selEnd) continue;
    const l = lines[i] || '';
    const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(l);
    if (dm) declaredOutsideSelection.add(dm[1]);
    const asgn = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    if (asgn) declaredOutsideSelection.add(asgn[1]);
    const sig = /^\s*Sub\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/i.exec(l);
    if (sig && sig[1]) {
      const parts = sig[1].split(',').map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        const pn = p.split(' ')[0]; if (pn) declaredOutsideSelection.add(pn);
      }
    }
  }

  // Collect class/process globals
  const globalDeclared = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || '';
    if (/^\s*Sub\s+Class_/i.test(l) || /^\s*Sub\s+Process_Globals/i.test(l)) {
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j] || '';
        const dm = /\bDim\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(lj);
        if (dm) globalDeclared.add(dm[1]);
        if (/^\s*End\s+Sub\b/i.test(lj)) { break; }
      }
    }
  }

  const candidateParams = [...ids].filter((id) => !declaredInSelection.has(id) && !/^Sub$|^End$|^Type$|^End Type$|^End Sub$/i.test(id));
  const candidatesFiltered = candidateParams.filter((id) => id.length >= 1);

  // Score candidates
  const scored = candidatesFiltered.map((id) => {
    let score = 0;
    if (declaredOutsideSelection.has(id)) score += 20;
    const beforeText = lines.slice(subStart, selStart).join('\n');
    const afterText = lines.slice(selEnd + 1, subEnd + 1).join('\n');
    const idRegexEsc = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const nearBefore = new RegExp('\\b' + idRegexEsc + '\\b', 'i').test(beforeText);
    const nearAfter = new RegExp('\\b' + idRegexEsc + '\\b', 'i').test(afterText);
    if (nearBefore) score += 10;
    if (nearAfter) score += 8;
    if (globalDeclared.has(id)) score -= 5;
    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // Load API index (if available) to help infer types by matching class names
  let apiClasses = new Set();
  try {
    const apiIndex = require('../../data/b4x-api-index.json');
    if (apiIndex && Array.isArray(apiIndex.allClasses)) {
      for (const c of apiIndex.allClasses) apiClasses.add(String(c.name));
    }
  } catch (_) { /* ignore if file missing */ }

  // Infer basic types for the top candidates
  const results = [];
  for (const s of scored.filter(s => s.score > 0)) {
    const name = s.id;
    // Look for assignments to this identifier in selection or nearby lines indicating type
    const assignRegex = new RegExp('\\b' + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + "\\s*=\\s*(.*)", 'i');
    let inferredType = 'Object';
    // check assignments in selection
    for (let i = selStart; i <= selEnd; i++) {
      const l = lines[i] || '';
      const am = assignRegex.exec(l);
        if (am && am[1]) {
        const rhs = am[1].trim();
          if (/^".*"$/.test(rhs)) { inferredType = 'String'; break; }
          if (/^\d+$/.test(rhs)) { inferredType = 'Int'; break; }
          if (/^True$|^False$/i.test(rhs)) { inferredType = 'Boolean'; break; }
          if (/\bCreate(Map|List|Array)\b/i.test(rhs) || /\bNew\s+(Map|List|Array)\b/i.test(rhs)) { inferredType = 'List'; break; }
          if (/\bCreateMap\b/i.test(rhs) || /\bNew\s+Map\b/i.test(rhs)) { inferredType = 'Map'; break; }
          if (/\bCreateList\b/i.test(rhs) || /\bNew\s+List\b/i.test(rhs)) { inferredType = 'List'; break; }
          // function call returning UI element or class-like naming heuristics
          if (/\([^)]+\)\s*\.\s*Add\b/i.test(rhs)) { inferredType = 'List'; break; }
      }
    }
    // check nearby assignments
    if (inferredType === 'Object') {
      for (let i = Math.max(0, selStart - 8); i <= Math.min(lines.length - 1, selEnd + 8); i++) {
        const l = lines[i] || '';
        const am = assignRegex.exec(l);
        if (am && am[1]) {
          const rhs = am[1].trim();
          if (/^".*"$/.test(rhs)) { inferredType = 'String'; break; }
          if (/^\d+$/.test(rhs)) { inferredType = 'Int'; break; }
          if (/^True$|^False$/i.test(rhs)) { inferredType = 'Boolean'; break; }
          if (/\bCreate(Map|List|Array)\b/i.test(rhs) || /\bNew\s+(Map|List|Array)\b/i.test(rhs)) { inferredType = 'List'; break; }
          if (/\bCreateMap\b/i.test(rhs) || /\bNew\s+Map\b/i.test(rhs)) { inferredType = 'Map'; break; }
          if (/\bCreateList\b/i.test(rhs) || /\bNew\s+List\b/i.test(rhs)) { inferredType = 'List'; break; }
        }
      }
    }

    // If identifier name matches a known API class, prefer that type
    if (apiClasses.has(name)) {
      inferredType = name;
    } else {
      // also check if RHS mentions a known class name
      for (const cls of apiClasses) {
        const clsRegex = new RegExp('\\b' + cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
        if (clsRegex.test(fileContent)) { inferredType = cls; break; }
      }
    }
    results.push({ name, type: inferredType, score: s.score });
  }

  return results.map(r => ({ name: r.name, type: r.type }));
}

module.exports = { inferParamsForSelection };

// Helper to create a WorkspaceEdit for Extract Method refactoring.
// Simple strategy:
// - Given a file path and a selection range (start/end line+character) extract the selected text
// - Create a new Sub with provided name at the end of the file
// - Replace selection with a call to the new Sub (with parentheses)

function createExtractMethodEdit(filePath, selection, newName, fileContent, params) {
  const lines = fileContent.split(/\r?\n/);
    const start = selection.start || { line: 0, character: 0 };
    const end = selection.end || { line: 0, character: 0 };

  // Extract text
  const extractedLines = lines.slice(start.line, end.line + 1);
  // If single line, trim start/end chars
  if (start.line === end.line) {
    extractedLines[0] = extractedLines[0].substring(start.character, end.character);
  } else {
    extractedLines[0] = extractedLines[0].substring(start.character);
    extractedLines[extractedLines.length - 1] = extractedLines[extractedLines.length - 1].substring(0, end.character);
  }

  const extractedText = extractedLines.join('\n');

  // Build new Sub text
    // params may be array of names or objects {name,type}
    const paramList = (params && params.length) ? params.map(p => (typeof p === 'string' ? p : p.name)).join(', ') : '';
    const paramDecls = (params && params.length) ? params.map(p => (typeof p === 'string' ? `${p} As Object` : `${p.name} As ${p.type}`)).join(', ') : '';
    const subLines = [`Sub ${newName}${paramDecls ? '(' + paramDecls + ')' : '()'}`];
  // indent the extracted text by two spaces
  for (const l of extractedLines) subLines.push(`  ${l}`);
  subLines.push('End Sub');

  const newSubText = subLines.join('\n');

  // Replacement for selection: call the new method
    const callText = `${newName}(${paramList})`;

  const { pathToFileURL } = require('url');
  const fileUri = pathToFileURL(require('path').resolve(filePath)).toString();

  const edits = {};
  edits[fileUri] = [];

  edits[fileUri].push({
    range: { start: { line: start.line, character: start.character }, end: { line: end.line, character: end.character } },
    newText: callText,
  });

  // Append new Sub at EOF with a separating blank line
  const eofLine = lines.length;
  edits[fileUri].push({ range: { start: { line: eofLine, character: 0 }, end: { line: eofLine, character: 0 } }, newText: '\n' + newSubText + '\n' });

  // Normalize suggested params to objects {name,type}
  const suggested = (params || []).map(p => (typeof p === 'string' ? { name: p, type: 'Object' } : p));

  return { changes: edits, suggestedParams: suggested };
}

module.exports = { createExtractMethodEdit };

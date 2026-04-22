import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseWorkspaceClassDocument } from '../../src/workspaceClassIndex';

function makeTextDocument(filePath: string, content: string): any {
  const lines = content.split(/\r?\n/);
  return {
    uri: { fsPath: filePath },
    getText: () => content,
    lineCount: lines.length,
    lineAt: (i: number) => {
      const text = lines[i] ?? '';
      return {
        text,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: text.length },
        },
      };
    },
    positionAt: (offset: number) => {
      let running = 0;
      for (let idx = 0; idx < lines.length; idx += 1) {
        const l = lines[idx] + '\n';
        const next = running + l.length;
        if (offset <= next) {
          return { line: idx, character: Math.max(0, offset - running) };
        }
        running = next;
      }
      return { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] || '').length };
    },
  };
}

async function run() {
  const sample = path.resolve(process.cwd(), 'test', 'MyWidget.bas');
  if (!fs.existsSync(sample)) {
    console.error('Sample file not found:', sample);
    process.exit(1);
  }

  const content = fs.readFileSync(sample, 'utf8');
  const doc = makeTextDocument(sample, content);
  const parsed = parseWorkspaceClassDocument(doc as any);
  console.log('Parsed output for', path.basename(sample));
  if (parsed) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  console.log('No class parsed from the file. Showing a generated sample parse:');
  const gen = "' Sample class\nType = Class\nSub Class_Globals\nEnd Sub\nPublic Sub getValue() As String\n  Return \"hi\"\nEnd Sub\nPublic Sub setValue(Value As String)\nEnd Sub\nPublic Sub DoSomething()\nEnd Sub\n";
  const gdoc = makeTextDocument('generated.bas', gen);
  const gparsed = parseWorkspaceClassDocument(gdoc as any);
  console.log(JSON.stringify(gparsed, null, 2));
}

run().catch((err) => { console.error(err); process.exit(1); });

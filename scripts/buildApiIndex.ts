import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseApiIndexDocument, summarizeApiIndex } from '../src/b4xDocParser';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const sourceFilePath = path.join(workspaceRoot, 'b4a_libraries.txt');
const outputFilePath = path.join(workspaceRoot, 'data', 'b4x-api-index.json');
function main(): void {
  const raw = decodeTextBuffer(fs.readFileSync(sourceFilePath));
  const index = parseApiIndexDocument(raw, path.basename(sourceFilePath));

  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  fs.writeFileSync(outputFilePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  const summary = summarizeApiIndex(index);
  console.log(`B4X API index written to ${outputFilePath}`);
  console.log(`Libraries: ${summary.libraries}`);
  console.log(`Classes: ${summary.classes}`);
  console.log(`Methods: ${summary.methods}`);
  console.log(`Properties: ${summary.properties}`);
}

function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString('utf16le');
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 256));
  let nullBytes = 0;

  for (const value of sample) {
    if (value === 0) {
      nullBytes += 1;
    }
  }

  if (nullBytes > sample.length / 4) {
    return buffer.toString('utf16le');
  }

  return buffer.toString('utf8');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

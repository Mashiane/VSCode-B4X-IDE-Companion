/**
 * CLI and API utilities for converting B4X binary layout files (.bal, .bjl, .bil)
 * to/from readable JSON format for AI assistants and developer inspection.
 * Powered by the consolidated SithasoLayoutEngine and BJLConverter.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Lazy-load Sithaso converter with bundled pako
function getConverter() {
  let pakoPath = path.join(__dirname, '..', '..', '..', 'media', 'bjl-editor', 'scripts', 'pako.min.js');
  let enginePath = path.join(__dirname, '..', '..', '..', 'media', 'bjl-editor', 'scripts', 'SithasoLayoutEngine.js');
  if (!fs.existsSync(pakoPath)) {
    pakoPath = path.join(__dirname, '..', '..', 'media', 'bjl-editor', 'scripts', 'pako.min.js');
    enginePath = path.join(__dirname, '..', '..', 'media', 'bjl-editor', 'scripts', 'SithasoLayoutEngine.js');
  }

  const pako = require(pakoPath);
  (global as any).pako = pako;
  const sithaso = require(enginePath);
  return new sithaso.Converter();
}

/**
 * Converts binary layout (.bal, .bjl, .bil) bytes into structured JSON object.
 */
export async function convertLayoutToJson(bytes: Uint8Array): Promise<any> {
  const converter = getConverter();
  return await converter.convertBjlToJsonFromBytes(bytes);
}

/**
 * Converts structured JSON object back into binary layout bytes.
 */
export async function convertJsonToLayout(jsonObj: any): Promise<Uint8Array> {
  const converter = getConverter();
  return await converter.convertJsonToBjlToBytes(jsonObj);
}

/**
 * Exports a binary layout file on disk to a formatted .json file.
 */
export async function exportLayoutToJsonFile(layoutPath: string, jsonOutputPath?: string): Promise<string> {
  if (!fs.existsSync(layoutPath)) {
    throw new Error(`Layout file does not exist: ${layoutPath}`);
  }

  const bytes = fs.readFileSync(layoutPath);
  const jsonObj = await convertLayoutToJson(new Uint8Array(bytes));
  const targetPath = jsonOutputPath || layoutPath.replace(/\.(bal|bjl|bil)$/i, '.layout.json');

  fs.writeFileSync(targetPath, JSON.stringify(jsonObj, null, 2), 'utf8');
  return targetPath;
}

/**
 * Imports a formatted .json layout file and encodes it back to binary layout format.
 */
export async function importLayoutFromJsonFile(jsonPath: string, layoutOutputPath?: string): Promise<string> {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file does not exist: ${jsonPath}`);
  }

  const jsonStr = fs.readFileSync(jsonPath, 'utf8');
  const jsonObj = JSON.parse(jsonStr);
  const bytes = await convertJsonToLayout(jsonObj);
  const targetPath = layoutOutputPath || (jsonPath.toLowerCase().endsWith('.layout.json') ? jsonPath.slice(0, -'.layout.json'.length) + '.bal' : jsonPath.replace(/\.json$/i, '.bal'));

  fs.writeFileSync(targetPath, Buffer.from(bytes));
  return targetPath;
}

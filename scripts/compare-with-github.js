// Compare Google Sheet with GitHub JSON to see unique entries
const https = require('https');

const SHEET_ID = '1qFvc3Q70RriJS3m_ywBoJvZ47gSTVAuN_X04SI0_XBw';
const GITHUB_JSON_URL = 'https://raw.githubusercontent.com/AnywhereSoftware/B4X_Forum_Resources/main/libraries_mapping.json';

async function fetchSheetAsCsv() {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

function parseSheetEntries(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  const dataLines = lines.slice(2);

  const entries = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    const libraryName = fields[0]?.trim();
    const b4aFile = fields[2]?.trim();
    const b4iFile = fields[3]?.trim();
    const b4jFile = fields[4]?.trim();
    const b4rFile = fields[5]?.trim();
    const version = fields[6]?.trim();

    if (!libraryName) continue;

    let platform = null;
    let libraryFile = null;
    let key = null;

    if (b4rFile) { platform = 'B4R'; libraryFile = b4rFile; }
    else if (b4jFile) { platform = 'B4J'; libraryFile = b4jFile; }
    else if (b4iFile) { platform = 'B4i'; libraryFile = b4iFile; }
    else if (b4aFile) { platform = 'B4A'; libraryFile = b4aFile; }

    if (platform && libraryFile) {
      key = libraryFile.toLowerCase().replace(/[^a-z0-9]/g, '-');
      if (key.startsWith('-')) key = key.substring(1);
      entries.push({ key, platform, libraryFile, version, name: libraryName });
    }
  }

  return entries;
}

async function fetchGitHubJson() {
  return new Promise((resolve, reject) => {
    https.get(GITHUB_JSON_URL, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Comparing Sheet vs GitHub ===\n');

  // Fetch both sources
  const [sheetEntries, githubData] = await Promise.all([
    fetchSheetAsCsv().then(parseSheetEntries),
    fetchGitHubJson()
  ]);

  console.log(`Google Sheet entries: ${sheetEntries.length}`);
  console.log(`GitHub JSON entries: ${Object.keys(githubData).length}`);

  // Create GitHub key map
  const githubKeys = new Set(Object.keys(githubData));
  const githubPlatformMap = new Map();
  for (const [key, entry] of Object.entries(githubData)) {
    githubPlatformMap.set(key, entry.platform);
  }

  // Find unique sheet entries (not in GitHub)
  const uniqueSheetEntries = [];
  const duplicates = [];

  for (const entry of sheetEntries) {
    if (githubKeys.has(entry.key)) {
      // Check if platform matches
      const existingPlatform = githubPlatformMap.get(entry.key);
      if (existingPlatform !== entry.platform) {
        uniqueSheetEntries.push({ ...entry, reason: 'new-platform' });
      } else {
        duplicates.push({ ...entry, reason: 'exact-match' });
      }
    } else {
      uniqueSheetEntries.push(entry);
    }
  }

  console.log(`\nEntries in both (same key): ${duplicates.length}`);
  console.log(`Unique sheet entries (new to catalog): ${uniqueSheetEntries.length}`);

  // Show unique entries by platform
  const byPlatform = { B4A: [], B4i: [], B4J: [], B4R: [] };
  for (const entry of uniqueSheetEntries) {
    byPlatform[entry.platform].push(entry);
  }

  console.log(`\nUnique entries by platform:`);
  for (const [platform, list] of Object.entries(byPlatform)) {
    console.log(`  ${platform}: ${list.length}`);
  }

  // Show some examples
  console.log(`\nSample unique entries (first 5):`);
  for (let i = 0; i < Math.min(5, uniqueSheetEntries.length); i++) {
    const e = uniqueSheetEntries[i];
    console.log(`  ${i + 1}. ${e.name} (${e.platform})`);
    console.log(`     Key: ${e.key}`);
    console.log(`     File: ${e.libraryFile}`);
    console.log(`     Version: ${e.version}`);
  }
}

main().catch(console.error);

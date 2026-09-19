// Check if we can merge by library_file URL
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

    if (b4rFile) { platform = 'B4R'; libraryFile = b4rFile; }
    else if (b4jFile) { platform = 'B4J'; libraryFile = b4jFile; }
    else if (b4iFile) { platform = 'B4i'; libraryFile = b4iFile; }
    else if (b4aFile) { platform = 'B4A'; libraryFile = b4aFile; }

    if (platform && libraryFile) {
      entries.push({
        platform,
        libraryFile: libraryFile,  // Raw file name from sheet
        version,
        name: libraryName
      });
    }
  }

  return entries;
}

function normalizeUrl(url) {
  if (!url) return '';
  // Convert to lowercase, remove trailing slashes, decode
  return url.toLowerCase().replace(/\/+$/, '').replace(/ /g, '%20');
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
  console.log('=== Comparing by Library File ===\n');

  const [sheetEntries, githubData] = await Promise.all([
    fetchSheetAsCsv().then(parseSheetEntries),
    fetchGitHubJson()
  ]);

  console.log(`Google Sheet entries: ${sheetEntries.length}`);
  console.log(`GitHub JSON entries: ${Object.keys(githubData).length}\n`);

  // Create GitHub file map - normalize the URLs
  const githubFileMap = new Map();
  for (const [key, entry] of Object.entries(githubData)) {
    const normalizedUrl = normalizeUrl(entry.library_file);
    githubFileMap.set(normalizedUrl, { key, platform: entry.platform, entry });
  }

  // Find matches
  const matches = [];
  const noMatch = [];

  for (const entry of sheetEntries) {
    const normalizedUrl = normalizeUrl(entry.libraryFile);
    const githubEntry = githubFileMap.get(normalizedUrl);

    if (githubEntry) {
      matches.push({
        sheet: entry,
        github: githubEntry,
        matchedKey: githubEntry.key
      });
    } else {
      noMatch.push(entry);
    }
  }

  console.log(`Matches by library file: ${matches.length}`);
  console.log(`No match (unique to sheet): ${noMatch.length}\n`);

  // Show some matches
  if (matches.length > 0) {
    console.log('Sample matches (first 5):');
    for (let i = 0; i < Math.min(5, matches.length); i++) {
      const m = matches[i];
      console.log(`  ${i + 1}. ${m.sheet.name}`);
      console.log(`     Sheet file: ${m.sheet.libraryFile}`);
      console.log(`     GitHub key: ${m.matchedKey}`);
      console.log(`     GitHub platform: ${m.github.platform}`);
      console.log(`     GitHub library_file: ${m.github.entry.library_file.substring(0, 60)}...`);
    }
  }

  // Show unique entries
  console.log(`\nSample unique entries (first 5):`);
  for (let i = 0; i < Math.min(5, noMatch.length); i++) {
    const e = noMatch[i];
    console.log(`  ${i + 1}. ${e.name} (${e.platform})`);
    console.log(`     File: ${e.libraryFile}`);
    console.log(`     Version: ${e.version}`);
  }
}

main().catch(console.error);

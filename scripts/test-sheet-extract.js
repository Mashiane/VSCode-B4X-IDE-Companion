// Test script to extract and display Google Sheet data
// This will help us understand the structure before implementing

const SHEET_ID = '1qFvc3Q70RriJS3m_ywBoJvZ47gSTVAuN_X04SI0_XBw';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

async function fetchSheetAsCsv() {
  console.log('Fetching sheet as CSV...');
  try {
    const response = await fetch(SHEET_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const csvText = await response.text();
    return csvText;
  } catch (error) {
    console.error('Error fetching sheet:', error.message);
    return null;
  }
}

function parseCsvToObjects(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());

  // Skip first 2 rows (headers/titles)
  const dataLines = lines.slice(2);

  const entries = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    // Simple CSV parsing - handle quoted fields
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current); // Last field

    // Parse row data
    const libraryName = fields[0]?.trim();
    const shortDescription = fields[1]?.trim();
    const b4aFile = fields[2]?.trim();
    const b4iFile = fields[3]?.trim();
    const b4jFile = fields[4]?.trim();
    const b4rFile = fields[5]?.trim();
    const version = fields[6]?.trim();
    const lastModified = fields[7]?.trim();
    const author = fields[8]?.trim();
    // Field 9 appears to be empty based on sheet structure
    const forumLink = fields[10]?.trim();

    // Skip if no library name
    if (!libraryName) continue;

    // Determine platform from file columns
    let platform = null;
    let libraryFile = null;

    if (b4rFile) { platform = 'B4R'; libraryFile = b4rFile; }
    else if (b4jFile) { platform = 'B4J'; libraryFile = b4jFile; }
    else if (b4iFile) { platform = 'B4i'; libraryFile = b4iFile; }
    else if (b4aFile) { platform = 'B4A'; libraryFile = b4aFile; }

    // Skip if no platform/file found
    if (!platform || !libraryFile) {
      console.log(`  Skipping "${libraryName}": No platform file found`);
      continue;
    }

    entries.push({
      libraryName,
      shortDescription,
      platform,
      libraryFile,
      version,
      lastModified,
      author,
      forumLink
    });
  }

  return entries;
}

async function main() {
  console.log('=== Google Sheet Test Extraction ===\n');
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log(`URL: ${SHEET_URL}\n`);

  const csv = await fetchSheetAsCsv();
  if (!csv) {
    console.log('Failed to fetch sheet data.');
    return;
  }

  const entries = parseCsvToObjects(csv);

  console.log(`\nExtracted ${entries.length} library entries:\n`);

  // Display first 10 entries as sample
  console.log('Sample entries (first 10):');
  for (let i = 0; i < Math.min(10, entries.length); i++) {
    const e = entries[i];
    console.log(`  ${i + 1}. ${e.libraryName}`);
    console.log(`     Platform: ${e.platform}`);
    console.log(`     File: ${e.libraryFile}`);
    console.log(`     Version: ${e.version || '(none)'}`);
    console.log(`     Author: ${e.author || '(none)'}`);
    console.log(`     Forum: ${e.forumLink || '(none)'}`);
    console.log();
  }

  // Summary stats
  const platforms = {};
  entries.forEach(e => {
    platforms[e.platform] = (platforms[e.platform] || 0) + 1;
  });

  console.log('Platform breakdown:');
  Object.entries(platforms).forEach(([platform, count]) => {
    console.log(`  ${platform}: ${count}`);
  });
}

main();

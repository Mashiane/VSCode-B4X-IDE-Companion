import * as https from 'node:https';

export type B4xPlatform = 'B4X' | 'B4A' | 'B4J' | 'B4i' | 'B4R';

export interface SheetLibraryEntry {
  libraryName: string;
  shortDescription?: string;
  files: { b4a?: string; b4i?: string; b4j?: string; b4r?: string };
  version?: string;
  lastUpdate?: string;
  author?: string;
  forumLink?: string;
}

export interface MergedLibraryEntry {
  key: string;
  snippet: string;
  library_file: string;
  forum_thread: string;
  library_type: 'b4xlib' | 'native' | '';  // Empty string for Google Sheet entries (type unknown)
  name: string;
  title: string;
  readme_url: string;
  platform: 'B4X' | 'B4A' | 'B4J' | 'B4i' | 'B4R';
  author: string;
  tags: string[];
  version: string;
  versionStatus: 'loading' | 'loaded' | 'error';
}

/**
 * Parses a Google Sheets CSV export URL to extract spreadsheet ID and sheet ID.
 * Input format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit?gid=SHEET_ID
 * Returns: { spreadsheetId, sheetId }
 */
function parseGoogleSheetUrl(url: string): { spreadsheetId: string; sheetId: string } | null {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/edit)?(?:\?gid=([0-9]+))?/);
    if (!match) {
      return null;
    }
    const spreadsheetId = match[1] ?? '';
    const sheetId = (match[2] ?? '0'); // Default to first sheet (gid=0)
    if (!spreadsheetId) {
      return null;
    }
    return { spreadsheetId, sheetId };
  } catch {
    return null;
  }
}

/**
 * Constructs the CSV export URL for a Google Sheet.
 * Format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=SHEET_ID
 */
function buildCsvExportUrl(spreadsheetId: string, sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheetId}`;
}

export class GoogleSheetClient {
  /**
   * Constructs a GoogleSheetClient using the Google Sheets CSV export API.
   * The input URL can be in either format:
   * - Full URL: https://docs.google.com/spreadsheets/d/.../edit?gid=...
   * - Simplified: https://docs.google.com/spreadsheets/d/...
   */
  constructor(private sheetUrl: string) {}

  async fetchSheetData(): Promise<SheetLibraryEntry[]> {
    return new Promise((resolve, reject) => {
      const parsed = parseGoogleSheetUrl(this.sheetUrl);
      if (!parsed) {
        reject(new Error('Invalid Google Sheets URL format'));
        return;
      }

      const csvUrl = buildCsvExportUrl(parsed.spreadsheetId, parsed.sheetId);

      const req = https.get(csvUrl, res => {
        // Handle redirect (307)
        if (res.statusCode === 307 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            // Follow Google redirect - silent operation
            // Make a new request to the redirected URL
            const redirectReq = https.get(location, redirectRes => {
              if (redirectRes.statusCode !== 200) {
                reject(new Error(`HTTP ${redirectRes.statusCode}`));
                return;
              }
              let data = '';
              redirectRes.on('data', chunk => (data += chunk));
              redirectRes.on('end', () => {
                try {
                  const entries = this.parseSheetData(data);
                  resolve(entries);
                } catch (err) {
                  reject(err);
                }
              });
            });
            redirectReq.on('error', reject);
            redirectReq.setTimeout(10000, () => {
              redirectReq.destroy();
              reject(new Error('Sheet fetch timeout'));
            });
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const entries = this.parseSheetData(data);
            resolve(entries);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Sheet fetch timeout'));
      });
    });
  }

  parseSheetData(rawCsv: string): SheetLibraryEntry[] {
    const lines = rawCsv.split('\n').filter(line => line.trim());
    // Skip first 2 rows (headers)
    const dataLines = lines.slice(2);

    const entries: SheetLibraryEntry[] = [];

    for (const line of dataLines) {
      const fields = this.parseCsvLine(line);
      if (fields.length < 11) continue;

      const libraryName = fields[0]?.trim();
      const shortDescription = fields[1]?.trim();
      const b4aFile = fields[2]?.trim();
      const b4iFile = fields[3]?.trim();
      const b4jFile = fields[4]?.trim();
      const b4rFile = fields[5]?.trim();
      const version = fields[6]?.trim();
      const lastUpdate = fields[7]?.trim();
      const author = fields[8]?.trim();
      // Field 9 is empty
      const forumLink = fields[10]?.trim();

      // Skip if no library name
      if (!libraryName) continue;

      const files: SheetLibraryEntry['files'] = {};
      if (b4aFile) files.b4a = b4aFile;
      if (b4iFile) files.b4i = b4iFile;
      if (b4jFile) files.b4j = b4jFile;
      if (b4rFile) files.b4r = b4rFile;

      // Skip if no platform files
      if (!files.b4a && !files.b4i && !files.b4j && !files.b4r) {
        continue;
      }

      entries.push({
        libraryName,
        shortDescription,
        files,
        version: version || undefined,
        lastUpdate: lastUpdate || undefined,
        author: author || undefined,
        forumLink: forumLink || undefined,
      });
    }

    return entries;
  }

  /**
   * Normalize library name for comparison/duplicate detection.
   * Converts library name to a normalized key.
   */
  private normalizeLibraryName(name: string): string {
    // Remove common prefixes
    let normalized = name
      .toLowerCase()
      .replace(/\[b4x\]\s*/gi, '')
      .replace(/\[b4a\]\s*/gi, '')
      .replace(/\[b4j\]\s*/gi, '')
      .replace(/\[b4i\]\s*/gi, '')
      .replace(/\[b4r\]\s*/gi, '')
      .replace(/\[xui\]\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Replace special chars with hyphens
    normalized = normalized.replace(/[^a-z0-9\s]/g, '-').replace(/-+/g, '-');

    // Remove leading/trailing hyphens
    normalized = normalized.replace(/^-+|-+$/g, '');

    return normalized;
  }

  /**
   * Normalize filename for comparison/duplicate detection with GitHub.
   * Converts a filename (like "B4xDialog4Button") to a normalized key.
   */
  public normalizeLibraryNameForComparison(filename: string): string {
    // Remove extension if present
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    // Normalize: lowercase, replace special chars with hyphens
    return nameWithoutExt.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  /**
   * Create a catalog entry for a specific platform from sheet data.
   * Used when the same library exists on multiple platforms in the sheet.
   *
   * For Google Sheet entries, we only know:
   * - key (normalized filename)
   * - snippet (description + version + author)
   * - forum_thread (column K)
   * - platform (determined from which columns have files)
   * - title (library name from column A + short description from column B)
   * - version (column G)
   *
   * We do NOT know:
   * - library_file (sheet only has filenames, not URLs)
   * - library_type (sheet doesn't specify native vs b4xlib)
   * - readme_url (sheet doesn't have this)
   */
  public mapSheetToCatalogPlatform(
    entry: SheetLibraryEntry,
    platform: B4xPlatform,
    libraryFile: string
  ): Partial<MergedLibraryEntry> {
    // Use the library_file (filename without extension) as the key
    // This matches the GitHub JSON pattern for duplicate detection
    const filename = libraryFile.split('/').pop() || libraryFile;
    const key = this.normalizeLibraryNameForComparison(filename);

    // Build snippet from description and version
    const snippet = this.buildSnippet(entry);

    // Build title from library name (column A) + short description (column B)
    const title = entry.shortDescription
      ? `${entry.libraryName} - ${entry.shortDescription}`
      : entry.libraryName;

    // Forum thread - from column K
    const forum_thread = entry.forumLink || '';

    // For Google Sheet entries, these are empty because the sheet doesn't provide:
    // - library_file: only filenames, not URLs
    // - library_type: doesn't specify native vs b4xlib
    // - readme_url: not provided in sheet
    const readme_url = '';
    const library_type: 'b4xlib' | 'native' | '' = '';
    const author = entry.author || '';
    const tags: string[] = [];

    // Version - from column G
    const version = entry.version || '';
    const versionStatus: 'loading' | 'loaded' | 'error' = version ? 'loaded' : 'error';

    return {
      key,
      snippet,
      library_file: '',  // Sheet doesn't provide file URLs
      forum_thread,
      library_type,
      name: entry.libraryName,
      title,
      readme_url,
      platform,
      author,
      tags,
      version,
      versionStatus,
    };
  }

  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
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
    fields.push(current);
    return fields;
  }

  private normalizeName(name: string): string {
    // Remove common prefixes
    let normalized = name
      .toLowerCase()
      .replace(/\[b4x\]\s*/gi, '')
      .replace(/\[b4a\]\s*/gi, '')
      .replace(/\[b4j\]\s*/gi, '')
      .replace(/\[b4i\]\s*/gi, '')
      .replace(/\[b4r\]\s*/gi, '')
      .replace(/\[xui\]\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Replace special chars with hyphens
    normalized = normalized.replace(/[^a-z0-9\s]/g, '-').replace(/-+/g, '-');

    // Remove leading/trailing hyphens
    normalized = normalized.replace(/^-+|-+$/g, '');

    return normalized;
  }

  private buildSnippet(entry: SheetLibraryEntry): string {
    const lines: string[] = [];
    if (entry.shortDescription) {
      lines.push(entry.shortDescription);
    }
    if (entry.version) {
      lines.push(`Version: ${entry.version}`);
    }
    if (entry.author) {
      lines.push(`Author: ${entry.author}`);
    }
    return lines.join('\n');
  }

  private buildReadmeUrl(libraryFile: string): string {
    // Construct README URL - will be updated by version extraction
    return '';
  }
}

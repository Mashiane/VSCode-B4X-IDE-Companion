import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import StreamZip = require('node-stream-zip');
import { GoogleSheetClient, SheetLibraryEntry } from './googleSheetCatalog';

export type B4xPlatform = 'B4X' | 'B4A' | 'B4J' | 'B4i' | 'B4R';

/** Version extraction status for a library entry. */
export type VersionStatus = 'loading' | 'loaded' | 'error';

/** Source of the library entry - either from GitHub JSON or Google Sheet. */
export type LibrarySource = 'github' | 'google';

export interface LibraryEntry {
  key: string;
  snippet: string;
  library_file: string;
  forum_thread: string;
  library_type: 'b4xlib' | 'native' | '';  // Empty string for Google Sheet entries (type unknown)
  name: string;
  title: string;
  readme_url: string;
  platform: B4xPlatform;
  author: string;
  tags: string[];
  version: string;  // Library version (empty string if not yet extracted)
  versionStatus: VersionStatus;  // Track loading state
  source: LibrarySource;  // Source of the library entry
}

export interface LibraryFilter {
  platform?: B4xPlatform | 'All';
  type?: 'b4xlib' | 'native' | 'all';
  query?: string;
  sortBy?: 'name' | 'author' | 'type';
}

export interface VersionedLibraryEntry extends LibraryEntry {
  version: string;
  versionStatus: VersionStatus;
}

const REMOTE_URL =
  'https://raw.githubusercontent.com/AnywhereSoftware/B4X_Forum_Resources/main/libraries_mapping.json';
const GLOBAL_STATE_KEY_DATA = 'b4x.libraryCatalog.data';
const GLOBAL_STATE_KEY_ETAG = 'b4x.libraryCatalog.etag';
const GLOBAL_STATE_KEY_TIMESTAMP = 'b4x.libraryCatalog.timestamp';
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

export type ProgressStep = 'github' | 'versions' | 'sheet';

export class LibraryCatalog implements vscode.Disposable {
  private _entries: LibraryEntry[] = [];
  private _etag: string | null = null;
  private _source: 'remote' | 'cache' | 'bundled' = 'bundled';
  private _lastUpdated = 0;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _syncTimer: ReturnType<typeof setInterval> | undefined;

  // Version extraction cache - stores versions fetched from remote URLs
  private _versionCache: Map<string, string>;

  // Sheet data cache - stores loaded sheet entries (used during merge)
  private _sheetCache: Map<string, LibraryEntry> = new Map();

  /** Optional progress callback: (step, message, percent) */
  private _progressCb?: (step: ProgressStep, message: string, percent: number) => void;

  constructor(private context: vscode.ExtensionContext) {
    this._versionCache = new Map<string, string>();
  }

  /** Set a progress callback for long-running operations. */
  onProgress(cb: (step: ProgressStep, message: string, percent: number) => void): void {
    this._progressCb = cb;
  }

  async initialize(): Promise<void> {
    const cachedOk = this.loadFromCache();
    if (cachedOk) {
      this._source = 'cache';
      // Fetch remote and merge sheet data in background
      this.fetchRemoteAndMergeSheet().then(changed => {
        if (changed) this._onDidChange.fire();
      }).catch(() => {});
    } else {
      const remoteOk = await this.fetchRemote();
      if (!remoteOk) {
        await this.loadBundled();
      }
      // Merge sheet data after initial load
      await this.mergeSheetData();
    }
    // Ensure versions are fetched and saved for all entries
    await this.fetchVersionsForAllEntries();
    this._onDidChange.fire();
    this.startPeriodicSync();
  }

  getEntries(filter?: LibraryFilter): LibraryEntry[] {
    let result = this._entries;
    if (filter) {
      if (filter.platform && filter.platform !== 'All') {
        result = result.filter(e => e.platform === filter.platform);
      }
      if (filter.type && filter.type !== 'all') {
        result = result.filter(e => e.library_type === filter.type);
      }
      if (filter.query) {
        const q = filter.query.toLowerCase();
        result = result.filter(
          e =>
            e.name.toLowerCase().includes(q) ||
            e.title.toLowerCase().includes(q) ||
            e.author.toLowerCase().includes(q) ||
            e.snippet.toLowerCase().includes(q),
        );
      }
      const sortBy = filter.sortBy || 'name';
      const sortKey = sortBy as 'name' | 'author';
      result = result.slice().sort((a, b) => a[sortKey].localeCompare(b[sortKey]));
    }
    return result;
  }

  getEntry(key: string): LibraryEntry | undefined {
    return this._entries.find(e => e.key === key);
  }

  /** Update a catalog entry's version in place and notify listeners. */
  updateEntryVersion(key: string, version: string): void {
    const entry = this._entries.find(e => e.key === key);
    if (entry) {
      entry.version = version;
      entry.versionStatus = version ? 'loaded' : 'error';
      this._versionCache.set(key, version);
      this._onDidChange.fire();
    }
  }

  /** Update a catalog entry's version without firing onDidChange (for batch updates). */
  updateEntryVersionSilent(key: string, version: string): void {
    const entry = this._entries.find(e => e.key === key);
    if (entry) {
      entry.version = version;
      entry.versionStatus = version ? 'loaded' : 'error';
      this._versionCache.set(key, version);
    }
  }

  /** Fire onDidChange after batch updates. */
  fireChanged(): void {
    this._onDidChange.fire();
  }

  getPlatforms(): B4xPlatform[] {
    const seen = new Set<B4xPlatform>();
    for (const e of this._entries) {
      seen.add(e.platform);
    }
    return Array.from(seen);
  }

  get source(): string {
    return this._source;
  }

  get lastUpdated(): number {
    return this._lastUpdated;
  }

  async refresh(): Promise<void> {
    // Clear cache first - start fresh with empty entries
    this._entries = [];
    this._etag = null;

    const remoteOk = await this.fetchRemote();
    if (!remoteOk) {
      // GitHub fetch failed - fall back to bundled only (no cached data)
      await this.loadBundled();
    }
    // Always merge sheet data after GitHub JSON is loaded
    await this.mergeSheetData();
    // Refresh handles its own save to avoid double-write
    this.saveToCache();
    this._onDidChange.fire();
  }

  /**
   * Fetch version for a specific library entry.
   * Updates the entry in place.
   * Does NOT fire onDidChange - caller is responsible for firing once after all versions are fetched.
   * @param key The library entry key
   * @returns The version string, or empty string on error
   */
  private async fetchLibraryVersionInternal(key: string): Promise<void> {
    const entry = this._entries.find(e => e.key === key);
    if (!entry) {
      return;
    }

    // Check cache first - use cached value without firing
    const cachedVersion = this._versionCache.get(key);
    if (cachedVersion !== undefined) {
      entry.version = cachedVersion;
      entry.versionStatus = cachedVersion ? 'loaded' : 'error';
      return;
    }

    // Set to loading state (no fire)
    entry.versionStatus = 'loading';

    try {
      let version = '';
      if (entry.library_type === 'native') {
        version = await fetchRemoteXmlVersion(entry.library_file);
      } else {
        version = await fetchRemoteB4xlibVersion(entry.library_file);
      }

      // Cache the result
      this._versionCache.set(key, version);
      entry.version = version;
      entry.versionStatus = version ? 'loaded' : 'error';
    } catch (err) {
      // Failed to fetch version - silently continue with empty version
      entry.versionStatus = 'error';
      this._versionCache.set(key, '');
    }
  }

  /**
   * Fetch version for a specific library entry (public API for webview requests).
   * Updates the entry in place and fires onDidChange.
   * @param key The library entry key
   * @returns The version string, or empty string on error
   */
  async fetchLibraryVersion(key: string): Promise<string> {
    await this.fetchLibraryVersionInternal(key);
    this._onDidChange.fire();
    const entry = this._entries.find(e => e.key === key);
    return entry?.version ?? '';
  }

  dispose(): void {
    if (this._syncTimer !== undefined) {
      clearInterval(this._syncTimer);
      this._syncTimer = undefined;
    }
    this._onDidChange.dispose();
  }

  /**
   * Fetch versions for all GitHub entries that have a library_file URL.
   * Sheet entries already have their versions from column G of the sheet.
   * Updates entries in place. Does NOT fire onDidChange - caller must fire once at end.
   */
  private async fetchVersionsForAllEntries(): Promise<void> {
    const needVersion = this._entries.filter(entry =>
      entry.source === 'github' && entry.library_file && entry.versionStatus !== 'loaded'
    );
    if (needVersion.length === 0) {
      return;
    }
    let completed = 0;
    const total = needVersion.length;
    const promises = needVersion.map(async (entry) => {
      await this.fetchLibraryVersionInternal(entry.key);
      completed++;
      this._progressCb?.('versions', `Extracting versions (${completed}/${total})`, Math.round(completed / total * 100));
    });
    await Promise.all(promises);
  }

  // ---- Private methods ----

  private loadFromCache(): boolean {
    try {
      const data = this.context.globalState.get<string>(GLOBAL_STATE_KEY_DATA);
      if (!data) {
        return false;
      }
      const raw = JSON.parse(data);
      if (!raw || typeof raw !== 'object') {
        return false;
      }
      // Preserve cached versions when loading from cache
      const cachedVersions = new Map<string, { version: string; versionStatus: VersionStatus }>();
      for (const [key, value] of Object.entries(raw)) {
        const obj = value as Record<string, unknown>;
        cachedVersions.set(key, {
          version: String(obj.version ?? ''),
          versionStatus: (obj.versionStatus as VersionStatus) ?? 'loading',
        });
      }
      this._entries = this.transformRaw(raw, cachedVersions);
      this._etag = this.context.globalState.get<string>(GLOBAL_STATE_KEY_ETAG) ?? null;
      this._lastUpdated = this.context.globalState.get<number>(GLOBAL_STATE_KEY_TIMESTAMP) ?? 0;
      return this._entries.length > 0;
    } catch {
      return false;
    }
  }

  private saveToCache(): void {
    try {
      const raw: Record<string, unknown> = {};
      for (const e of this._entries) {
        raw[e.key] = {
          snippet: e.snippet,
          library_file: e.library_file,
          forum_thread: e.forum_thread,
          library_type: e.library_type,
          name: e.name,
          title: e.title,
          readme_url: e.readme_url,
          platform: e.platform,
          tags: e.tags,
          version: e.version,
          versionStatus: e.versionStatus,
          source: e.source,
        };
      }
      this.context.globalState.update(GLOBAL_STATE_KEY_DATA, JSON.stringify(raw));
      this.context.globalState.update(GLOBAL_STATE_KEY_ETAG, this._etag);
      this.context.globalState.update(GLOBAL_STATE_KEY_TIMESTAMP, this._lastUpdated);
    } catch {
      // globalState may exceed storage limits on very large datasets; ignore silently
    }
  }

  private async fetchRemote(): Promise<boolean> {
    this._progressCb?.('github', 'Fetching library index from GitHub...', 0);
    return new Promise(resolve => {
      const url = new URL(REMOTE_URL);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'User-Agent': 'B4X-IntelliSense/1.0',
        },
      };
      if (this._etag) {
        (options.headers as Record<string, string>)['If-None-Match'] = this._etag;
      }

      const req = https.request(options, res => {
        if (res.statusCode === 304) {
          // Not modified
          res.resume();
          resolve(true);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const raw = JSON.parse(body);
            if (!raw || typeof raw !== 'object') {
              resolve(false);
              return;
            }
            this._entries = this.transformRaw(raw);
            this._etag = res.headers['etag'] ?? null;
            this._source = 'remote';
            this._lastUpdated = Date.now();
            this._progressCb?.('github', 'Library index loaded, extracting versions...', 10);
            // Fetch versions for all entries before resolving
            await this.fetchVersionsForAllEntries();
            // Do NOT save to cache here - let refresh() handle it after merge
            // Do NOT fire _onDidChange here — fetchRemote() is a private helper.
            // Callers (refresh, startPeriodicSync) own the notification decision.
            resolve(true);
          } catch (e) {
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        resolve(false);
      });
      req.setTimeout(15000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  private async loadBundled(): Promise<void> {
    try {
      const filePath = path.join(this.context.extensionPath, 'libraries_mapping.json');
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this._entries = this.transformRaw(raw);
      this._source = 'bundled';
      // Trigger background version extraction for bundled entries
      await this.fetchVersionsForAllEntries();
    } catch {
      this._entries = [];
    }
  }

  private transformRaw(raw: Record<string, unknown>, cachedVersions?: Map<string, { version: string; versionStatus: VersionStatus }>): LibraryEntry[] {
    const entries: LibraryEntry[] = [];
    for (const [key, value] of Object.entries(raw)) {
      const obj = value as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') {
        continue;
      }
      // Use cached version if available, otherwise start with empty/loading
      const cached = cachedVersions?.get(key);
      entries.push({
        key,
        snippet: String(obj.snippet ?? ''),
        library_file: String(obj.library_file ?? ''),
        forum_thread: String(obj.forum_thread ?? ''),
        library_type: obj.library_type === 'native' ? 'native' : 'b4xlib',
        name: String(obj.name ?? key),
        title: String(obj.title ?? key),
        readme_url: String(obj.readme_url ?? ''),
        // Prefer the cached `platform` field; fall back to URL-derived value for
        // fresh remote JSON that was never round-tripped through saveToCache.
        platform: (obj.platform as B4xPlatform | undefined) ?? parsePlatform(String(obj.library_file ?? '')),
        author: extractAuthor(String(obj.snippet ?? '')),
        tags: extractTags(String(obj.title ?? '')),
        version: cached?.version ?? '',  // Use cached version if available
        versionStatus: cached?.versionStatus ?? 'loading' as const,
        source: (obj.source as LibrarySource) ?? 'github',  // Default to github if not specified
      });
    }
    return entries;
  }

  private startPeriodicSync(): void {
    if (this._syncTimer !== undefined) {
      clearInterval(this._syncTimer);
    }
    this._syncTimer = setInterval(() => {
      // Fire _onDidChange only when remote data actually changed (fetchRemote returns true
      // and we got HTTP 200 — 304 Not Modified also returns true but leaves entries intact,
      // so a redundant fire there is harmless but firing only on real updates is cleaner).
      this.fetchRemoteAndMergeSheet().then(changed => {
        if (changed) this._onDidChange.fire();
      }).catch(() => {});
    }, SYNC_INTERVAL_MS);
  }

  private async fetchRemoteAndMergeSheet(): Promise<boolean> {
    const remoteOk = await this.fetchRemote();
    let entriesChanged = remoteOk;
    if (!remoteOk) {
      const cachedOk = this.loadFromCache();
      if (!cachedOk) {
        await this.loadBundled();
        entriesChanged = true;
      }
    }
    // Merge sheet data after GitHub JSON is loaded
    const entriesBeforeMerge = this._entries.length;
    await this.mergeSheetData();
    if (this._entries.length !== entriesBeforeMerge) {
      entriesChanged = true;
    }
    // fetchRemoteAndMergeSheet saves because mergeSheetData() no longer does
    this.saveToCache();
    return entriesChanged;
  }

  private async mergeSheetData(): Promise<void> {
    const sheetUrl = this.getGoogleSheetUrl();
    if (!sheetUrl) {
      return;
    }
    this._progressCb?.('sheet', 'Fetching library catalog from Google Sheet...', 0);
    const client = new GoogleSheetClient(sheetUrl);
    try {
      const sheetEntries = await client.fetchSheetData();
      this._progressCb?.('sheet', `Merging ${sheetEntries.length} sheet entries...`, 50);
      const sheetEntriesMap = this.mergeSheetEntries(sheetEntries);
      // Combine GitHub entries with sheet entries
      // GitHub entries remain, sheet entries are added
      const combinedEntries = [...this._entries, ...sheetEntriesMap];
      this._entries = combinedEntries;
      this._lastUpdated = Date.now();
      this._progressCb?.('sheet', `Merged ${sheetEntriesMap.length} sheet entries`, 100);
      // Note: Version extraction only happens for GitHub entries
      // Sheet entries get their versions directly from column G of the sheet
      // Note: mergeSheetData() no longer saves to cache - callers handle save
    } catch (err) {
      // Failed to merge sheet data - silently continue with GitHub entries only
    }
  }

  private getGoogleSheetUrl(): string {
    const config = vscode.workspace.getConfiguration('b4xIntellisense');
    return config.get<string>('googleSheetUrl', '') ?? '';
  }

  private mergeSheetEntries(sheetEntries: SheetLibraryEntry[]): LibraryEntry[] {
    const merged = new Map<string, LibraryEntry>();

    // Build a set of existing library keys (from both GitHub and previously merged sheet entries)
    // This prevents duplicates when the same sheet data is processed multiple times
    const existingKeys = new Set<string>();
    for (const entry of this._entries) {
      existingKeys.add(entry.key);
    }

    // Add sheet entries (only if not already present)
    for (const entry of sheetEntries) {
      // Get all platform files with their platform
      const platformFiles: { platform: B4xPlatform; file: string }[] = [];
      if (entry.files.b4a) platformFiles.push({ platform: 'B4A', file: entry.files.b4a! });
      if (entry.files.b4i) platformFiles.push({ platform: 'B4i', file: entry.files.b4i! });
      if (entry.files.b4j) platformFiles.push({ platform: 'B4J', file: entry.files.b4j! });
      if (entry.files.b4r) platformFiles.push({ platform: 'B4R', file: entry.files.b4r! });

      for (const pf of platformFiles) {
        const file = pf.file;
        // Normalize filename to match GitHub's key format (lowercase, special chars replaced with hyphens)
        const fileKeyNormalized = file.toLowerCase().replace(/[^a-z0-9]/g, '-');

        // Skip if already in existing data (from cache or previous sync) or already added in this batch
        if (existingKeys.has(fileKeyNormalized) || merged.has(fileKeyNormalized)) {
          continue;
        }

        // Determine platform for this specific entry
        let platform: B4xPlatform;
        if (platformFiles.length === 1) {
          // Only one platform has a file → that specific platform (e.g., ABMaterial only on B4J)
          platform = pf.platform;
        } else {
          // Multiple platforms have files
          const allFilenames = new Set(platformFiles.map(pf2 => pf2.file.toLowerCase().replace(/[^a-z0-9]/g, '-')));
          if (allFilenames.size === 1) {
            // All platforms have the same filename → B4X
            platform = 'B4X';
          } else {
            // Multiple platforms with different filenames → each gets its specific platform
            platform = pf.platform;
          }
        }

        // Build title from column A (library name) + column B (short description)
        const title = entry.shortDescription ? `${entry.libraryName} - ${entry.shortDescription}` : entry.libraryName;

        // The key matches GitHub's normalized format
        // Note: Google Sheet entries don't have snippets - only GitHub entries have snippets
        merged.set(fileKeyNormalized, {
          key: fileKeyNormalized,
          snippet: '',  // No snippet for Google Sheet entries
          library_file: '',  // Sheet doesn't provide file URLs, only filenames
          forum_thread: entry.forumLink || '',  // Column K has forum link
          library_type: '',  // Sheet doesn't specify native vs b4xlib
          name: file,  // Use original filename as name (preserves casing)
          title,
          readme_url: '',  // Sheet doesn't provide readme URLs
          platform,
          author: entry.author || '',
          tags: [],
          version: entry.version || '',
          versionStatus: entry.version ? 'loaded' : 'error' as const,
          source: 'google',  // Mark as from Google Sheet
        });
      }
    }

    return Array.from(merged.values());
  }
}

export function parsePlatform(libraryFile: string): B4xPlatform {
  const match = libraryFile.match(/\/(B4X|B4A|B4J|B4i|B4R)\//);
  if (match) {
    return match[1] as B4xPlatform;
  }
  return 'B4X';
}

export function extractTags(title: string): string[] {
  const tags: string[] = [];
  const re = /\[([A-Za-z0-9]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const tag = m[1];
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

export function extractAuthor(snippet: string): string {
  // Try patterns like "Title by AuthorName" or just "by AuthorName" in the first line
  const firstLine = snippet.split('\n')[0] ?? '';
  // Pattern: "by AuthorName" — capture the name after "by " until a newline, "###", or end
  const byMatch = firstLine.match(/\bby\s+([A-Za-z][A-Za-z\s]{0,40}?)(?:\s*$|\s*###|\s*\[)/);
  if (byMatch && byMatch[1]) {
    return byMatch[1].trim();
  }
  // Broader pattern in first 200 chars
  const head = snippet.substring(0, 200);
  const broadMatch = head.match(/\bby\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\n|###|\[)/);
  if (broadMatch && broadMatch[1]) {
    return broadMatch[1].trim();
  }
  return '';
}

// ──────────────────────────────────────────────────────────────────────────────
// Version Extraction Functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract version from an XML library file by reading the last `<version>...</version>` tag.
 * @param xmlContent The XML content as a string
 * @returns The version string, or empty string if not found
 */
export function extractXmlVersionFromContent(xmlContent: string): string {
  try {
    // Remove XML comments first to avoid false matches
    const contentWithoutComments = xmlContent.replace(/<!--[\s\S]*?-->/g, '');
    // Match <version>...</version> (case-insensitive)
    const match = contentWithoutComments.match(/<version>([^<]+)<\/version>/i);
    return match ? match[1]!.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Fallback: read manifest.txt directly from a ZIP file by parsing the central directory.
 * Used when StreamZip rejects the file (e.g., entries with backslash paths flagged as zip-slip).
 */
function extractManifestFromZipFallback(archivePath: string): string | null {
  try {
    const buf = fs.readFileSync(archivePath);

    // Find End of Central Directory record
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return null;

    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const cdEntries = buf.readUInt16LE(eocdOffset + 10);

    let offset = cdOffset;
    for (let i = 0; i < cdEntries; i++) {
      if (buf.readUInt32LE(offset) !== 0x02014b50) break;
      const comprMethod = buf.readUInt16LE(offset + 10);
      const compSize = buf.readUInt32LE(offset + 20);
      const uncompSize = buf.readUInt32LE(offset + 24);
      const nameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      const localHeaderOffset = buf.readUInt32LE(offset + 42);
      const entryName = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

      if (entryName.toLowerCase() === 'manifest.txt') {
        const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataOffset = localHeaderOffset + 30 + lhNameLen + lhExtraLen;

        if (comprMethod === 0) {
          return buf.toString('utf8', dataOffset, dataOffset + uncompSize).replace(/^﻿/, '');
        } else if (comprMethod === 8) {
          const compressed = buf.subarray(dataOffset, dataOffset + compSize);
          return zlib.inflateRawSync(compressed).toString('utf8').replace(/^﻿/, '');
        }
        return null;
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract version from a .b4xlib (ZIP) by reading the `Version=` line in manifest.txt.
 * @param archivePath Absolute path to the .b4xlib file
 * @returns The version string, or empty string if not found
 */
export async function extractB4xlibVersion(archivePath: string): Promise<string> {
  try {
    const zip = new StreamZip({ file: archivePath, storeEntries: true });
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on('ready', () => resolve());
        zip.on('error', (err: Error) => reject(err));
      });
      const manifestEntry = Object.entries(zip.entries()).find(([name]) => name.toLowerCase() === 'manifest.txt');
      if (!manifestEntry) {
        return '';
      }
      const data = zip.entryDataSync(manifestEntry[0]);
      const text = data.toString('utf8').replace(/^﻿/, '');
      const match = text.match(/^Version\s*=\s*(.+)$/im);
      return match ? match[1]!.trim() : '';
    } finally {
      await new Promise<void>((r) => zip.close(r));
    }
  } catch {
    // StreamZip may reject files with backslash paths (zip-slip detection).
    // Fall back to direct ZIP parsing.
    const manifest = extractManifestFromZipFallback(archivePath);
    if (manifest) {
      const match = manifest.match(/^Version\s*=\s*(.+)$/im);
      return match ? match[1]!.trim() : '';
    }
    return '';
  }
}

/**
 * Fetch remote XML content and extract version.
 * @param url URL to the XML library file
 * @returns The version string, or empty string on error
 */
export async function fetchRemoteXmlVersion(url: string): Promise<string> {
  return new Promise<string>(resolve => {
    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'B4X-IntelliSense/1.0',
      },
      timeout: 5000, // 5 second timeout
    };

    const req = https.request(options, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve('');
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const content = Buffer.concat(chunks).toString('utf-8');
          resolve(extractXmlVersionFromContent(content));
        } catch {
          resolve('');
        }
      });
    });

    req.on('error', () => resolve(''));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve('');
    });
    req.end();
  });
}

/**
 * Fetch remote b4xlib content and extract version from manifest.txt.
 * @param url URL to the .b4xlib file
 * @returns The version string, or empty string on error
 */
export async function fetchRemoteB4xlibVersion(url: string): Promise<string> {
  return new Promise<string>(resolve => {
    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'B4X-IntelliSense/1.0',
      },
      timeout: 5000, // 5 second timeout
    };

    const req = https.request(options, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve('');
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          // Create a temporary in-memory zip for extraction
          // We'll write to a temp file then extract
          const tmpDir = require('os').tmpdir();
          const tmpPath = path.join(tmpDir, `b4xlib_${Date.now()}_${Math.random().toString(16).slice(2)}.zip`);

          await fs.promises.writeFile(tmpPath, buffer);
          try {
            const version = await extractB4xlibVersion(tmpPath);
            resolve(version);
          } finally {
            await fs.promises.unlink(tmpPath).catch(() => {});
          }
        } catch {
          resolve('');
        }
      });
    });

    req.on('error', () => resolve(''));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve('');
    });
    req.end();
  });
}
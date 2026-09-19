/**
 * Core logic for project statistics collection.
 *
 * Pure functions with no VS Code dependencies.
 * Successor to jMashProjectProfile's project analysis reports.
 */

/** Statistics for a single module (file). */
export interface ModuleStatistics {
  readonly fileName: string;
  readonly totalLines: number;
  readonly codeLines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly subCount: number;
  readonly eventHandlerCount: number;
  readonly typeCount: number;
}

/** Aggregate statistics for an entire project. */
export interface ProjectStatistics {
  readonly totalLines: number;
  readonly codeLines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly moduleCount: number;
  readonly subCount: number;
  readonly eventHandlerCount: number;
  readonly typeCount: number;
  readonly modules: readonly ModuleStatistics[];
}

/** Count Sub declarations in file content. */
function countSubs(content: string): { subCount: number; eventHandlerCount: number } {
  const lines = content.split('\n');
  let subCount = 0;
  let eventHandlerCount = 0;
  const subPattern = /^\s*(?:Public\s+|Private\s+)?Sub\s+([A-Za-z_][A-Za-z0-9_]*)/i;

  for (const line of lines) {
    const match = subPattern.exec(line);
    if (match) {
      subCount++;
      const name = match[1]!;
      // Event handlers follow the pattern ObjectName_EventName
      // (underscore in name, not starting with underscore)
      if (name.includes('_') && !name.startsWith('_')) {
        eventHandlerCount++;
      }
    }
  }

  return { subCount, eventHandlerCount };
}

/** Count Type declarations in file content. */
function countTypes(content: string): number {
  const lines = content.split('\n');
  let typeCount = 0;
  const typePattern = /^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)/i;

  for (const line of lines) {
    if (typePattern.test(line)) {
      typeCount++;
    }
  }

  return typeCount;
}

/** Analyze a single module file and return its statistics. */
function analyzeModule(fileName: string, content: string): ModuleStatistics {
  const lines = content.split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      blankLines++;
    } else if (trimmed.startsWith("'")) {
      commentLines++;
    } else {
      // Lines with code (may also have inline comments, counted as code)
      codeLines++;
    }
  }

  const { subCount, eventHandlerCount } = countSubs(content);
  const typeCount = countTypes(content);

  return {
    fileName,
    totalLines: lines.length,
    codeLines,
    commentLines,
    blankLines,
    subCount,
    eventHandlerCount,
    typeCount,
  };
}

/**
 * Collect project statistics from a set of file contents.
 *
 * @param files — Map of file name to file content (typically .bas, .b4a, .b4i, .b4j, .b4r files)
 * @returns Aggregate ProjectStatistics with per-module breakdown
 */
export function collectStatistics(files: Map<string, string>): ProjectStatistics {
  const modules: ModuleStatistics[] = [];

  for (const [fileName, content] of files) {
    modules.push(analyzeModule(fileName, content));
  }

  // Sort modules alphabetically by file name
  modules.sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    totalLines: modules.reduce((sum, m) => sum + m.totalLines, 0),
    codeLines: modules.reduce((sum, m) => sum + m.codeLines, 0),
    commentLines: modules.reduce((sum, m) => sum + m.commentLines, 0),
    blankLines: modules.reduce((sum, m) => sum + m.blankLines, 0),
    moduleCount: modules.length,
    subCount: modules.reduce((sum, m) => sum + m.subCount, 0),
    eventHandlerCount: modules.reduce((sum, m) => sum + m.eventHandlerCount, 0),
    typeCount: modules.reduce((sum, m) => sum + m.typeCount, 0),
    modules,
  };
}
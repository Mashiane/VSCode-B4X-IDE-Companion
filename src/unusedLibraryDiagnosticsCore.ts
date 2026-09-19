/**
 * Core logic for unused library detection.
 *
 * Cross-references declared libraries against actually-used types/methods.
 * Successor to jMashProjectProfile's "Find unused libraries" wishlist item.
 */

/** Information about an unused library. */
export interface UnusedLibraryResult {
  readonly libraryName: string;
  readonly exportedTypes: readonly string[];
  readonly reason: string;
}

/** Result of library usage analysis. */
export interface LibraryUsageAnalysis {
  readonly unused: readonly UnusedLibraryResult[];
  readonly used: readonly string[];
}

/**
 * Analyze which declared libraries are unused.
 *
 * A library is considered unused if none of its exported types
 * are referenced anywhere in the workspace code. Types are compared
 * case-insensitively since B4X is case-insensitive.
 *
 * A library with no exported types is also considered unused, since
 * it provides no symbols that could be referenced.
 *
 * @param declaredLibraries — Map of library name to exported type names
 *   (from xmlLibraryIndex or project file parsing)
 * @param usedTypes — Set of type names that are actually used in workspace code
 *   (lowercased, from workspaceClassIndex type inference)
 * @returns Analysis result with unused libraries and used libraries
 */
export function analyzeLibraryUsage(
  declaredLibraries: Map<string, string[]>,
  usedTypes: Set<string>,
): LibraryUsageAnalysis {
  const unused: UnusedLibraryResult[] = [];
  const used: string[] = [];

  for (const [libraryName, exportedTypes] of declaredLibraries) {
    // A library with no exported types is unused
    if (exportedTypes.length === 0) {
      unused.push({
        libraryName,
        exportedTypes,
        reason: `Library '${libraryName}' has no exported types and appears unused.`,
      });
      continue;
    }

    // Check if any exported type from this library is used (case-insensitive)
    const isUsed = exportedTypes.some(typeName =>
      usedTypes.has(typeName.toLowerCase()),
    );

    if (isUsed) {
      used.push(libraryName);
    } else {
      unused.push({
        libraryName,
        exportedTypes,
        reason: `No types from '${libraryName}' (${exportedTypes.join(', ')}) are used in the project.`,
      });
    }
  }

  return { unused, used };
}
Indexing and Data Model — Draft
================================

Goal
----
Design an incremental, workspace-scalable indexing model for B4X source and library artifacts that will power an LSP server.

Key requirements
----------------
- Fast incremental updates on file change (didOpen/didChange/didSave)
- Cross-file symbol queries: definitions, references, workspace symbols
- Member/field/method indexing for completion and signature help
- Support multiple sources: workspace modules, XML library descriptors, generated API index
- Memory-efficient and cacheable on-disk
- Support worker threads for heavy parsing/type-inference

High-level components
---------------------
- Document Manager: holds open documents and recent snapshots (from LSP didOpen/didChange)
- File System Indexer: watches workspace files and builds/maintains file-level symbol index
- Global Symbol Table: merged view of symbols across sources with provenance metadata
- Source Parsers: fast partial parser for incremental parse, and full parser for background analysis
- Type Inference Engine: incremental type resolution with work-queue and cancellation
- Query API: synchronous read-only queries for completions, definitions, references, and hovers
- Worker Pool: pool of worker threads/processes to parse files and compute heavy analyses

Data model (simplified)
------------------------
- SymbolId: string (stable across reloads when file path + node position stable)
- FileSymbol: { id, name, kind, range, containerName?, flags, filePath }
- ClassInfo: { id, name, methods: FileSymbol[], properties: FileSymbol[], source: 'workspace'|'xml'|'api', filePath? }
- IndexState: maps: filePath -> [FileSymbol], className -> [ClassInfo], simple caches for prefix queries

Incremental workflow
--------------------
1. On file change, push small change event to Document Manager
2. Run quick partial parser to update FileSymbol entries for the changed file (fast path)
3. Update Global Symbol Table (delta apply)
4. Queue background full-parse/type-inference task in Worker Pool if needed
5. Publish diagnostics when available

Persistence & caching
---------------------
- Serialize compact symbol index to workspace `.vscode/.b4x-index` for faster cold starts
- Use file mtime/hash to validate caches

APIs to implement first
-----------------------
- getSymbolsByPrefix(prefix, limit)
- getClassByName(name)
- getMembersForClass(name)
- findDefinition(symbolId or file+pos)
- findReferences(symbolId)

Next steps
----------
1. Implement Document Manager with unit tests
2. Implement FileSymbol quick-parser for `.bas` files
3. Implement Global Symbol Table and prefix search
4. Wire these into the LSP server scaffold to respond to completion/definition requests
5. Add worker pool and persistence

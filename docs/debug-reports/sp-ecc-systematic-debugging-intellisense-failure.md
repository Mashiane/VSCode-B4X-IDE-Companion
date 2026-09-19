# Diagnostic Plan: IntelliSense Failure Investigation
**Agent/Skill:** `sp-ecc:systematic-debugging`
**Date:** 2026-05-29
**Status:** Proposed

## 1. Problem Statement
A user reports that IntelliSense is not working. The cause is unknown, and the environment is not currently accessible for live debugging.

## 2. Failure Path Analysis (Hypotheses)
Based on the architecture, the failure could occur at any of the following points:

### Path 1: Activation & Lifecycle Failures
- **Activation Event Mismatch:** Extension not activating because file associations are incorrect.
- **Activation Crash:** Critical error during `activate()` in `src/extension.ts`.
- **Dependency Failures:** Native modules (e.g., `better-sqlite3`) failing to load.

### Path 2: LSP Server Health ("The Brain")
- **Server Crash:** `server/server.js` crashing on startup or during execution.
- **Stalled Indexing:** `workerPool.js` hanging or crashing due to large files/regex issues.
- **Memory Exhaustion:** Node.js process hitting limits with large projects.

### Path 3: Project & Environment Configuration
- **Platform Path Misconfiguration:** `b4x.platformPath` not resolved, preventing library XML loading.
- **Missing Project File:** Opening `.bas` files without a `.b4a/.b4i/.b4j/.b4r` project file in the workspace.
- **Invalid Project Structure:** Project file version mismatch or corruption.

### Path 4: Indexing & Symbol Resolution
- **Symbol Extraction Failure:** `fileSymbolParser.js` failing on specific syntax.
- **Global Symbol Table Corruption:** Race conditions during symbol updates.
- **Cache Invalidation:** Stale index leading to missing symbols.

### Path 5: Client-Server Communication
- **LSP Transport Error:** Stdio communication breakdown.
- **Provider Registration Gap:** Server sends data, but client provider is not registered.
- **Request Timeout:** Completion requests timing out.

---

## 3. Proposed Diagnostic Instrumentation
To identify the root cause, the following logging will be added (active only when `b4xIntellisense.debug` is enabled).

### A. Lifecycle Evidence (`src/extension.ts`)
- Log `enter/exit` for `activate()`.
- Log confirmation of each provider registration.

### B. Configuration Evidence (`src/platformConfig.ts`, `src/projectFile.ts`)
- Log the final resolved `platformPath` and its discovery method.
- Log project file parsing results (number of libraries/modules).

### C. Server/Indexer Evidence (`server/server.js`, `server/indexer/workerPool.js`, `server/indexer/fileSymbolParser.js`)
- Log server startup and LSP connection establishment.
- Log worker task queueing, start, and completion.
- Log symbol counts per file parsed.

### D. Communication Evidence (LSP Client)
- Log `textDocument/completion` requests and their corresponding responses.

---

## 4. Proposed "Health Check" Command
A new command `b4x.checkHealth` will be implemented to provide a rapid snapshot of the system state:

| Check | Success Indicator | Failure Implication |
| :--- | :--- | :--- |
| **Extension** | `Activated` | Activation failure (Path 1) |
| **LSP Server** | `Connected` | Server crash/transport error (Path 2/5) |
| **Platform Path** | `Found: [Path]` | Config issue (Path 3) |
| **Project File** | `Detected: [File]` | Context issue (Path 3) |
| **Indexer** | `Idle / [N] pending` | Indexing stall (Path 2/4) |

## 5. Next Steps
1. Implement diagnostic logs.
2. Implement `b4x.checkHealth` command.
3. Request user to run health check and provide logs.

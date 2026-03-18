LSP Server scaffold
===================

This folder contains a minimal Language Server Protocol (LSP) server scaffold.

Getting started
---------------

1. Install the runtime dependencies:

```bash
npm install --no-audit --no-fund vscode-languageserver vscode-languageclient
```

2. Start the server (stdio):

```bash
node server/server.js
```

Notes
-----
- The server is intentionally minimal and intended as a starting point. Integrate your indexing, parsing, and analysis logic into `server.js` and wire the extension client to start it.
- For TypeScript-based server, consider moving the server code to `src/server` and compiling to `dist/server`.

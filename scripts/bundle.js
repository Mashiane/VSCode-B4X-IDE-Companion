const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function bundle() {
  console.log('Bundling extension...');
  
  const entryPoints = [
    { in: 'src/extension.ts', out: 'dist/extension.js' },
  ];

  try {
    await esbuild.build({
      entryPoints: entryPoints.map(p => p.in),
      bundle: true,
      minify: true,
      sourcemap: true,
      platform: 'node',
      target: 'node16',
      outfile: 'dist/extension.js',
      external: [
        'vscode',
        'vscode-languageserver',
        'vscode-languageserver-textdocument',
        'better-sqlite3'
      ],
    });
    try {
      const wasmSrc = require.resolve('sql.js/dist/sql-wasm.wasm');
      const wasmDest = path.join(__dirname, '..', 'dist', 'sql-wasm.wasm');
      fs.copyFileSync(wasmSrc, wasmDest);
    } catch (copyErr) {
      console.warn('Could not copy sql-wasm.wasm:', copyErr.message || copyErr);
    }

    // ── Bundle the LSP server and its worker into dist/ ──
    // The .vsix ignores node_modules, so the server must be self-contained.
    // workerTask.js is emitted to dist/ because workerPool uses
    // `new Worker(path.join(__dirname, 'workerTask.js'))` and __dirname resolves
    // to dist/ once the server is bundled there.
    console.log('Bundling LSP server...');
    await esbuild.build({
      entryPoints: ['server/server.js'],
      bundle: true,
      minify: true,
      platform: 'node',
      target: 'node16',
      format: 'cjs',
      outfile: 'dist/server.js',
      // No externals: vscode-languageserver / textdocument must be inlined
      // since they live in node_modules and won't ship in the .vsix.
      external: [],
    });
    console.log('Bundling LSP worker...');
    await esbuild.build({
      entryPoints: ['server/indexer/workerTask.js'],
      bundle: true,
      minify: true,
      platform: 'node',
      target: 'node16',
      format: 'cjs',
      outfile: 'dist/workerTask.js',
      external: [],
    });
    console.log('Bundling complete.');
  } catch (e) {
    console.error('Bundling failed:', e);
    process.exit(1);
  }
}

bundle();

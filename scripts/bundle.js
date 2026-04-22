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
    console.log('Bundling complete.');
  } catch (e) {
    console.error('Bundling failed:', e);
    process.exit(1);
  }
}

bundle();

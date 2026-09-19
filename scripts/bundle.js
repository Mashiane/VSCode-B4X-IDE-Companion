const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const PKG_PATH = path.join(__dirname, '..', 'package.json');
const BUNDLED_MAIN = './dist/extension.js';
const DEV_MAIN = './dist/src/extension.js';

async function bundleExtension() {
  console.log('Bundling extension...');
  await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: 'node',
    target: 'node16',
    outfile: 'dist/extension.js',
    external: [
      'vscode',
    ],
  });
  console.log('Extension bundle complete.');
}

async function bundleServer() {
  console.log('Bundling LSP server...');
  await esbuild.build({
    entryPoints: ['server/server.js'],
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: 'node',
    target: 'node16',
    outfile: 'dist/server.js',
    // No externals — bundle all LSP deps inline so no node_modules needed
    external: [],
  });
  console.log('Server bundle complete.');
}

async function bundleWorker() {
  console.log('Bundling worker task...');
  await esbuild.build({
    entryPoints: ['server/indexer/workerTask.js'],
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: 'node',
    target: 'node16',
    outfile: 'dist/workerTask.js',
    // No externals — pure Node.js code, bundle everything
    external: [],
  });
  console.log('Worker bundle complete.');
}

async function bundle() {
  console.log('Bundling extension, server, and worker...');
  try {
    await bundleExtension();
    await bundleServer();
    await bundleWorker();

    // Copy sql-wasm.wasm to dist for sql.js fallback
    const wasmSrc = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const wasmDest = path.join(__dirname, '..', 'dist', 'sql-wasm.wasm');
    if (fs.existsSync(wasmSrc)) {
      fs.copyFileSync(wasmSrc, wasmDest);
      console.log('Copied sql-wasm.wasm to dist/');
    } else {
      console.warn('Warning: sql-wasm.wasm not found in node_modules, fallback may fail.');
    }

    // Switch package.json main to the bundled entry for packaging
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    if (pkg.main !== BUNDLED_MAIN) {
      pkg.main = BUNDLED_MAIN;
      fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Updated package.json main to ${BUNDLED_MAIN}`);
    }

    console.log('All bundles complete.');
  } catch (e) {
    console.error('Bundling failed:', e);
    process.exit(1);
  }
}

/**
 * Restore package.json main to the tsc output path for development.
 * Called by the compile script so F5 debugging always loads fresh tsc output.
 */
function restoreDevMain() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    if (pkg.main !== DEV_MAIN) {
      pkg.main = DEV_MAIN;
      fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Restored package.json main to ${DEV_MAIN}`);
    }
  } catch (e) {
    console.error('Failed to restore dev main:', e);
  }
}

module.exports = { bundle, restoreDevMain };

// Run bundle when executed directly
if (require.main === module) {
  bundle();
}
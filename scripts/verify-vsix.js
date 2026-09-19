/**
 * Comprehensive post-package VSIX validation.
 *
 * Extracts the VSIX and verifies everything needed for the extension to work
 * when a user installs it. Catches missing files, stray dev artifacts, and
 * broken module resolution before publishing.
 *
 * Usage: node scripts/verify-vsix.js [path/to/extension.vsix]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

// ── Required bundles (esbuild output) ──────────────────────────────────────
const REQUIRED_BUNDLES = {
  'dist/extension.js':   { minKB: 50,   label: 'Extension host entry point' },
  'dist/server.js':      { minKB: 100,  label: 'LSP server (must include LSP protocol code)' },
  'dist/workerTask.js':  { minKB: 0.5,  label: 'Parser worker thread' },
};

// ── Assets declared in package.json contributes ─────────────────────────────
// These are parsed dynamically from the extracted package.json, but we also
// define known paths that MUST exist if the extension is to function.

// ── Runtime assets referenced by extension code but not in contributes ──────
const RUNTIME_ASSETS = [
  'dist/sql-wasm.wasm',                     // sql.js WASM fallback
  'libraries_mapping.json',                  // library name resolution
  'language-configuration.json',             // language config (declared in contributes)
  'syntaxes/b4x.tmLanguage.json',             // grammar (declared in contributes)
  'snippets/b4x.json',                        // snippets (declared in contributes)
  'images/b4xlogo.png',                       // icon (declared in package.json)
  'docs/manual.md',                           // user manual (openDocs command)
];

// ── Marketplace listing assets (shown on the Marketplace page) ─────────────
const MARKETPLACE_ASSETS = [
  'CHANGELOG.md',                           // changelog tab (Content.Changelog asset)
];

// ── PowerShell scripts referenced by extension commands ─────────────────────
const POWERSHELL_SCRIPTS = [
  'src/install.ps1',
  'src/startemulator.ps1',
  'src/backup.ps1',
  'src/gif.ps1',
  'src/screenshot.ps1',
];

// ── Webview media assets ───────────────────────────────────────────────────
const WEBVIEW_ASSETS = [
  'media/daisyui.min.css',
  'media/tailwind.min.js',
  'media/remixicon.css',
  'media/remixicon.woff',
  'media/remixicon.woff2',
  'media/remixicon.ttf',
  'media/chart.umd.js',
  'media/apple-icon.svg',
  'media/b4i-icon.svg',
  'media/bridge.apk',
];

// ── Directories that must NOT exist in the VSIX ────────────────────────────
const FORBIDDEN_DIRS = [
  'node_modules',        // everything bundled by esbuild
  'server',             // replaced by dist/server.js + dist/workerTask.js
  'src',                // TypeScript source (only .ps1 scripts should ship)
  '.github',            // CI config
  '.vscode',            // editor config
  'scripts',            // build tooling
  'data',               // dev data
  'docs',               // documentation
  'Understanding',      // library reference
  'tests',              // test files
  '.worktrees',          // git worktrees
  '_backups',            // local backup folder
];

// ── File patterns that must NOT exist ───────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  /\.(ts|tsx)$/,                  // TypeScript source files
  /tsconfig\.json$/,             // TypeScript config
  /tsconfig\.tsbuildinfo$/,      // TypeScript build info
  /\.gitignore$/,                // Git ignore
  /\.vscodeignore$/,             // VS Code ignore
];

// ── Specific files that must NOT exist ──────────────────────────────────────
const FORBIDDEN_FILES = [
  'ARCHITECTURE.md',
  'MARKETPLACE_RELEASE_NOTES.md',
  'RELEASE_NOTES.md',
  'deep-analysis.js',
  'backup-manifest.json',
  '.b4x-index.json',
  'mempalace.yaml',
  'entities.json',
  'images/48x48.png',
  'images/icon.png',
  'images/icon.svg',
];

// ── B4X project/sample directories that must NOT ship ────────────────────────
const FORBIDDEN_B4X_DIRS = [
  'jMashProjectProfile.b4j',   // sample B4J project — not a runtime dependency
];

// ── Helpers ────────────────────────────────────────────────────────────────

function findVsix() {
  const dir = path.resolve(__dirname, '..');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.vsix'));
  if (files.length === 0) {
    console.error('No .vsix file found in project root.');
    process.exit(1);
  }
  if (files.length > 1) {
    console.warn(`Multiple .vsix files found, using: ${files[files.length - 1]}`);
  }
  return path.join(dir, files[files.length - 1]);
}

function collectFiles(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

function verifyVsix(vsixPath) {
  const tmpDir = path.join(os.tmpdir(), `b4x-verify-${Date.now()}`);
  let hasErrors = false;
  let hasWarnings = false;

  function fail(msg) {
    console.error(`FAIL: ${msg}`);
    hasErrors = true;
  }
  function warn(msg) {
    console.warn(`WARN: ${msg}`);
    hasWarnings = true;
  }
  function ok(msg) {
    console.log(`  OK: ${msg}`);
  }

  console.log(`\nVerifying VSIX: ${vsixPath}`);
  console.log(`Extracting to: ${tmpDir}`);

  try {
    // ── Extract ──────────────────────────────────────────────────────────
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(vsixPath);
    zip.extractAllTo(tmpDir, true);

    const extDir = path.join(tmpDir, 'extension');
    if (!fs.existsSync(extDir)) {
      fail('Extracted VSIX has no extension/ directory.');
      process.exit(1);
    }

    const allFiles = collectFiles(extDir, '');
    const allFileSet = new Set(allFiles.map(f => f.replace(/\\/g, '/')));

    // ══ CHECK 1: Package manifest integrity ═══════════════════════════════
    console.log('\n── 1. Package manifest integrity ──');

    const pkgPath = path.join(extDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      fail('package.json missing from VSIX.');
    } else {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      // main entry point
      const mainFile = (pkg.main || '').replace(/^\.\//, '');
      if (!mainFile) {
        fail('package.json has no "main" field.');
      } else if (!allFileSet.has(mainFile)) {
        fail(`package.json main "${pkg.main}" not found in VSIX.`);
      } else {
        ok(`main → ${pkg.main}`);
      }

      // icon
      if (pkg.icon && !allFileSet.has(pkg.icon)) {
        fail(`package.json icon "${pkg.icon}" not found in VSIX.`);
      } else if (pkg.icon) {
        ok(`icon → ${pkg.icon}`);
      }

      // contributes.grammars
      for (const g of (pkg.contributes?.grammars || [])) {
        const gPath = (g.path || '').replace(/^\.\//, '');
        if (gPath && !allFileSet.has(gPath)) {
          fail(`Grammar path "${g.path}" not found in VSIX.`);
        } else if (gPath) {
          ok(`grammar → ${g.path}`);
        }
      }

      // contributes.snippets
      for (const s of (pkg.contributes?.snippets || [])) {
        const sPath = (s.path || '').replace(/^\.\//, '');
        if (sPath && !allFileSet.has(sPath)) {
          fail(`Snippet path "${s.path}" not found in VSIX.`);
        } else if (sPath) {
          ok(`snippet → ${s.path}`);
        }
      }

      // contributes.languages
      for (const l of (pkg.contributes?.languages || [])) {
        const cfg = (l.configuration || '').replace(/^\.\//, '');
        if (cfg && !allFileSet.has(cfg)) {
          fail(`Language config "${l.configuration}" not found in VSIX.`);
        } else if (cfg) {
          ok(`language config → ${l.configuration}`);
        }
        const icon = (l.icon || '').replace(/^\.\//, '');
        if (icon && !allFileSet.has(icon)) {
          fail(`Language icon "${l.icon}" not found in VSIX.`);
        }
      }
    }

    // ══ CHECK 2: Required bundles ═════════════════════════════════════════
    console.log('\n── 2. Required bundles ──');

    for (const [file, spec] of Object.entries(REQUIRED_BUNDLES)) {
      const fullPath = path.join(extDir, file);
      if (!fs.existsSync(fullPath)) {
        fail(`Missing required bundle: ${file} (${spec.label})`);
      } else {
        const sizeKB = fs.statSync(fullPath).size / 1024;
        if (sizeKB < spec.minKB) {
          fail(`${file} is only ${sizeKB.toFixed(1)} KB — expected >=${spec.minKB} KB (${spec.label})`);
        } else {
          ok(`${file} (${sizeKB.toFixed(1)} KB) — ${spec.label}`);
        }
      }
    }

    // ══ CHECK 3: Runtime assets ═══════════════════════════════════════════
    console.log('\n── 3. Runtime assets ──');

    for (const asset of RUNTIME_ASSETS) {
      if (!allFileSet.has(asset)) {
        fail(`Missing runtime asset: ${asset}`);
      } else {
        ok(`${asset}`);
      }
    }

    // ══ CHECK 4: Marketplace listing assets ═══════════════════════════════
    console.log('\n── 4. Marketplace listing assets ──');

    // vsce lowercases README.md → readme.md and CHANGELOG.md → changelog.md on
    // the way into the package, so compare case-insensitively or this reports a
    // false miss even though the file shipped.
    const allFileSetLower = new Set([...allFileSet].map(f => f.toLowerCase()));

    for (const asset of MARKETPLACE_ASSETS) {
      if (!allFileSetLower.has(asset.toLowerCase())) {
        warn(`Missing Marketplace listing asset: ${asset} (changelog tab will be empty)`);
      } else {
        ok(`${asset}`);
      }
    }

    // ══ CHECK 5: PowerShell scripts ════════════════════════════════════════
    console.log('\n── 5. PowerShell scripts ──');

    for (const ps1 of POWERSHELL_SCRIPTS) {
      if (!allFileSet.has(ps1)) {
        fail(`Missing PowerShell script: ${ps1}`);
      } else {
        ok(`${ps1}`);
      }
    }

    // ══ CHECK 5: Webview media assets ═════════════════════════════════════
    console.log('\n── 5. Webview media assets ──');

    for (const asset of WEBVIEW_ASSETS) {
      if (!allFileSet.has(asset)) {
        warn(`Missing webview asset: ${asset} (webview may render without it)`);
      } else {
        ok(`${asset}`);
      }
    }

    // ══ CHECK 6: No forbidden directories ══════════════════════════════════
    console.log('\n── 6. No forbidden directories ──');

    for (const dir of FORBIDDEN_DIRS) {
      const dirPath = path.join(extDir, dir);
      if (fs.existsSync(dirPath)) {
        // Special case: src/ is allowed to contain ONLY .ps1 files
        if (dir === 'src') {
          const entries = fs.readdirSync(dirPath);
          const nonPs1 = entries.filter(e => !e.endsWith('.ps1'));
          if (nonPs1.length > 0) {
            fail(`src/ directory contains non-.ps1 files: ${nonPs1.join(', ')}`);
          } else if (entries.length > 0) {
            ok(`src/ contains only .ps1 scripts (${entries.length} files)`);
          }
        } else if (dir === 'docs') {
          const entries = fs.readdirSync(dirPath);
          const allowedDocs = ['manual.md'];
          const forbidden = entries.filter(e => !allowedDocs.includes(e));
          if (forbidden.length > 0) {
            fail(`docs/ contains non-allowed files: ${forbidden.join(', ')} (only manual.md should ship)`);
          } else if (entries.length > 0) {
            ok(`docs/ contains only allowed files (${entries.join(', ')})`);
          }
        } else if (dir === 'node_modules') {
          const entries = fs.readdirSync(dirPath);
          if (entries.length > 0) {
            fail(`node_modules/ contains ${entries.length} packages — should be empty (bundled by esbuild): ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ' ...' : ''}`);
          } else {
            ok(`node_modules/ is empty`);
          }
        } else {
          fail(`Forbidden directory present: ${dir}/`);
        }
      } else {
        ok(`${dir}/ not present`);
      }
    }

    // ══ CHECK 7: No forbidden file patterns ════════════════════════════════
    console.log('\n── 7. No forbidden file patterns ──');

    const forbiddenFiles = allFiles.filter(f =>
      FORBIDDEN_PATTERNS.some(p => p.test(f.replace(/\\/g, '/')))
    );
    if (forbiddenFiles.length > 0) {
      fail(`Forbidden files found: ${forbiddenFiles.slice(0, 10).join(', ')}`);
    } else {
      ok('No .ts, tsconfig.json, .gitignore, or .vscodeignore files found');
    }

    // ══ CHECK 7b: No forbidden specific files ════════════════════════════════
    console.log('\n── 7b. No forbidden specific files ──');

    for (const file of FORBIDDEN_FILES) {
      if (allFileSet.has(file)) {
        fail(`Forbidden file present: ${file}`);
      } else {
        ok(`${file} not present`);
      }
    }

    // ══ CHECK 7c: No B4X project/sample directories ══════════════════════════
    console.log('\n── 7c. No B4X project/sample directories ──');

    for (const dir of FORBIDDEN_B4X_DIRS) {
      const dirPath = path.join(extDir, dir);
      if (fs.existsSync(dirPath)) {
        fail(`B4X project directory must not ship: ${dir}/ (exclude in .vscodeignore)`);
      } else {
        ok(`${dir}/ not present`);
      }
    }

    // Also catch any .b4j/.b4a/.b4i/.b4r directories or files at the VSIX root
    const b4xProjectInVsix = allFiles.filter(f =>
      /^(jMashProjectProfile\.b4j|[^/]+\.(b4j|b4a|b4i|b4r))/i.test(f.replace(/\\/g, '/'))
    );
    if (b4xProjectInVsix.length > 0) {
      fail(`B4X project files in VSIX root: ${b4xProjectInVsix.join(', ')}`);
    } else {
      ok('No B4X project files in VSIX root');
    }

    // ══ CHECK 8: Server runtime test ═══════════════════════════════════════
    console.log('\n── 8. Server runtime test ──');

    const serverBundle = path.join(extDir, 'dist', 'server.js');
    if (fs.existsSync(serverBundle)) {
      // Spawn the server and verify it starts without crashing.
      // A healthy LSP server writes nothing to stdout on startup and
      // waits for a JSON-RPC initialize request on stdin.
      // We give it 3 seconds — if it hasn't crashed by then, it's working.
      const server = spawn(process.execPath, [serverBundle], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: extDir,
        timeout: 5000,
      });

      let stderr = '';
      let serverPassed = false;
      let serverFailed = false;

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      server.on('exit', (code) => {
        // code === null means killed by signal (our timeout kill) — that's success
        // code === 0 would be unusual (clean exit) but not a crash
        // Any non-zero code is a real crash
        if (code !== null && code !== 0) {
          serverFailed = true;
          fail(`Server process exited with code ${code}. stderr: ${stderr.slice(0, 500)}`);
        }
      });

      // Wait up to 3 seconds — if the server hasn't crashed by then, it's listening
      // for LSP messages on stdin, which is the correct behavior.
      setTimeout(() => {
        if (!serverFailed) {
          serverPassed = true;
          ok('Server process started and is listening (no crash after 3s)');
          server.kill();
        }
      }, 3000);
    } else {
      fail('Cannot run server test — dist/server.js not found');
    }

    // ── Final verdict (printed after server test completes) ────────────────
    setTimeout(() => {
      console.log('');
      if (hasErrors) {
        console.error('❌ VSIX validation FAILED — do not publish this package.');
        process.exit(1);
      } else if (hasWarnings) {
        console.warn('⚠️  VSIX validation PASSED with warnings — review before publishing.');
      } else {
        console.log('✅ VSIX validation PASSED — extension is ready for deployment.');
      }
    }, 4000);

  } finally {
    // Clean up after all checks complete
    setTimeout(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore cleanup failures */ }
    }, 5000);
  }
}

const vsixPath = process.argv[2] || findVsix();
verifyVsix(vsixPath);
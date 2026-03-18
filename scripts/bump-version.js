#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

(async () => {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    const v = (pkg.version || '0.1.0').split('.');
    const major = parseInt(v[0] || '0', 10) || 0;
    const minor = parseInt(v[1] || '0', 10) || 0;
    const patch = parseInt(v[2] || '0', 10) || 0;
    const newPatch = patch + 1;
    const newVersion = `${major}.${minor}.${newPatch}`;
    pkg.version = newVersion;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`Bumped package.json version: ${newVersion}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to bump version', err);
    process.exit(1);
  }
})();

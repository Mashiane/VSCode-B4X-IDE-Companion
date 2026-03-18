const { spawnSync } = require('child_process');

const ver = process.env.ELECTRON_VERSION;
if (!ver) {
  console.log('ELECTRON_VERSION not set — skipping electron-rebuild.');
  console.log('To rebuild native modules for Electron, set ELECTRON_VERSION and rerun:');
  console.log('  ELECTRON_VERSION=25.2.1 npm run rebuild:electron');
  process.exit(0);
}

console.log(`Running electron-rebuild for Electron v${ver}...`);
const args = ['electron-rebuild', '-f', '-w', 'better-sqlite3', '--version', ver];
const res = spawnSync('npx', args, { stdio: 'inherit' });
process.exit(res.status || 0);

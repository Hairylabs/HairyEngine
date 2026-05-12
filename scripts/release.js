#!/usr/bin/env node
// Bumps the version, syncs it into the preload bundle, runs `npm run package`
// with --publish always, and uploads to the configured GitHub release.
//
// Usage:
//   GH_TOKEN=<pat> node scripts/release.js patch    (default — 0.0.x → 0.0.x+1)
//   GH_TOKEN=<pat> node scripts/release.js minor
//   GH_TOKEN=<pat> node scripts/release.js major
//   GH_TOKEN=<pat> node scripts/release.js 0.1.2    (explicit version)
//
// GH_TOKEN must have `contents: write` on the target repo (Hairylabs/HairyEngine).
// The token gets embedded into the published app via electron-builder so installed
// clients can fetch updates from the private repo.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const preloadPath = path.join(root, 'src', 'preload', 'index.ts');

if (!process.env.GH_TOKEN) {
  console.error('error: GH_TOKEN is not set.');
  console.error('Create a fine-grained PAT with contents:write on Hairylabs/HairyEngine');
  console.error('and run:  GH_TOKEN=<pat> npm run release [patch|minor|major|x.y.z]');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const bumpArg = process.argv[2] || 'patch';
const next = computeNext(current, bumpArg);

console.log(`Releasing HairyEngine ${current} -> ${next}`);

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const preloadSrc = fs.readFileSync(preloadPath, 'utf8');
const updatedPreload = preloadSrc.replace(
  /version: '[^']+'/,
  `version: '${next}'`,
);
fs.writeFileSync(preloadPath, updatedPreload, 'utf8');
console.log(`Synced version to ${preloadPath}`);

// Build + upload. `electron-builder --publish always` reads build.publish from
// package.json and uses GH_TOKEN to authenticate.
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';

const buildResult = spawnSync(
  'node',
  [path.join('scripts', 'run.js'), 'build'],
  { cwd: root, stdio: 'inherit', shell: false },
);
if (buildResult.status !== 0) {
  console.error('Build failed.');
  process.exit(buildResult.status ?? 1);
}

const publishResult = spawnSync(
  npx,
  ['electron-builder', '--win', '--x64', '--publish', 'always'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env },
  },
);

if (publishResult.status !== 0) {
  console.error('electron-builder publish failed.');
  process.exit(publishResult.status ?? 1);
}

console.log(`\nReleased HairyEngine ${next} to Hairylabs/HairyEngine.`);
console.log(`Installed clients will pick it up within an hour, or on next launch.`);

function computeNext(currentVersion, arg) {
  if (/^\d+\.\d+\.\d+/.test(arg)) return arg;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(currentVersion);
  if (!m) throw new Error(`Cannot parse current version: ${currentVersion}`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (arg === 'major') {
    major++; minor = 0; patch = 0;
  } else if (arg === 'minor') {
    minor++; patch = 0;
  } else if (arg === 'patch' || !arg) {
    patch++;
  } else {
    throw new Error(`Unknown bump: ${arg}`);
  }
  return `${major}.${minor}.${patch}`;
}

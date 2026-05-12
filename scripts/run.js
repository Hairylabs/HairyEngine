#!/usr/bin/env node
// Forwards arguments to electron-vite after scrubbing ELECTRON_RUN_AS_NODE.
//
// Reason: when this project is launched from a process that *itself* runs
// inside Electron (e.g. VS Code's extension host, the Claude Code CLI),
// the child shell inherits ELECTRON_RUN_AS_NODE=1, which forces our Electron
// binary to start in Node mode and `require('electron')` returns the binary
// path instead of the API namespace. The result is a confusing
// "Cannot read properties of undefined (reading 'whenReady')" on startup.

const { spawn } = require('node:child_process');
const path = require('node:path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const isWin = process.platform === 'win32';
const bin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  isWin ? 'electron-vite.cmd' : 'electron-vite',
);

const child = spawn(bin, process.argv.slice(2), {
  env,
  stdio: 'inherit',
  shell: isWin, // .cmd needs cmd.exe
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to start electron-vite:', err);
  process.exit(1);
});

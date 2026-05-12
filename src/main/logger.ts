import log from 'electron-log/main';
import { app, ipcMain, shell, dialog } from 'electron';
import { join } from 'node:path';

// Rolling log file at <userData>/logs/main.log + renderer.log.
// electron-log's default transport rotates at 1MB, keeps 5 historical files.
// We bump the limit a bit so a verbose session doesn't lose context.
//
// Sources:
//   - main process: log.error/warn/info/etc.
//   - main process console.*: piped through `Object.assign(console, log.functions)`
//   - renderer process: forwarded via IPC channel 'log:write' from a small shim
//   - uncaught exceptions: log.errorHandler.startCatching()
//   - unhandled rejections: same handler covers them

let installed = false;

export function installLogger() {
  if (installed) return;
  installed = true;

  log.initialize();
  log.transports.file.maxSize = 4 * 1024 * 1024; // 4 MB per file
  log.transports.file.level = 'info';
  log.transports.console.level = 'silly';
  log.transports.file.format =
    '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{processType}] {text}';

  // Pipe main-process console.* so existing console.log calls land in the log.
  Object.assign(console, log.functions);

  // Hard crash safety net — catches both unhandledRejection and uncaught
  // exceptions and dumps them to the log before propagating.
  log.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error, processType }) => {
      log.error(`[uncaught:${processType}]`, error);
    },
  });

  // Renderer log forwarding. The renderer's shim calls
  // ipcRenderer.send('log:write', level, ...args).
  ipcMain.on('log:write', (_e, level: string, ...args: unknown[]) => {
    const fn = (log as unknown as Record<string, (...a: unknown[]) => void>)[level];
    if (typeof fn === 'function') fn('[renderer]', ...args);
    else log.info('[renderer]', `[${level}]`, ...args);
  });

  ipcMain.handle('log:openFolder', () => {
    shell.openPath(join(app.getPath('userData'), 'logs'));
  });

  ipcMain.handle('log:showFile', () => {
    const path = log.transports.file.getFile().path;
    shell.showItemInFolder(path);
  });

  ipcMain.handle('log:tail', async (_e, lines = 200) => {
    try {
      const { readFile } = await import('node:fs/promises');
      const path = log.transports.file.getFile().path;
      const raw = await readFile(path, 'utf8');
      const allLines = raw.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch (err) {
      return `<could not read log: ${(err as Error).message}>`;
    }
  });

  log.info(
    `[boot] HairyEngine main process started — log file at ${log.transports.file.getFile().path}`,
  );

  // Native crashes (Chromium-level) — we don't enable Crashpad here, but a
  // friendly "previous launch crashed" notice could ride on the existence
  // of an .stack file in this folder. TODO if it becomes needed.
}

export function logRendererWindow(win: Electron.BrowserWindow) {
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[renderer-gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('unresponsive', () => log.warn('[renderer] unresponsive'));
  win.webContents.on('responsive', () => log.info('[renderer] responsive again'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`[did-fail-load] ${code} ${desc} ${url}`);
  });
}

export { log };

export function openLogDialog(parent: Electron.BrowserWindow) {
  const path = log.transports.file.getFile().path;
  return dialog.showMessageBox(parent, {
    type: 'info',
    title: 'HairyEngine Log',
    message: 'Log file location',
    detail: path,
    buttons: ['Show in folder', 'OK'],
  });
}

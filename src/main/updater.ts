import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

// Auto-update glue around electron-updater.
//
// In production it polls the configured publish provider (set via `build.publish`
// in package.json) at startup + every hour. When a new version is available it
// downloads in the background; the renderer shows a toast and the user can
// click "Restart & install" to apply.
//
// In dev (process.env.ELECTRON_RENDERER_URL is set, or not packaged), we skip
// the actual check — electron-updater bails anyway, but the noisy logs are
// avoided by gating here.

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string }
  | { type: 'update-not-available' }
  | { type: 'download-progress'; percent: number; bytesPerSecond: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'error'; message: string };

export function registerUpdater(getWindow: () => BrowserWindow | null) {
  // electron-updater silently no-ops if app isn't packaged, so guarding here
  // is mostly to avoid confusing logs in dev.
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const broadcast = (event: UpdaterEvent) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:event', event);
    }
  };

  autoUpdater.on('checking-for-update', () => broadcast({ type: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({ type: 'update-available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () =>
    broadcast({ type: 'update-not-available' }),
  );
  autoUpdater.on('download-progress', (p) =>
    broadcast({
      type: 'download-progress',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
    }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ type: 'update-downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    broadcast({ type: 'error', message: err.message }),
  );

  ipcMain.handle('updater:check', async () => {
    if (isDev) {
      return { ok: false, error: 'Auto-update is disabled in dev mode.' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Kick off an initial check on startup, then re-check every hour.
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // Errors are already broadcast via the 'error' event.
      });
    }, 5_000);
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => undefined);
    }, 60 * 60 * 1000);
  }
}

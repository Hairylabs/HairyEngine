import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

// Native application menu — replaces the inline header File/Help/About buttons
// with the OS-standard menu bar. Renderer handles the actual modal/UI; we just
// broadcast a `menu:action` IPC with a short string the renderer interprets.

type Action =
  | 'about'
  | 'check-updates'
  | 'open-log'
  | 'open-repo'
  | 'open-releases'
  | 'new-project'
  | 'open-project'
  | 'save'
  | 'save-as';

function send(win: BrowserWindow | null, action: Action) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', action);
  }
}

export function installAppMenu(getWindow: () => BrowserWindow | null) {
  const isMac = process.platform === 'darwin';
  const win = () => getWindow();

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(win(), 'new-project'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send(win(), 'open-project'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(win(), 'save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send(win(), 'save-as'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About HairyEngine',
          click: () => send(win(), 'about'),
        },
        { type: 'separator' },
        {
          label: 'Check for updates',
          click: () => send(win(), 'check-updates'),
        },
        {
          label: 'Show log file',
          click: () => send(win(), 'open-log'),
        },
        { type: 'separator' },
        {
          label: 'GitHub repo',
          click: () => send(win(), 'open-repo'),
        },
        {
          label: 'Releases page',
          click: () => send(win(), 'open-releases'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { installLogger, logRendererWindow } from './logger';
import { installAppMenu } from './menu';

// Logger first so any later error here gets captured.
installLogger();
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { blenderConnection, BlenderResponse } from './blender';
import { registerUpdater } from './updater';
import { importAsset, listAssets, openLibrary, readAsset, revealAsset } from './assets';
import { randomUUID } from 'node:crypto';
import {
  broadcastToAll,
  deleteConversation,
  deriveTitle,
  listConversations,
  loadConversation,
  newConversation,
  saveConversation,
  setRendererInvoke,
  streamMessage,
  type ChatMessage,
  type Conversation,
  type ContentBlock,
} from './anthropic';

// Electron main process — owns the application window and the privileged
// integrations (Blender TCP socket, native file dialogs).
// The renderer talks to this process via IPC channels declared in the preload.

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0a0a0f',
    show: false,
    titleBarStyle: 'default',
    title: 'HairyEngine α',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  logRendererWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('blender:connect', async (_e, host?: string, port?: number) => {
    try {
      await blenderConnection.connect(host ?? 'localhost', port ?? 9876);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('blender:disconnect', () => {
    blenderConnection.disconnect();
    return { ok: true };
  });

  ipcMain.handle('blender:status', () => ({
    connected: blenderConnection.isConnected(),
  }));

  ipcMain.handle('blender:send', async (_e, type: string, params?: Record<string, unknown>) => {
    try {
      const res: BlenderResponse = await blenderConnection.send({ type, params });
      return res;
    } catch (err) {
      return { status: 'error' as const, message: (err as Error).message };
    }
  });

  ipcMain.handle('project:open', async () => {
    if (!mainWindow) return { canceled: true as const };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open HairyEngine project',
      filters: [{ name: 'HairyEngine project', extensions: ['hairy', 'json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true as const };
    const filePath = result.filePaths[0];
    try {
      const text = await readFile(filePath, 'utf8');
      return {
        canceled: false as const,
        filePath,
        fileName: basename(filePath),
        json: text,
      };
    } catch (err) {
      return { canceled: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    'project:saveAs',
    async (_e, defaultName: string, json: string) => {
      if (!mainWindow) return { canceled: true as const };
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save HairyEngine project',
        defaultPath: defaultName || 'untitled.hairy',
        filters: [{ name: 'HairyEngine project', extensions: ['hairy'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true as const };
      try {
        await writeFile(result.filePath, json, 'utf8');
        return {
          canceled: false as const,
          filePath: result.filePath,
          fileName: basename(result.filePath),
        };
      } catch (err) {
        return { canceled: false as const, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle('project:openPath', async (_e, filePath: string) => {
    try {
      const text = await readFile(filePath, 'utf8');
      return {
        canceled: false as const,
        filePath,
        fileName: basename(filePath),
        json: text,
      };
    } catch (err) {
      return { canceled: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('project:save', async (_e, filePath: string, json: string) => {
    try {
      await writeFile(filePath, json, 'utf8');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('window:setTitle', (_e, title: string) => {
    if (mainWindow) mainWindow.setTitle(title);
  });

  // Generic temp-file bridge — Blender writes to / reads from the user's
  // %TEMP%/hairyengine-bridge/ folder. The engine reads/writes the same path.
  ipcMain.handle('bridge:readGlb', async (_e, filePath: string) => {
    try {
      const buf = await readFile(filePath);
      return {
        ok: true as const,
        bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });
  ipcMain.handle('bridge:writeGlb', async (_e, filePath: string, bytes: ArrayBuffer) => {
    try {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(filePath, Buffer.from(bytes));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });
  ipcMain.handle('bridge:tempDir', async () => {
    const { tmpdir } = await import('node:os');
    const dir = join(tmpdir(), 'hairyengine-bridge');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    return dir;
  });

  ipcMain.handle('assets:list', () => listAssets());
  ipcMain.handle('assets:read', (_e, path: string) => readAsset(path));
  ipcMain.handle('assets:import', () => importAsset(mainWindow));
  ipcMain.handle('assets:reveal', (_e, path: string) => revealAsset(path));
  ipcMain.handle('assets:openLibrary', () => openLibrary());

  // ai:hasKey kept so older renderer code doesn't crash; always reports `true`
  // because we now use the Claude Code CLI subscription via the Agent SDK and
  // don't need an API key.
  ipcMain.handle('ai:hasKey', () => true);
  ipcMain.handle('ai:listConversations', () => listConversations());
  ipcMain.handle('ai:loadConversation', (_e, id: string) => loadConversation(id));
  ipcMain.handle('ai:deleteConversation', (_e, id: string) => deleteConversation(id));
  ipcMain.handle('ai:newConversation', () => newConversation());

  ipcMain.handle('ai:send', async (_e, requestId: string, conversationId: string, userText: string) => {
    const conv = (await loadConversation(conversationId)) ?? newConversation();
    conv.id = conversationId;
    const userMsg: ChatMessage = {
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    conv.messages.push(userMsg);
    if (conv.title === 'New chat') conv.title = deriveTitle(conv.messages);
    await saveConversation(conv);

    const broadcast = (event: { type: string } & Record<string, unknown>) => {
      broadcastToAll('ai:stream', { requestId, ...event });
    };

    const { blocks, sessionId } = await streamMessage(
      userText,
      conv.sessionId,
      (e) => broadcast(e as { type: string } & Record<string, unknown>),
    );

    if (sessionId) conv.sessionId = sessionId;

    if (blocks.length > 0) {
      // Group consecutive blocks by role so persisted history mirrors the
      // alternating assistant/user pairs the API/SDK expects on resume.
      const grouped: ChatMessage[] = [];
      let current: { role: 'assistant' | 'user'; items: ContentBlock[] } | null = null;
      for (const b of blocks) {
        const role: 'assistant' | 'user' = b.type === 'tool_result' ? 'user' : 'assistant';
        if (!current || current.role !== role) {
          if (current) {
            grouped.push({
              role: current.role,
              content: current.items,
              timestamp: Date.now(),
            });
          }
          current = { role, items: [] };
        }
        current.items.push(b);
      }
      if (current) {
        grouped.push({
          role: current.role,
          content: current.items,
          timestamp: Date.now(),
        });
      }
      conv.messages.push(...grouped);
    }
    await saveConversation(conv);
    broadcast({
      type: 'persisted',
      conversation: conv as unknown as Record<string, unknown>,
    });
    return { ok: true };
  });

  ipcMain.handle('dialog:openGlb', async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import GLB / GLTF',
      filters: [{ name: '3D models', extensions: ['glb', 'gltf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    try {
      const buf = await readFile(filePath);
      return {
        canceled: false,
        filePath,
        // Forward as ArrayBuffer-compatible bytes for the renderer
        bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    } catch (err) {
      return { canceled: false, error: (err as Error).message };
    }
  });
}

// Renderer-side tool bridge — Claude tool calls that need Three.js scene access
// (engine_add_primitive, engine_list_scene) get round-tripped through the
// renderer. Main sends `tools:invoke`, renderer answers with `tools:result`.
const pendingRendererTools = new Map<string, {
  resolve: (s: string) => void;
  reject: (e: Error) => void;
}>();

function registerToolBridge() {
  setRendererInvoke((tool, input) => {
    return new Promise<string>((resolve, reject) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        reject(new Error('no renderer window available for tool call'));
        return;
      }
      const id = randomUUID();
      pendingRendererTools.set(id, { resolve, reject });
      mainWindow.webContents.send('tools:invoke', { id, tool, input });
      // 30 second timeout so a misbehaving renderer can't hang the tool loop.
      setTimeout(() => {
        if (pendingRendererTools.has(id)) {
          pendingRendererTools.delete(id);
          reject(new Error('renderer tool call timed out'));
        }
      }, 30_000);
    });
  });

  ipcMain.handle('tools:result', (_e, id: string, result: string) => {
    const p = pendingRendererTools.get(id);
    if (!p) return;
    pendingRendererTools.delete(id);
    p.resolve(result);
  });
}

app.whenReady().then(() => {
  registerIpc();
  registerToolBridge();
  registerUpdater(() => mainWindow);
  installAppMenu(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  blenderConnection.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

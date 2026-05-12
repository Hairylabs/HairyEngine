import { contextBridge, ipcRenderer } from 'electron';

// Bridge between the renderer (sandboxed Three.js viewport) and the main process.
// Exposes a typed API so the renderer never has direct Node/Electron access.

export type BlenderResponse =
  | { status: 'success'; result?: unknown }
  | { status: 'error'; message: string };

export type ConnectResult = { ok: true } | { ok: false; error: string };

export type OpenGlbResult =
  | { canceled: true }
  | { canceled: false; filePath: string; bytes: ArrayBuffer }
  | { canceled: false; error: string };

export type OpenProjectResult =
  | { canceled: true }
  | { canceled: false; filePath: string; fileName: string; json: string }
  | { canceled: false; error: string };

export type SaveAsResult =
  | { canceled: true }
  | { canceled: false; filePath: string; fileName: string }
  | { canceled: false; error: string };

export type SaveResult = { ok: true } | { ok: false; error: string };

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  model?: string;
};

export type AssetEntry = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
};

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string }
  | { type: 'update-not-available' }
  | { type: 'download-progress'; percent: number; bytesPerSecond: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'error'; message: string };

const api = {
  version: '0.0.12',
  blender: {
    connect: (host?: string, port?: number): Promise<ConnectResult> =>
      ipcRenderer.invoke('blender:connect', host, port),
    disconnect: (): Promise<{ ok: true }> => ipcRenderer.invoke('blender:disconnect'),
    status: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('blender:status'),
    send: (type: string, params?: Record<string, unknown>): Promise<BlenderResponse> =>
      ipcRenderer.invoke('blender:send', type, params),
  },
  project: {
    open: (): Promise<OpenProjectResult> => ipcRenderer.invoke('project:open'),
    openPath: (filePath: string): Promise<OpenProjectResult> =>
      ipcRenderer.invoke('project:openPath', filePath),
    save: (filePath: string, json: string): Promise<SaveResult> =>
      ipcRenderer.invoke('project:save', filePath, json),
    saveAs: (defaultName: string, json: string): Promise<SaveAsResult> =>
      ipcRenderer.invoke('project:saveAs', defaultName, json),
  },
  window: {
    setTitle: (title: string): Promise<void> => ipcRenderer.invoke('window:setTitle', title),
  },
  updater: {
    check: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onEvent: (handler: (event: UpdaterEvent) => void) => {
      const listener = (_e: unknown, payload: UpdaterEvent) => handler(payload);
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
  },
  dialog: {
    openGlb: (): Promise<OpenGlbResult> => ipcRenderer.invoke('dialog:openGlb'),
  },
  tools: {
    onInvoke: (
      handler: (event: {
        id: string;
        tool: string;
        input: Record<string, unknown>;
      }) => void,
    ): (() => void) => {
      const listener = (
        _e: unknown,
        payload: { id: string; tool: string; input: Record<string, unknown> },
      ) => handler(payload);
      ipcRenderer.on('tools:invoke', listener);
      return () => ipcRenderer.removeListener('tools:invoke', listener);
    },
    result: (id: string, result: string): Promise<void> =>
      ipcRenderer.invoke('tools:result', id, result),
  },
  ai: {
    hasKey: (): Promise<boolean> => ipcRenderer.invoke('ai:hasKey'),
    listConversations: (): Promise<
      Array<{ id: string; title: string; updatedAt: number }>
    > => ipcRenderer.invoke('ai:listConversations'),
    loadConversation: (id: string): Promise<Conversation | null> =>
      ipcRenderer.invoke('ai:loadConversation', id),
    deleteConversation: (id: string): Promise<void> =>
      ipcRenderer.invoke('ai:deleteConversation', id),
    newConversation: (): Promise<Conversation> => ipcRenderer.invoke('ai:newConversation'),
    send: (
      requestId: string,
      conversationId: string,
      userText: string,
    ): Promise<{ ok: true }> => ipcRenderer.invoke('ai:send', requestId, conversationId, userText),
    onStream: (
      handler: (event: { requestId: string; type: string } & Record<string, unknown>) => void,
    ): (() => void) => {
      const listener = (
        _e: unknown,
        payload: { requestId: string; type: string } & Record<string, unknown>,
      ) => handler(payload);
      ipcRenderer.on('ai:stream', listener);
      return () => ipcRenderer.removeListener('ai:stream', listener);
    },
  },
  menu: {
    onAction: (handler: (action: string) => void): (() => void) => {
      const listener = (_e: unknown, action: string) => handler(action);
      ipcRenderer.on('menu:action', listener);
      return () => ipcRenderer.removeListener('menu:action', listener);
    },
  },
  log: {
    /** Forward a renderer log entry to the main-process electron-log file. */
    write: (level: 'log' | 'info' | 'warn' | 'error', message: string) => {
      ipcRenderer.send('log:write', level, message);
    },
    openFolder: (): Promise<void> => ipcRenderer.invoke('log:openFolder'),
    showFile: (): Promise<void> => ipcRenderer.invoke('log:showFile'),
    tail: (lines = 200): Promise<string> => ipcRenderer.invoke('log:tail', lines),
  },
  bridge: {
    tempDir: (): Promise<string> => ipcRenderer.invoke('bridge:tempDir'),
    readGlb: (path: string): Promise<
      { ok: true; bytes: ArrayBuffer } | { ok: false; error: string }
    > => ipcRenderer.invoke('bridge:readGlb', path),
    writeGlb: (path: string, bytes: ArrayBuffer): Promise<
      { ok: true } | { ok: false; error: string }
    > => ipcRenderer.invoke('bridge:writeGlb', path, bytes),
  },
  assets: {
    list: (): Promise<AssetEntry[]> => ipcRenderer.invoke('assets:list'),
    read: (path: string): Promise<
      { ok: true; bytes: ArrayBuffer } | { ok: false; error: string }
    > => ipcRenderer.invoke('assets:read', path),
    import: (): Promise<
      | { canceled: true }
      | { canceled: false; imported: AssetEntry[] }
      | { canceled: false; error: string }
    > => ipcRenderer.invoke('assets:import'),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('assets:reveal', path),
    openLibrary: (): Promise<void> => ipcRenderer.invoke('assets:openLibrary'),
    writeBinary: (
      filename: string,
      bytes: ArrayBuffer,
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('assets:writeBinary', filename, bytes),
  },
};

contextBridge.exposeInMainWorld('hairy', api);

export type HairyApi = typeof api;

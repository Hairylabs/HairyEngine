// Type declaration for the bridge exposed by the preload script.
// Mirrors src/preload/index.ts — keep in sync.

declare global {
  interface Window {
    hairy: {
      version: string;
      blender: {
        connect: (host?: string, port?: number) => Promise<
          { ok: true } | { ok: false; error: string }
        >;
        disconnect: () => Promise<{ ok: true }>;
        status: () => Promise<{ connected: boolean }>;
        send: (
          type: string,
          params?: Record<string, unknown>,
        ) => Promise<
          | { status: 'success'; result?: unknown }
          | { status: 'error'; message: string }
        >;
      };
      project: {
        open: () => Promise<
          | { canceled: true }
          | { canceled: false; filePath: string; fileName: string; json: string }
          | { canceled: false; error: string }
        >;
        openPath: (filePath: string) => Promise<
          | { canceled: false; filePath: string; fileName: string; json: string }
          | { canceled: false; error: string }
        >;
        save: (
          filePath: string,
          json: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>;
        saveAs: (
          defaultName: string,
          json: string,
        ) => Promise<
          | { canceled: true }
          | { canceled: false; filePath: string; fileName: string }
          | { canceled: false; error: string }
        >;
      };
      window: {
        setTitle: (title: string) => Promise<void>;
      };
      updater: {
        check: () => Promise<{ ok: true } | { ok: false; error: string }>;
        install: () => Promise<void>;
        onEvent: (
          handler: (
            event:
              | { type: 'checking' }
              | { type: 'update-available'; version: string }
              | { type: 'update-not-available' }
              | { type: 'download-progress'; percent: number; bytesPerSecond: number }
              | { type: 'update-downloaded'; version: string }
              | { type: 'error'; message: string },
          ) => void,
        ) => () => void;
      };
      dialog: {
        openGlb: () => Promise<
          | { canceled: true }
          | { canceled: false; filePath: string; bytes: ArrayBuffer }
          | { canceled: false; error: string }
        >;
      };
      tools: {
        onInvoke: (
          handler: (event: {
            id: string;
            tool: string;
            input: Record<string, unknown>;
          }) => void,
        ) => () => void;
        result: (id: string, result: string) => Promise<void>;
      };
      ai: {
        hasKey: () => Promise<boolean>;
        listConversations: () => Promise<
          Array<{ id: string; title: string; updatedAt: number }>
        >;
        loadConversation: (id: string) => Promise<{
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
          model?: string;
        } | null>;
        deleteConversation: (id: string) => Promise<void>;
        newConversation: () => Promise<{
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
          model?: string;
        }>;
        send: (
          requestId: string,
          conversationId: string,
          userText: string,
        ) => Promise<{ ok: true }>;
        onStream: (
          handler: (
            event: { requestId: string; type: string } & Record<string, unknown>,
          ) => void,
        ) => () => void;
      };
      menu: {
        onAction: (handler: (action: string) => void) => () => void;
      };
      log: {
        write: (level: 'log' | 'info' | 'warn' | 'error', message: string) => void;
        openFolder: () => Promise<void>;
        showFile: () => Promise<void>;
        tail: (lines?: number) => Promise<string>;
      };
      bridge: {
        tempDir: () => Promise<string>;
        readGlb: (path: string) => Promise<
          { ok: true; bytes: ArrayBuffer } | { ok: false; error: string }
        >;
        writeGlb: (path: string, bytes: ArrayBuffer) => Promise<
          { ok: true } | { ok: false; error: string }
        >;
      };
      assets: {
        list: () => Promise<
          Array<{ path: string; name: string; size: number; mtime: number; ext: string }>
        >;
        read: (
          path: string,
        ) => Promise<
          { ok: true; bytes: ArrayBuffer } | { ok: false; error: string }
        >;
        import: () => Promise<
          | { canceled: true }
          | {
              canceled: false;
              imported: Array<{
                path: string;
                name: string;
                size: number;
                mtime: number;
                ext: string;
              }>;
            }
          | { canceled: false; error: string }
        >;
        reveal: (path: string) => Promise<void>;
        openLibrary: () => Promise<void>;
      };
    };
  }
}

export {};

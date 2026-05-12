import net from 'node:net';

// TCP client for the BlenderMCP addon (port 9876).
// Wire format: each request and response is a single UTF-8 JSON object;
// the addon parses the buffer on every chunk until `json.loads` succeeds.
// So we send JSON.stringify(cmd) and read until we get a parseable response.

export type BlenderRequest = {
  type: string;
  params?: Record<string, unknown>;
};

export type BlenderResponse =
  | { status: 'success'; result?: unknown }
  | { status: 'error'; message: string };

export class BlenderConnection {
  private socket: net.Socket | null = null;
  private host = 'localhost';
  private port = 9876;
  private connecting: Promise<void> | null = null;
  private pending: {
    resolve: (r: BlenderResponse) => void;
    reject: (e: Error) => void;
    buf: string;
  } | null = null;
  private queue: Array<{
    payload: string;
    resolve: (r: BlenderResponse) => void;
    reject: (e: Error) => void;
  }> = [];

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async connect(host = 'localhost', port = 9876): Promise<void> {
    if (this.isConnected() && this.host === host && this.port === port) return;
    this.disconnect();
    this.host = host;
    this.port = port;

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setNoDelay(true);

      const onError = (err: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        this.socket = null;
        reject(err);
      };

      socket.once('error', onError);
      socket.connect(port, host, () => {
        socket.off('error', onError);
        this.socket = socket;
        this.attachHandlers(socket);
        resolve();
      });
    });

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  disconnect() {
    if (this.pending) {
      this.pending.reject(new Error('connection closed'));
      this.pending = null;
    }
    for (const q of this.queue) q.reject(new Error('connection closed'));
    this.queue = [];
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  async send(req: BlenderRequest): Promise<BlenderResponse> {
    if (!this.isConnected()) {
      await this.connect(this.host, this.port);
    }
    const payload = JSON.stringify(req);
    return new Promise<BlenderResponse>((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    if (this.pending) return; // already waiting on a response
    const next = this.queue.shift();
    if (!next || !this.socket) return;

    this.pending = { resolve: next.resolve, reject: next.reject, buf: '' };
    this.socket.write(next.payload, 'utf8', (err) => {
      if (err && this.pending) {
        this.pending.reject(err);
        this.pending = null;
        this.pump();
      }
    });
  }

  private attachHandlers(socket: net.Socket) {
    socket.on('data', (chunk) => {
      if (!this.pending) return; // unsolicited data — ignore
      this.pending.buf += chunk.toString('utf8');
      // Try to parse — addon sends one complete JSON per response.
      try {
        const parsed = JSON.parse(this.pending.buf) as BlenderResponse;
        const p = this.pending;
        this.pending = null;
        p.resolve(parsed);
        this.pump();
      } catch {
        // not yet a complete JSON document — wait for more data
      }
    });
    socket.on('close', () => {
      if (this.pending) {
        this.pending.reject(new Error('connection closed'));
        this.pending = null;
      }
      for (const q of this.queue) q.reject(new Error('connection closed'));
      this.queue = [];
      this.socket = null;
    });
    socket.on('error', () => {
      // close event will follow — cleanup happens there
    });
  }
}

export const blenderConnection = new BlenderConnection();

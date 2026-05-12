// Intercepts console.log/info/warn/error and broadcasts entries to subscribers.
// Original console methods still fire (we don't swallow DevTools output).
//
// Capped at MAX_ENTRIES rolling buffer so a noisy log loop doesn't OOM the panel.

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export type LogEntry = {
  level: LogLevel;
  timestamp: number;
  message: string;
};

export type LogListener = (entry: LogEntry) => void;

const MAX_ENTRIES = 2000;

let installed = false;
const buffer: LogEntry[] = [];
const listeners: LogListener[] = [];

export function installLogBus() {
  if (installed) return;
  installed = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const message = args.map(formatArg).join(' ');
      const entry: LogEntry = { level, timestamp: Date.now(), message };
      buffer.push(entry);
      if (buffer.length > MAX_ENTRIES) buffer.shift();
      listeners.forEach((l) => l(entry));
      // Forward to the main-process rolling log file via the preload bridge.
      // Guarded because the bridge may not be loaded yet in the very first
      // tick (e.g. during preload script execution).
      const w = window as unknown as {
        hairy?: { log?: { write?: (lvl: string, msg: string) => void } };
      };
      try {
        w.hairy?.log?.write?.(level, message);
      } catch {
        // never let logging crash the app
      }
    };
  });

  window.addEventListener('error', (e) => {
    // e.error has the full Error object with stack. Without it the bundle
    // line numbers are useless — we'd never find the bug.
    const stack = e.error?.stack ? `\n${e.error.stack}` : '';
    pushSynthetic(
      'error',
      `Uncaught: ${e.message} (${e.filename}:${e.lineno}:${e.colno})${stack}`,
    );
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const stack = reason instanceof Error && reason.stack ? `\n${reason.stack}` : '';
    pushSynthetic('error', `Unhandled rejection: ${formatArg(reason)}${stack}`);
  });
}

export function getLogBuffer(): readonly LogEntry[] {
  return buffer;
}

export function onLog(l: LogListener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function clearLogs() {
  buffer.length = 0;
  // Push a synthetic clear so consumers can wipe their views.
  listeners.forEach((l) =>
    l({ level: 'info', timestamp: Date.now(), message: '__clear__' }),
  );
}

function pushSynthetic(level: LogLevel, message: string) {
  const entry: LogEntry = { level, timestamp: Date.now(), message };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  listeners.forEach((l) => l(entry));
  // Forward to the main-process rolling log file so uncaught errors land
  // in main.log alongside normal console output. Without this, the file
  // never sees the crash that actually matters.
  const w = window as unknown as {
    hairy?: { log?: { write?: (lvl: string, msg: string) => void } };
  };
  try {
    w.hairy?.log?.write?.(level, message);
  } catch {
    // never let logging crash the app
  }
}

function formatArg(a: unknown): string {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'string') return a;
  if (typeof a === 'number' || typeof a === 'boolean') return String(a);
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

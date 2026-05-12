import { getLogBuffer, onLog, LogEntry, LogLevel, clearLogs } from '../engine/LogBus';

// Console panel — renders the rolling LogBus buffer as a virtualized-ish list
// (just appendChild on each new entry, capped via the buffer). DOM updates
// are batched in a microtask so a high-frequency log doesn't slow the engine.

export class ConsolePanel {
  private pendingFlush: number | null = null;
  private pending: LogEntry[] = [];
  private autoScroll = true;

  constructor(private root: HTMLElement) {
    root.classList.add('console-panel');
    // Replay buffered entries (in case logs landed before the panel was mounted)
    for (const entry of getLogBuffer()) this.append(entry, false);
    onLog((entry) => {
      if (entry.message === '__clear__') {
        this.root.innerHTML = '';
        return;
      }
      this.pending.push(entry);
      if (this.pendingFlush === null) {
        this.pendingFlush = requestAnimationFrame(() => this.flush());
      }
    });

    root.addEventListener('scroll', () => {
      const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 4;
      this.autoScroll = atBottom;
    });
  }

  clear() {
    clearLogs();
    this.root.innerHTML = '';
  }

  private flush() {
    this.pendingFlush = null;
    for (const e of this.pending) this.append(e, true);
    this.pending = [];
    if (this.autoScroll) this.root.scrollTop = this.root.scrollHeight;
  }

  private append(entry: LogEntry, _isLive: boolean) {
    const row = document.createElement('div');
    row.className = `console-row level-${entry.level}`;
    const ts = document.createElement('span');
    ts.className = 'console-ts';
    ts.textContent = formatTs(entry.timestamp);
    const lvl = document.createElement('span');
    lvl.className = 'console-lvl';
    lvl.textContent = LEVEL_LABEL[entry.level];
    const msg = document.createElement('span');
    msg.className = 'console-msg';
    msg.textContent = entry.message;
    row.appendChild(ts);
    row.appendChild(lvl);
    row.appendChild(msg);
    this.root.appendChild(row);
  }
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  log: 'LOG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR ',
};

function formatTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

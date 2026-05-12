// Command pattern + undo/redo stack.
//
// Two ways to record an action:
//   history.push(cmd)    — runs cmd.do() now, then records it
//   history.record(cmd)  — caller already performed the action; just record it
//
// `record` is for cases where the action is naturally executed by another
// system (e.g. TransformControls already moved the object during drag — we
// record a TransformCommand on drag-end so undo can revert to the snapshot).

export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

export type HistoryListener = (state: HistoryState) => void;

export type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  lastLabel: string | null;
};

const MAX_HISTORY = 200;

export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private listeners: HistoryListener[] = [];

  push(cmd: Command) {
    cmd.do();
    this.record(cmd);
  }

  record(cmd: Command) {
    this.past.push(cmd);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.emit();
  }

  undo() {
    const cmd = this.past.pop();
    if (!cmd) return;
    cmd.undo();
    this.future.push(cmd);
    this.emit();
  }

  redo() {
    const cmd = this.future.pop();
    if (!cmd) return;
    cmd.do();
    this.past.push(cmd);
    this.emit();
  }

  clear() {
    this.past = [];
    this.future = [];
    this.emit();
  }

  state(): HistoryState {
    const top = this.past[this.past.length - 1];
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      lastLabel: top?.label ?? null,
    };
  }

  onChange(l: HistoryListener) {
    this.listeners.push(l);
  }

  private emit() {
    const s = this.state();
    this.listeners.forEach((l) => l(s));
  }
}

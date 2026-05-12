import { Scene } from './Scene';

// Owner of "current project file" state and orchestrator of save/open.
// Tracks: path, dirty flag, recent list. Emits state changes so the menu /
// title bar can re-render without polling.

const RECENTS_KEY = 'hairy.recents.v1';
const MAX_RECENTS = 8;

export type ProjectListener = (state: ProjectState) => void;
export type ProjectState = {
  filePath: string | null;
  fileName: string;
  dirty: boolean;
  recents: string[];
};

export class Project {
  private filePath: string | null = null;
  private fileName = 'untitled.hairy';
  private dirty = false;
  private listeners: ProjectListener[] = [];

  constructor(private scene: Scene) {
    // Any user-driven scene mutation marks dirty.
    scene.onSceneChanged(() => this.markDirty());
  }

  onChange(l: ProjectListener) {
    this.listeners.push(l);
  }

  getState(): ProjectState {
    return {
      filePath: this.filePath,
      fileName: this.fileName,
      dirty: this.dirty,
      recents: this.recents(),
    };
  }

  markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.emit();
    }
  }

  // Called after a successful save to clear the dirty marker without firing
  // a phantom mutation.
  clearDirty() {
    if (this.dirty) {
      this.dirty = false;
      this.emit();
    }
  }

  async newProject() {
    if (!this.confirmDiscardChanges()) return;
    while (this.scene.editable.children.length > 0) {
      this.scene.removeInternal(this.scene.editable.children[0]);
    }
    this.filePath = null;
    this.fileName = 'untitled.hairy';
    this.dirty = false;
    this.emit();
  }

  async save(): Promise<boolean> {
    if (!this.filePath) return this.saveAs();
    const json = this.toJsonString();
    const res = await window.hairy.project.save(this.filePath, json);
    if (!res.ok) {
      alert(`Save failed: ${res.error}`);
      return false;
    }
    this.dirty = false;
    this.emit();
    return true;
  }

  async saveAs(): Promise<boolean> {
    const json = this.toJsonString();
    const res = await window.hairy.project.saveAs(this.fileName, json);
    if (res.canceled) return false;
    if ('error' in res) {
      alert(`Save failed: ${res.error}`);
      return false;
    }
    this.filePath = res.filePath;
    this.fileName = res.fileName;
    this.dirty = false;
    this.pushRecent(res.filePath);
    this.emit();
    return true;
  }

  async open(): Promise<boolean> {
    if (!this.confirmDiscardChanges()) return false;
    const res = await window.hairy.project.open();
    if (res.canceled) return false;
    if ('error' in res) {
      alert(`Open failed: ${res.error}`);
      return false;
    }
    return this.loadFromJson(res.json, res.filePath, res.fileName);
  }

  // Drag-drop entry point: we have the file contents but no absolute path
  // (Electron's webUtils.getPathForFile isn't wired up). The user can Save As
  // to persist; until then the project stays in "untitled" state.
  async loadFromText(json: string, fileName: string): Promise<boolean> {
    if (!this.confirmDiscardChanges()) return false;
    return this.loadFromJson(json, null, fileName);
  }

  async openPath(filePath: string): Promise<boolean> {
    if (!this.confirmDiscardChanges()) return false;
    const res = await window.hairy.project.openPath(filePath);
    if ('error' in res) {
      alert(`Open failed: ${res.error}`);
      // Stale entry — drop it from recents so we don't keep offering it.
      this.removeRecent(filePath);
      return false;
    }
    return this.loadFromJson(res.json, res.filePath, res.fileName);
  }

  removeRecent(filePath: string) {
    const list = this.recents().filter((p) => p !== filePath);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
    this.emit();
  }

  private loadFromJson(
    json: string,
    filePath: string | null,
    fileName: string,
  ): boolean {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch (err) {
      alert(`Project file is not valid JSON: ${(err as Error).message}`);
      return false;
    }
    try {
      const { warnings } = this.scene.deserialize(data);
      if (warnings.length > 0) console.warn('[project] load warnings:', warnings);
    } catch (err) {
      alert(`Load failed: ${(err as Error).message}`);
      return false;
    }
    this.filePath = filePath;
    this.fileName = fileName;
    // deserialize fires onSceneChanged which marks dirty — undo that here.
    this.dirty = false;
    if (filePath) this.pushRecent(filePath);
    this.emit();
    return true;
  }

  private toJsonString(): string {
    return JSON.stringify(
      this.scene.serialize({ name: this.fileName.replace(/\.[^.]+$/, '') }),
    );
  }

  recents(): string[] {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private pushRecent(filePath: string) {
    const list = this.recents().filter((p) => p !== filePath);
    list.unshift(filePath);
    while (list.length > MAX_RECENTS) list.pop();
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  }

  private confirmDiscardChanges(): boolean {
    if (!this.dirty) return true;
    return window.confirm(
      `${this.fileName} has unsaved changes. Discard them?`,
    );
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }
}

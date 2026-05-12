import { Scene } from './Scene';

// Levels — multiple named scenes within a single .hairy project file. Lets
// the user build a "MainMenu" level + a "Arena1" level + a "Lobby" level all
// in one save. Each level is a serialized Scene snapshot; switching levels
// swaps the scene contents under the same renderer / camera.
//
// Storage layout in localStorage / project file (for round-tripping):
//   levels: [
//     { name: "MainMenu", data: <Scene.serialize> },
//     { name: "Arena1",   data: <Scene.serialize> },
//   ]
//   currentLevel: 0
//
// The active level is always kept in the live Scene. switchTo(idx) writes
// the current Scene back into its slot first, then loads the target slot.

const STORAGE_KEY = 'hairy.levels.v1';

export type LevelMeta = {
  name: string;
  updatedAt: number;
  objectCount: number;
};

type LevelSlot = {
  name: string;
  updatedAt: number;
  data: unknown; // Scene.serialize() output
};

export type LevelsListener = (state: LevelsState) => void;
export type LevelsState = {
  levels: LevelMeta[];
  currentLevel: number;
};

export class LevelsManager {
  private slots: LevelSlot[] = [];
  private current = 0;
  private listeners: LevelsListener[] = [];

  constructor(private scene: Scene) {
    this.load();
    if (this.slots.length === 0) {
      // First-run: seed with a single "MainLevel" matching the current scene.
      this.slots.push({
        name: 'MainLevel',
        updatedAt: Date.now(),
        data: scene.serialize(),
      });
      this.current = 0;
      this.persist();
    }
  }

  getState(): LevelsState {
    return {
      levels: this.slots.map((s) => ({
        name: s.name,
        updatedAt: s.updatedAt,
        objectCount: countObjects(s.data),
      })),
      currentLevel: this.current,
    };
  }

  onChange(l: LevelsListener) {
    this.listeners.push(l);
  }

  currentName(): string {
    return this.slots[this.current]?.name ?? 'MainLevel';
  }

  /** Capture the live Scene into the current slot. Called before switching. */
  snapshotCurrent() {
    if (!this.slots[this.current]) return;
    this.slots[this.current].data = this.scene.serialize();
    this.slots[this.current].updatedAt = Date.now();
    this.persist();
    this.emit();
  }

  switchTo(idx: number) {
    if (idx < 0 || idx >= this.slots.length) return;
    if (idx === this.current) return;
    this.snapshotCurrent();
    this.current = idx;
    this.scene.deserialize(this.slots[idx].data);
    this.emit();
  }

  rename(idx: number, name: string) {
    if (!this.slots[idx]) return;
    this.slots[idx].name = sanitizeLevelName(name);
    this.persist();
    this.emit();
  }

  add(name: string): number {
    this.snapshotCurrent();
    // Start the new level with just the default lights + grid (no user objs)
    // — we re-seed by deserializing an empty editable subtree.
    this.slots.push({
      name: sanitizeLevelName(name),
      updatedAt: Date.now(),
      data: emptyLevelSnapshot(),
    });
    this.current = this.slots.length - 1;
    this.scene.deserialize(this.slots[this.current].data);
    this.persist();
    this.emit();
    return this.current;
  }

  duplicate(idx: number): number {
    if (!this.slots[idx]) return -1;
    this.snapshotCurrent();
    const copy: LevelSlot = {
      name: sanitizeLevelName(`${this.slots[idx].name}_copy`),
      updatedAt: Date.now(),
      // Deep-clone via serialize round-trip.
      data: JSON.parse(JSON.stringify(this.slots[idx].data)),
    };
    this.slots.push(copy);
    this.persist();
    this.emit();
    return this.slots.length - 1;
  }

  remove(idx: number): boolean {
    if (this.slots.length <= 1) return false; // must keep at least one
    if (!this.slots[idx]) return false;
    this.slots.splice(idx, 1);
    if (this.current >= this.slots.length) this.current = this.slots.length - 1;
    this.scene.deserialize(this.slots[this.current].data);
    this.persist();
    this.emit();
    return true;
  }

  /** Pack all levels into a JSON-safe blob for storage inside a .hairy file. */
  serialize(): unknown {
    this.snapshotCurrent();
    return {
      version: 1,
      currentLevel: this.current,
      levels: this.slots,
    };
  }

  /** Load levels from a .hairy project payload. Returns false if not present. */
  deserialize(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as { levels?: unknown; currentLevel?: unknown };
    if (!Array.isArray(p.levels) || p.levels.length === 0) return false;
    this.slots = p.levels.map((s: unknown) => {
      const o = s as Partial<LevelSlot>;
      return {
        name: typeof o.name === 'string' ? o.name : 'Level',
        updatedAt: Number(o.updatedAt ?? Date.now()),
        data: o.data,
      };
    });
    this.current = Math.max(0, Math.min(this.slots.length - 1, Number(p.currentLevel ?? 0)));
    this.scene.deserialize(this.slots[this.current].data);
    this.persist();
    this.emit();
    return true;
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentLevel: this.current,
        levels: this.slots,
      }));
    } catch (err) {
      console.warn('[LevelsManager] localStorage persist failed:', err);
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!Array.isArray(p?.levels)) return;
      this.slots = p.levels;
      this.current = Number(p.currentLevel ?? 0);
    } catch {
      /* corrupt — start fresh */
    }
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }
}

function sanitizeLevelName(name: string): string {
  const t = name.trim();
  if (!t) return 'Level';
  return t.slice(0, 32);
}

function countObjects(data: unknown): number {
  // Cheap heuristic — count "children" entries in the serialized tree.
  try {
    const json = JSON.stringify(data);
    return (json.match(/"name"\s*:/g) ?? []).length;
  } catch {
    return 0;
  }
}

function emptyLevelSnapshot(): unknown {
  return {
    format: 'hairyengine-project',
    version: 1,
    editable: {
      metadata: { version: 4.6, type: 'Object', generator: 'Object3D.toJSON' },
      object: { uuid: 'empty', type: 'Group', name: 'Editable', children: [] },
    },
  };
}

import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';

// Play mode controls the editor↔runtime transition.
//
// On Play:
//   - Snapshot the editable subtree (Object3D.toJSON) so Stop can restore it
//   - Clear undo history (runtime mutations shouldn't be undoable as editor commands)
//   - Switch the global mode flag; runtime systems gate their updates on this
//   - Editor UI dims, hierarchy/inspector enter read-mostly mode
//
// On Stop:
//   - Restore the snapshot, re-create children from the serialized data
//   - Mode flag flips back; editor resumes

export type PlayMode = 'edit' | 'play' | 'paused';
export type PlayListener = (mode: PlayMode) => void;

type Snapshot = unknown;

export class PlayState {
  private mode: PlayMode = 'edit';
  private snapshot: Snapshot | null = null;
  private listeners: PlayListener[] = [];

  constructor(
    private scene: Scene,
    private history: History,
  ) {}

  getMode(): PlayMode {
    return this.mode;
  }

  isPlaying(): boolean {
    return this.mode === 'play';
  }

  onChange(l: PlayListener) {
    this.listeners.push(l);
  }

  play() {
    if (this.mode !== 'edit') return;
    this.snapshot = this.scene.editable.toJSON();
    this.history.clear();
    this.setMode('play');
  }

  pause() {
    if (this.mode !== 'play') return;
    this.setMode('paused');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.setMode('play');
  }

  stop() {
    if (this.mode === 'edit') return;
    if (this.snapshot) {
      try {
        this.restoreSnapshot(this.snapshot);
      } catch (err) {
        console.error('[PlayState] Restore failed:', err);
      }
    }
    this.snapshot = null;
    this.history.clear();
    this.setMode('edit');
  }

  private restoreSnapshot(json: unknown) {
    // Clear current editable subtree
    while (this.scene.editable.children.length > 0) {
      this.scene.removeInternal(this.scene.editable.children[0]);
    }
    // Reload from snapshot
    const loader = new THREE.ObjectLoader();
    const loaded = loader.parse(json as Parameters<THREE.ObjectLoader['parse']>[0]);
    while (loaded.children.length > 0) {
      this.scene.editable.add(loaded.children[0]);
    }
    this.scene.notifyChanged();
    this.scene.select(null);
  }

  private setMode(m: PlayMode) {
    this.mode = m;
    this.listeners.forEach((l) => l(m));
  }
}

import * as THREE from 'three';
import { Scene } from './Scene';
import { Input } from './Input';
import {
  getScriptDefinition,
  getScriptDescriptors,
  Script,
  ScriptCtx,
} from './Script';
import { PlayState } from './PlayState';

// Walks the editable subtree on Play, instantiates all attached scripts,
// calls .start(), and runs .update(dt) every frame. Stop tears everything
// down. Scripts added/removed during play are handled too — see
// startScriptsFor / stopScriptsFor for the runtime path.

type LiveScript = {
  owner: THREE.Object3D;
  type: string;
  instance: Script;
};

export class ScriptSystem {
  private live: LiveScript[] = [];
  private ctxBase: Omit<ScriptCtx, 'owner'>;

  constructor(
    private scene: Scene,
    input: Input,
    camera: THREE.PerspectiveCamera,
    play: PlayState,
  ) {
    this.ctxBase = { scene, input, camera };
    play.onChange((mode) => {
      if (mode === 'play') this.startAll();
      else if (mode === 'edit') this.stopAll();
      // paused leaves live instances in place but update() won't run
      // (the loop checks play state).
    });
  }

  update(dt: number) {
    for (const ls of this.live) {
      try {
        ls.instance.update?.(dt);
      } catch (err) {
        console.error(`[Script:${ls.type}] update failed:`, err);
      }
    }
  }

  private startAll() {
    this.scene.editable.traverse((obj) => {
      this.startScriptsFor(obj);
    });
  }

  private startScriptsFor(obj: THREE.Object3D) {
    const descriptors = getScriptDescriptors(obj);
    for (const desc of descriptors) {
      const def = getScriptDefinition(desc.type);
      if (!def) {
        console.warn(`[ScriptSystem] Unknown script type: ${desc.type}`);
        continue;
      }
      try {
        const instance = def.create(
          { ...this.ctxBase, owner: obj },
          desc.params ?? {},
        );
        instance.start?.();
        this.live.push({ owner: obj, type: desc.type, instance });
      } catch (err) {
        console.error(`[Script:${desc.type}] start failed:`, err);
      }
    }
  }

  private stopAll() {
    for (const ls of this.live) {
      try {
        ls.instance.stop?.();
      } catch (err) {
        console.error(`[Script:${ls.type}] stop failed:`, err);
      }
    }
    this.live = [];
  }
}

import * as THREE from 'three';
import { Scene } from './Scene';
import { PlayState } from './PlayState';

// Animation playback. When a GLB is loaded, GLTFLoader returns
// `gltf.animations` — we stash that array on the root's userData and an
// AnimationPlayer script can then access them. AnimationSystem ticks every
// registered mixer each frame in Play Mode.
//
// We also tick in edit mode so designers can preview animations from the
// Inspector without entering Play Mode (matches Unity/Unreal behavior).

type Registration = {
  mixer: THREE.AnimationMixer;
};

export class AnimationSystem {
  private mixers = new Map<THREE.Object3D, Registration>();

  constructor(_scene: Scene, _play: PlayState) {}

  update(dt: number) {
    for (const reg of this.mixers.values()) {
      reg.mixer.update(dt);
    }
  }

  // Get or create the mixer for an object. Scripts call this in their start().
  getMixer(owner: THREE.Object3D): THREE.AnimationMixer {
    const existing = this.mixers.get(owner);
    if (existing) return existing.mixer;
    const mixer = new THREE.AnimationMixer(owner);
    this.mixers.set(owner, { mixer });
    return mixer;
  }

  releaseMixer(owner: THREE.Object3D) {
    const reg = this.mixers.get(owner);
    if (reg) {
      reg.mixer.stopAllAction();
      this.mixers.delete(owner);
    }
  }
}

import * as THREE from 'three';

// AnimationClip[] doesn't survive Three's toJSON serialization, so we keep a
// runtime-only registry keyed by the Object3D's UUID. Loaders call
// attachAnimations; scripts call getAnimations.

const registry = new Map<string, THREE.AnimationClip[]>();

export function attachAnimations(obj: THREE.Object3D, clips: THREE.AnimationClip[]) {
  registry.set(obj.uuid, clips);
  // Surface clip names in userData so the Inspector can list them without
  // pulling in this module.
  obj.userData.__animationNames = clips.map((c) => c.name);
}

export function getAnimations(obj: THREE.Object3D): THREE.AnimationClip[] {
  return registry.get(obj.uuid) ?? [];
}

export function listAnimationNames(obj: THREE.Object3D): string[] {
  const names = obj.userData.__animationNames;
  return Array.isArray(names) ? (names as string[]) : [];
}

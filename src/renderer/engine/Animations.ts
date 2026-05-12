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

// Find a bone by name, handling the common naming conventions found in
// Mixamo / ActorCore / hand-rigged characters. Tries (in order):
//   1. Exact match
//   2. With `mixamorig:` prefix
//   3. Without the prefix
//   4. Case-insensitive
// Returns the first hit found by traversal.
export function findBoneByName(
  root: THREE.Object3D,
  name: string,
): THREE.Object3D | null {
  const candidates = [
    name,
    `mixamorig:${name}`,
    name.replace(/^mixamorig:/, ''),
  ];
  for (const c of candidates) {
    const hit = root.getObjectByName(c);
    if (hit) return hit;
  }
  // Case-insensitive fallback.
  const lower = name.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    const n = (o.name || '').toLowerCase();
    if (n === lower || n === `mixamorig:${lower}` || n.endsWith(`:${lower}`)) {
      found = o;
    }
  });
  return found;
}

// Returns the list of bone-like nodes (objects whose name looks like a bone).
// Useful for the Inspector "Attach to bone" dropdown when a SkinnedMesh is
// selected — the user picks from a list rather than typing a name.
export function listBones(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((o) => {
    const isBone = (o as THREE.Bone).isBone || o.name.startsWith('mixamorig:');
    if (isBone && o.name) names.push(o.name);
  });
  return names;
}

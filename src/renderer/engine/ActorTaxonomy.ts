import * as THREE from 'three';

// HairyEngine actor taxonomy — our own naming convention so the user thinks
// in "Actors / Props / Lights" rather than "Object3D / Mesh / Group".
// Persists via userData.__actorKind so it round-trips through save/load.
//
// Vocab (Unreal-inspired, but trimmed to what an artist actually cares about):
//   Hero       — playable character / NPC with scripts (highest "agency")
//   Prop       — decorative or static mesh
//   Volume     — invisible trigger/collider area (later)
//   Light      — any THREE.Light
//   Camera     — scene camera
//   Spawn      — spawn point marker
//   Group      — folder / collection (THREE.Group with no scripts)
//   Brush      — level-geometry primitive (Wall/Floor/Ramp/Stairs)
//
// The taxonomy drives:
//   • Hierarchy panel icon + sort order
//   • Layer-style filters in the level panel
//   • Default scripts attached when an Actor is created via +Add

export type ActorKind =
  | 'hero'
  | 'prop'
  | 'volume'
  | 'light'
  | 'camera'
  | 'spawn'
  | 'group'
  | 'brush';

const ICONS: Record<ActorKind, string> = {
  hero: '👤',
  prop: '◆',
  volume: '◇',
  light: '💡',
  camera: '🎥',
  spawn: '◯',
  group: '📁',
  brush: '▮',
};

const LABELS: Record<ActorKind, string> = {
  hero: 'Hero',
  prop: 'Prop',
  volume: 'Volume',
  light: 'Light',
  camera: 'Camera',
  spawn: 'Spawn Point',
  group: 'Group',
  brush: 'Brush',
};

export function setActorKind(obj: THREE.Object3D, kind: ActorKind) {
  obj.userData.__actorKind = kind;
}

export function getActorKind(obj: THREE.Object3D): ActorKind {
  const explicit = obj.userData.__actorKind as ActorKind | undefined;
  if (explicit) return explicit;
  return inferKind(obj);
}

/** Best-guess kind for objects that pre-date the taxonomy. */
export function inferKind(obj: THREE.Object3D): ActorKind {
  if ((obj as THREE.Light).isLight) return 'light';
  if ((obj as THREE.Camera).isCamera) return 'camera';
  if (obj.name?.toLowerCase().includes('spawn')) return 'spawn';
  const scripts = obj.userData.__scripts;
  if (Array.isArray(scripts) && scripts.length > 0) {
    // Anything with a CharacterController is a Hero. Otherwise still a Prop.
    if (scripts.some((s: { type: string }) => s.type === 'CharacterController')) return 'hero';
    return 'prop';
  }
  if ((obj as THREE.Group).isGroup && obj.children.length > 0) {
    // A Group of meshes/lights is a Group; a Group with a CharacterController
    // already routed above.
    const firstName = obj.name.toLowerCase();
    if (firstName.includes('wall') || firstName.includes('floor')
      || firstName.includes('ramp') || firstName.includes('stair')) {
      return 'brush';
    }
    return 'group';
  }
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh) {
    // Brush primitives carry telltale names
    const nm = obj.name.toLowerCase();
    if (['wall', 'floor', 'ramp', 'stairs', 'cover'].some((k) => nm.includes(k))) {
      return 'brush';
    }
    return 'prop';
  }
  return 'prop';
}

export function actorIcon(kind: ActorKind): string {
  return ICONS[kind];
}

export function actorLabel(kind: ActorKind): string {
  return LABELS[kind];
}

export function listActorKinds(): ActorKind[] {
  return ['hero', 'prop', 'brush', 'light', 'camera', 'spawn', 'volume', 'group'];
}

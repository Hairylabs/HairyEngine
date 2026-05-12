import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';
import { AddObjectCommand } from './Commands';

// "Edit tools" — single-shot operations the user runs on the selected object.
// Modeled on Unreal Engine's "Drop to Floor", Unity's "Move to View" and
// ProBuilder's array/duplicate-along workflow. Each is undoable.
//
// Surface: viewport toolbar buttons + Edit menu entries.

const DEFAULT_GRID = 1.0;

// Drop the selected object so its bounding-box bottom rests on y = 0
// (or on the highest mesh directly below it, if any). Saves the artist from
// nudging things into the floor manually.
export function dropToFloor(scene: Scene, history: History): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const box = new THREE.Box3().setFromObject(sel);
  if (box.isEmpty()) return false;
  // Raycast straight down from the bbox bottom to find a surface, then
  // place the object on it; if no hit, just sit on y = 0.
  const origin = box.getCenter(new THREE.Vector3());
  origin.y = box.max.y + 0.01;
  const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
  const others = scene.editable.children.filter((c) => c !== sel);
  const hits = raycaster.intersectObjects(others, true);
  const targetY = hits.length > 0 ? hits[0].point.y : 0;
  const delta = targetY - box.min.y;
  const before = sel.position.clone();
  sel.position.y += delta;
  history.record({
    label: `Drop to floor (${sel.name})`,
    do: () => sel.position.copy(before).setY(before.y + delta),
    undo: () => sel.position.copy(before),
  });
  scene.notifyChanged();
  return true;
}

// Snap the selected object's position to the nearest grid intersection.
// Useful after free-hand drag if you forgot to enable grid-snap before moving.
export function snapToGrid(
  scene: Scene,
  history: History,
  grid = DEFAULT_GRID,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const before = sel.position.clone();
  sel.position.x = Math.round(sel.position.x / grid) * grid;
  sel.position.y = Math.round(sel.position.y / grid) * grid;
  sel.position.z = Math.round(sel.position.z / grid) * grid;
  const after = sel.position.clone();
  history.record({
    label: 'Snap to grid',
    do: () => sel.position.copy(after),
    undo: () => sel.position.copy(before),
  });
  scene.notifyChanged();
  return true;
}

// Make N copies of the selected object, offset by `step` along an axis.
// Standard Unity/Unreal "array along axis" command — great for pillars,
// floor tiles, fence posts.
export function duplicateAlongAxis(
  scene: Scene,
  history: History,
  count: number,
  axis: 'x' | 'y' | 'z',
  step: number,
): number {
  const sel = scene.selection;
  if (!sel) return 0;
  const made: THREE.Object3D[] = [];
  for (let i = 1; i <= count; i++) {
    const copy = sel.clone(true);
    copy.position.copy(sel.position);
    copy.position[axis] += step * i;
    copy.name = `${sel.name}_${i}`;
    history.push(new AddObjectCommand(scene, copy));
    made.push(copy);
  }
  return made.length;
}

// Scatter N copies of the selected object randomly within a radius around
// its current position. Random Y rotation. Like Unity's foliage placement
// brush in a single click.
export function scatter(
  scene: Scene,
  history: History,
  count: number,
  radius: number,
): number {
  const sel = scene.selection;
  if (!sel) return 0;
  for (let i = 0; i < count; i++) {
    const copy = sel.clone(true);
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    copy.position.copy(sel.position);
    copy.position.x += Math.cos(angle) * r;
    copy.position.z += Math.sin(angle) * r;
    copy.rotation.y = Math.random() * Math.PI * 2;
    copy.name = `${sel.name}_s${i}`;
    history.push(new AddObjectCommand(scene, copy));
  }
  return count;
}

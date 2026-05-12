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

// "Extrude" the selected mesh along an axis by `amount` meters.
// This isn't true face-extrude (we don't have a half-edge mesh system yet),
// but for the blockout workflow it does what users expect: make the wall
// taller, the floor longer, the ramp wider — without re-scaling so origins
// behave naturally.
//
// Strategy:
//   - For a Box-shaped mesh: rebuild the BoxGeometry with the dimension on
//     the chosen axis grown by `amount`, then shift position by amount/2
//     along the same axis so the user's "anchor" stays put.
//   - For arbitrary geometry: clone the mesh, translate the clone by amount
//     along the axis, return the pair — fallback is a duplicate they can
//     then merge manually (TODO: wire boolean union here once that's stable
//     enough to be invisible to the user).
//
// Real face-extrude (click a face, drag the handle) lives behind a TODO in
// ROADMAP.md.
export function extrudeAlong(
  scene: Scene,
  history: History,
  axis: 'x' | 'y' | 'z',
  amount: number,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const mesh = sel as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const geom = mesh.geometry as THREE.BufferGeometry & {
    parameters?: { width?: number; height?: number; depth?: number };
    type?: string;
  };

  // BoxGeometry path — clean resize.
  if (geom?.type === 'BoxGeometry' && geom.parameters) {
    const w = geom.parameters.width ?? 1;
    const h = geom.parameters.height ?? 1;
    const d = geom.parameters.depth ?? 1;
    const before = {
      w,
      h,
      d,
      pos: mesh.position.clone(),
    };
    const next = { w, h, d, pos: mesh.position.clone() };
    if (axis === 'x') {
      next.w = w + amount;
      next.pos.x += amount * 0.5;
    } else if (axis === 'y') {
      next.h = h + amount;
      next.pos.y += amount * 0.5;
    } else {
      next.d = d + amount;
      next.pos.z += amount * 0.5;
    }

    const oldGeom = mesh.geometry;
    mesh.geometry = new THREE.BoxGeometry(next.w, next.h, next.d);
    mesh.position.copy(next.pos);

    history.record({
      label: `Extrude ${axis} +${amount}`,
      do: () => {
        mesh.geometry = new THREE.BoxGeometry(next.w, next.h, next.d);
        mesh.position.copy(next.pos);
      },
      undo: () => {
        mesh.geometry = oldGeom;
        mesh.position.copy(before.pos);
      },
    });
    scene.notifyChanged();
    return true;
  }

  // Fallback: just duplicate offset along the axis. Crude but visible.
  const copy = mesh.clone(true);
  copy.position[axis] += amount;
  copy.name = `${mesh.name}_extrude`;
  scene.addInternal(copy);
  scene.notifyChanged();
  return true;
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

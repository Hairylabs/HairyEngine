import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';
import { snapshotGeometry, restoreGeometry } from './MeshOps';

// UE5-style modeling tools — one-click operations that mutate the selected
// mesh in non-trivial ways. Each is undoable via the History stack. None of
// these require a half-edge cluster pick like FaceExtrude does; they apply
// to the whole geometry of the selected mesh.

/** Extrude the entire geometry along an axis by `amount` meters. For a
 *  BoxGeometry this is the same as the toolbar's grow-on-axis. For arbitrary
 *  meshes we offset every vertex in the +axis half by +amount/2 and in the
 *  -axis half by -amount/2, growing the shape symmetrically. This is the
 *  "extrude poly" feel UE5 ships in the Modeling Mode. */
export function extrudePoly(
  scene: Scene,
  history: History,
  axis: 'x' | 'y' | 'z',
  amount: number,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const mesh = sel as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const before = snapshotGeometry(mesh.geometry);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  // Split point = mesh centroid on this axis.
  let centroid = 0;
  for (let i = 0; i < pos.count; i++) {
    centroid += axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);
  }
  centroid /= pos.count;
  for (let i = 0; i < pos.count; i++) {
    const v = axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);
    const newV = v > centroid ? v + amount * 0.5 : v - amount * 0.5;
    if (axis === 'x') pos.setX(i, newV);
    else if (axis === 'y') pos.setY(i, newV);
    else pos.setZ(i, newV);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  const after = snapshotGeometry(mesh.geometry);
  history.record({
    label: `Extrude poly ${axis}`,
    do: () => restoreGeometry(mesh, after),
    undo: () => restoreGeometry(mesh, before),
  });
  scene.notifyChanged();
  return true;
}

/** Extrude the selected mesh along a sweep path — N clones spaced along a
 *  user-supplied path (here: a gentle sine curve so the result looks like a
 *  serpent or pipe). Each clone is an independent object so it stays editable. */
export function extrudePath(
  scene: Scene,
  history: History,
  steps = 8,
  spacing = 1.2,
  curveHeight = 0.4,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const made: THREE.Object3D[] = [];
  for (let i = 1; i <= steps; i++) {
    const copy = sel.clone(true);
    copy.position.copy(sel.position);
    copy.position.x += i * spacing;
    copy.position.y += Math.sin(i * 0.7) * curveHeight;
    copy.position.z += Math.cos(i * 0.4) * 0.3;
    copy.rotation.y += i * 0.15;
    copy.name = `${sel.name}_path${i}`;
    scene.addInternal(copy);
    made.push(copy);
  }
  history.record({
    label: `Extrude path ×${steps}`,
    do: () => made.forEach((m) => { if (!m.parent) scene.addInternal(m); }),
    undo: () => made.forEach((m) => scene.removeInternal(m)),
  });
  scene.notifyChanged();
  return true;
}

/** Warp the selected mesh — apply a sin-based bend on the Y axis. Vertices
 *  higher up rotate more, creating a "leaning" effect. UE5's Warp tool is
 *  more elaborate (multi-axis lattice control); this MVP gives a single
 *  visible bend that's enough to demonstrate the workflow. */
export function warpMesh(
  scene: Scene,
  history: History,
  amount = 0.5,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const mesh = sel as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const before = snapshotGeometry(mesh.geometry);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  // Find Y range so the bend is normalized regardless of mesh size.
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const range = Math.max(0.01, yMax - yMin);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y - yMin) / range; // 0 at bottom, 1 at top
    const angle = t * amount * Math.PI; // top tilts more
    const c = Math.cos(angle), s = Math.sin(angle);
    pos.setX(i, x * c - z * s);
    pos.setZ(i, x * s + z * c);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  const after = snapshotGeometry(mesh.geometry);
  history.record({
    label: 'Warp mesh',
    do: () => restoreGeometry(mesh, after),
    undo: () => restoreGeometry(mesh, before),
  });
  scene.notifyChanged();
  return true;
}

/** Apply a free-form lattice deformation — wraps the mesh in an 8-corner
 *  bounding cage and offsets the top corners inward, producing a tapered
 *  "obelisk" shape. UE5's Lattice is interactive; this is a one-shot taper
 *  the user can repeat or undo. Each call alternates between "taper" and
 *  "twist" so repeated clicks build up varied shapes. */
let latticeMode = 0;
export function latticeDeform(
  scene: Scene,
  history: History,
  amount = 0.25,
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const mesh = sel as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const before = snapshotGeometry(mesh.geometry);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;

  // Compute bbox to derive lattice axes.
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const xRange = Math.max(0.01, xMax - xMin);
  const yRange = Math.max(0.01, yMax - yMin);
  const zRange = Math.max(0.01, zMax - zMin);

  const op = latticeMode++ % 3; // 0=taper, 1=twist, 2=bulge

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ty = (y - yMin) / yRange;
    if (op === 0) {
      // Taper toward top: shrink x/z linearly with y.
      const scale = 1 - amount * ty;
      pos.setX(i, x * scale);
      pos.setZ(i, z * scale);
    } else if (op === 1) {
      // Twist around Y axis: rotation proportional to y.
      const angle = ty * amount * Math.PI;
      const c = Math.cos(angle), s = Math.sin(angle);
      pos.setX(i, x * c - z * s);
      pos.setZ(i, x * s + z * c);
    } else {
      // Bulge: push outward at middle Y.
      const bulge = Math.sin(ty * Math.PI) * amount;
      const r = Math.hypot(x, z);
      if (r > 0.001) {
        const scale = 1 + bulge;
        pos.setX(i, x * scale);
        pos.setZ(i, z * scale);
      }
    }
    void xRange; void zRange;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  const after = snapshotGeometry(mesh.geometry);
  const labels = ['Lattice taper', 'Lattice twist', 'Lattice bulge'];
  history.record({
    label: labels[op],
    do: () => restoreGeometry(mesh, after),
    undo: () => restoreGeometry(mesh, before),
  });
  scene.notifyChanged();
  return true;
}

/** Move the mesh's origin (pivot) to the center of its bounding box, keeping
 *  the visible geometry stationary in world space. UE5's "Edit Pivot" tool
 *  is what you reach for when a GLB came in with its pivot stuck in some
 *  random corner. Also offers a "drop to bottom" variant via the mode arg. */
export function editPivot(
  scene: Scene,
  history: History,
  mode: 'center' | 'bottom' = 'center',
): boolean {
  const sel = scene.selection;
  if (!sel) return false;
  const mesh = sel as THREE.Mesh;
  if (!mesh.isMesh) return false;

  // Compute bbox in mesh-local space so we can shift verts by the inverse.
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  const center = bb.getCenter(new THREE.Vector3());
  const offset = mode === 'center'
    ? center.clone()
    : new THREE.Vector3(center.x, bb.min.y, center.z);

  const before = snapshotGeometry(mesh.geometry);
  const beforePos = mesh.position.clone();
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) - offset.x,
      pos.getY(i) - offset.y,
      pos.getZ(i) - offset.z,
    );
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  // Shift the object so the world-space appearance doesn't change.
  const worldOffset = offset.clone().applyMatrix4(
    new THREE.Matrix4().extractRotation(mesh.matrixWorld),
  );
  worldOffset.multiply(mesh.scale);
  mesh.position.copy(beforePos).add(worldOffset);
  const after = snapshotGeometry(mesh.geometry);
  const afterPos = mesh.position.clone();
  history.record({
    label: mode === 'center' ? 'Pivot to center' : 'Pivot to bottom',
    do: () => {
      restoreGeometry(mesh, after);
      mesh.position.copy(afterPos);
    },
    undo: () => {
      restoreGeometry(mesh, before);
      mesh.position.copy(beforePos);
    },
  });
  scene.notifyChanged();
  return true;
}

import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';

// TODO (multi-select face mode): real Blender-style "click + shift-click to
// add another face, then E to extrude both" requires a full mesh-edit mode
// with a selection state distinct from drag state. The current widget
// conflates "click face" with "start drag" so multi-select would need
// either a) mode toggle (Tab in Blender → select, then E → extrude), or
// b) modifier-key disambiguation (shift-click extends, normal-click starts
// drag with current selection). For arbitrary GLBs we'd also want a real
// half-edge data structure — vendoring three-edit or porting mda is on the
// roadmap. Today: single coplanar cluster only.
import {
  canonicalizeForFaceOps,
  extrudeCluster,
  findCoplanarCluster,
  faceNormal,
  snapshotGeometry,
  restoreGeometry,
  Cluster,
} from './MeshOps';

// Sprint 6 (parts 1+2) — Face-mode selection + draggable normal-handle
// extrude widget that works on:
//   • BoxGeometry meshes (Cube/Wall/Floor) — fast resize path
//   • Arbitrary indexed triangle meshes (GLBs, CSG output, RoundedBox,
//     extruded results) — uses the half-edge-lite cluster extruder in
//     MeshOps.ts to do real topology operations.

type BoxFace = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

const FACE_NORMALS: Record<BoxFace, THREE.Vector3> = {
  '+x': new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  '+y': new THREE.Vector3(0, 1, 0),
  '-y': new THREE.Vector3(0, -1, 0),
  '+z': new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
};

type Listener = (mode: boolean) => void;

type BoxState = {
  kind: 'box';
  face: BoxFace;
  width: number;
  height: number;
  depth: number;
  position: THREE.Vector3;
};
type ClusterState = {
  kind: 'cluster';
  cluster: Cluster;
  geomBefore: ReturnType<typeof snapshotGeometry>;
  centerLocal: THREE.Vector3;
  normalLocal: THREE.Vector3;
  triExtent: { w: number; h: number }; // for sizing the overlay quad
};

export class FaceExtrude {
  private active = false;
  private hoverMesh: THREE.Mesh | null = null;
  private hoverState: BoxState | ClusterState | null = null;
  private dragging = false;
  private dragStartDistance = 0;
  private dragMesh: THREE.Mesh | null = null;
  private dragState: BoxState | ClusterState | null = null;
  private lastCommittedDistance = 0;

  private overlay: THREE.Mesh;
  private arrow: THREE.ArrowHelper;
  private label: HTMLDivElement;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private listeners: Listener[] = [];
  private dragPointerId: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private scene: Scene,
    private history: History,
  ) {
    const overlayMat = new THREE.MeshBasicMaterial({
      color: 0x4cf8c5,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat);
    this.overlay.visible = false;
    this.overlay.userData.deletable = false;
    this.overlay.userData.isFaceExtrudeHelper = true;
    this.overlay.renderOrder = 999;
    scene.three.add(this.overlay);

    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      1.5,
      0x4cf8c5,
      0.4,
      0.25,
    );
    this.arrow.visible = false;
    this.arrow.userData.deletable = false;
    this.arrow.userData.isFaceExtrudeHelper = true;
    scene.three.add(this.arrow);

    this.label = document.createElement('div');
    this.label.className = 'face-extrude-label';
    this.label.hidden = true;
    document.body.appendChild(this.label);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dragging) this.cancel();
    });
  }

  isActive(): boolean {
    return this.active;
  }

  onChange(l: Listener) {
    this.listeners.push(l);
  }

  setActive(on: boolean) {
    this.active = on;
    if (!on) {
      this.clearHover();
      this.dragging = false;
    }
    this.listeners.forEach((l) => l(on));
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.dragging) {
      this.updateDrag();
      return;
    }
    this.pickFace();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    if (!this.hoverMesh || !this.hoverState) {
      console.log('[FaceExtrude] click ignored — no hover face');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.dragPointerId = e.pointerId;
    this.dragMesh = this.hoverMesh;
    this.dragState = this.hoverState;
    this.dragStartDistance = this.projectedDistance();
    this.lastCommittedDistance = 0;
    this.dragging = true;
    this.label.hidden = false;
    console.log('[FaceExtrude] drag start', { mesh: this.dragMesh.name, kind: this.dragState.kind });
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      if (this.dragPointerId !== null) this.canvas.releasePointerCapture(this.dragPointerId);
    } catch {
      /* ignore */
    }
    this.dragPointerId = null;
    this.commitDrag();
  };

  private pickFace() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.editable.children, true);
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      const geom = mesh.geometry as THREE.BufferGeometry & {
        parameters?: { width?: number; height?: number; depth?: number };
        type?: string;
      };
      if (!mesh.isMesh || !geom) continue;
      if (!hit.face) continue;

      if (geom.type === 'BoxGeometry' && geom.parameters) {
        const face = boxFaceFromNormal(hit.face.normal);
        if (!face) continue;
        this.setHoverBox(mesh, face);
        return;
      }

      // Arbitrary mesh — use cluster extrude. faceIndex is the triangle index.
      if (typeof hit.faceIndex === 'number') {
        const canon = canonicalizeForFaceOps(geom);
        const cluster = findCoplanarCluster(canon, hit.faceIndex);
        const center = clusterCenter(canon, cluster);
        const extent = clusterExtent(canon, cluster, cluster.normal);
        this.setHoverCluster(mesh, canon, cluster, center, extent);
        return;
      }
    }
    this.clearHover();
  }

  private setHoverBox(mesh: THREE.Mesh, face: BoxFace) {
    const geom = mesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    this.hoverMesh = mesh;
    this.hoverState = {
      kind: 'box',
      face,
      width: geom.parameters.width,
      height: geom.parameters.height,
      depth: geom.parameters.depth,
      position: mesh.position.clone(),
    };
    this.positionHelperBox(mesh, face);
    this.overlay.visible = true;
    this.arrow.visible = true;
    (this.overlay.material as THREE.MeshBasicMaterial).color.set(
      this.dragging ? 0xff3a8c : 0x4cf8c5,
    );
    this.arrow.setColor(this.dragging ? 0xff3a8c : 0x4cf8c5);
  }

  private setHoverCluster(
    mesh: THREE.Mesh,
    canonGeom: THREE.BufferGeometry,
    cluster: Cluster,
    center: THREE.Vector3,
    extent: { w: number; h: number },
  ) {
    this.hoverMesh = mesh;
    this.hoverState = {
      kind: 'cluster',
      cluster,
      geomBefore: snapshotGeometry(canonGeom),
      centerLocal: center,
      normalLocal: cluster.normal.clone(),
      triExtent: extent,
    };
    // Position helpers in world space.
    mesh.updateMatrixWorld(true);
    const centerWorld = center.clone().applyMatrix4(mesh.matrixWorld);
    const normalWorld = cluster.normal.clone()
      .transformDirection(mesh.matrixWorld).normalize();
    this.overlay.position.copy(centerWorld).addScaledVector(normalWorld, 0.002);
    this.overlay.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normalWorld,
    );
    this.overlay.scale.set(
      Math.max(0.1, extent.w * 1.05),
      Math.max(0.1, extent.h * 1.05),
      1,
    );
    this.overlay.visible = true;
    this.arrow.visible = true;
    this.arrow.position.copy(centerWorld);
    this.arrow.setDirection(normalWorld);
    (this.overlay.material as THREE.MeshBasicMaterial).color.set(
      this.dragging ? 0xff3a8c : 0x4cf8c5,
    );
    this.arrow.setColor(this.dragging ? 0xff3a8c : 0x4cf8c5);
  }

  private clearHover() {
    this.hoverMesh = null;
    this.hoverState = null;
    this.overlay.visible = false;
    this.arrow.visible = false;
    this.label.hidden = true;
  }

  private positionHelperBox(mesh: THREE.Mesh, face: BoxFace) {
    mesh.updateMatrixWorld(true);
    const geom = mesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    const { width: w, height: h, depth: d } = geom.parameters;
    const normalLocal = FACE_NORMALS[face].clone();
    const center = new THREE.Vector3(
      normalLocal.x * w * 0.5,
      normalLocal.y * h * 0.5,
      normalLocal.z * d * 0.5,
    );
    center.applyMatrix4(mesh.matrixWorld);
    const normalWorld = normalLocal.clone()
      .transformDirection(mesh.matrixWorld).normalize();
    this.overlay.position.copy(center);
    this.overlay.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normalWorld,
    );
    let qw = w, qh = h;
    if (face === '+x' || face === '-x') { qw = d; qh = h; }
    else if (face === '+y' || face === '-y') { qw = w; qh = d; }
    else { qw = w; qh = h; }
    this.overlay.scale.set(qw * 1.001, qh * 1.001, 1);
    this.overlay.position.addScaledVector(normalWorld, 0.002);
    this.arrow.position.copy(center);
    this.arrow.setDirection(normalWorld);
  }

  /** Distance from pointer to the current face plane, projected along normal. */
  private projectedDistance(): number {
    if (!this.dragMesh || !this.dragState) return 0;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { center, normal } = this.dragAnchor();
    const u = this.raycaster.ray.direction;
    const v = normal;
    const w0 = this.raycaster.ray.origin.clone().sub(center);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d0 = u.dot(w0);
    const e0 = v.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return 0;
    return (a * e0 - b * d0) / denom;
  }

  /** World-space face anchor (center + outward normal) for the current drag. */
  private dragAnchor(): { center: THREE.Vector3; normal: THREE.Vector3 } {
    const mesh = this.dragMesh!;
    const state = this.dragState!;
    mesh.updateMatrixWorld(true);
    if (state.kind === 'box') {
      const { face } = state;
      const w = state.width, h = state.height, d = state.depth;
      const normalLocal = FACE_NORMALS[face].clone();
      const center = new THREE.Vector3(
        normalLocal.x * w * 0.5,
        normalLocal.y * h * 0.5,
        normalLocal.z * d * 0.5,
      );
      // Use the snapshotted position so the anchor stays put while extruding.
      const m = new THREE.Matrix4().compose(state.position, mesh.quaternion, mesh.scale);
      center.applyMatrix4(m);
      const normal = normalLocal.transformDirection(mesh.matrixWorld).normalize();
      return { center, normal };
    } else {
      const center = state.centerLocal.clone().applyMatrix4(mesh.matrixWorld);
      const normal = state.normalLocal.clone()
        .transformDirection(mesh.matrixWorld).normalize();
      return { center, normal };
    }
  }

  private updateDrag() {
    if (!this.dragMesh || !this.dragState) return;
    let t = this.projectedDistance() - this.dragStartDistance;
    if ((window.event as KeyboardEvent | undefined)?.ctrlKey) {
      t = Math.round(t * 4) / 4;
    }
    this.applyExtrude(t);
    this.lastCommittedDistance = t;

    this.label.textContent = `${t >= 0 ? '+' : ''}${t.toFixed(2)} m`;
    const { center, normal } = this.dragAnchor();
    const head = center.clone().addScaledVector(normal, 1.5);
    const projected = head.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    this.label.style.left = `${rect.left + ((projected.x + 1) * 0.5) * rect.width + 12}px`;
    this.label.style.top = `${rect.top + ((1 - projected.y) * 0.5) * rect.height - 10}px`;
  }

  private applyExtrude(distance: number) {
    if (!this.dragMesh || !this.dragState) return;
    if (this.dragState.kind === 'box') {
      this.applyExtrudeBox(distance, this.dragState);
    } else {
      this.applyExtrudeCluster(distance, this.dragState);
    }
  }

  private applyExtrudeBox(distance: number, snap: BoxState) {
    let axisMin: number, axisMax: number;
    const next = { w: snap.width, h: snap.height, d: snap.depth, pos: snap.position.clone() };
    switch (snap.face) {
      case '+x': {
        const opp = snap.position.x - snap.width * 0.5;
        const moved = snap.position.x + snap.width * 0.5 + distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.w = Math.max(0.01, axisMax - axisMin);
        next.pos.x = (axisMin + axisMax) * 0.5; break;
      }
      case '-x': {
        const opp = snap.position.x + snap.width * 0.5;
        const moved = snap.position.x - snap.width * 0.5 - distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.w = Math.max(0.01, axisMax - axisMin);
        next.pos.x = (axisMin + axisMax) * 0.5; break;
      }
      case '+y': {
        const opp = snap.position.y - snap.height * 0.5;
        const moved = snap.position.y + snap.height * 0.5 + distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.h = Math.max(0.01, axisMax - axisMin);
        next.pos.y = (axisMin + axisMax) * 0.5; break;
      }
      case '-y': {
        const opp = snap.position.y + snap.height * 0.5;
        const moved = snap.position.y - snap.height * 0.5 - distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.h = Math.max(0.01, axisMax - axisMin);
        next.pos.y = (axisMin + axisMax) * 0.5; break;
      }
      case '+z': {
        const opp = snap.position.z - snap.depth * 0.5;
        const moved = snap.position.z + snap.depth * 0.5 + distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.d = Math.max(0.01, axisMax - axisMin);
        next.pos.z = (axisMin + axisMax) * 0.5; break;
      }
      case '-z': {
        const opp = snap.position.z + snap.depth * 0.5;
        const moved = snap.position.z - snap.depth * 0.5 - distance;
        axisMin = Math.min(opp, moved); axisMax = Math.max(opp, moved);
        next.d = Math.max(0.01, axisMax - axisMin);
        next.pos.z = (axisMin + axisMax) * 0.5; break;
      }
    }
    this.dragMesh!.geometry.dispose();
    this.dragMesh!.geometry = new THREE.BoxGeometry(next.w, next.h, next.d);
    this.dragMesh!.position.copy(next.pos);
  }

  private applyExtrudeCluster(distance: number, state: ClusterState) {
    // Restore original then re-extrude — simpler than incremental + safe.
    restoreGeometry(this.dragMesh!, state.geomBefore);
    const canon = canonicalizeForFaceOps(this.dragMesh!.geometry);
    this.dragMesh!.geometry.dispose();
    this.dragMesh!.geometry = canon;
    extrudeCluster(this.dragMesh!, state.cluster, distance);
  }

  private commitDrag() {
    if (!this.dragMesh || !this.dragState) {
      this.dragging = false;
      this.label.hidden = true;
      return;
    }
    const state = this.dragState;
    const mesh = this.dragMesh;
    const distance = this.lastCommittedDistance;
    if (Math.abs(distance) > 0.001) {
      if (state.kind === 'box') {
        const before = state;
        const finalGeom = mesh.geometry as THREE.BoxGeometry & {
          parameters: { width: number; height: number; depth: number };
        };
        const after = {
          width: finalGeom.parameters.width,
          height: finalGeom.parameters.height,
          depth: finalGeom.parameters.depth,
          position: mesh.position.clone(),
        };
        this.history.record({
          label: `Extrude ${before.face}`,
          do: () => {
            mesh.geometry.dispose();
            mesh.geometry = new THREE.BoxGeometry(after.width, after.height, after.depth);
            mesh.position.copy(after.position);
          },
          undo: () => {
            mesh.geometry.dispose();
            mesh.geometry = new THREE.BoxGeometry(before.width, before.height, before.depth);
            mesh.position.copy(before.position);
          },
        });
      } else {
        const before = state.geomBefore;
        const after = snapshotGeometry(mesh.geometry);
        this.history.record({
          label: 'Extrude face cluster',
          do: () => restoreGeometry(mesh, after),
          undo: () => restoreGeometry(mesh, before),
        });
      }
      this.scene.notifyChanged();
    }
    this.dragging = false;
    this.dragMesh = null;
    this.dragState = null;
    this.label.hidden = true;
  }

  cancel() {
    if (!this.dragMesh || !this.dragState) return;
    if (this.dragState.kind === 'box') {
      this.dragMesh.geometry.dispose();
      this.dragMesh.geometry = new THREE.BoxGeometry(
        this.dragState.width,
        this.dragState.height,
        this.dragState.depth,
      );
      this.dragMesh.position.copy(this.dragState.position);
    } else {
      restoreGeometry(this.dragMesh, this.dragState.geomBefore);
    }
    this.dragging = false;
    this.dragMesh = null;
    this.dragState = null;
    this.label.hidden = true;
  }
}

function boxFaceFromNormal(n: THREE.Vector3): BoxFace | null {
  const eps = 0.5;
  if (n.x > eps) return '+x';
  if (n.x < -eps) return '-x';
  if (n.y > eps) return '+y';
  if (n.y < -eps) return '-y';
  if (n.z > eps) return '+z';
  if (n.z < -eps) return '-z';
  return null;
}

function clusterCenter(geom: THREE.BufferGeometry, cluster: Cluster): THREE.Vector3 {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index as THREE.BufferAttribute;
  const seen = new Set<number>();
  const out = new THREE.Vector3();
  for (const t of cluster.faceIndices) {
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k);
      if (seen.has(v)) continue;
      seen.add(v);
      out.x += pos.getX(v);
      out.y += pos.getY(v);
      out.z += pos.getZ(v);
    }
  }
  if (seen.size > 0) out.multiplyScalar(1 / seen.size);
  return out;
}

function clusterExtent(
  geom: THREE.BufferGeometry,
  cluster: Cluster,
  normal: THREE.Vector3,
): { w: number; h: number } {
  // Project all cluster verts to a 2D plane orthogonal to normal, find extent.
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index as THREE.BufferAttribute;
  // Pick any axis not parallel to normal as basis.
  const u = Math.abs(normal.y) < 0.95
    ? new THREE.Vector3(0, 1, 0).cross(normal).normalize()
    : new THREE.Vector3(1, 0, 0).cross(normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  const seen = new Set<number>();
  const p = new THREE.Vector3();
  for (const t of cluster.faceIndices) {
    for (let k = 0; k < 3; k++) {
      const vi = idx.getX(t * 3 + k);
      if (seen.has(vi)) continue;
      seen.add(vi);
      p.fromBufferAttribute(pos, vi);
      const uu = p.dot(u), vv = p.dot(v);
      if (uu < umin) umin = uu;
      if (uu > umax) umax = uu;
      if (vv < vmin) vmin = vv;
      if (vv > vmax) vmax = vv;
    }
  }
  return { w: Math.max(0.1, umax - umin), h: Math.max(0.1, vmax - vmin) };
}

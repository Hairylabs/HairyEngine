import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';

// Sprint 6 — Face-mode selection + draggable normal-handle extrude widget.
//
// Scope: works on Three.js BoxGeometry meshes (Cube, Wall, Floor, Ramp,
// Stairs steps, Kenney crates if they're boxes, etc.). For arbitrary
// triangle soup we'd need a half-edge mesh layer (deferred — mda is
// unmaintained and pulled from npm; see docs/SPRINT6_MESH_EDITING.md).
//
// Workflow the user sees:
//   1. Click ◫ Face Mode in the toolbar (or press 3).
//   2. Hover a BoxGeometry mesh — the face under the cursor lights up cyan.
//   3. Click → the face stays orange + a fat arrow appears along the
//      normal pointing outward.
//   4. Drag the arrow → live ghost preview of the box growing/shrinking.
//   5. Release → commit (undoable). ESC cancels mid-drag.

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

export class FaceExtrude {
  private active = false;
  private hoverMesh: THREE.Mesh | null = null;
  private hoverFace: BoxFace | null = null;
  private dragging = false;
  private dragStartDistance = 0;
  private dragFace: BoxFace | null = null;
  private dragMesh: THREE.Mesh | null = null;
  private dragSnapshot: {
    width: number;
    height: number;
    depth: number;
    position: THREE.Vector3;
  } | null = null;
  private lastCommittedDistance = 0;

  private overlay: THREE.Mesh;
  private arrow: THREE.ArrowHelper;
  private label: HTMLDivElement;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private listeners: Listener[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private scene: Scene,
    private history: History,
  ) {
    // Translucent cyan overlay that snaps to whichever face is hovered/selected.
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

    // A bold arrow that lives at the face center along the outward normal.
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

    // Floating distance label that appears next to the arrow during drag.
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
    if (!this.hoverMesh || !this.hoverFace) {
      console.log('[FaceExtrude] click ignored — no hover face');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Capture the pointer so the TransformControls / Viewport picking handlers
    // can't steal pointermoves / pointerups mid-drag.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // older versions ignore
    }
    this.dragPointerId = e.pointerId;
    this.dragMesh = this.hoverMesh;
    this.dragFace = this.hoverFace;
    const geom = this.dragMesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    this.dragSnapshot = {
      width: geom.parameters.width,
      height: geom.parameters.height,
      depth: geom.parameters.depth,
      position: this.dragMesh.position.clone(),
    };
    this.dragStartDistance = this.projectedDistance(e);
    this.lastCommittedDistance = 0;
    this.dragging = true;
    this.label.hidden = false;
    console.log('[FaceExtrude] drag start', {
      mesh: this.dragMesh.name,
      face: this.dragFace,
      before: { w: geom.parameters.width, h: geom.parameters.height, d: geom.parameters.depth },
      startDistance: this.dragStartDistance,
    });
  };

  private dragPointerId: number | null = null;

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      if (this.dragPointerId !== null) {
        this.canvas.releasePointerCapture(this.dragPointerId);
      }
    } catch {
      // ignore
    }
    this.dragPointerId = null;
    this.commitDrag();
  };

  private pickFace() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.scene.editable.children,
      true,
    );
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      const geom = mesh.geometry as
        | (THREE.BoxGeometry & { parameters?: { width?: number; height?: number; depth?: number }; type?: string })
        | undefined;
      if (!mesh.isMesh || !geom || geom.type !== 'BoxGeometry') continue;
      if (!hit.face) continue;
      // Box faces have normals exactly along ±x/±y/±z in local space.
      const n = hit.face.normal;
      const face = boxFaceFromNormal(n);
      if (!face) continue;
      this.setHover(mesh, face);
      return;
    }
    this.clearHover();
  }

  private setHover(mesh: THREE.Mesh, face: BoxFace) {
    this.hoverMesh = mesh;
    this.hoverFace = face;
    this.positionHelperFor(mesh, face);
    this.overlay.visible = true;
    this.arrow.visible = true;
    // Hover = cyan; selected = orange (during drag).
    (this.overlay.material as THREE.MeshBasicMaterial).color.set(
      this.dragging ? 0xff3a8c : 0x4cf8c5,
    );
    this.arrow.setColor(this.dragging ? 0xff3a8c : 0x4cf8c5);
  }

  private clearHover() {
    this.hoverMesh = null;
    this.hoverFace = null;
    this.overlay.visible = false;
    this.arrow.visible = false;
    this.label.hidden = true;
  }

  /** Position the cyan overlay quad + arrow on the named face of mesh. */
  private positionHelperFor(mesh: THREE.Mesh, face: BoxFace) {
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
    const normalWorld = normalLocal
      .clone()
      .transformDirection(mesh.matrixWorld)
      .normalize();
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
    // Tiny bump along the normal so the overlay sits outside the face and
    // doesn't z-fight with the box surface.
    this.overlay.position.addScaledVector(normalWorld, 0.002);

    this.arrow.position.copy(center);
    this.arrow.setDirection(normalWorld);
  }

  private projectedDistance(e: PointerEvent): number {
    // Convert the current pointer position to a distance along the face
    // normal, measured from the face origin. We project the pointer ray
    // onto the line through `center` along `normalWorld`.
    if (!this.dragMesh || !this.dragFace) return 0;
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const py = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(px, py), this.camera);

    const geom = this.dragMesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    const { width: w, height: h, depth: d } = geom.parameters;
    const normalLocal = FACE_NORMALS[this.dragFace].clone();
    const center = new THREE.Vector3(
      normalLocal.x * w * 0.5,
      normalLocal.y * h * 0.5,
      normalLocal.z * d * 0.5,
    );
    center.applyMatrix4(this.dragMesh.matrixWorld);
    const normalWorld = normalLocal
      .clone()
      .transformDirection(this.dragMesh.matrixWorld)
      .normalize();

    // Closest point on the ray to the infinite line through `center` along `normalWorld`.
    // Standard closest-points-on-two-lines math: solves for t on the normal line.
    const u = this.raycaster.ray.direction;
    const v = normalWorld;
    const w0 = this.raycaster.ray.origin.clone().sub(center);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d0 = u.dot(w0);
    const e0 = v.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return 0;
    const tOnNormal = (a * e0 - b * d0) / denom;
    return tOnNormal;
  }

  private updateDrag() {
    if (!this.dragMesh || !this.dragFace || !this.dragSnapshot) return;
    const pe = (window as unknown as { event?: PointerEvent }).event;
    void pe;
    // We don't have the PointerEvent in this scope — recompute distance from
    // the cached pointer NDC by projecting back through the raycaster.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const geom = this.dragMesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    const { width: w, height: h, depth: d } = geom.parameters;
    const normalLocal = FACE_NORMALS[this.dragFace].clone();
    const snapPosLocal = new THREE.Vector3(
      normalLocal.x * (this.dragSnapshot.width * 0.5),
      normalLocal.y * (this.dragSnapshot.height * 0.5),
      normalLocal.z * (this.dragSnapshot.depth * 0.5),
    );
    const snapPosWorld = snapPosLocal
      .applyMatrix4(
        new THREE.Matrix4()
          .compose(
            this.dragSnapshot.position,
            this.dragMesh.quaternion,
            this.dragMesh.scale,
          ),
      );
    const normalWorld = normalLocal
      .clone()
      .transformDirection(this.dragMesh.matrixWorld)
      .normalize();
    const u = this.raycaster.ray.direction;
    const v = normalWorld;
    const w0 = this.raycaster.ray.origin.clone().sub(snapPosWorld);
    const a = u.dot(u);
    const bb = u.dot(v);
    const cc = v.dot(v);
    const d0 = u.dot(w0);
    const e0 = v.dot(w0);
    const denom = a * cc - bb * bb;
    if (Math.abs(denom) < 1e-6) return;
    let t = (a * e0 - bb * d0) / denom - this.dragStartDistance;
    // Ctrl-snap to 0.25m increments — matches the editor's grid feel.
    if ((window.event as KeyboardEvent | undefined)?.ctrlKey) {
      t = Math.round(t * 4) / 4;
    }
    this.applyExtrude(t);
    this.lastCommittedDistance = t;
    void w; void h; void d;

    // Update label
    this.label.textContent = `${t >= 0 ? '+' : ''}${t.toFixed(2)} m`;
    // Position label near the arrow head in screen-space.
    const head = this.arrow.position
      .clone()
      .addScaledVector(normalWorld, 1.5);
    const projected = head.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    this.label.style.left = `${rect.left + ((projected.x + 1) * 0.5) * rect.width + 12}px`;
    this.label.style.top = `${rect.top + ((1 - projected.y) * 0.5) * rect.height - 10}px`;

    this.setHover(this.dragMesh, this.dragFace);
  }

  private applyExtrude(distance: number) {
    if (!this.dragMesh || !this.dragFace || !this.dragSnapshot) return;
    const next = {
      w: this.dragSnapshot.width,
      h: this.dragSnapshot.height,
      d: this.dragSnapshot.depth,
      pos: this.dragSnapshot.position.clone(),
    };
    const half = distance * 0.5;
    switch (this.dragFace) {
      case '+x':
        next.w = Math.max(0.01, this.dragSnapshot.width + distance);
        next.pos.x += half;
        break;
      case '-x':
        next.w = Math.max(0.01, this.dragSnapshot.width + distance);
        next.pos.x -= half;
        break;
      case '+y':
        next.h = Math.max(0.01, this.dragSnapshot.height + distance);
        next.pos.y += half;
        break;
      case '-y':
        next.h = Math.max(0.01, this.dragSnapshot.height + distance);
        next.pos.y -= half;
        break;
      case '+z':
        next.d = Math.max(0.01, this.dragSnapshot.depth + distance);
        next.pos.z += half;
        break;
      case '-z':
        next.d = Math.max(0.01, this.dragSnapshot.depth + distance);
        next.pos.z -= half;
        break;
    }
    this.dragMesh.geometry.dispose();
    this.dragMesh.geometry = new THREE.BoxGeometry(next.w, next.h, next.d);
    this.dragMesh.position.copy(next.pos);
  }

  private commitDrag() {
    if (!this.dragMesh || !this.dragSnapshot) {
      console.log('[FaceExtrude] commit skipped — no drag state');
      return;
    }
    const mesh = this.dragMesh;
    const before = this.dragSnapshot;
    const finalGeom = mesh.geometry as THREE.BoxGeometry & {
      parameters: { width: number; height: number; depth: number };
    };
    const after = {
      width: finalGeom.parameters.width,
      height: finalGeom.parameters.height,
      depth: finalGeom.parameters.depth,
      position: mesh.position.clone(),
    };
    console.log('[FaceExtrude] commit', {
      mesh: mesh.name,
      face: this.dragFace,
      before: { w: before.width, h: before.height, d: before.depth, pos: before.position.toArray() },
      after: { w: after.width, h: after.height, d: after.depth, pos: after.position.toArray() },
    });
    // If the user didn't actually drag (Blender E-then-Esc footgun fix),
    // bail without polluting the undo stack.
    const moved =
      Math.abs(after.width - before.width) > 0.001 ||
      Math.abs(after.height - before.height) > 0.001 ||
      Math.abs(after.depth - before.depth) > 0.001;
    if (moved) {
      this.history.record({
        label: `Extrude ${this.dragFace}`,
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
      this.scene.notifyChanged();
    }
    this.dragging = false;
    this.dragMesh = null;
    this.dragFace = null;
    this.dragSnapshot = null;
    this.label.hidden = true;
  }

  /** Cancel an in-progress drag, restoring the original geometry. */
  cancel() {
    if (!this.dragMesh || !this.dragSnapshot) return;
    this.dragMesh.geometry.dispose();
    this.dragMesh.geometry = new THREE.BoxGeometry(
      this.dragSnapshot.width,
      this.dragSnapshot.height,
      this.dragSnapshot.depth,
    );
    this.dragMesh.position.copy(this.dragSnapshot.position);
    this.dragging = false;
    this.dragMesh = null;
    this.dragFace = null;
    this.dragSnapshot = null;
    this.label.hidden = true;
  }
}

function boxFaceFromNormal(n: THREE.Vector3): BoxFace | null {
  // The face's local normal will be exactly one of ±x/±y/±z for BoxGeometry.
  // We compare with a tolerance to absorb floating-point drift.
  const eps = 0.5;
  if (n.x > eps) return '+x';
  if (n.x < -eps) return '-x';
  if (n.y > eps) return '+y';
  if (n.y < -eps) return '-y';
  if (n.z > eps) return '+z';
  if (n.z < -eps) return '-z';
  return null;
}

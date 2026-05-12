import * as THREE from 'three';
import { Scene } from './Scene';

// Sprint 5 v3 — Hammer-style 2D top-down viewport split.
// A second canvas overlaid on the right half of the viewport, rendering the
// same Scene through an orthographic camera looking straight down. Click +
// drag-rectangle pans; wheel zooms; double-click frames the scene. Clicking
// an object picks it the same way the main viewport does (uses the Scene's
// selection model — selection stays in sync across both views).

export type SyncSelect = (obj: THREE.Object3D | null) => void;

export class TopDownView {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private active = false;
  private viewSize = 30; // half-extent in meters
  private container: HTMLDivElement;
  private panState = { dragging: false, lastX: 0, lastY: 0 };
  private downAt = { x: 0, y: 0, t: 0 };
  private selectedBoxHelper: THREE.Box3Helper | null = null;

  constructor(
    private hostEl: HTMLElement,
    private scene: Scene,
    private syncSelect: SyncSelect,
  ) {
    // The topdown pane is now a sibling of the main viewport pane, sized by
    // the parent's CSS grid (.viewport.has-topdown). We just mount our
    // canvas + label inside the existing #viewport-topdown div.
    const paneSlot = document.getElementById('viewport-topdown');
    if (!paneSlot) throw new Error('TopDownView: #viewport-topdown not in DOM');
    this.container = paneSlot as HTMLDivElement;
    this.container.innerHTML = '';
    this.container.hidden = true;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'topdown-canvas';
    this.container.appendChild(this.canvas);
    const labelEl = document.createElement('div');
    labelEl.className = 'topdown-label';
    labelEl.textContent = '▤ Top-Down · RMB drag pans · wheel zooms · dbl-click frames all';
    this.container.appendChild(labelEl);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x12161d, 1);

    this.camera = new THREE.OrthographicCamera(
      -this.viewSize, this.viewSize,
      this.viewSize, -this.viewSize,
      0.1, 200,
    );
    this.camera.position.set(0, 50, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    this.bindEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  setActive(on: boolean) {
    this.active = on;
    this.container.hidden = !on;
    this.hostEl.classList.toggle('has-topdown', on);
    if (on) {
      // Resize on next frame after layout has updated for the new grid.
      requestAnimationFrame(() => {
        this.resize();
        this.frameAll();
      });
    }
  }

  isActive(): boolean {
    return this.active;
  }

  tick() {
    if (!this.active) return;
    // Re-check size each tick — getBoundingClientRect is robust against
    // layout glitches that aren't caught by ResizeObserver alone.
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const cw = Math.round(rect.width);
      const ch = Math.round(rect.height);
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.resize();
      }
    }
    // Keep the box helper synced to the selected object's bounds.
    const sel = this.scene.selection;
    if (this.selectedBoxHelper) {
      this.scene.three.remove(this.selectedBoxHelper);
      this.selectedBoxHelper = null;
    }
    if (sel) {
      const box = new THREE.Box3().setFromObject(sel);
      if (!box.isEmpty()) {
        this.selectedBoxHelper = new THREE.Box3Helper(box, new THREE.Color(0x4cf8c5));
        this.selectedBoxHelper.userData.isTopDownHelper = true;
        this.selectedBoxHelper.userData.deletable = false;
        this.scene.three.add(this.selectedBoxHelper);
      }
    }
    this.renderer.render(this.scene.three, this.camera);
  }

  private bindEvents() {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      this.viewSize = Math.max(2, Math.min(120, this.viewSize * factor));
      this.updateCameraFrustum();
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      } else if (e.button === 2 || e.button === 1) {
        // Right or middle button → pan
        this.panState.dragging = true;
        this.panState.lastX = e.clientX;
        this.panState.lastY = e.clientY;
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.panState.dragging) {
        const dx = e.clientX - this.panState.lastX;
        const dy = e.clientY - this.panState.lastY;
        this.panState.lastX = e.clientX;
        this.panState.lastY = e.clientY;
        const rect = this.canvas.getBoundingClientRect();
        const meterPerPxX = (this.viewSize * 2) / rect.width;
        const meterPerPxZ = (this.viewSize * 2) / rect.height;
        // World X = camera X (right). World Z = -screen Y (up on screen = -Z).
        this.camera.position.x -= dx * meterPerPxX;
        this.camera.position.z -= dy * meterPerPxZ;
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (this.panState.dragging && (e.button === 1 || e.button === 2)) {
        this.panState.dragging = false;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* */ }
        return;
      }
      if (e.button === 0) {
        const dx = e.clientX - this.downAt.x;
        const dy = e.clientY - this.downAt.y;
        const dt = performance.now() - this.downAt.t;
        if (dx * dx + dy * dy > 9 || dt > 400) return;
        this.pick(e);
      }
    });

    this.canvas.addEventListener('dblclick', () => this.frameAll());
  }

  private pick(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.editable.children, true);
    if (hits.length === 0) {
      this.syncSelect(null);
      return;
    }
    let hit: THREE.Object3D = hits[0].object;
    while (hit.parent && hit.parent !== this.scene.editable) hit = hit.parent;
    this.syncSelect(hit);
  }

  private frameAll() {
    const box = new THREE.Box3().setFromObject(this.scene.editable);
    if (box.isEmpty()) {
      this.viewSize = 30;
      this.camera.position.set(0, 50, 0);
      this.updateCameraFrustum();
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.camera.position.x = center.x;
    this.camera.position.z = center.z;
    this.viewSize = Math.max(2, Math.max(size.x, size.z) * 0.6 + 2);
    this.updateCameraFrustum();
  }

  private updateCameraFrustum() {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    this.camera.left = -this.viewSize * aspect;
    this.camera.right = this.viewSize * aspect;
    this.camera.top = this.viewSize;
    this.camera.bottom = -this.viewSize;
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.renderer.setSize(rect.width, rect.height, false);
    // Also pin the canvas to fill via inline style — defensive against any
    // CSS leftover that might force a 0-height.
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.updateCameraFrustum();
  }
}

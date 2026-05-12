import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Translate / rotate / scale gizmo around the current selection.
// Hotkeys (when no input is focused):
//   W — translate
//   E — rotate
//   R — scale
//   Esc — clear selection
// Hold Ctrl/Cmd while dragging for snap (0.25 units / 15° / 0.1 scale).
// The gizmo emits 'dragging-changed' so the editor camera can pause flying
// while a handle is being dragged.

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type DraggingListener = (dragging: boolean) => void;
export type ModeListener = (mode: GizmoMode) => void;

export class Gizmo {
  readonly controls: TransformControls;
  private modeListeners: ModeListener[] = [];
  private draggingListeners: DraggingListener[] = [];

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    scene: THREE.Scene,
  ) {
    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(0.9);
    this.controls.setTranslationSnap(null);
    this.controls.setRotationSnap(null);
    this.controls.setScaleSnap(null);

    // r171: TransformControls is a Controls instance, its visual is a helper.
    const helper = this.controls.getHelper();
    helper.userData.deletable = false;
    helper.userData.gizmo = true;
    scene.add(helper);

    this.controls.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.draggingListeners.forEach((l) => l(dragging));
    });

    this.bindHotkeys();
  }

  attach(obj: THREE.Object3D | null) {
    if (obj) {
      this.controls.attach(obj);
    } else {
      this.controls.detach();
    }
  }

  setMode(mode: GizmoMode) {
    this.controls.setMode(mode);
    this.modeListeners.forEach((l) => l(mode));
  }

  onModeChanged(l: ModeListener) {
    this.modeListeners.push(l);
  }

  onDraggingChanged(l: DraggingListener) {
    this.draggingListeners.push(l);
  }

  setSnapping(enabled: boolean) {
    if (enabled) {
      this.controls.setTranslationSnap(this.gridSize);
      this.controls.setRotationSnap(THREE.MathUtils.degToRad(15));
      this.controls.setScaleSnap(0.1);
    } else {
      this.controls.setTranslationSnap(null);
      this.controls.setRotationSnap(null);
      this.controls.setScaleSnap(null);
    }
  }

  /** Toggle between snap-always-on (level builder mode) and snap-on-Ctrl. */
  setAlwaysSnap(on: boolean, gridSize = 1.0) {
    this.gridSize = gridSize;
    this.alwaysSnap = on;
    this.setSnapping(on);
  }

  isAlwaysSnap(): boolean {
    return this.alwaysSnap;
  }

  private gridSize = 0.25;
  private alwaysSnap = false;

  private bindHotkeys() {
    window.addEventListener('keydown', (e) => {
      if (this.isEditable(e.target)) return;
      switch (e.key.toLowerCase()) {
        case 'w':
          // Only switch gizmo mode if right-mouse isn't held (then W = fly forward).
          if (!e.repeat && !this.flying()) this.setMode('translate');
          break;
        case 'e':
          if (!e.repeat && !this.flying()) this.setMode('rotate');
          break;
        case 'r':
          if (!e.repeat && !this.flying()) this.setMode('scale');
          break;
      }
      if (e.ctrlKey || e.metaKey) this.setSnapping(true);
    });
    window.addEventListener('keyup', (e) => {
      // When "always snap" is on for blockout work, Ctrl-release shouldn't
      // disable it. Otherwise Ctrl is the temporary snap modifier.
      if (this.alwaysSnap) return;
      if (!e.ctrlKey && !e.metaKey) this.setSnapping(false);
    });
  }

  private flying(): boolean {
    // Heuristic: right-mouse held → EditorCamera is in fly mode and W/E/R are flight inputs.
    // We expose this via window.__hairy_fly so EditorCamera can flip it. (Simple & explicit.)
    return Boolean((window as unknown as { __hairy_fly?: boolean }).__hairy_fly);
  }

  private isEditable(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
  }
}

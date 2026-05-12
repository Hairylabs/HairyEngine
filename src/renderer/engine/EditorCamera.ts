import * as THREE from 'three';

// Unity-style scene-view camera:
//   right-click drag    — mouselook (yaw/pitch)
//   middle-click drag   — pan (orthogonal to view)
//   wheel               — dolly toward/away from cursor
//   WASD                — fly while right-mouse is held (Unity convention)
//   Q/E                 — down/up while right-mouse is held
//   Shift               — fly faster
// This is intentionally NOT pointer-locked — the editor needs the cursor visible
// so the user can move it onto buttons in the surrounding panels.

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();

export class EditorCamera {
  private yaw = 0;
  private pitch = 0;
  private rightDown = false;
  private middleDown = false;
  private keys = new Set<string>();
  private enabled = true;
  private speed = 5;
  private fastMultiplier = 3;
  private mouseSensitivity = 0.0025;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
  ) {
    // initial yaw/pitch derived from camera orientation
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    // Three's getWorldDirection returns -Z forward; convert.
    this.yaw = Math.atan2(-dir.x, -dir.z);

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number) {
    if (!this.enabled) return;
    // Apply yaw/pitch to camera
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    // Only fly when right-mouse is held — Unity scene view convention.
    if (!this.rightDown) return;
    const sp = this.speed * (this.keys.has('shift') ? this.fastMultiplier : 1) * dt;
    this.camera.getWorldDirection(tmpForward);
    tmpRight.crossVectors(tmpForward, tmpUp).normalize();

    tmpDir.set(0, 0, 0);
    if (this.keys.has('w')) tmpDir.add(tmpForward);
    if (this.keys.has('s')) tmpDir.sub(tmpForward);
    if (this.keys.has('d')) tmpDir.add(tmpRight);
    if (this.keys.has('a')) tmpDir.sub(tmpRight);
    if (this.keys.has('e')) tmpDir.add(tmpUp);
    if (this.keys.has('q')) tmpDir.sub(tmpUp);

    if (tmpDir.lengthSq() > 0) {
      tmpDir.normalize().multiplyScalar(sp);
      this.camera.position.add(tmpDir);
    }
  }

  frame(target: THREE.Vector3, distance: number) {
    this.camera.getWorldDirection(tmpForward);
    this.camera.position.copy(target).addScaledVector(tmpForward, -distance);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  private onDown = (e: PointerEvent) => {
    if (e.button === 2) {
      this.rightDown = true;
      (window as unknown as { __hairy_fly?: boolean }).__hairy_fly = true;
      this.el.setPointerCapture(e.pointerId);
    } else if (e.button === 1) {
      this.middleDown = true;
      this.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.button === 2) {
      this.rightDown = false;
      (window as unknown as { __hairy_fly?: boolean }).__hairy_fly = false;
    }
    if (e.button === 1) this.middleDown = false;
  };

  private onMove = (e: PointerEvent) => {
    if (this.rightDown) {
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    } else if (this.middleDown) {
      this.camera.getWorldDirection(tmpForward);
      tmpRight.crossVectors(tmpForward, tmpUp).normalize();
      const panScale = 0.01 * this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
      this.camera.position.addScaledVector(tmpRight, -e.movementX * panScale);
      this.camera.position.addScaledVector(tmpUp, e.movementY * panScale);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.camera.getWorldDirection(tmpForward);
    const factor = e.deltaY > 0 ? -1 : 1;
    const step = factor * Math.min(2, Math.abs(e.deltaY) * 0.01);
    this.camera.position.addScaledVector(tmpForward, step);
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.isEditable(e.target)) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (e.shiftKey) this.keys.add('shift');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    if (!e.shiftKey) this.keys.delete('shift');
  };

  private isEditable(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
  }
}

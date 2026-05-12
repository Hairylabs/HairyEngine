// Global input state. Tracks keyboard, mouse buttons, mouse delta (since last
// frame), and supports pointer lock (FPS-style mouse capture).
//
// Pattern: read-once-per-frame snapshot.
//   Scripts query with isKeyDown / isMouseDown / getMouseDelta.
//   Input.endFrame() zeroes the deltas so each frame's read is correct.
//
// Pointer lock toggles on user request (e.g. PlayerController calls .lock() in
// start, and unlocks when play mode stops or user presses Escape).

type MouseButton = 0 | 1 | 2;

export class Input {
  private keys = new Set<string>();
  private mouseButtons = new Set<MouseButton>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheelDy = 0;
  private locked = false;
  private bound = false;
  private lockTarget: HTMLElement | null = null;

  bind(target: HTMLElement) {
    if (this.bound) return;
    this.bound = true;
    this.lockTarget = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  endFrame() {
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheelDy = 0;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code.toLowerCase());
  }

  isMouseDown(button: MouseButton = 0): boolean {
    return this.mouseButtons.has(button);
  }

  getMouseDelta(): { x: number; y: number } {
    return { x: this.mouseDx, y: this.mouseDy };
  }

  getWheelDelta(): number {
    return this.wheelDy;
  }

  isPointerLocked(): boolean {
    return this.locked;
  }

  async lock() {
    if (!this.lockTarget) return;
    try {
      // Some browsers / Electron versions require user gesture; this is called
      // from a click handler upstream so it should succeed.
      await (this.lockTarget as HTMLElement & {
        requestPointerLock: () => Promise<void>;
      }).requestPointerLock();
    } catch {
      // ignore; user can click again to retry
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  reset() {
    this.keys.clear();
    this.mouseButtons.clear();
    this.endFrame();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    this.keys.add(e.key.toLowerCase());
    // Also track by code so games can use 'Space' / 'KeyW' style mapping.
    this.keys.add(e.code.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    this.keys.delete(e.code.toLowerCase());
  };

  private onBlur = () => this.reset();

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.mouseButtons.add(e.button as MouseButton);
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.mouseButtons.delete(e.button as MouseButton);
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  private onWheel = (e: WheelEvent) => {
    this.wheelDy += e.deltaY;
  };

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.lockTarget;
  };
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export const input = new Input();

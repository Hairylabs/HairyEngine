import * as THREE from 'three';

export class StatusBar {
  private fpsEma = 60;

  constructor(
    private fpsEl: HTMLElement,
    private selEl: HTMLElement,
    private statusEl: HTMLElement,
  ) {}

  setFps(fps: number) {
    this.fpsEma = this.fpsEma * 0.9 + fps * 0.1;
    this.fpsEl.textContent = `${this.fpsEma.toFixed(0)} fps`;
  }

  setSelection(obj: THREE.Object3D | null) {
    this.selEl.textContent = obj ? `selected: ${obj.name || obj.type}` : 'no selection';
  }

  setStatus(msg: string) {
    this.statusEl.textContent = msg;
  }
}

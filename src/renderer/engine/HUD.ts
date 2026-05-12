import { PlayState } from './PlayState';

// In-game HUD layer. Scripts get a DOM container they can append to during
// Play mode (e.g. crosshair, health bar, score). The layer is cleared on
// Stop so editor mode never shows runtime HUD elements.

export class HUD {
  private root: HTMLElement;

  constructor(parent: HTMLElement, play: PlayState) {
    this.root = document.createElement('div');
    this.root.className = 'hud-layer';
    parent.appendChild(this.root);
    play.onChange((mode) => {
      if (mode === 'edit') this.clear();
      this.root.style.display = mode === 'edit' ? 'none' : '';
    });
    this.root.style.display = 'none';
  }

  element(): HTMLElement {
    return this.root;
  }

  add(el: HTMLElement) {
    this.root.appendChild(el);
  }

  clear() {
    this.root.innerHTML = '';
  }
}

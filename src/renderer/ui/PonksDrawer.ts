import * as THREE from 'three';
import { Ponk, applyPonkTexture } from '../engine/Web3';
import { Scene } from '../engine/Scene';

// Floating right-side drawer that shows the player's connected Ponks.
// Click a thumbnail → it gets applied as the texture on the currently selected
// mesh. Useful for "set this paper-bag head to my favorite Ponk".

export class PonksDrawer {
  private root: HTMLElement;
  private grid: HTMLElement;
  private statusEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    private scene: Scene,
    private onStatus: (msg: string) => void,
  ) {
    this.root = document.createElement('aside');
    this.root.className = 'ponks-drawer';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="ponks-head">
        <span>🎭 Your Ponks</span>
        <button class="ponks-close" type="button" title="Close">×</button>
      </div>
      <div class="ponks-grid" id="ponks-grid"></div>
      <div class="ponks-foot" id="ponks-status">Click a Ponk to apply as the selected object's texture.</div>
    `;
    parent.appendChild(this.root);
    this.grid = this.root.querySelector('#ponks-grid') as HTMLElement;
    this.statusEl = this.root.querySelector('#ponks-status') as HTMLElement;
    this.root.querySelector('.ponks-close')?.addEventListener('click', () => {
      this.hide();
    });
  }

  show(ponks: Ponk[]) {
    this.grid.innerHTML = '';
    if (ponks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ponks-empty';
      empty.textContent = 'No Ponks found on this wallet.';
      this.grid.appendChild(empty);
    } else {
      for (const p of ponks) this.grid.appendChild(this.cell(p));
    }
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  private cell(p: Ponk): HTMLElement {
    const cell = document.createElement('button');
    cell.className = 'ponks-cell';
    cell.type = 'button';
    cell.title = `#${p.tokenId} — click to apply to selected mesh`;
    cell.innerHTML = `
      ${p.imageUrl ? `<img loading="lazy" alt="" src="${p.imageUrl}">` : '<div class="ponks-noimg">no img</div>'}
      <span class="ponks-id">#${p.tokenId}</span>
    `;
    cell.addEventListener('click', () => this.apply(p));
    return cell;
  }

  private async apply(p: Ponk) {
    const target = this.scene.selection;
    if (!target) {
      this.statusEl.textContent = 'Select a mesh first (the player\'s head), then click a Ponk.';
      this.onStatus('Select a mesh first');
      return;
    }
    if (!p.imageUrl) {
      this.statusEl.textContent = `Ponk #${p.tokenId} has no image URL.`;
      return;
    }
    this.statusEl.textContent = `Applying #${p.tokenId} to "${target.name}"…`;
    const ok = await applyPonkTexture(p.imageUrl, target as THREE.Object3D);
    this.statusEl.textContent = ok
      ? `Applied Ponk #${p.tokenId} to "${target.name}".`
      : `Couldn't apply texture (CORS or load fail) — check Console.`;
    this.onStatus(ok ? `Ponk #${p.tokenId} → ${target.name}` : 'Texture apply failed');
  }
}

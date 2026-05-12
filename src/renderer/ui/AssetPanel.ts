import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Scene } from '../engine/Scene';
import { History as UndoHistory } from '../engine/History';
import { AddObjectCommand } from '../engine/Commands';
import { attachAnimations } from '../engine/Animations';

// Asset Browser — lists files in the global library (<userData>/assets/).
// Click a row to spawn it into the active scene. Buttons: Import, Refresh,
// Open folder. Drag-to-spawn into viewport via 'application/x-hairyengine-asset'.

type Entry = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
};

const gltfLoader = new GLTFLoader();

export class AssetPanel {
  private listEl: HTMLElement;
  private toolbar: HTMLElement;
  private entries: Entry[] = [];

  constructor(
    private root: HTMLElement,
    private scene: Scene,
    private history: UndoHistory,
    private onMessage: (msg: string) => void,
  ) {
    root.classList.add('asset-panel');
    root.innerHTML = `
      <div class="asset-toolbar">
        <button class="asset-btn primary" id="asset-import">+ Import…</button>
        <button class="asset-btn" id="asset-refresh">Refresh</button>
        <button class="asset-btn" id="asset-open-folder">Open folder</button>
        <span class="asset-toolbar-info" id="asset-info"></span>
      </div>
      <div class="asset-list" id="asset-list"></div>
    `;
    this.toolbar = root.querySelector('.asset-toolbar') as HTMLElement;
    this.listEl = root.querySelector('#asset-list') as HTMLElement;

    root.querySelector('#asset-import')?.addEventListener('click', () => this.importAsset());
    root.querySelector('#asset-refresh')?.addEventListener('click', () => this.refresh());
    root.querySelector('#asset-open-folder')?.addEventListener('click', () => {
      window.hairy.assets.openLibrary();
    });

    this.refresh();
  }

  async refresh() {
    try {
      this.entries = await window.hairy.assets.list();
      this.render();
    } catch (err) {
      this.onMessage(`Asset list failed: ${(err as Error).message}`);
    }
  }

  private async importAsset() {
    const res = await window.hairy.assets.import();
    if (res.canceled) return;
    if ('error' in res) {
      this.onMessage(`Import failed: ${res.error}`);
      return;
    }
    this.onMessage(`Imported ${res.imported.length} asset(s) to library`);
    await this.refresh();
  }

  private render() {
    this.listEl.innerHTML = '';
    const info = this.toolbar.querySelector('#asset-info') as HTMLElement;
    info.textContent = `${this.entries.length} asset${this.entries.length === 1 ? '' : 's'}`;
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Library is empty. Click + Import… or drop GLBs in the folder.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const entry of this.entries) {
      this.listEl.appendChild(this.row(entry));
    }
  }

  private row(entry: Entry): HTMLElement {
    const el = document.createElement('div');
    el.className = 'asset-row';
    el.draggable = true;
    el.title = entry.path;
    el.innerHTML = `
      <div class="asset-thumb">${entry.ext.replace('.', '').toUpperCase()}</div>
      <div class="asset-meta">
        <div class="asset-name">${escapeHtml(entry.name)}</div>
        <div class="asset-sub">${formatSize(entry.size)} · ${relativeTime(entry.mtime)}</div>
      </div>
      <button class="asset-row-action" data-action="reveal" title="Reveal in Explorer">↗</button>
    `;
    el.addEventListener('dblclick', () => this.spawnAsset(entry));
    el.addEventListener('click', (e) => {
      // Single click adds too, since most users don't think to double-click
      // an asset to use it. Reveal button stops propagation below.
      if ((e.target as HTMLElement).dataset.action) return;
      this.spawnAsset(entry);
    });
    el.querySelector('[data-action="reveal"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.hairy.assets.reveal(entry.path);
    });
    el.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-hairyengine-asset', entry.path);
    });
    return el;
  }

  private async spawnAsset(entry: Entry) {
    const r = await window.hairy.assets.read(entry.path);
    if (!r.ok) {
      this.onMessage(`Could not read ${entry.name}: ${r.error}`);
      return;
    }
    try {
      const gltf = await gltfLoader.parseAsync(r.bytes, '');
      const root = gltf.scene;
      root.name = entry.name.replace(/\.[^.]+$/, '');
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      if (gltf.animations && gltf.animations.length > 0) {
        attachAnimations(root, gltf.animations);
      }
      this.history.push(new AddObjectCommand(this.scene, root));
      this.onMessage(`Spawned "${root.name}"`);
    } catch (err) {
      this.onMessage(`Spawn failed: ${(err as Error).message}`);
    }
  }
}

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

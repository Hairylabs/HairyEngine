import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Scene } from '../engine/Scene';
import { History as UndoHistory } from '../engine/History';
import { AddObjectCommand } from '../engine/Commands';
import { attachAnimations } from '../engine/Animations';
import { listUserScripts, openScriptEditor } from '../engine/UserScripts';

// Asset Browser — lives in the left sidebar under Scene. Compact row view.
// Right-click opens a context menu: Import GLB, New Script, Open folder, etc.
// Click → spawn asset. Double-click → also spawn (or open editor for scripts).
// Drag → asset path is set so a viewport drop spawns it.

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
  private entries: Entry[] = [];
  private contextMenu: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private scene: Scene,
    private history: UndoHistory,
    private onMessage: (msg: string) => void,
  ) {
    root.classList.add('asset-panel');
    this.listEl = root;

    // Right-click on the panel itself (empty area or any row) opens the menu.
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openContextMenu(e.clientX, e.clientY, null);
    });
    document.addEventListener('click', (ev) => {
      if (this.contextMenu && !this.contextMenu.contains(ev.target as Node)) {
        this.closeContextMenu();
      }
    });

    this.refresh();
  }

  async refresh() {
    try {
      const fileAssets = await window.hairy.assets.list();
      const scriptEntries = listUserScripts().map((s) => ({
        path: `script:${s.id}`,
        name: `${s.name}.script`,
        size: s.body.length,
        mtime: s.updatedAt,
        ext: '.script',
      }));
      this.entries = [...scriptEntries, ...fileAssets];
      this.render();
    } catch (err) {
      this.onMessage(`Asset list failed: ${(err as Error).message}`);
    }
  }

  openImportDialog() {
    void this.importAsset();
  }

  openNewScriptDialog() {
    openScriptEditor(null, () => {
      this.onMessage('Script saved');
      this.refresh();
    });
  }

  openLibraryFolder() {
    window.hairy.assets.openLibrary();
  }

  async installKenneyPack() {
    const base = 'https://cdn.jsdelivr.net/gh/KenneyNL/Starter-Kit-FPS@main/models/';
    const files = ['crate.glb','barrel.glb','wall.glb','floor.glb','ramp.glb','stairs.glb','door.glb','window.glb','pillar.glb','cover-low.glb','cover-high.glb'];
    this.onMessage(`Downloading ${files.length} Kenney assets…`);
    let imported = 0, failed = 0;
    for (const name of files) {
      try {
        const res = await fetch(base + name);
        if (!res.ok) { failed++; continue; }
        const bytes = await res.arrayBuffer();
        const r = await window.hairy.assets.writeBinary(`kenney_${name}`, bytes);
        if (r.ok) imported++; else failed++;
      } catch { failed++; }
    }
    this.onMessage(`Kenney pack: imported ${imported}, ${failed} failed`);
    await this.refresh();
  }

  private async importAsset() {
    const res = await window.hairy.assets.import();
    if (res.canceled) return;
    if ('error' in res) {
      this.onMessage(`Import failed: ${res.error}`);
      return;
    }
    this.onMessage(`Imported ${res.imported.length} asset(s)`);
    await this.refresh();
  }

  private render() {
    this.listEl.innerHTML = '';
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.style.padding = '20px 10px';
      empty.style.color = 'var(--muted)';
      empty.style.fontSize = '11px';
      empty.style.textAlign = 'center';
      empty.innerHTML = 'Empty.<br>Right-click for options,<br>or drop GLB files here.';
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
    const extKey = entry.ext.replace(/^\./, '').toLowerCase().slice(0, 4);
    el.innerHTML = `
      <span class="ext-badge is-${extKey}">${extKey || '?'}</span>
      <span class="asset-name">${escapeHtml(entry.name)}</span>
      <span class="asset-size">${formatSize(entry.size)}</span>
    `;
    el.addEventListener('click', () => this.activate(entry));
    el.addEventListener('dblclick', () => this.activate(entry));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openContextMenu(e.clientX, e.clientY, entry);
    });
    el.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-hairyengine-asset', entry.path);
    });
    return el;
  }

  private async activate(entry: Entry) {
    if (entry.path.startsWith('script:')) {
      const id = entry.path.replace(/^script:/, '');
      openScriptEditor(id, () => this.refresh());
      return;
    }
    await this.spawnAsset(entry);
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

  private openContextMenu(x: number, y: number, entry: Entry | null) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'menu-popup tree-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items: Array<{ label: string; onClick: () => void; danger?: boolean; sep?: false } | { sep: true }> = [
      { label: '📥 Import GLB / GLTF / FBX…', onClick: () => this.importAsset() },
      { label: '📝 New Script', onClick: () => this.openNewScriptDialog() },
      { sep: true },
      { label: '⬇ Install Kenney FPS pack', onClick: () => this.installKenneyPack() },
      { label: '📂 Open asset folder', onClick: () => window.hairy.assets.openLibrary() },
      { label: '⟳ Refresh', onClick: () => this.refresh() },
    ];
    if (entry) {
      items.unshift({ sep: true });
      if (entry.path.startsWith('script:')) {
        const id = entry.path.replace(/^script:/, '');
        items.unshift(
          { label: `✎ Edit "${entry.name}"`, onClick: () => openScriptEditor(id, () => this.refresh()) },
          { label: `🗑 Delete script`, onClick: () => this.deleteScript(id), danger: true },
        );
      } else {
        items.unshift(
          { label: `▶ Spawn into scene`, onClick: () => this.spawnAsset(entry) },
          { label: `↗ Reveal in folder`, onClick: () => window.hairy.assets.reveal(entry.path) },
        );
      }
    }
    for (const item of items) {
      if ('sep' in item && item.sep) {
        const s = document.createElement('div');
        s.className = 'menu-sep';
        menu.appendChild(s);
        continue;
      }
      const it = item as { label: string; onClick: () => void; danger?: boolean };
      const btn = document.createElement('button');
      btn.textContent = it.label;
      if (it.danger) btn.classList.add('danger');
      btn.addEventListener('click', () => {
        it.onClick();
        this.closeContextMenu();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    this.contextMenu = menu;
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8) {
        menu.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
      }
      if (r.right > window.innerWidth - 8) {
        menu.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
      }
    });
  }

  private closeContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private async deleteScript(id: string) {
    const mod = await import('../engine/UserScripts');
    if (mod.deleteUserScript(id)) {
      this.onMessage('Script deleted');
      this.refresh();
    }
  }
}

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

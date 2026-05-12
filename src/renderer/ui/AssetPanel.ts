import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Scene } from '../engine/Scene';
import { History as UndoHistory } from '../engine/History';
import { AddObjectCommand } from '../engine/Commands';
import { attachAnimations } from '../engine/Animations';
import { listUserScripts, openScriptEditor } from '../engine/UserScripts';

// Asset Browser — folder tree view. Files are auto-grouped into default
// folders by extension (Models / Textures / Audio / Scripts / Animations /
// Project files / Other). User can also create custom folders, and any file
// can be tagged into one via right-click → Move to Folder. Custom folder
// memberships persist in localStorage as a path -> folder map.
//
// Right-click context menu varies per node:
//   • Folder header: New Folder · Add Image · Add Audio · Import GLB · Open folder
//   • File row:      Spawn · Reveal in Explorer · Move to Folder · Delete (TODO)
//   • Empty area:    Same as folder header above

type Entry = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
};

type FolderName = string;
const DEFAULT_FOLDERS: FolderName[] = [
  'Models', 'Textures', 'Audio', 'Animations', 'Scripts', 'Project Files', 'Other',
];
const CUSTOM_FOLDER_KEY = 'hairy.assetFolders.v1';
const FOLDER_TAGS_KEY = 'hairy.assetTags.v1';
const COLLAPSED_KEY = 'hairy.assetFoldersCollapsed.v1';

const gltfLoader = new GLTFLoader();

export class AssetPanel {
  private entries: Entry[] = [];
  private customFolders: FolderName[] = [];
  private fileTags: Record<string, FolderName> = {}; // path -> folder override
  private collapsed = new Set<FolderName>();
  private contextMenu: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private scene: Scene,
    private history: UndoHistory,
    private onMessage: (msg: string) => void,
  ) {
    root.classList.add('asset-panel');
    this.loadFolders();

    root.addEventListener('contextmenu', (e) => {
      // Only the panel background (not a folder/file row) gets the empty menu.
      if (e.target === root) {
        e.preventDefault();
        e.stopPropagation();
        this.openContextMenu(e.clientX, e.clientY, null, null);
      }
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
      const scriptEntries: Entry[] = listUserScripts().map((s) => ({
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

  openNewScriptDialog() {
    openScriptEditor(null, () => {
      this.onMessage('Script saved');
      this.refresh();
    });
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

  /** Open a file picker filtered to one extension class, save the chosen
   *  files into the asset library. We reuse the same `assets:import` IPC
   *  which already pops a system dialog; the user just filters in the dialog. */
  private async addByCategory(category: 'image' | 'audio') {
    void category; // The IPC doesn't currently filter; the user will see all formats.
    return this.importAsset();
  }

  private render() {
    this.root.innerHTML = '';
    // Group entries by folder.
    const groups = new Map<FolderName, Entry[]>();
    for (const folder of [...DEFAULT_FOLDERS, ...this.customFolders]) {
      groups.set(folder, []);
    }
    for (const entry of this.entries) {
      const folder = this.folderFor(entry);
      const arr = groups.get(folder) ?? [];
      arr.push(entry);
      groups.set(folder, arr);
    }

    // Render each folder; skip empty default folders unless they're custom.
    for (const [folderName, items] of groups) {
      const isDefault = DEFAULT_FOLDERS.includes(folderName);
      if (isDefault && items.length === 0) continue; // hide empty defaults
      this.root.appendChild(this.renderFolder(folderName, items, !isDefault));
    }

    // Empty hint
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.style.padding = '20px 10px';
      empty.style.color = 'var(--muted)';
      empty.style.fontSize = '11px';
      empty.style.textAlign = 'center';
      empty.innerHTML = 'No assets yet.<br>Right-click for + New Folder, Import GLB,<br>Add Image, Add Audio, New Script.';
      this.root.appendChild(empty);
    }
  }

  private renderFolder(name: FolderName, items: Entry[], isCustom: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'asset-folder';
    const header = document.createElement('div');
    header.className = 'asset-folder-header';
    const isCollapsed = this.collapsed.has(name);
    header.innerHTML = `
      <span class="asset-folder-twirl">${items.length === 0 ? '·' : isCollapsed ? '▶' : '▼'}</span>
      <span class="asset-folder-icon">${folderIcon(name)}</span>
      <span class="asset-folder-name">${escapeHtml(name)}</span>
      <span class="asset-folder-count">${items.length}</span>
    `;
    header.addEventListener('click', () => {
      if (this.collapsed.has(name)) this.collapsed.delete(name);
      else this.collapsed.add(name);
      this.saveCollapsed();
      this.render();
    });
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openContextMenu(e.clientX, e.clientY, null, { folderName: name, isCustom });
    });
    wrap.appendChild(header);

    if (!isCollapsed) {
      for (const entry of items) {
        wrap.appendChild(this.row(entry));
      }
    }
    return wrap;
  }

  private folderFor(entry: Entry): FolderName {
    // User-tagged override wins.
    const tag = this.fileTags[entry.path];
    if (tag && [...DEFAULT_FOLDERS, ...this.customFolders].includes(tag)) return tag;
    // Otherwise auto-categorize by extension.
    const ext = entry.ext.toLowerCase();
    if (entry.path.startsWith('script:')) return 'Scripts';
    if (/^\.(png|jpg|jpeg|webp|bmp|gif)$/.test(ext)) return 'Textures';
    if (/^\.(mp3|wav|ogg|m4a|flac)$/.test(ext)) return 'Audio';
    if (entry.name.toLowerCase().match(/anim|walk|run|idle|jump|dance|attack|wave|punch|kick/)) return 'Animations';
    if (/^\.(glb|gltf|fbx|obj|stl|dae)$/.test(ext)) return 'Models';
    if (/^\.(hairy|json)$/.test(ext)) return 'Project Files';
    return 'Other';
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
      this.openContextMenu(e.clientX, e.clientY, entry, null);
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

  private openContextMenu(
    x: number,
    y: number,
    entry: Entry | null,
    folderCtx: { folderName: FolderName; isCustom: boolean } | null,
  ) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'menu-popup tree-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    type Item = { label: string; onClick: () => void; danger?: boolean } | { sep: true };
    const items: Item[] = [];

    if (entry) {
      // File-row context
      if (entry.path.startsWith('script:')) {
        const id = entry.path.replace(/^script:/, '');
        items.push({ label: `✎ Edit "${entry.name}"`, onClick: () => openScriptEditor(id, () => this.refresh()) });
        items.push({ label: '🗑 Delete script', onClick: () => this.deleteScript(id), danger: true });
      } else {
        items.push({ label: '▶ Spawn into scene', onClick: () => this.spawnAsset(entry) });
        items.push({ label: '↗ Reveal in Explorer', onClick: () => window.hairy.assets.reveal(entry.path) });
      }
      items.push({ sep: true });
      items.push({
        label: '📁 Move to folder…',
        onClick: () => this.promptMoveToFolder(entry),
      });
      items.push({ sep: true });
    }

    items.push({ label: '➕ New Folder…', onClick: () => this.createNewFolder() });
    items.push({ label: '📥 Import GLB / GLTF / FBX…', onClick: () => this.importAsset() });
    items.push({ label: '🖼 Add Image…', onClick: () => this.addByCategory('image') });
    items.push({ label: '🔊 Add Audio…', onClick: () => this.addByCategory('audio') });
    items.push({ label: '📝 New Script', onClick: () => this.openNewScriptDialog() });
    items.push({ sep: true });
    items.push({ label: '⬇ Install Kenney FPS pack', onClick: () => this.installKenneyPack() });
    items.push({ label: '📂 Open asset folder (Explorer)', onClick: () => window.hairy.assets.openLibrary() });
    items.push({ label: '⟳ Refresh', onClick: () => this.refresh() });

    if (folderCtx && folderCtx.isCustom) {
      items.unshift({ sep: true });
      items.unshift({
        label: `🗑 Delete folder "${folderCtx.folderName}"`,
        onClick: () => this.deleteCustomFolder(folderCtx.folderName),
        danger: true,
      });
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

  private createNewFolder() {
    const name = prompt('Name for the new folder?', 'MyFolder');
    if (!name) return;
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return;
    if ([...DEFAULT_FOLDERS, ...this.customFolders].includes(trimmed)) {
      this.onMessage(`Folder "${trimmed}" already exists`);
      return;
    }
    this.customFolders.push(trimmed);
    this.saveFolders();
    this.render();
    this.onMessage(`Created folder "${trimmed}"`);
  }

  private deleteCustomFolder(name: FolderName) {
    if (!confirm(`Delete folder "${name}"? Files inside will revert to their auto-category.`)) return;
    this.customFolders = this.customFolders.filter((f) => f !== name);
    // Clear any tags pointing at this folder
    for (const [path, tag] of Object.entries(this.fileTags)) {
      if (tag === name) delete this.fileTags[path];
    }
    this.saveFolders();
    this.render();
  }

  private promptMoveToFolder(entry: Entry) {
    const folders = [...DEFAULT_FOLDERS, ...this.customFolders];
    const list = folders.map((f, i) => `${i + 1}. ${f}`).join('\n');
    const choice = prompt(`Move "${entry.name}" to which folder?\n\n${list}\n\nType the number or name:`, '');
    if (!choice) return;
    const trimmed = choice.trim();
    const idx = parseInt(trimmed);
    const folder = Number.isFinite(idx) && folders[idx - 1] ? folders[idx - 1] : folders.find((f) => f.toLowerCase() === trimmed.toLowerCase());
    if (!folder) {
      this.onMessage(`No folder "${trimmed}"`);
      return;
    }
    this.fileTags[entry.path] = folder;
    this.saveFolders();
    this.render();
    this.onMessage(`Moved "${entry.name}" → ${folder}`);
  }

  private async deleteScript(id: string) {
    const mod = await import('../engine/UserScripts');
    if (mod.deleteUserScript(id)) {
      this.onMessage('Script deleted');
      this.refresh();
    }
  }

  private loadFolders() {
    try {
      const raw = localStorage.getItem(CUSTOM_FOLDER_KEY);
      if (raw) this.customFolders = JSON.parse(raw);
      const rawT = localStorage.getItem(FOLDER_TAGS_KEY);
      if (rawT) this.fileTags = JSON.parse(rawT);
      const rawC = localStorage.getItem(COLLAPSED_KEY);
      if (rawC) this.collapsed = new Set(JSON.parse(rawC));
    } catch {
      /* */
    }
  }

  private saveFolders() {
    try {
      localStorage.setItem(CUSTOM_FOLDER_KEY, JSON.stringify(this.customFolders));
      localStorage.setItem(FOLDER_TAGS_KEY, JSON.stringify(this.fileTags));
    } catch {
      /* */
    }
  }
  private saveCollapsed() {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(this.collapsed)));
    } catch {
      /* */
    }
  }
}

function folderIcon(name: FolderName): string {
  switch (name) {
    case 'Models': return '🧊';
    case 'Textures': return '🖼';
    case 'Audio': return '🔊';
    case 'Animations': return '💃';
    case 'Scripts': return '📝';
    case 'Project Files': return '💾';
    case 'Other': return '📦';
    default: return '📁';
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

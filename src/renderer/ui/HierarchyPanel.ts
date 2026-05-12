import * as THREE from 'three';
import { Scene } from '../engine/Scene';
import { getActorKind, actorIcon, actorLabel } from '../engine/ActorTaxonomy';

// Hierarchy panel — full tree view of the scene. Click selects, click the
// twirl-down chevron expands/collapses, drag-and-drop reparents (Unity /
// Unreal / Godot style). Right-click opens a context menu with Parent /
// Unparent / Rename / Delete.
//
// "Parent to" means: drag actor A onto actor B → A becomes a child of B
// while preserving its world transform (using THREE.Object3D.attach).
// "Unparent" means: move A out from under its current parent and back to
// the scene root (still preserving world transform).
//
// We DON'T add children of the internal Editable group (lights/grid live on
// scene.three directly, not on Editable, so they're filtered out naturally).

const COLLAPSED_KEY = 'hairy.hierarchy.collapsed.v1';

type DragState = {
  draggedId: string | null;
};

export class HierarchyPanel {
  private collapsed = new Set<string>();
  private drag: DragState = { draggedId: null };
  private contextMenu: HTMLElement | null = null;

  constructor(
    private el: HTMLElement,
    private scene: Scene,
  ) {
    this.loadCollapsed();
    // Click on blank area = deselect.
    el.addEventListener('click', (e) => {
      if (e.target === el) this.scene.select(null);
    });
    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
        this.closeContextMenu();
      }
    });
  }

  render() {
    const roots = this.scene.editableRoots();
    this.el.innerHTML = '';
    if (roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Empty scene. Add objects from the +Add menu.';
      this.el.appendChild(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'hierarchy-tree';
    for (const child of roots) {
      ul.appendChild(this.row(child, 0));
    }
    this.el.appendChild(ul);

    // Wire root-level drop zone so dragging onto blank area = unparent.
    this.el.addEventListener('dragover', (e) => {
      if (this.drag.draggedId) e.preventDefault();
    });
    this.el.addEventListener('drop', (e) => {
      const id = this.drag.draggedId;
      this.drag.draggedId = null;
      if (!id) return;
      e.preventDefault();
      // Only handle drops directly on the panel container, not on an item.
      if (e.target !== this.el) return;
      const obj = this.findByUuid(id);
      if (!obj) return;
      this.reparent(obj, null);
    });
  }

  private row(obj: THREE.Object3D, depth: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'tree-node';
    const head = document.createElement('div');
    head.className = 'tree-row';
    head.style.paddingLeft = `${depth * 14 + 4}px`;
    head.dataset.uuid = obj.uuid;
    if (this.scene.selection === obj) head.classList.add('selected');

    // Drag wiring — every row both draggable and a drop target.
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      this.drag.draggedId = obj.uuid;
      head.classList.add('dragging');
      // Required for Firefox; Electron Chromium honors it too.
      e.dataTransfer?.setData('text/plain', obj.uuid);
    });
    head.addEventListener('dragend', () => {
      head.classList.remove('dragging');
      // Clean up any drop-target hover markers
      this.el.querySelectorAll('.tree-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
    });
    head.addEventListener('dragover', (e) => {
      if (!this.drag.draggedId) return;
      if (this.drag.draggedId === obj.uuid) return;
      // Can't reparent onto own descendant.
      const dragged = this.findByUuid(this.drag.draggedId);
      if (dragged && isAncestorOf(dragged, obj)) return;
      e.preventDefault();
      head.classList.add('drop-target');
    });
    head.addEventListener('dragleave', () => {
      head.classList.remove('drop-target');
    });
    head.addEventListener('drop', (e) => {
      head.classList.remove('drop-target');
      const id = this.drag.draggedId;
      this.drag.draggedId = null;
      if (!id || id === obj.uuid) return;
      e.preventDefault();
      e.stopPropagation();
      const dragged = this.findByUuid(id);
      if (!dragged) return;
      if (isAncestorOf(dragged, obj)) return; // can't reparent to descendant
      this.reparent(dragged, obj);
    });

    // Twirl-down arrow + icon + name
    const hasChildren = obj.children.some((c) => !c.userData.isCameraHelper && !c.userData.isSpawnHelper && !c.userData.lightHelper && !c.userData.isFaceExtrudeHelper && !c.userData.isTopDownHelper && !c.userData.__wireframeOverlay);
    const isCollapsed = this.collapsed.has(obj.uuid);

    const twirl = document.createElement('span');
    twirl.className = 'tree-twirl';
    if (hasChildren) {
      twirl.textContent = isCollapsed ? '▶' : '▼';
      twirl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.collapsed.has(obj.uuid)) this.collapsed.delete(obj.uuid);
        else this.collapsed.add(obj.uuid);
        this.saveCollapsed();
        this.render();
      });
    } else {
      twirl.textContent = '·';
      twirl.classList.add('leaf');
    }
    head.appendChild(twirl);

    const kind = getActorKind(obj);
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = actorIcon(kind);
    head.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = obj.name || obj.type;
    name.title = `${actorLabel(kind)} · ${obj.type}${obj.parent && obj.parent !== this.scene.editable ? ` · child of "${obj.parent.name}"` : ''}`;
    head.appendChild(name);

    head.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scene.select(obj);
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openContextMenu(obj, e.clientX, e.clientY);
    });
    head.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.startRename(obj, name);
    });

    li.appendChild(head);

    // Render visible children (filtered to skip engine helpers)
    if (hasChildren && !isCollapsed) {
      const childUl = document.createElement('ul');
      childUl.className = 'tree-children';
      for (const c of obj.children) {
        if (isEngineHelper(c)) continue;
        childUl.appendChild(this.row(c, depth + 1));
      }
      li.appendChild(childUl);
    }
    return li;
  }

  private openContextMenu(obj: THREE.Object3D, x: number, y: number) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'tree-context-menu menu-popup';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items: Array<{ label: string; onClick: () => void; danger?: boolean }> = [
      { label: '🎯 Select', onClick: () => this.scene.select(obj) },
      { label: '✎ Rename…', onClick: () => this.promptRename(obj) },
      { label: '⧉ Duplicate', onClick: () => this.duplicate(obj) },
    ];
    if (obj.parent && obj.parent !== this.scene.editable) {
      items.push({
        label: '⬑ Unparent (to scene root)',
        onClick: () => this.reparent(obj, null),
      });
    }
    if (this.scene.selection && this.scene.selection !== obj) {
      items.push({
        label: `🔗 Parent under "${this.scene.selection.name}"`,
        onClick: () => this.reparent(obj, this.scene.selection!),
      });
    }
    items.push({ label: '🗑 Delete', onClick: () => this.delete(obj), danger: true });

    for (const item of items) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      if (item.danger) btn.classList.add('danger');
      btn.addEventListener('click', () => {
        item.onClick();
        this.closeContextMenu();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Clamp to viewport
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

  /** Move `child` to be parented under `newParent`. Pass null to unparent
   *  (reparent to scene.editable). Preserves world transform via
   *  THREE.Object3D.attach so the user doesn't see the actor jump. */
  private reparent(child: THREE.Object3D, newParent: THREE.Object3D | null) {
    if (child === newParent) return;
    if (child.userData.deletable === false && newParent === null) {
      // Lights / grid shouldn't be relocated.
      return;
    }
    const target = newParent ?? this.scene.editable;
    if (newParent && isAncestorOf(child, newParent)) return; // cycle guard
    target.attach(child);
    this.scene.notifyChanged();
    this.scene.select(child);
  }

  private duplicate(obj: THREE.Object3D) {
    const copy = obj.clone(true);
    copy.position.copy(obj.position).add(new THREE.Vector3(1, 0, 0));
    copy.name = `${obj.name}_copy`;
    const parent = obj.parent ?? this.scene.editable;
    parent.add(copy);
    this.scene.notifyChanged();
    this.scene.select(copy);
  }

  private delete(obj: THREE.Object3D) {
    if (obj.userData.deletable === false) return;
    obj.removeFromParent();
    if (this.scene.selection === obj) this.scene.select(null);
    this.scene.notifyChanged();
  }

  private startRename(obj: THREE.Object3D, nameEl: HTMLElement) {
    const oldName = obj.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'tree-name-input';
    nameEl.replaceWith(input);
    input.select();
    input.focus();
    const finish = (save: boolean) => {
      if (save && input.value.trim()) {
        obj.name = input.value.trim().slice(0, 64);
      }
      this.scene.notifyChanged();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { finish(true); input.blur(); }
      if (e.key === 'Escape') { finish(false); input.blur(); }
    });
  }

  private promptRename(obj: THREE.Object3D) {
    const name = prompt(`Rename "${obj.name}" to?`, obj.name);
    if (!name) return;
    obj.name = name.trim().slice(0, 64);
    this.scene.notifyChanged();
  }

  private findByUuid(uuid: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    this.scene.editable.traverse((o) => {
      if (found) return;
      if (o.uuid === uuid) found = o;
    });
    return found;
  }

  private loadCollapsed() {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.collapsed = new Set(arr);
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

/** True if `ancestor` is anywhere up the parent chain of `descendant`. */
function isAncestorOf(ancestor: THREE.Object3D, descendant: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = descendant;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

/** Filter out engine-internal children (camera helpers, light meshes, etc)
 *  so the hierarchy panel only shows actors the user cares about. */
function isEngineHelper(obj: THREE.Object3D): boolean {
  const d = obj.userData;
  return (
    !!d.isCameraHelper ||
    !!d.isSpawnHelper ||
    !!d.lightHelper ||
    !!d.isFaceExtrudeHelper ||
    !!d.isTopDownHelper ||
    !!d.__wireframeOverlay
  );
}

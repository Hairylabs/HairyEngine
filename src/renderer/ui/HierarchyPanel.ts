import * as THREE from 'three';
import { Scene } from '../engine/Scene';

// Hierarchy panel — flat list of editable objects, click to select.
// Will grow to support nested groups, drag-to-reparent, etc.

export class HierarchyPanel {
  constructor(
    private el: HTMLElement,
    private scene: Scene,
  ) {}

  render() {
    const roots = this.scene.editableRoots();
    this.el.innerHTML = '';
    if (roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Empty scene. Add objects from the menu.';
      this.el.appendChild(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'hierarchy-list';
    for (const child of roots) {
      ul.appendChild(this.row(child));
    }
    this.el.appendChild(ul);
  }

  private row(obj: THREE.Object3D): HTMLLIElement {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'hierarchy-row';
    btn.dataset.uuid = obj.uuid;
    btn.textContent = `${this.icon(obj)} ${obj.name || obj.type}`;
    if (this.scene.selection === obj) btn.classList.add('selected');
    btn.addEventListener('click', () => this.scene.select(obj));
    li.appendChild(btn);
    return li;
  }

  private icon(obj: THREE.Object3D): string {
    if ((obj as THREE.Mesh).isMesh) return '◼';
    if ((obj as THREE.Light).isLight) return '☀';
    if ((obj as THREE.Group).isGroup) return '▤';
    return '·';
  }
}

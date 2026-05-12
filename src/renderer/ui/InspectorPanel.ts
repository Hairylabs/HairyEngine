import * as THREE from 'three';
import { Scene } from '../engine/Scene';
import { History } from '../engine/History';
import {
  TransformCommand,
  snapshotTransform,
  transformsEqual,
} from '../engine/Commands';
import {
  addScriptDescriptor,
  getScriptDescriptors,
  listScripts,
  removeScriptDescriptor,
  ScriptDescriptor,
  ScriptParamDef,
} from '../engine/Script';
import { openMenuPopup } from './Menu';

// Inspector — shows transform of the selected object plus material color for meshes.
// Edits flow back into the Three.js object live. The viewport's BoxHelper rebuilds
// every frame so we don't need to push updates back into it manually.

export class InspectorPanel {
  private current: THREE.Object3D | null = null;
  private inputs: Record<string, HTMLInputElement> = {};
  private focusSnapshot: ReturnType<typeof snapshotTransform> | null = null;

  constructor(
    private el: HTMLElement,
    private scene: Scene,
    private history: History,
  ) {}

  show(obj: THREE.Object3D | null) {
    this.current = obj;
    this.el.innerHTML = '';
    this.inputs = {};
    if (!obj) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Click anything in the viewport.';
      this.el.appendChild(empty);
      return;
    }

    this.section('Object', (body) => {
      this.nameField(body, obj);
      this.typeRow(body, obj);
    });

    this.section('Transform', (body) => {
      this.vec3Row(body, 'pos', 'Position', obj.position);
      this.vec3RowEuler(body, 'rot', 'Rotation', obj);
      this.vec3Row(body, 'scl', 'Scale', obj.scale);
    });

    this.renderScripts(obj);

    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material && !Array.isArray(mesh.material)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if ((mat as { color?: THREE.Color }).color) {
        this.section('Material', (body) => {
          this.colorRow(body, 'color', 'Color', mat.color);
          this.numberRow(body, 'rough', 'Roughness', mat.roughness ?? 1, 0, 1, 0.01, (v) => {
            mat.roughness = v;
          });
          this.numberRow(body, 'metal', 'Metalness', mat.metalness ?? 0, 0, 1, 0.01, (v) => {
            mat.metalness = v;
          });
        });
      }
    }

    // Polycount / Decimate — only show on meshes with real geometry.
    if (mesh.isMesh && mesh.geometry) {
      this.renderPolycountSection(mesh);
    }
  }

  private renderPolycountSection(mesh: THREE.Mesh) {
    this.section('Polycount', (body) => {
      const stats = document.createElement('div');
      stats.style.fontFamily = 'ui-monospace, monospace';
      stats.style.fontSize = '11px';
      stats.style.color = 'var(--muted)';
      stats.style.padding = '4px 8px 10px';
      const update = () => {
        const idx = mesh.geometry.index;
        const pos = mesh.geometry.attributes.position;
        const triangles = idx ? Math.round(idx.count / 3) : (pos ? Math.round(pos.count / 3) : 0);
        const vertices = pos ? pos.count : 0;
        stats.textContent = `${triangles.toLocaleString()} triangles · ${vertices.toLocaleString()} vertices`;
      };
      update();
      body.appendChild(stats);

      // Decimate slider — applies a temporary preview, commit on release.
      const row = document.createElement('div');
      row.style.padding = '0 8px 8px';
      const label = document.createElement('div');
      label.textContent = 'Decimate to:';
      label.style.fontSize = '11px';
      label.style.color = 'var(--text)';
      label.style.marginBottom = '4px';
      row.appendChild(label);

      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '6px';
      controls.style.alignItems = 'center';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '5';
      slider.max = '100';
      slider.value = '100';
      slider.style.flex = '1';
      const percent = document.createElement('span');
      percent.style.fontSize = '11px';
      percent.style.fontFamily = 'ui-monospace, monospace';
      percent.style.minWidth = '36px';
      percent.style.textAlign = 'right';
      percent.textContent = '100%';
      slider.addEventListener('input', () => {
        percent.textContent = `${slider.value}%`;
      });
      controls.appendChild(slider);
      controls.appendChild(percent);
      row.appendChild(controls);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '6px';
      btnRow.style.marginTop = '8px';

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.className = 'inspector-add-btn';
      applyBtn.style.flex = '1';
      applyBtn.addEventListener('click', async () => {
        const ratio = Number(slider.value) / 100;
        if (ratio >= 0.99) return;
        applyBtn.textContent = 'Decimating…';
        applyBtn.disabled = true;
        try {
          const { decimateGeometry, snapshotGeometry, restoreGeometry } = await import('../engine/MeshOps');
          const before = snapshotGeometry(mesh.geometry);
          const next = await decimateGeometry(mesh.geometry, ratio);
          mesh.geometry.dispose();
          mesh.geometry = next;
          const after = snapshotGeometry(mesh.geometry);
          this.history.record({
            label: `Decimate to ${slider.value}%`,
            do: () => restoreGeometry(mesh, after),
            undo: () => restoreGeometry(mesh, before),
          });
          this.scene.notifyChanged();
          update();
        } catch (err) {
          console.error('[Inspector] decimate failed:', err);
        }
        applyBtn.textContent = 'Apply';
        applyBtn.disabled = false;
        slider.value = '100';
        percent.textContent = '100%';
      });
      btnRow.appendChild(applyBtn);

      row.appendChild(btnRow);
      body.appendChild(row);
    });
  }

  tick() {
    // The user can drag in the viewport (once TransformControls lands) — refresh
    // the inputs from the live object so they don't go stale.
    const obj = this.current;
    if (!obj) return;
    this.syncVec3('pos', obj.position);
    this.syncVec3('scl', obj.scale);
    this.syncEuler(obj);
  }

  private section(title: string, build: (body: HTMLElement) => void) {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-section';
    const head = document.createElement('div');
    head.className = 'inspector-section-head';
    head.textContent = title;
    const body = document.createElement('div');
    body.className = 'inspector-section-body';
    wrap.appendChild(head);
    wrap.appendChild(body);
    this.el.appendChild(wrap);
    build(body);
  }

  private nameField(parent: HTMLElement, obj: THREE.Object3D) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = 'Name';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = obj.name || '';
    input.addEventListener('change', () => {
      obj.name = input.value;
      this.scene.notifyChanged();
    });
    row.appendChild(label);
    row.appendChild(input);
    parent.appendChild(row);
  }

  private typeRow(parent: HTMLElement, obj: THREE.Object3D) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = 'Type';
    const val = document.createElement('span');
    val.className = 'inspector-readonly';
    val.textContent = obj.type;
    row.appendChild(label);
    row.appendChild(val);
    parent.appendChild(row);
  }

  private vec3Row(parent: HTMLElement, key: string, title: string, v: THREE.Vector3) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = title;
    row.appendChild(label);
    const group = document.createElement('div');
    group.className = 'inspector-vec3';
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.05';
      input.value = v[axis].toFixed(3);
      input.addEventListener('focus', () => this.captureTransformSnapshot());
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        if (Number.isFinite(n)) v[axis] = n;
      });
      input.addEventListener('blur', () => this.recordTransformIfChanged());
      this.inputs[`${key}.${axis}`] = input;
      group.appendChild(input);
    });
    row.appendChild(group);
    parent.appendChild(row);
  }

  private vec3RowEuler(parent: HTMLElement, key: string, title: string, obj: THREE.Object3D) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = title;
    row.appendChild(label);
    const group = document.createElement('div');
    group.className = 'inspector-vec3';
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = THREE.MathUtils.radToDeg(obj.rotation[axis]).toFixed(1);
      input.addEventListener('focus', () => this.captureTransformSnapshot());
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        if (Number.isFinite(n)) obj.rotation[axis] = THREE.MathUtils.degToRad(n);
      });
      input.addEventListener('blur', () => this.recordTransformIfChanged());
      this.inputs[`${key}.${axis}`] = input;
      group.appendChild(input);
    });
    row.appendChild(group);
    parent.appendChild(row);
  }

  private renderScripts(obj: THREE.Object3D) {
    this.section('Scripts', (body) => {
      const descriptors = getScriptDescriptors(obj);
      if (descriptors.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'inspector-empty';
        empty.textContent = 'No scripts attached.';
        body.appendChild(empty);
      }
      descriptors.forEach((desc, i) => {
        body.appendChild(this.renderScriptRow(obj, desc, i));
      });
      const addBtn = document.createElement('button');
      addBtn.className = 'inspector-add-btn';
      addBtn.textContent = '+ Add Component';
      addBtn.addEventListener('click', (e) => this.openAddScriptMenu(obj, e.currentTarget as HTMLElement));
      body.appendChild(addBtn);
    });
  }

  private openAddScriptMenu(obj: THREE.Object3D, anchor: HTMLElement) {
    // Group by category so the menu reads like Unity's Add Component:
    // each header (Behavior, Camera, Audio, Physics, Paint, Player,
    // Animation, FX, User) is a separator; under each are the matching
    // scripts in registration order.
    const CATEGORY_ORDER = [
      'Behavior', 'Player', 'Paint', 'Camera',
      'Physics', 'Animation', 'Audio', 'FX', 'User',
    ];
    const defs = listScripts();
    const byCat = new Map<string, typeof defs>();
    for (const def of defs) {
      const cat = (def as { category?: string }).category ?? 'User';
      const arr = byCat.get(cat) ?? [];
      arr.push(def);
      byCat.set(cat, arr);
    }
    const items: Array<{ label: string; onClick: () => void } | { sep: true }> = [];
    let first = true;
    for (const cat of CATEGORY_ORDER) {
      const list = byCat.get(cat);
      if (!list || list.length === 0) continue;
      if (!first) items.push({ sep: true });
      first = false;
      // Add a non-clickable header by inserting a fake button styled separately
      // via the label prefix. Menu.ts doesn't support headers, so we encode it
      // visually with a leading "▸ " in caps.
      items.push({
        label: `── ${cat.toUpperCase()} ──`,
        onClick: () => { /* no-op header */ },
      });
      for (const def of list) {
        items.push({
          label: `  ${def.label}`,
          onClick: () => {
            addScriptDescriptor(obj, {
              type: def.type,
              params: defaultParamsFor(def.params),
            });
            this.scene.notifyChanged();
            this.show(obj);
          },
        });
      }
    }
    openMenuPopup(anchor, items);
  }

  private renderScriptRow(
    obj: THREE.Object3D,
    desc: ScriptDescriptor,
    index: number,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-script';
    const head = document.createElement('div');
    head.className = 'inspector-script-head';
    const title = document.createElement('span');
    title.className = 'inspector-script-name';
    title.textContent = desc.type;
    const remove = document.createElement('button');
    remove.className = 'inspector-script-remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      removeScriptDescriptor(obj, index);
      this.scene.notifyChanged();
      this.show(obj);
    });
    head.appendChild(title);
    head.appendChild(remove);
    wrap.appendChild(head);

    // Params form
    const def = listScripts().find((d) => d.type === desc.type);
    if (def) {
      const paramsBody = document.createElement('div');
      paramsBody.className = 'inspector-script-params';
      for (const p of def.params) {
        paramsBody.appendChild(this.renderParamRow(desc, p));
      }
      wrap.appendChild(paramsBody);
    }
    return wrap;
  }

  private renderParamRow(
    desc: ScriptDescriptor,
    p: ScriptParamDef,
  ): HTMLElement {
    const params = desc.params ?? (desc.params = {});
    if (params[p.key] === undefined) params[p.key] = p.default;
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = p.label;
    row.appendChild(label);
    if (p.kind === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      if (p.step != null) input.step = String(p.step);
      if (p.min != null) input.min = String(p.min);
      if (p.max != null) input.max = String(p.max);
      input.value = String(params[p.key] ?? p.default ?? 0);
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        if (Number.isFinite(n)) params[p.key] = n;
      });
      row.appendChild(input);
    } else if (p.kind === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(params[p.key]);
      input.addEventListener('change', () => {
        params[p.key] = input.checked;
      });
      row.appendChild(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(params[p.key] ?? p.default ?? '');
      input.addEventListener('input', () => {
        params[p.key] = input.value;
      });
      row.appendChild(input);
    }
    return row;
  }

  private captureTransformSnapshot() {
    if (this.current) this.focusSnapshot = snapshotTransform(this.current);
  }

  private recordTransformIfChanged() {
    if (!this.current || !this.focusSnapshot) return;
    const before = this.focusSnapshot;
    const after = snapshotTransform(this.current);
    this.focusSnapshot = null;
    if (!transformsEqual(before, after)) {
      this.history.record(new TransformCommand(this.current, before, after));
    }
  }

  private numberRow(
    parent: HTMLElement,
    key: string,
    title: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('span');
    out.className = 'inspector-readonly';
    out.textContent = value.toFixed(2);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = v.toFixed(2);
      onChange(v);
    });
    this.inputs[key] = input;
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(out);
    parent.appendChild(row);
  }

  private colorRow(parent: HTMLElement, key: string, title: string, color: THREE.Color) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#' + color.getHexString();
    input.addEventListener('input', () => {
      color.set(input.value);
    });
    this.inputs[key] = input;
    row.appendChild(label);
    row.appendChild(input);
    parent.appendChild(row);
  }

  private syncVec3(key: string, v: THREE.Vector3) {
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const input = this.inputs[`${key}.${axis}`];
      if (input && document.activeElement !== input) {
        input.value = v[axis].toFixed(3);
      }
    });
  }

  private syncEuler(obj: THREE.Object3D) {
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const input = this.inputs[`rot.${axis}`];
      if (input && document.activeElement !== input) {
        input.value = THREE.MathUtils.radToDeg(obj.rotation[axis]).toFixed(1);
      }
    });
  }
}

function defaultParamsFor(params: ScriptParamDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    if (p.default !== undefined) out[p.key] = p.default;
  }
  return out;
}

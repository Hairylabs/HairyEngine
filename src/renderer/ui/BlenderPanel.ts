import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Scene } from '../engine/Scene';
import { History as UndoHistory } from '../engine/History';
import { AddObjectCommand } from '../engine/Commands';
import { attachAnimations } from '../engine/Animations';

// Right-pane companion to the Inspector. Talks to the Blender MCP addon
// (port 9876) and lets the user:
//   - Connect / disconnect
//   - Run a quick "Get Scene Info" / "Get Viewport Screenshot" probe
//   - Send arbitrary Python (`execute_code`) and see stdout / errors
//   - Import a local GLB (file dialog → GLTFLoader) into the engine scene
//
// AI "chat with Claude" will plug in here later — for now the chat box is
// raw Python so we have a working tool without an API key.

type Role = 'user' | 'blender' | 'system';

const gltfLoader = new GLTFLoader();

export class BlenderPanel {
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private historyEl: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private connectBtn: HTMLButtonElement;
  private connected = false;
  private busy = false;

  constructor(
    private root: HTMLElement,
    private scene: Scene,
    private history: UndoHistory,
  ) {
    root.innerHTML = `
      <div class="blender-toolbar">
        <span class="status-dot" id="blender-dot"></span>
        <span class="status-text" id="blender-status">disconnected</span>
        <button id="blender-connect" class="blender-btn">Connect</button>
      </div>
      <div class="blender-quick">
        <button data-action="scene" class="blender-quick-btn">Scene info</button>
        <button data-action="shot" class="blender-quick-btn">Screenshot</button>
        <button data-action="import-glb" class="blender-quick-btn">Import GLB…</button>
      </div>
      <div class="blender-quick">
        <button data-action="from-blender" class="blender-quick-btn primary">⬇ Import from Blender (selected)</button>
        <button data-action="to-blender" class="blender-quick-btn primary">⬆ Send selection to Blender</button>
      </div>
      <div class="blender-history" id="blender-history"></div>
      <div class="blender-input">
        <textarea id="blender-input" rows="3" placeholder="Python to run in Blender — Ctrl+Enter to send. e.g. bpy.ops.mesh.primitive_monkey_add()"></textarea>
        <button id="blender-send" class="blender-btn primary">Send</button>
      </div>
    `;

    this.statusDot = root.querySelector('#blender-dot') as HTMLElement;
    this.statusText = root.querySelector('#blender-status') as HTMLElement;
    this.historyEl = root.querySelector('#blender-history') as HTMLElement;
    this.input = root.querySelector('#blender-input') as HTMLTextAreaElement;
    this.sendBtn = root.querySelector('#blender-send') as HTMLButtonElement;
    this.connectBtn = root.querySelector('#blender-connect') as HTMLButtonElement;

    this.connectBtn.addEventListener('click', () => this.toggleConnection());
    this.sendBtn.addEventListener('click', () => this.sendPython());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.sendPython();
      }
    });
    root.querySelectorAll<HTMLButtonElement>('.blender-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.runQuick(btn.dataset.action ?? ''));
    });

    this.appendMessage(
      'system',
      'Make sure Blender is open with the MCP addon enabled and the server started (Sidebar > BlenderMCP > Start Server). Then click Connect.',
    );

    this.refreshStatus();
  }

  private async refreshStatus() {
    try {
      const s = await window.hairy.blender.status();
      this.setConnected(s.connected);
    } catch {
      this.setConnected(false);
    }
  }

  private setConnected(connected: boolean) {
    this.connected = connected;
    this.statusDot.classList.toggle('connected', connected);
    this.statusText.textContent = connected ? 'connected to localhost:9876' : 'disconnected';
    this.connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  }

  private async toggleConnection() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.connected) {
        await window.hairy.blender.disconnect();
        this.appendMessage('system', 'Disconnected.');
        this.setConnected(false);
      } else {
        const r = await window.hairy.blender.connect();
        if (r.ok) {
          this.appendMessage('system', 'Connected to Blender at localhost:9876.');
          this.setConnected(true);
        } else {
          this.appendMessage('system', `Connect failed: ${r.error}`);
          this.setConnected(false);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async sendPython() {
    const code = this.input.value.trim();
    if (!code || this.busy) return;
    this.busy = true;
    this.input.value = '';
    this.appendMessage('user', code);
    try {
      if (!this.connected) {
        const c = await window.hairy.blender.connect();
        if (!c.ok) {
          this.appendMessage('system', `Connect failed: ${c.error}`);
          this.busy = false;
          return;
        }
        this.setConnected(true);
      }
      const res = await window.hairy.blender.send('execute_code', { code });
      this.renderResponse(res);
    } finally {
      this.busy = false;
    }
  }

  private async runQuick(action: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (action === 'scene') {
        await this.ensureConnected();
        this.appendMessage('user', 'get_scene_info');
        const r = await window.hairy.blender.send('get_scene_info');
        this.renderResponse(r);
      } else if (action === 'shot') {
        await this.ensureConnected();
        this.appendMessage('user', 'get_viewport_screenshot');
        const r = await window.hairy.blender.send('get_viewport_screenshot', {
          max_size: 1024,
        });
        this.renderScreenshot(r);
      } else if (action === 'import-glb') {
        await this.importLocalGlb();
      } else if (action === 'from-blender') {
        await this.importFromBlender();
      } else if (action === 'to-blender') {
        await this.exportSelectionToBlender();
      }
    } finally {
      this.busy = false;
    }
  }

  private async importFromBlender() {
    if (!(await this.ensureConnected())) return;
    const tempDir = await window.hairy.bridge.tempDir();
    const id = Math.random().toString(36).slice(2, 10);
    // Blender writes a GLB containing the active selection to tempDir/id.glb,
    // then we read it back and import into the engine scene.
    const blenderPath = `${tempDir.replace(/\\/g, '/')}/bridge-${id}.glb`;
    const code = `
import bpy
import os
out_path = r'${blenderPath.replace(/'/g, "\\'")}'
os.makedirs(os.path.dirname(out_path), exist_ok=True)
selected = [o for o in bpy.context.selected_objects]
if not selected and bpy.context.active_object:
    selected = [bpy.context.active_object]
if not selected:
    raise Exception('Nothing selected in Blender')
bpy.ops.export_scene.gltf(filepath=out_path, use_selection=True, export_format='GLB', export_apply=True)
print(out_path)
`.trim();
    this.appendMessage('user', 'Importing from Blender (selected)…');
    const r = await window.hairy.blender.send('execute_code', { code });
    if (r.status === 'error') {
      this.appendMessage('blender', r.message, true);
      return;
    }
    const localPath = blenderPath.replace(/\//g, '\\'); // Windows path for fs.readFile
    const fileR = await window.hairy.bridge.readGlb(localPath);
    if (!fileR.ok) {
      this.appendMessage('blender', `Read failed: ${fileR.error}`, true);
      return;
    }
    try {
      const gltf = await gltfLoader.parseAsync(fileR.bytes, '');
      const root = gltf.scene;
      root.name = root.name || `from-blender-${id}`;
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
      this.appendMessage('blender', `Imported "${root.name}" from Blender.`);
    } catch (err) {
      this.appendMessage('blender', `Parse failed: ${(err as Error).message}`, true);
    }
  }

  private async exportSelectionToBlender() {
    if (!this.scene.selection) {
      this.appendMessage('system', 'No HairyEngine object selected. Click one in the viewport first.');
      return;
    }
    if (!(await this.ensureConnected())) return;
    const tempDir = await window.hairy.bridge.tempDir();
    const id = Math.random().toString(36).slice(2, 10);
    const blenderPath = `${tempDir.replace(/\\/g, '/')}/to-blender-${id}.glb`;

    // Export the selected Three.js subtree as GLB using GLTFExporter.
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const gltf = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        this.scene.selection as THREE.Object3D,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLTFExporter returned non-binary'));
        },
        (err) => reject(err),
        { binary: true },
      );
    });

    const writeR = await window.hairy.bridge.writeGlb(
      blenderPath.replace(/\//g, '\\'),
      gltf,
    );
    if (!writeR.ok) {
      this.appendMessage('system', `Write failed: ${writeR.error}`);
      return;
    }
    this.appendMessage('user', `Sending "${this.scene.selection.name}" to Blender…`);
    const code = `
import bpy
in_path = r'${blenderPath.replace(/'/g, "\\'")}'
bpy.ops.import_scene.gltf(filepath=in_path)
print(f'Imported {in_path}')
`.trim();
    const r = await window.hairy.blender.send('execute_code', { code });
    if (r.status === 'error') {
      this.appendMessage('blender', r.message, true);
    } else {
      this.appendMessage('blender', 'Sent — check Blender for the imported object.');
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.connected) return true;
    const r = await window.hairy.blender.connect();
    if (r.ok) {
      this.setConnected(true);
      return true;
    }
    this.appendMessage('system', `Connect failed: ${r.error}`);
    return false;
  }

  private renderResponse(
    res:
      | { status: 'success'; result?: unknown }
      | { status: 'error'; message: string },
  ) {
    if (res.status === 'error') {
      this.appendMessage('blender', `error: ${res.message}`, true);
      return;
    }
    const body = res.result === undefined ? 'ok' : this.formatResult(res.result);
    this.appendMessage('blender', body);
  }

  private renderScreenshot(
    res:
      | { status: 'success'; result?: unknown }
      | { status: 'error'; message: string },
  ) {
    if (res.status === 'error') {
      this.appendMessage('blender', `error: ${res.message}`, true);
      return;
    }
    // The addon returns the screenshot as a file path on disk; we can't read
    // that from the renderer, so just show the path. Future: pipe through main.
    this.appendMessage('blender', this.formatResult(res.result));
  }

  private formatResult(r: unknown): string {
    if (typeof r === 'string') return r;
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r);
    }
  }

  private appendMessage(role: Role, text: string, isError = false) {
    const row = document.createElement('div');
    row.className = `blender-msg blender-msg-${role}${isError ? ' is-error' : ''}`;
    const head = document.createElement('div');
    head.className = 'blender-msg-head';
    head.textContent = role === 'user' ? 'You' : role === 'blender' ? 'Blender' : '·';
    const body = document.createElement('pre');
    body.className = 'blender-msg-body';
    body.textContent = text;
    row.appendChild(head);
    row.appendChild(body);
    this.historyEl.appendChild(row);
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private async importLocalGlb() {
    const r = await window.hairy.dialog.openGlb();
    if (r.canceled) return;
    if ('error' in r) {
      this.appendMessage('system', `Open failed: ${r.error}`);
      return;
    }
    this.appendMessage('system', `Loading ${r.filePath}…`);
    try {
      const gltf = await gltfLoader.parseAsync(r.bytes, '');
      const root = gltf.scene;
      root.name = filenameOf(r.filePath);
      // Normalize: cast shadows on meshes
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
      this.appendMessage('system', `Imported "${root.name}".`);
    } catch (err) {
      this.appendMessage('system', `Import failed: ${(err as Error).message}`);
    }
  }
}

function filenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = i >= 0 ? p.slice(i + 1) : p;
  return base.replace(/\.[^.]+$/, '');
}

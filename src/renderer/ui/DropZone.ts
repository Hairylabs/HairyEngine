import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Scene } from '../engine/Scene';
import { Project } from '../engine/Project';
import { History } from '../engine/History';
import { AddObjectCommand } from '../engine/Commands';
import { attachAnimations } from '../engine/Animations';

// Viewport drag-and-drop:
//   .glb / .gltf  -> parse with GLTFLoader, add to scene, auto-select
//   .hairy / .json -> load as project (after confirming dirty discard)
// File contents are read directly from the DataTransfer object so we don't
// need Electron's webUtils.getPathForFile (deprecated/removed paths in 32+).

const gltfLoader = new GLTFLoader();

export class DropZone {
  private overlay: HTMLElement;
  private dragDepth = 0;

  constructor(
    private viewportEl: HTMLElement,
    private scene: Scene,
    private project: Project,
    private history: History,
    private onMessage: (msg: string) => void,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'drop-overlay';
    this.overlay.innerHTML = '<span>Drop GLB / FBX / .hairy file</span>';
    this.overlay.hidden = true;
    viewportEl.appendChild(this.overlay);

    viewportEl.addEventListener('dragenter', this.onDragEnter);
    viewportEl.addEventListener('dragover', this.onDragOver);
    viewportEl.addEventListener('dragleave', this.onDragLeave);
    viewportEl.addEventListener('drop', this.onDrop);
  }

  private onDragEnter = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.overlay.hidden = false;
  };

  private onDragOver = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  private onDragLeave = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.overlay.hidden = true;
  };

  private onDrop = async (e: DragEvent) => {
    e.preventDefault();
    this.dragDepth = 0;
    this.overlay.hidden = true;

    // Asset Browser drag (internal): payload is an absolute path to a library asset.
    const assetPath = e.dataTransfer?.getData('application/x-hairyengine-asset');
    if (assetPath) {
      await this.spawnLibraryAsset(assetPath);
      return;
    }

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.glb') || name.endsWith('.gltf')) {
        await this.importGltf(file);
      } else if (name.endsWith('.fbx')) {
        await this.importFbx(file);
      } else if (name.endsWith('.hairy') || name.endsWith('.json')) {
        await this.openProject(file);
      } else {
        this.onMessage(`Unsupported file: ${file.name}`);
      }
    }
  };

  private async importFbx(file: File) {
    try {
      const bytes = await file.arrayBuffer();
      const loader = new FBXLoader();
      const root = loader.parse(bytes, '');
      root.name = file.name.replace(/\.[^.]+$/, '');
      // FBXLoader returns clips on the root's animations array
      const animations = (root as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      if (animations.length > 0) {
        attachAnimations(root, animations);
      }
      this.history.push(new AddObjectCommand(this.scene, root));
      this.onMessage(
        `Imported FBX "${root.name}"${animations.length ? ` (${animations.length} anim${animations.length === 1 ? '' : 's'})` : ''}`,
      );
    } catch (err) {
      this.onMessage(`FBX import failed: ${(err as Error).message}`);
    }
  }

  private async spawnLibraryAsset(path: string) {
    const r = await window.hairy.assets.read(path);
    if (!r.ok) {
      this.onMessage(`Could not read asset: ${r.error}`);
      return;
    }
    try {
      const gltf = await gltfLoader.parseAsync(r.bytes, '');
      const root = gltf.scene;
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const name = slash >= 0 ? path.slice(slash + 1) : path;
      root.name = name.replace(/\.[^.]+$/, '');
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

  private async importGltf(file: File) {
    try {
      const bytes = await file.arrayBuffer();
      const gltf = await gltfLoader.parseAsync(bytes, '');
      const root = gltf.scene;
      root.name = file.name.replace(/\.[^.]+$/, '');
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      // Stash animations + clip names so the AnimationPlayer script can pick
      // them up. The clips themselves don't survive toJSON; we cache them on a
      // weak runtime map elsewhere.
      if (gltf.animations && gltf.animations.length > 0) {
        attachAnimations(root, gltf.animations);
      }
      this.history.push(new AddObjectCommand(this.scene, root));
      this.onMessage(
        `Imported "${root.name}"${gltf.animations?.length ? ` (${gltf.animations.length} anim${gltf.animations.length === 1 ? '' : 's'})` : ''}`,
      );
    } catch (err) {
      this.onMessage(`Import failed: ${(err as Error).message}`);
    }
  }

  private async openProject(file: File) {
    const text = await file.text();
    const ok = await this.project.loadFromText(text, file.name);
    if (ok) this.onMessage(`Loaded "${file.name}" — Save As to persist its path`);
  }

  private hasFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }
}

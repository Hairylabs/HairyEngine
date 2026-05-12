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
      } else if (/\.(png|jpg|jpeg|webp|bmp)$/.test(name)) {
        // External image drop: save it into the asset library so the user
        // can re-use it, then apply to selection if there is one.
        await this.importToLibraryAndOptionallyApply(file, 'image');
      } else if (/\.(mp3|wav|ogg|m4a)$/.test(name)) {
        await this.importToLibraryAndOptionallyApply(file, 'audio');
      } else {
        this.onMessage(`Unsupported file: ${file.name}`);
      }
    }
  };

  private async importToLibraryAndOptionallyApply(file: File, kind: 'image' | 'audio') {
    const bytes = await file.arrayBuffer();
    const r = await window.hairy.assets.writeBinary(file.name, bytes);
    if (!r.ok) {
      this.onMessage(`Library write failed: ${r.error}`);
      return;
    }
    this.onMessage(`Saved ${file.name} to library`);
    // If there's a selection, apply the dropped file to it immediately.
    if (this.scene.selection) {
      if (kind === 'image') await this.applyImageTexture(r.path);
      else await this.attachAudioSource(r.path);
    }
  }

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
    // Internal asset paths can be:
    //   "script:<id>"       — a user-defined script; attach to selection
    //   "/path/to/file.glb" — a real file on disk; route by extension
    if (path.startsWith('script:')) {
      await this.attachUserScript(path.replace(/^script:/, ''));
      return;
    }
    const lower = path.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.bmp')) {
      await this.applyImageTexture(path);
      return;
    }
    if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') || lower.endsWith('.m4a')) {
      await this.attachAudioSource(path);
      return;
    }
    // Route by extension. FBX / OBJ have their own loaders.
    const r = await window.hairy.assets.read(path);
    if (!r.ok) {
      this.onMessage(`Could not read asset: ${r.error}`);
      return;
    }
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const fileName = slash >= 0 ? path.slice(slash + 1) : path;
    try {
      let root: THREE.Object3D;
      let animations: THREE.AnimationClip[] = [];
      if (lower.endsWith('.fbx')) {
        const loader = new FBXLoader();
        root = loader.parse(r.bytes, '');
        animations = (root as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
      } else if (lower.endsWith('.obj')) {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        const text = new TextDecoder().decode(r.bytes);
        root = loader.parse(text);
      } else {
        const gltf = await gltfLoader.parseAsync(r.bytes, '');
        root = gltf.scene;
        animations = gltf.animations ?? [];
      }
      root.name = fileName.replace(/\.[^.]+$/, '');
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
      this.onMessage(`Spawned "${root.name}"${animations.length ? ` (${animations.length} anim${animations.length === 1 ? '' : 's'})` : ''}`);
    } catch (err) {
      this.onMessage(`Spawn failed: ${(err as Error).message}`);
    }
  }

  /** Drop an image onto the viewport → apply it as the diffuse texture of
   *  whatever mesh sits under the cursor, or the currently selected mesh. */
  private async applyImageTexture(path: string) {
    const target = this.scene.selection as THREE.Mesh | null;
    if (!target || !target.isMesh) {
      this.onMessage('Select a mesh first, then drop the image to use it as a texture');
      return;
    }
    const r = await window.hairy.assets.read(path);
    if (!r.ok) {
      this.onMessage(`Could not read image: ${r.error}`);
      return;
    }
    const blob = new Blob([r.bytes]);
    const url = URL.createObjectURL(blob);
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = target.material as THREE.MeshStandardMaterial;
      if (mat && 'map' in mat) {
        mat.map = tex;
        if (mat.color) mat.color.set('#ffffff');
        mat.needsUpdate = true;
        this.onMessage(`Applied texture to "${target.name}"`);
      }
      URL.revokeObjectURL(url);
    }, undefined, (err) => {
      this.onMessage(`Texture load failed: ${(err as ErrorEvent).message ?? err}`);
      URL.revokeObjectURL(url);
    });
  }

  /** Drop an audio asset → add an AudioSource script to the selected actor
   *  (or to a new empty actor at the drop location if nothing's selected). */
  private async attachAudioSource(path: string) {
    const target = this.scene.selection;
    if (!target) {
      this.onMessage('Select an actor first, then drop the audio file to attach it');
      return;
    }
    const scripts = (target.userData.__scripts as Array<{ type: string; params?: Record<string, unknown> }> | undefined) ?? [];
    scripts.push({ type: 'AudioSource', params: { src: path } });
    target.userData.__scripts = scripts;
    this.scene.notifyChanged();
    this.scene.select(target);
    this.onMessage(`Attached AudioSource (${path.split(/[\\/]/).pop()}) to "${target.name}"`);
  }

  /** Drop a user-defined script onto an actor → attach it as a component. */
  private async attachUserScript(scriptId: string) {
    const target = this.scene.selection;
    if (!target) {
      this.onMessage('Select an actor first, then drop the script onto the viewport');
      return;
    }
    const mod = await import('../engine/UserScripts');
    const script = mod.getUserScript(scriptId);
    if (!script) {
      this.onMessage('Script no longer exists');
      return;
    }
    const scripts = (target.userData.__scripts as Array<{ type: string; params?: Record<string, unknown> }> | undefined) ?? [];
    scripts.push({ type: script.type, params: {} });
    target.userData.__scripts = scripts;
    this.scene.notifyChanged();
    this.scene.select(target);
    this.onMessage(`Attached "${script.name}" to "${target.name}"`);
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

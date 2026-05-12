import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Scene } from './Scene';
import { EditorCamera } from './EditorCamera';
import { Gizmo, GizmoMode } from './Gizmo';
import { History } from './History';
import {
  TransformCommand,
  snapshotTransform,
  transformsEqual,
} from './Commands';
import { input } from './Input';
import { PlayState } from './PlayState';
import { ScriptSystem } from './ScriptSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { AnimationSystem } from './AnimationSystem';

// Viewport owns the renderer + editor camera + render loop + selection visuals.
// Composer adds an outline pass so selected objects glow. Gizmo lives here so
// pointer events on its handles can suppress the click-to-select pick.

export type TickFn = (dt: number, fps: number) => void;
export type ModeListener = (mode: GizmoMode) => void;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly editorCamera: EditorCamera;
  readonly gizmo: Gizmo;
  private composer: EffectComposer;
  private outline: OutlinePass;
  private clock = new THREE.Clock();
  private fpsSamples: number[] = [];
  private selected: THREE.Object3D | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt = { x: 0, y: 0, t: 0, onGizmo: false };

  readonly scriptSystem: ScriptSystem;
  readonly physics: PhysicsSystem;
  readonly animations: AnimationSystem;
  // Active camera each frame — usually the editor camera, but Play Mode can
  // swap to a scene camera marked as `isMainCamera`.
  private activeCamera: THREE.PerspectiveCamera;

  constructor(
    private canvas: HTMLCanvasElement,
    private hostEl: HTMLElement,
    private scene: Scene,
    private history: History,
    private play: PlayState,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);
    this.camera.position.set(5, 4, 6);
    this.camera.lookAt(0, 0.5, 0);
    this.activeCamera = this.camera;

    this.editorCamera = new EditorCamera(this.camera, canvas);
    this.gizmo = new Gizmo(this.camera, canvas, scene.three);
    this.scriptSystem = new ScriptSystem(scene, input, this.camera, play);
    this.physics = new PhysicsSystem(scene, play);
    this.animations = new AnimationSystem(scene, play);
    input.bind(canvas);

    // Hide camera helpers + camera frustum gizmos during play (they're
    // editor-only visual aids that would otherwise show in the rendered frame).
    play.onChange((mode) => {
      this.setHelpersVisible(mode !== 'play');
      this.activeCamera = mode === 'play' ? this.findMainCamera() : this.camera;
    });

    let dragSnapshot: ReturnType<typeof snapshotTransform> | null = null;
    let dragTarget: THREE.Object3D | null = null;

    this.gizmo.onDraggingChanged((dragging) => {
      this.editorCamera.setEnabled(!dragging);
      if (dragging) {
        dragTarget = this.selected;
        dragSnapshot = dragTarget ? snapshotTransform(dragTarget) : null;
      } else if (dragTarget && dragSnapshot) {
        const after = snapshotTransform(dragTarget);
        if (!transformsEqual(dragSnapshot, after)) {
          this.history.record(
            new TransformCommand(dragTarget, dragSnapshot, after),
          );
        }
        dragTarget = null;
        dragSnapshot = null;
      }
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene.three, this.camera));
    this.outline = new OutlinePass(
      new THREE.Vector2(1, 1),
      scene.three,
      this.camera,
    );
    this.outline.edgeStrength = 4;
    this.outline.edgeGlow = 0.5;
    this.outline.edgeThickness = 1;
    this.outline.pulsePeriod = 0;
    this.outline.visibleEdgeColor.set('#4cf8c5');
    this.outline.hiddenEdgeColor.set('#1a4a3a');
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    this.setupResize();
    this.setupPicking();
  }

  start(onTick: TickFn) {
    const loop = () => {
      const dt = Math.min(0.05, this.clock.getDelta());
      if (this.play.isPlaying()) {
        // In Play Mode: physics ticks first (so positions are fresh for scripts
        // that read them), then scripts drive the world (which may move
        // kinematic bodies), then animations advance the skeletal state.
        this.physics.step(dt);
        this.scriptSystem.update(dt);
        this.animations.update(dt);
      } else {
        this.editorCamera.update(dt);
      }
      // Re-render with the active camera. Composer was wired with this.camera
      // at construction so for scene cameras we use renderer directly to bypass
      // the composer cache. (Outline pass still works for editor camera.)
      if (this.activeCamera === this.camera) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene.three, this.activeCamera);
      }
      input.endFrame();

      const fps = this.measureFps(dt);
      onTick(dt, fps);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setSelected(obj: THREE.Object3D | null) {
    this.selected = obj;
    this.gizmo.attach(obj);
    this.outline.selectedObjects = obj ? [obj] : [];
  }

  private findMainCamera(): THREE.PerspectiveCamera {
    // First scene camera with userData.isMainCamera === true wins. Otherwise
    // fall back to the editor camera so the user sees something rather than
    // a black screen.
    const cameras: THREE.PerspectiveCamera[] = [];
    this.scene.editable.traverse((obj) => {
      const cam = obj as THREE.PerspectiveCamera;
      if (cam.isCamera && obj.userData.isMainCamera) {
        cameras.push(cam);
      }
    });
    const found = cameras[0];
    if (found) {
      const w = this.hostEl.clientWidth || 1;
      const h = this.hostEl.clientHeight || 1;
      found.aspect = w / h;
      found.updateProjectionMatrix();
      return found;
    }
    return this.camera;
  }

  private setHelpersVisible(visible: boolean) {
    this.scene.editable.traverse((obj) => {
      if (obj.userData.isCameraHelper) obj.visible = visible;
    });
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmo.setMode(mode);
  }

  onGizmoModeChanged(l: ModeListener) {
    this.gizmo.onModeChanged(l);
  }

  focusSelected() {
    const obj = this.selected;
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.editorCamera.frame(center, Math.max(2, size * 1.8));
  }

  private setupResize() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.hostEl);
    this.resize();
  }

  private resize() {
    const w = this.hostEl.clientWidth;
    const h = this.hostEl.clientHeight;
    if (w === 0 || h === 0) return;
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w * pr, h * pr);
    this.outline.setSize(w * pr, h * pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private setupPicking() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.downAt = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        // If TransformControls is hovered, swallow the click so it doesn't reselect.
        onGizmo: this.gizmo.controls.axis !== null,
      };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      const dx = e.clientX - this.downAt.x;
      const dy = e.clientY - this.downAt.y;
      const dt = performance.now() - this.downAt.t;
      if (dx * dx + dy * dy > 9 || dt > 400) return;
      if (this.downAt.onGizmo) return;

      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);

      const hits = this.raycaster.intersectObjects(this.scene.editable.children, true);
      if (hits.length === 0) {
        this.scene.select(null);
        return;
      }
      let hit: THREE.Object3D = hits[0].object;
      while (hit.parent && hit.parent !== this.scene.editable) {
        hit = hit.parent;
      }
      this.scene.select(hit);
    });
  }

  private measureFps(dt: number): number {
    if (dt <= 0) return 60;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    let sum = 0;
    for (const f of this.fpsSamples) sum += f;
    return sum / this.fpsSamples.length;
  }
}

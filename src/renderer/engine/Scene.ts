import * as THREE from 'three';

// The Scene wraps THREE.Scene and owns the selection model + change notifications
// so the UI panels and viewport can subscribe without each polling Three internals.

export type SelectionListener = (obj: THREE.Object3D | null) => void;
export type SceneListener = () => void;

export class Scene {
  readonly three = new THREE.Scene();
  readonly editable = new THREE.Group(); // user-spawned objects live here
  private _selection: THREE.Object3D | null = null;
  private selectionListeners: SelectionListener[] = [];
  private sceneListeners: SceneListener[] = [];

  constructor() {
    this.three.name = 'HairyEngine Scene';
    this.editable.name = 'Editable';
    this.editable.userData.locked = true; // the group itself is structural, not deletable
    this.editable.userData.deletable = false;
    this.three.add(this.editable);
  }

  get selection(): THREE.Object3D | null {
    return this._selection;
  }

  select(obj: THREE.Object3D | null) {
    if (this._selection === obj) return;
    this._selection = obj;
    this.selectionListeners.forEach((l) => l(obj));
  }

  // Canonical mutator. Routes through this so listeners fire consistently.
  // Use AddObjectCommand via History for user-driven actions; call this
  // directly for engine-driven structural changes (load, reset).
  addInternal(obj: THREE.Object3D) {
    this.editable.add(obj);
    this.sceneListeners.forEach((l) => l());
  }

  removeInternal(obj: THREE.Object3D) {
    obj.removeFromParent();
    if (this._selection === obj) this.select(null);
    this.sceneListeners.forEach((l) => l());
  }

  // Backward-compat shims — the rest of the codebase still calls these.
  // New code should explicitly push commands through History instead.
  add(obj: THREE.Object3D) {
    this.addInternal(obj);
  }

  remove(obj: THREE.Object3D) {
    this.removeInternal(obj);
  }

  onSelectionChanged(l: SelectionListener) {
    this.selectionListeners.push(l);
  }

  onSceneChanged(l: SceneListener) {
    this.sceneListeners.push(l);
  }

  notifyChanged() {
    this.sceneListeners.forEach((l) => l());
  }

  // --- Grid settings ------------------------------------------------------
  // Grid spacing (meters per cell) and listeners so the toolbar UI + gizmo
  // snap can react. Rebuilds the visible THREE.GridHelper so what the user
  // sees is exactly what they're snapped to.

  private gridSize = 1;
  private gridSizeListeners: Array<(size: number) => void> = [];

  getGridSize(): number {
    return this.gridSize;
  }

  setGridSize(size: number) {
    const s = Math.max(0.01, size);
    if (s === this.gridSize) return;
    this.gridSize = s;
    this.rebuildGridHelper();
    this.gridSizeListeners.forEach((l) => l(s));
  }

  onGridSizeChanged(l: (size: number) => void) {
    this.gridSizeListeners.push(l);
  }

  private rebuildGridHelper() {
    // Find and remove the existing grid helper, then rebuild at the new size.
    // Keep the ground plane in place — only the grid lines change.
    const existing = this.three.getObjectByName('Grid');
    if (existing) {
      this.three.remove(existing);
      (existing as unknown as { geometry?: { dispose: () => void } }).geometry?.dispose?.();
      (existing as unknown as { material?: { dispose: () => void } }).material?.dispose?.();
    }
    // Total extent stays at 60m; divisions = 60 / gridSize cells.
    const extent = 60;
    const divisions = Math.round(extent / this.gridSize);
    const grid = new THREE.GridHelper(extent, divisions, 0x80c0ff, 0x4a5060);
    grid.name = 'Grid';
    grid.position.y = 0.001;
    grid.userData.deletable = false;
    const mat = grid.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = 0.7;
    this.three.add(grid);
  }

  // Walk the editable group only — hierarchy panel doesn't need to show lights/grid.
  editableRoots(): THREE.Object3D[] {
    return this.editable.children;
  }

  // Serialize the editable subtree to a JSON-safe structure using Three's
  // built-in toJSON. Geometries are inlined as base64 blobs which keeps the
  // file self-contained at the cost of size — fine for v1.
  serialize(meta?: Record<string, unknown>): unknown {
    return {
      format: 'hairyengine-project',
      version: 1,
      createdAt: new Date().toISOString(),
      ...meta,
      editable: this.editable.toJSON(),
    };
  }

  // Inverse of serialize. Replaces the editable subtree; preserves the
  // grid/ground/lights that seedDefault put on the parent scene.
  deserialize(data: unknown): { warnings: string[] } {
    const warnings: string[] = [];
    if (!data || typeof data !== 'object') {
      throw new Error('not a HairyEngine project file');
    }
    const d = data as Record<string, unknown>;
    if (d.format !== 'hairyengine-project') {
      warnings.push(`Unexpected format: ${String(d.format)}`);
    }
    if (typeof d.version === 'number' && d.version > 1) {
      warnings.push(`Newer project format (v${d.version}); attempting to load anyway.`);
    }
    if (!d.editable) {
      throw new Error('project file missing "editable" subtree');
    }

    // Dynamically require ObjectLoader so the renderer doesn't pay the cost
    // of importing it until a project is actually opened.
    const ThreeNS = THREE as unknown as { ObjectLoader: new () => {
      parse: (json: unknown) => THREE.Object3D;
    } };
    const loader = new ThreeNS.ObjectLoader();
    const loaded = loader.parse(d.editable) as THREE.Object3D;

    // Clear existing editable children
    while (this.editable.children.length > 0) {
      this.editable.remove(this.editable.children[0]);
    }

    // Reparent loaded children
    while (loaded.children.length > 0) {
      const c = loaded.children[0];
      this.editable.add(c);
    }
    // Carry over loaded group's userData if useful
    if (loaded.userData) {
      Object.assign(this.editable.userData, loaded.userData);
    }
    this._selection = null;
    this.selectionListeners.forEach((l) => l(null));
    this.sceneListeners.forEach((l) => l());
    return { warnings };
  }

  seedDefault() {
    // Bright daylight setup — was too dark to see anything before. Now there's
    // strong hemisphere fill so even unlit faces are readable, a punchy
    // directional sun for shadows, and a mid-tone ground that contrasts the
    // grid lines.
    const ambient = new THREE.HemisphereLight(0xddebff, 0x404048, 1.4);
    ambient.name = 'Hemi';
    ambient.userData.deletable = false;
    this.three.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.name = 'Sun';
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15;
    sun.shadow.camera.bottom = -15;
    sun.shadow.bias = -0.0002;
    sun.userData.deletable = false;
    this.three.add(sun);

    // Subtle fill light from the opposite direction so unlit faces aren't black.
    const fill = new THREE.DirectionalLight(0x8aa8d8, 0.4);
    fill.position.set(-4, 3, -6);
    fill.name = 'Fill';
    fill.userData.deletable = false;
    this.three.add(fill);

    // Ground plane — light enough to see the grid against
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4e, roughness: 0.9, metalness: 0.0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'Ground';
    ground.userData.deletable = false;
    this.three.add(ground);

    // Major grid — clearer lines, every meter, plus a stronger center cross.
    const grid = new THREE.GridHelper(60, 60, 0x80c0ff, 0x4a5060);
    grid.name = 'Grid';
    grid.position.y = 0.001; // sit slightly above ground to avoid z-fighting
    grid.userData.deletable = false;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.7;
    this.three.add(grid);

    // A starter cube so first launch isn't an empty void
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff3a8c, roughness: 0.4, metalness: 0.1 }),
    );
    cube.position.set(0, 0.5, 0);
    cube.castShadow = true;
    cube.receiveShadow = true;
    cube.name = 'Cube';
    this.add(cube);

    // Brighter sky-blue background + pushed-out fog so distant objects don't disappear.
    this.three.background = new THREE.Color(0x1c2233);
    this.three.fog = new THREE.Fog(0x1c2233, 60, 140);
  }
}

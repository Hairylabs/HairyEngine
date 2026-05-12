import * as THREE from 'three';

// Factory functions for the +Add menu. Each builds a fresh, ready-to-add object;
// callers push the result into Scene so onSceneChanged listeners fire.

const PALETTE = [0xff3a8c, 0x4cf8c5, 0xffd166, 0x8a8aff, 0xff9f5a, 0x66c9ff];
let paletteIdx = 0;
function nextColor() {
  const c = PALETTE[paletteIdx % PALETTE.length];
  paletteIdx++;
  return c;
}

function standardMaterial() {
  return new THREE.MeshStandardMaterial({
    color: nextColor(),
    roughness: 0.5,
    metalness: 0.05,
  });
}

function mesh(geom: THREE.BufferGeometry, name: string) {
  const m = new THREE.Mesh(geom, standardMaterial());
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makeCube() {
  const m = mesh(new THREE.BoxGeometry(1, 1, 1), 'Cube');
  m.position.y = 0.5;
  return m;
}

export function makeSphere() {
  const m = mesh(new THREE.SphereGeometry(0.5, 32, 16), 'Sphere');
  m.position.y = 0.5;
  return m;
}

export function makeCylinder() {
  const m = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), 'Cylinder');
  m.position.y = 0.5;
  return m;
}

export function makePlane() {
  const m = mesh(new THREE.PlaneGeometry(2, 2), 'Plane');
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function makeTorus() {
  const m = mesh(new THREE.TorusKnotGeometry(0.4, 0.12, 96, 16), 'TorusKnot');
  m.position.y = 0.7;
  return m;
}

export function makePointLight() {
  const l = new THREE.PointLight(0xffe0a0, 1.5, 12, 1.5);
  l.position.set(0, 2, 0);
  l.castShadow = true;
  l.name = 'PointLight';
  const helper = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0 }),
  );
  helper.userData.lightHelper = true;
  l.add(helper);
  return l;
}

// Scene camera — a PerspectiveCamera placed in the scene. The Viewport finds
// the first object with userData.isMainCamera === true on Play and renders
// through it. CameraHelper gives a wireframe frustum so it's visible in the
// editor (helper is hidden during Play).
export function makeSceneCamera() {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.name = 'Camera';
  cam.position.set(0, 2, 5);
  cam.lookAt(0, 1, 0);
  cam.userData.isSceneCamera = true;
  // The CameraHelper is part of the camera so it moves/rotates with it.
  const helper = new THREE.CameraHelper(cam);
  helper.userData.isCameraHelper = true;
  helper.userData.deletable = false;
  cam.add(helper);
  return cam;
}

// A cube pre-set with a Rigidbody script so it falls under gravity in Play.
// Saves the user from manually attaching the component for a quick demo.
export function makePhysicsCube() {
  const m = mesh(new THREE.BoxGeometry(1, 1, 1), 'PhysicsCube');
  m.position.set(0, 3, 0);
  m.userData.__scripts = [
    { type: 'Rigidbody', params: { kind: 'dynamic', mass: 1, friction: 0.5, restitution: 0.2, shape: 'box' } },
  ];
  return m;
}

export function makePhysicsSphere() {
  const m = mesh(new THREE.SphereGeometry(0.5, 32, 16), 'PhysicsBall');
  m.position.set(0, 3, 0);
  m.userData.__scripts = [
    { type: 'Rigidbody', params: { kind: 'dynamic', mass: 1, friction: 0.4, restitution: 0.5, shape: 'sphere' } },
  ];
  return m;
}

// One-click FPS Player template. Drops a capsule the user can swap out for
// any humanoid GLB later, pre-wired with movement, camera, crosshair, shoot,
// and a default Mixamo-friendly position. Mirrors Unity's Starter Asset
// First-Person template that lets non-coders go from empty scene to playable
// character in a single click.
// --- Level-building primitives (Sprint 5: ProBuilder-style blockout) -------
//
// These are box-based shapes sized in meters and positioned so their bottom
// rests on y = floor. Combined with grid snap in the viewport gizmo, they
// give the artist the Hammer / CubeGrid "drop walls + floors on a grid"
// workflow without having to author meshes in Blender.

export function makeWall() {
  const m = mesh(new THREE.BoxGeometry(4, 3, 0.2), 'Wall');
  m.position.set(0, 1.5, 0);
  return m;
}

export function makeFloor() {
  const m = mesh(new THREE.BoxGeometry(8, 0.2, 8), 'Floor');
  m.position.set(0, 0.1, 0);
  return m;
}

export function makeRamp() {
  // Right-triangular prism: 4m long × 2m wide × 1m tall, sloping from y=0 at
  // the front edge (z=+1) to y=1 at the back edge (z=-1). Faces:
  //   bottom (y=0 quad), top (sloped quad), back vertical (z=-1 quad),
  //   left/right triangles.
  const tris: number[] = [];
  const v = (x: number, y: number, z: number) => tris.push(x, y, z);
  // bottom
  v(-2, 0, -1); v(2, 0, -1); v(2, 0, 1);
  v(-2, 0, -1); v(2, 0, 1); v(-2, 0, 1);
  // sloped top (front-bottom → front-bottom-other-end → back-top)
  v(-2, 0, 1); v(2, 0, 1); v(2, 1, -1);
  v(-2, 0, 1); v(2, 1, -1); v(-2, 1, -1);
  // back vertical
  v(-2, 0, -1); v(-2, 1, -1); v(2, 1, -1);
  v(-2, 0, -1); v(2, 1, -1); v(2, 0, -1);
  // right side triangle (x = +2)
  v(2, 0, -1); v(2, 1, -1); v(2, 0, 1);
  // left side triangle (x = -2)
  v(-2, 0, -1); v(-2, 0, 1); v(-2, 1, -1);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  geom.computeVertexNormals();
  const ramp = new THREE.Mesh(geom, standardMaterial());
  ramp.name = 'Ramp';
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  return ramp;
}

export function makeStairs() {
  // A 4-step staircase, each step 0.5m × 1m × 0.3m. Visually clean for blockout.
  const group = new THREE.Group();
  group.name = 'Stairs';
  for (let i = 0; i < 4; i++) {
    const step = mesh(new THREE.BoxGeometry(2, 0.3, 0.5), `Step${i}`);
    step.position.set(0, 0.15 + i * 0.3, -i * 0.5);
    group.add(step);
  }
  return group;
}

// Empty marker — useful for spawn points, capture flags, anything gameplay
// wants to reference by name. Renders a small wireframe diamond so it's
// visible in the editor; the wireframe is hidden in Play Mode (userData flag).
export function makeSpawnPoint() {
  const group = new THREE.Group();
  group.name = 'SpawnPoint';
  group.position.set(0, 0.5, 0);
  const helper = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4),
    new THREE.MeshBasicMaterial({ color: 0x4cf8c5, wireframe: true }),
  );
  helper.userData.isSpawnHelper = true;
  helper.userData.deletable = false;
  group.add(helper);
  return group;
}

export function makeFPSPlayer() {
  const group = new THREE.Group();
  group.name = 'Player';
  group.position.set(0, 1, 0);

  // Visual placeholder — a capsule the same size as the character collider.
  // The artist replaces this with a Mixamo / Ready-rigged humanoid GLB later;
  // CharacterController already uses a 0.4-radius / 1.8-height capsule collider.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xff3a8c, roughness: 0.6 }),
  );
  body.name = 'PlayerBody';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  group.userData.__scripts = [
    { type: 'CharacterController', params: {} },
    { type: 'Crosshair', params: {} },
    { type: 'Shooter', params: {} },
  ];
  return group;
}

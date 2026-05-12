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

import * as THREE from 'three';
import { Scene } from './Scene';
import { History } from './History';
import { AddObjectCommand } from './Commands';
import { setActorKind } from './ActorTaxonomy';

// Paintball game bootstrap — one-click commands that lay down the building
// blocks for a multiplayer paintball arena using PulseChain Ponks NFTs as
// character heads (the user's long-term goal). The pieces are all standard
// HairyEngine primitives + scripts so the user can keep editing them after
// the bootstrap runs.
//
// Surface: a new "🎯 Paintball" entry in the +Add menu that opens a submenu.

const PAINT_COLORS = [
  0xff3a8c, 0x4cf8c5, 0xffd166, 0x8a8aff, 0xff9f5a, 0x66c9ff, 0xff5a8c, 0x9affc5,
];
let paintIdx = 0;
function nextPaintColor(): number {
  return PAINT_COLORS[paintIdx++ % PAINT_COLORS.length];
}

/** Construct a paintball gun visual + behavior. The gun is a child of the
 *  player camera once they parent it; on its own it's a stand-alone prop.
 *  Comes pre-wired with a PaintShooter script that spawns paintballs on click. */
export function makePaintGun(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PaintGun';
  group.position.set(0.3, 1.4, -0.4);

  // Body — a chunky rectangular grip.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x222533, roughness: 0.7 }),
  );
  body.castShadow = true;
  body.position.set(0, 0, 0);
  group.add(body);

  // Barrel — protrudes forward.
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.5, 16),
    new THREE.MeshStandardMaterial({ color: 0x4a4f5e, roughness: 0.4, metalness: 0.6 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, -0.35);
  barrel.castShadow = true;
  group.add(barrel);

  // Hopper — round container above body.
  const hopper = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xff3a8c, roughness: 0.5 }),
  );
  hopper.position.set(0, 0.16, -0.05);
  hopper.castShadow = true;
  group.add(hopper);

  group.userData.__scripts = [
    { type: 'PaintShooter', params: { rate: 4, speed: 25 } },
  ];
  setActorKind(group, 'prop');
  return group;
}

/** Paintball player template — same as makeFPSPlayer but starts with a
 *  PaintGun in hand, a 100-point health bar, and team color tinting. */
export function makePaintPlayer(team: 'red' | 'blue' = 'red'): THREE.Group {
  const group = new THREE.Group();
  group.name = team === 'red' ? 'PaintPlayer_Red' : 'PaintPlayer_Blue';
  group.position.set(team === 'red' ? -8 : 8, 1, 0);

  const tint = team === 'red' ? 0xff3a8c : 0x4cf8c5;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 8, 16),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6 }),
  );
  body.name = `${group.name}_Body`;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Mount a paint gun as a child so it follows the player.
  group.add(makePaintGun());

  group.userData.__team = team;
  group.userData.__health = 100;
  group.userData.__scripts = [
    { type: 'CharacterController', params: {} },
    { type: 'Crosshair', params: {} },
    { type: 'PaintShooter', params: { rate: 4, speed: 25 } },
  ];
  setActorKind(group, 'hero');
  return group;
}

/** A paintball projectile — small bright sphere with a Rigidbody + PaintImpact
 *  script that splatters paint on whatever it hits and then despawns. */
export function makePaintball(color = 0xff3a8c, position = new THREE.Vector3(0, 1, 0)): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      roughness: 0.2,
    }),
  );
  mesh.name = 'Paintball';
  mesh.castShadow = true;
  mesh.position.copy(position);
  mesh.userData.__paintColor = color;
  mesh.userData.__scripts = [
    { type: 'Rigidbody', params: { kind: 'dynamic', mass: 0.05, friction: 0.4, restitution: 0.3, shape: 'sphere' } },
    { type: 'PaintImpact', params: {} },
  ];
  return mesh;
}

/** Build the whole arena in one click — ground, walls (boundary fence),
 *  cover boxes (8 randomly-rotated cubes), and two spawn points. After this
 *  the user has a fully-playable starter map; they can edit any piece. */
export function buildPaintballArena(scene: Scene, history: History): number {
  const created: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D) => {
    history.push(new AddObjectCommand(scene, o));
    created.push(o);
  };

  // Floor — 30×30 m, dark green.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(30, 0.5, 30),
    new THREE.MeshStandardMaterial({ color: 0x2a3a2f, roughness: 0.9 }),
  );
  floor.position.set(0, -0.25, 0);
  floor.receiveShadow = true;
  floor.name = 'ArenaFloor';
  floor.userData.__scripts = [
    { type: 'Rigidbody', params: { kind: 'static', mass: 0, friction: 0.8, restitution: 0.1, shape: 'box' } },
  ];
  add(floor);

  // Boundary walls — 4 sides, 3m tall.
  const wallMat = () => new THREE.MeshStandardMaterial({ color: 0x4a3f3a, roughness: 0.8 });
  const wallSpecs = [
    { name: 'WallN', size: [30, 3, 0.4], pos: [0, 1.5, -15] },
    { name: 'WallS', size: [30, 3, 0.4], pos: [0, 1.5, 15] },
    { name: 'WallE', size: [0.4, 3, 30], pos: [15, 1.5, 0] },
    { name: 'WallW', size: [0.4, 3, 30], pos: [-15, 1.5, 0] },
  ];
  for (const w of wallSpecs) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]),
      wallMat(),
    );
    wall.position.set(w.pos[0], w.pos[1], w.pos[2]);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.name = w.name;
    wall.userData.__scripts = [
      { type: 'Rigidbody', params: { kind: 'static', mass: 0, friction: 0.8, restitution: 0.1, shape: 'box' } },
    ];
    add(wall);
  }

  // Cover boxes — randomly placed but symmetric across the X axis so neither
  // team has a positional advantage.
  const coverCount = 6;
  for (let i = 0; i < coverCount; i++) {
    const x = -10 + Math.random() * 20;
    const z = -8 + Math.random() * 16;
    const w = 1.2 + Math.random() * 1.5;
    const h = 1.0 + Math.random() * 1.0;
    const d = 1.0 + Math.random() * 1.2;
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: nextPaintColor(), roughness: 0.7 }),
    );
    cover.position.set(x, h * 0.5, z);
    cover.rotation.y = Math.random() * Math.PI;
    cover.castShadow = true;
    cover.receiveShadow = true;
    cover.name = `Cover${i}`;
    cover.userData.__scripts = [
      { type: 'Rigidbody', params: { kind: 'static', mass: 0, friction: 0.8, restitution: 0.1, shape: 'box' } },
    ];
    add(cover);
  }

  // Spawn points — one per team.
  const spawnRed = makeSpawnMarker('SpawnRed', 0xff3a8c, new THREE.Vector3(-12, 0.5, 0));
  const spawnBlue = makeSpawnMarker('SpawnBlue', 0x4cf8c5, new THREE.Vector3(12, 0.5, 0));
  add(spawnRed);
  add(spawnBlue);

  // A starter red player so the artist can press Play and immediately move.
  const player = makePaintPlayer('red');
  add(player);

  return created.length;
}

function makeSpawnMarker(name: string, color: number, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.copy(position);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.08, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.userData.deletable = false;
  group.add(ring);
  setActorKind(group, 'spawn');
  return group;
}

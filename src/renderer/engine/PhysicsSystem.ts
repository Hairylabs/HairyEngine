import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene } from './Scene';
import { PlayState } from './PlayState';

// Wraps a Rapier world for the lifetime of one Play session.
// Scripts (Rigidbody, CharacterController) register bodies via attachBody.
// PhysicsSystem.step(dt) runs the simulation and writes transforms back onto
// the Three.js Object3Ds. Cleanup runs on Stop.
//
// Rapier needs an async init for the WASM module — we lazy-init on first use.

let initPromise: Promise<void> | null = null;
export function ensureRapierInit(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export type BodyHandle = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  owner: THREE.Object3D;
  kind: 'dynamic' | 'static' | 'kinematic';
};

export class PhysicsSystem {
  world: RAPIER.World | null = null;
  private bodies: BodyHandle[] = [];
  private ready = false;

  constructor(
    private scene: Scene,
    play: PlayState,
  ) {
    play.onChange((mode) => {
      if (mode === 'play') void this.onPlay();
      else if (mode === 'edit') this.onStop();
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  step(dt: number) {
    if (!this.world) return;
    // Rapier uses a fixed timestep internally; we set it once and just step.
    // Cap dt to avoid spiraling after a hitch.
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();

    // Sync transforms from physics bodies back to scene objects (dynamic only;
    // kinematic bodies are driven by scripts).
    for (const h of this.bodies) {
      if (h.kind !== 'dynamic') continue;
      const t = h.body.translation();
      const r = h.body.rotation();
      h.owner.position.set(t.x, t.y, t.z);
      h.owner.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  attachBody(handle: BodyHandle) {
    this.bodies.push(handle);
  }

  removeBody(body: RAPIER.RigidBody) {
    if (!this.world) return;
    const idx = this.bodies.findIndex((h) => h.body === body);
    if (idx >= 0) this.bodies.splice(idx, 1);
    this.world.removeRigidBody(body);
  }

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance = 100,
  ): { hit: boolean; point?: THREE.Vector3; normal?: THREE.Vector3; distance?: number } {
    if (!this.world) return { hit: false };
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );
    const hit = this.world.castRay(ray, maxDistance, true);
    if (!hit) return { hit: false };
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      hit: true,
      point: new THREE.Vector3(point.x, point.y, point.z),
      distance: hit.timeOfImpact,
    };
  }

  private async onPlay() {
    await ensureRapierInit();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.ready = true;

    // Implicit ground at y=0 — saves users from having to add a static body
    // for the default Ground plane.
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    );
    const groundCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.05, 50)
        .setFriction(0.6)
        .setRestitution(0.0),
      groundBody,
    );
    this.bodies.push({
      body: groundBody,
      collider: groundCollider,
      owner: this.scene.three, // not a Three object — placeholder
      kind: 'static',
    });
  }

  private onStop() {
    this.bodies = [];
    if (this.world) {
      this.world.free?.();
      this.world = null;
    }
    this.ready = false;
  }
}

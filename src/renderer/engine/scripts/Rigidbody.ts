import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { registerScript, Script, ScriptCtx } from '../Script';
import { ensureRapierInit, PhysicsSystem } from '../PhysicsSystem';

// Rigidbody — adds a Rapier body sized from the owner's bounding box.
// Type: dynamic (falls under gravity), kinematic (driven by scripts),
// static (immovable). Shape: box (bbox), sphere (bbox max axis / 2).
//
// The PhysicsSystem is fetched off window.__engine since scripts don't have a
// dependency-injected reference. (Cleaner: a ctx.physics field — easy refactor
// once we have a stable surface.)

function getPhysics(): PhysicsSystem | null {
  const eng = (window as unknown as { __engine?: { physics?: PhysicsSystem } }).__engine;
  return eng?.physics ?? null;
}

registerScript({
  type: 'Rigidbody',
  label: 'Rigidbody',
  description: 'Physics body. Box collider sized from the bounding box. Add this to objects you want to fall, bounce, or be hit by raycasts.',
  category: 'Physics',
  params: [
    { key: 'kind', label: 'Type (dynamic/static/kinematic)', kind: 'string', default: 'dynamic' },
    { key: 'mass', label: 'Mass', kind: 'number', default: 1, step: 0.1 },
    { key: 'friction', label: 'Friction', kind: 'number', default: 0.5, step: 0.05, min: 0, max: 5 },
    { key: 'restitution', label: 'Bounciness', kind: 'number', default: 0.1, step: 0.05, min: 0, max: 1 },
    { key: 'shape', label: 'Shape (box/sphere)', kind: 'string', default: 'box' },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    let body: RAPIER.RigidBody | null = null;
    return {
      async start() {
        await ensureRapierInit();
        const physics = getPhysics();
        if (!physics?.world) {
          console.warn('[Rigidbody] PhysicsSystem not ready');
          return;
        }
        const kind = String(params.kind ?? 'dynamic') as 'dynamic' | 'static' | 'kinematic';
        const mass = Number(params.mass ?? 1);
        const friction = Number(params.friction ?? 0.5);
        const restitution = Number(params.restitution ?? 0.1);
        const shape = String(params.shape ?? 'box');

        // Build collider from bounding box
        const box = new THREE.Box3().setFromObject(ctx.owner);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const half = { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 };

        const desc =
          kind === 'static'
            ? RAPIER.RigidBodyDesc.fixed()
            : kind === 'kinematic'
              ? RAPIER.RigidBodyDesc.kinematicPositionBased()
              : RAPIER.RigidBodyDesc.dynamic();
        desc.setTranslation(
          ctx.owner.position.x,
          ctx.owner.position.y,
          ctx.owner.position.z,
        );
        const q = ctx.owner.quaternion;
        desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

        body = physics.world.createRigidBody(desc);

        let colliderDesc;
        if (shape === 'sphere') {
          const r = Math.max(half.x, half.y, half.z);
          colliderDesc = RAPIER.ColliderDesc.ball(r);
        } else {
          colliderDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
        }
        colliderDesc.setFriction(friction).setRestitution(restitution);
        if (kind === 'dynamic') colliderDesc.setDensity(mass);
        const collider = physics.world.createCollider(colliderDesc, body);

        physics.attachBody({ body, collider, owner: ctx.owner, kind });
      },
      stop() {
        const physics = getPhysics();
        if (body && physics) physics.removeBody(body);
        body = null;
      },
    };
  },
});

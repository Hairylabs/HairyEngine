import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { PhysicsSystem } from '../PhysicsSystem';

// PaintImpact — applies initial launch velocity (set by PaintShooter), tracks
// TTL, and when the ball stops moving or its lifetime expires, replaces it
// with a flat "splat" decal (a colored circle stuck to the contact surface).
//
// We use a soft heuristic for "stopped" (speed < 0.4 m/s) rather than
// instrumenting collision callbacks — Rapier's contact events would be more
// precise but require plumbing through PhysicsSystem. Good enough for v1.

function getPhysics(): PhysicsSystem | null {
  const eng = (window as unknown as { __engine?: { physics?: PhysicsSystem } }).__engine;
  return eng?.physics ?? null;
}

registerScript({
  type: 'PaintImpact',
  label: 'Paint Impact',
  description: 'Applies initial velocity and converts a paintball into a splat decal on impact / timeout.',
  params: [
    { key: 'splatRadius', label: 'Splat radius', kind: 'number', default: 0.25, step: 0.05 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const splatRadius = Number(params.splatRadius ?? 0.25);
    let elapsed = 0;
    let appliedLaunch = false;

    return {
      update(dt: number) {
        elapsed += dt;
        const owner = ctx.owner as THREE.Mesh;

        // Apply initial launch impulse exactly once, after the Rigidbody
        // script has had a frame to register the body.
        if (!appliedLaunch && elapsed > 0.02) {
          const launch = owner.userData.__paintLaunch as
            | { vx: number; vy: number; vz: number }
            | undefined;
          const physics = getPhysics();
          if (launch && physics?.world) {
            // Find this object's Rapier body by walking the physics handles.
            const handle = physics.findHandle(owner);
            if (handle) {
              handle.body.setLinvel(
                { x: launch.vx, y: launch.vy, z: launch.vz },
                true,
              );
            }
          }
          appliedLaunch = true;
        }

        const ttl = Number(owner.userData.__paintTtl ?? 5);
        if (elapsed > ttl) {
          splatAndRemove(owner, splatRadius, ctx.scene);
          return;
        }

        // Check if the ball has effectively stopped (low speed).
        const physics = getPhysics();
        if (!physics?.world) return;
        const handle = physics.findHandle(owner);
        if (!handle) return;
        const v = handle.body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed < 0.4 && elapsed > 0.3) {
          splatAndRemove(owner, splatRadius, ctx.scene);
        }
      },
      stop() {
        // Nothing — leaving any unconsumed paintballs alone is fine.
      },
    };
  },
});

function splatAndRemove(
  ball: THREE.Mesh,
  radius: number,
  scene: { addInternal: (o: THREE.Object3D) => void; removeInternal: (o: THREE.Object3D) => void },
) {
  const color = Number(ball.userData.__paintColor ?? 0xff3a8c);
  const splat = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  // Lay it flat on top of wherever the ball came to rest.
  splat.position.copy(ball.position);
  splat.rotation.x = -Math.PI / 2;
  splat.position.y += 0.01;
  splat.name = 'Splat';
  splat.userData.__isPaintSplat = true;
  splat.renderOrder = 5;
  scene.addInternal(splat);
  scene.removeInternal(ball);
}

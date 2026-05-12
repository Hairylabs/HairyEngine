import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { makePaintball } from '../Paintball';

// AutoShoot — fires a paintball every N seconds along the owner's -Z axis.
// Pair with LockOn (sets userData.__lockOnTarget) to make a turret that
// only fires when it has a valid target. Set requireTarget=false to make
// a sprayer that fires regardless of LockOn state.

registerScript({
  type: 'AutoShoot',
  label: 'Auto Shoot (turret)',
  description: 'Fires paintballs at a fixed rate along the owner\'s forward axis. Pair with LockOn for a tracking turret.',
  category: 'Paint',
  params: [
    { key: 'rate', label: 'Shots per second', kind: 'number', default: 2, step: 0.5 },
    { key: 'speed', label: 'Muzzle speed (m/s)', kind: 'number', default: 25, step: 1 },
    { key: 'color', label: 'Paint color (hex int)', kind: 'number', default: 0xffd166, step: 1 },
    { key: 'requireTarget', label: 'Only fire when LockOn has a target', kind: 'boolean', default: true },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const rate = Math.max(0.1, Number(params.rate ?? 2));
    const cooldown = 1 / rate;
    const speed = Number(params.speed ?? 25);
    const color = Number(params.color ?? 0xffd166);
    const requireTarget = !!params.requireTarget;
    let timeSinceFire = cooldown;

    const dir = new THREE.Vector3();
    const muzzle = new THREE.Vector3();

    return {
      update(dt: number) {
        timeSinceFire += dt;
        if (timeSinceFire < cooldown) return;
        if (requireTarget && !ctx.owner.userData.__lockOnTarget) return;
        timeSinceFire = 0;
        // Forward = owner's -Z in world space (Three.js convention).
        ctx.owner.getWorldDirection(dir);
        dir.negate(); // getWorldDirection returns the local -Z direction; for "forward" we want +Z relative to lookAt, which is -dir. We flipped it back to match camera-style forward.
        // Actually: object.getWorldDirection returns the direction the
        // object is facing (which IS -Z transformed to world). We want
        // to fire ALONG that direction. So undo the negate:
        dir.negate();
        ctx.owner.getWorldPosition(muzzle);
        muzzle.addScaledVector(dir, 0.4);

        const ball = makePaintball(color, muzzle);
        ball.userData.__paintLaunch = {
          vx: dir.x * speed,
          vy: dir.y * speed,
          vz: dir.z * speed,
        };
        ball.userData.__paintTtl = 5;
        ctx.scene.addInternal(ball);
      },
    };
  },
});

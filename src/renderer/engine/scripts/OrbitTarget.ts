import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// OrbitTarget — keep the owner at a fixed distance from a named target,
// orbiting around it slowly. Drop this on a Camera + set target to
// "Player" for an automatic camera arm. Drop it on any prop for an
// orbiting drone effect.

registerScript({
  type: 'OrbitTarget',
  label: 'Orbit Target',
  description: 'Owner orbits around a named target at fixed distance. Use for camera arms, drones, satellites.',
  category: 'Behavior',
  params: [
    { key: 'targetName', label: 'Target name', kind: 'string', default: 'Player' },
    { key: 'distance', label: 'Distance (m)', kind: 'number', default: 5, step: 0.5 },
    { key: 'height', label: 'Height offset (m)', kind: 'number', default: 2, step: 0.5 },
    { key: 'speed', label: 'Orbit speed (deg/s)', kind: 'number', default: 30, step: 5 },
    { key: 'lookAtTarget', label: 'Look at target', kind: 'boolean', default: true },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const targetName = String(params.targetName ?? 'Player');
    const dist = Number(params.distance ?? 5);
    const height = Number(params.height ?? 2);
    const speedDeg = Number(params.speed ?? 30);
    const lookAt = !!params.lookAtTarget;
    const targetPos = new THREE.Vector3();
    let angle = 0;
    let cachedTarget: THREE.Object3D | null = null;

    function findTarget(): THREE.Object3D | null {
      if (cachedTarget && cachedTarget.parent) return cachedTarget;
      cachedTarget = ctx.scene.three.getObjectByName(targetName) ?? null;
      return cachedTarget;
    }

    return {
      update(dt: number) {
        const target = findTarget();
        if (!target) return;
        angle += (speedDeg * Math.PI / 180) * dt;
        target.getWorldPosition(targetPos);
        ctx.owner.position.set(
          targetPos.x + Math.cos(angle) * dist,
          targetPos.y + height,
          targetPos.z + Math.sin(angle) * dist,
        );
        if (lookAt) {
          ctx.owner.lookAt(targetPos);
        }
      },
    };
  },
});

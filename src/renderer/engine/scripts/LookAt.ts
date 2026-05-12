import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// LookAt — orient the owner so its -Z axis points at a named target.
// The simplest "aim" behavior — useful for paintball turrets, security
// cameras, or just making props face the player. Smooths optionally so it
// doesn't snap instantly (gives a nice tracking feel).
//
// Target lookup runs each frame (in case the target spawns later or is
// destroyed); it's a cheap traversal at the scene root.

registerScript({
  type: 'LookAt',
  label: 'Look At (target)',
  description: 'Rotates the owner to face an object by name. Use for turrets, security cameras, NPCs that track the player.',
  category: 'Behavior',
  params: [
    { key: 'targetName', label: 'Target name', kind: 'string', default: 'Player' },
    { key: 'smoothing', label: 'Smoothing (0=snap, 1=slow)', kind: 'number', default: 0.15, min: 0, max: 1, step: 0.05 },
    { key: 'lockY', label: 'Lock Y axis only', kind: 'boolean', default: false },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const targetName = String(params.targetName ?? 'Player');
    const smoothing = Math.max(0, Math.min(1, Number(params.smoothing ?? 0.15)));
    const lockY = !!params.lockY;
    const targetPos = new THREE.Vector3();
    const ownerPos = new THREE.Vector3();
    const desiredQuat = new THREE.Quaternion();
    const tmpMat = new THREE.Matrix4();

    let cachedTarget: THREE.Object3D | null = null;

    function findTarget(): THREE.Object3D | null {
      if (cachedTarget && cachedTarget.parent) return cachedTarget;
      cachedTarget = ctx.scene.three.getObjectByName(targetName) ?? null;
      return cachedTarget;
    }

    return {
      update() {
        const target = findTarget();
        if (!target) return;
        target.getWorldPosition(targetPos);
        ctx.owner.getWorldPosition(ownerPos);
        if (lockY) targetPos.y = ownerPos.y;
        // Build the desired quaternion via a look-at matrix.
        tmpMat.lookAt(ownerPos, targetPos, ctx.owner.up);
        desiredQuat.setFromRotationMatrix(tmpMat);
        if (smoothing <= 0) {
          ctx.owner.quaternion.copy(desiredQuat);
        } else {
          // Slerp toward target by an alpha that respects smoothing.
          const alpha = 1 - smoothing;
          ctx.owner.quaternion.slerp(desiredQuat, alpha);
        }
      },
    };
  },
});

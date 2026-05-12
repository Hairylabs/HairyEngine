import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// LockOn — finds the NEAREST object whose name matches a tag (default
// "Player") within a sphere radius, then orients the owner toward it.
// Different from LookAt because it auto-picks the closest valid target
// each frame, supports a max-range cutoff, and exposes the locked target
// via owner.userData.__lockOnTarget so AutoShoot / similar scripts can
// read it without rerunning the search.

registerScript({
  type: 'LockOn',
  label: 'Lock On (auto-target)',
  description: 'Picks the nearest object matching a name and rotates to face it. Pair with AutoShoot for a turret.',
  category: 'Behavior',
  params: [
    { key: 'targetName', label: 'Target name (substring)', kind: 'string', default: 'Player' },
    { key: 'range', label: 'Max range (m)', kind: 'number', default: 25, step: 1 },
    { key: 'smoothing', label: 'Smoothing (0=snap, 1=slow)', kind: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },
    { key: 'lockY', label: 'Lock Y axis only', kind: 'boolean', default: true },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const targetSubstr = String(params.targetName ?? 'Player').toLowerCase();
    const range = Number(params.range ?? 25);
    const smoothing = Math.max(0, Math.min(1, Number(params.smoothing ?? 0.2)));
    const lockY = !!params.lockY;
    const ownerPos = new THREE.Vector3();
    const targetPos = new THREE.Vector3();
    const desiredQuat = new THREE.Quaternion();
    const tmpMat = new THREE.Matrix4();

    function findNearest(): THREE.Object3D | null {
      ctx.owner.getWorldPosition(ownerPos);
      let best: THREE.Object3D | null = null;
      let bestD = range * range;
      ctx.scene.editable.traverse((o) => {
        if (o === ctx.owner) return;
        if (!o.name) return;
        if (!o.name.toLowerCase().includes(targetSubstr)) return;
        o.getWorldPosition(targetPos);
        const dx = targetPos.x - ownerPos.x;
        const dy = targetPos.y - ownerPos.y;
        const dz = targetPos.z - ownerPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = o;
        }
      });
      return best;
    }

    return {
      update() {
        const target = findNearest();
        ctx.owner.userData.__lockOnTarget = target;
        if (!target) return;
        target.getWorldPosition(targetPos);
        ctx.owner.getWorldPosition(ownerPos);
        if (lockY) targetPos.y = ownerPos.y;
        tmpMat.lookAt(ownerPos, targetPos, ctx.owner.up);
        desiredQuat.setFromRotationMatrix(tmpMat);
        if (smoothing <= 0) {
          ctx.owner.quaternion.copy(desiredQuat);
        } else {
          ctx.owner.quaternion.slerp(desiredQuat, 1 - smoothing);
        }
      },
      stop() {
        delete ctx.owner.userData.__lockOnTarget;
      },
    };
  },
});

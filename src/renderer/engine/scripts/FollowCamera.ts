import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// Camera-side script: keeps the owner (a scene Camera) hovering at an offset
// from a named target object, optionally looking at it. Set `target` to the
// object's name (case-sensitive). Smoothing 0 = snap, 1 = no movement.

registerScript({
  type: 'FollowCamera',
  label: 'Follow Camera',
  description: 'Camera follows a named target object with an offset.',
  params: [
    { key: 'target', label: 'Target name', kind: 'string', default: 'Player' },
    { key: 'offsetX', label: 'Offset X', kind: 'number', default: 0, step: 0.5 },
    { key: 'offsetY', label: 'Offset Y', kind: 'number', default: 4, step: 0.5 },
    { key: 'offsetZ', label: 'Offset Z', kind: 'number', default: 7, step: 0.5 },
    { key: 'smoothing', label: 'Smoothing (0-1)', kind: 'number', default: 0.15, step: 0.05, min: 0, max: 1 },
    { key: 'lookAt', label: 'Look at target', kind: 'boolean', default: true },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const targetName = String(params.target ?? 'Player');
    const offset = new THREE.Vector3(
      Number(params.offsetX ?? 0),
      Number(params.offsetY ?? 4),
      Number(params.offsetZ ?? 7),
    );
    const smoothing = Number(params.smoothing ?? 0.15);
    const lookAt = params.lookAt !== false;
    let target: THREE.Object3D | null = null;
    const desired = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    return {
      start() {
        target = findByName(ctx.scene.three, targetName);
        if (!target) console.warn(`[FollowCamera] No object named "${targetName}"`);
      },
      update(_dt: number) {
        if (!target) return;
        target.getWorldPosition(tmp);
        desired.copy(tmp).add(offset);
        if (smoothing <= 0) {
          ctx.owner.position.copy(desired);
        } else {
          ctx.owner.position.lerp(desired, 1 - smoothing);
        }
        if (lookAt) ctx.owner.lookAt(tmp);
      },
    };
  },
});

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!result && o.name === name) result = o;
  });
  return result;
}

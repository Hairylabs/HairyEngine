import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { findBoneByName } from '../Animations';

// Parents the owner to a named bone inside the FIRST SkinnedMesh ancestor in
// the scene tree. Use this for guns-in-hand, hats-on-head, sword-on-back.
// On Stop the owner is reparented to the scene root so the editor still sees
// it as a top-level object.

registerScript({
  type: 'AttachToBone',
  label: 'Attach to Bone',
  description:
    'Parents this object to a bone (e.g. mixamorig:RightHand). Use for guns in hand, hats on heads, swords on backs.',
  category: 'Animation',
  params: [
    {
      key: 'characterName',
      label: 'Character object name',
      kind: 'string',
      default: 'Player',
    },
    {
      key: 'bone',
      label: 'Bone name',
      kind: 'string',
      default: 'mixamorig:RightHand',
    },
    { key: 'offsetX', label: 'Offset X', kind: 'number', default: 0, step: 0.01 },
    { key: 'offsetY', label: 'Offset Y', kind: 'number', default: 0, step: 0.01 },
    { key: 'offsetZ', label: 'Offset Z', kind: 'number', default: 0, step: 0.01 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    let originalParent: THREE.Object3D | null = null;
    const originalPosition = new THREE.Vector3();
    const originalQuaternion = new THREE.Quaternion();
    return {
      start() {
        const characterName = String(params.characterName ?? 'Player');
        const boneName = String(params.bone ?? 'mixamorig:RightHand');
        const character = ctx.scene.three.getObjectByName(characterName);
        if (!character) {
          console.warn(`[AttachToBone] No character named "${characterName}"`);
          return;
        }
        const bone = findBoneByName(character, boneName);
        if (!bone) {
          console.warn(
            `[AttachToBone] No bone "${boneName}" inside "${characterName}"`,
          );
          return;
        }
        originalParent = ctx.owner.parent;
        originalPosition.copy(ctx.owner.position);
        originalQuaternion.copy(ctx.owner.quaternion);
        bone.add(ctx.owner);
        ctx.owner.position.set(
          Number(params.offsetX ?? 0),
          Number(params.offsetY ?? 0),
          Number(params.offsetZ ?? 0),
        );
      },
      stop() {
        if (originalParent) {
          originalParent.add(ctx.owner);
          ctx.owner.position.copy(originalPosition);
          ctx.owner.quaternion.copy(originalQuaternion);
        }
      },
    };
  },
});

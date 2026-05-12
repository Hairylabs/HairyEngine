import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { registerScript, Script, ScriptCtx } from '../Script';
import { ensureRapierInit, PhysicsSystem } from '../PhysicsSystem';

// First-person character controller using Rapier's KinematicCharacterController.
// Walks, jumps, slides along walls. Camera is parented to the owner so it
// follows. Pointer-lock for mouse look on click. Press Escape to release.
//
// Replaces the simpler PlayerController for actual FPS gameplay where you
// want collisions and ground detection.

function getPhysics(): PhysicsSystem | null {
  const eng = (window as unknown as { __engine?: { physics?: PhysicsSystem } }).__engine;
  return eng?.physics ?? null;
}

registerScript({
  type: 'CharacterController',
  label: 'Character Controller',
  description: 'FPS-style: WASD walk, Space jump, mouse look, click to lock pointer. Requires PhysicsSystem (auto, when you press Play).',
  params: [
    { key: 'speed', label: 'Move speed', kind: 'number', default: 5, step: 0.5 },
    { key: 'sprint', label: 'Sprint multiplier', kind: 'number', default: 1.6, step: 0.1 },
    { key: 'jumpSpeed', label: 'Jump speed', kind: 'number', default: 6, step: 0.5 },
    { key: 'height', label: 'Height', kind: 'number', default: 1.8, step: 0.1 },
    { key: 'radius', label: 'Radius', kind: 'number', default: 0.4, step: 0.05 },
    { key: 'eyeHeight', label: 'Eye height', kind: 'number', default: 1.6, step: 0.05 },
    { key: 'sensitivity', label: 'Mouse sensitivity', kind: 'number', default: 0.002, step: 0.0005 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const moveSpeed = Number(params.speed ?? 5);
    const sprintMul = Number(params.sprint ?? 1.6);
    const jumpSpeed = Number(params.jumpSpeed ?? 6);
    const height = Number(params.height ?? 1.8);
    const radius = Number(params.radius ?? 0.4);
    const eyeHeight = Number(params.eyeHeight ?? 1.6);
    const sensitivity = Number(params.sensitivity ?? 0.002);

    let yaw = 0;
    let pitch = 0;
    let body: RAPIER.RigidBody | null = null;
    let collider: RAPIER.Collider | null = null;
    let cc: RAPIER.KinematicCharacterController | null = null;
    let verticalVelocity = 0;

    let prevParent: THREE.Object3D | null = null;
    const prevCamPos = new THREE.Vector3();
    const prevCamQuat = new THREE.Quaternion();

    let canvasEl: HTMLCanvasElement | null = null;
    const onCanvasClick = () => {
      if (!ctx.input.isPointerLocked()) ctx.input.lock();
    };

    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();

    return {
      async start() {
        await ensureRapierInit();
        const physics = getPhysics();
        if (!physics?.world) {
          console.warn('[CharacterController] PhysicsSystem not ready');
          return;
        }

        yaw = ctx.owner.rotation.y;
        pitch = 0;

        const halfHeight = height * 0.5;
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(
            ctx.owner.position.x,
            ctx.owner.position.y + halfHeight,
            ctx.owner.position.z,
          );
        body = physics.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.capsule(
          Math.max(0.05, halfHeight - radius),
          radius,
        );
        collider = physics.world.createCollider(colliderDesc, body);

        cc = physics.world.createCharacterController(0.05);
        cc.enableAutostep(0.3, 0.2, true);
        cc.enableSnapToGround(0.3);
        cc.setApplyImpulsesToDynamicBodies(true);

        // Camera reparenting for FP view
        prevParent = ctx.camera.parent;
        prevCamPos.copy(ctx.camera.position);
        prevCamQuat.copy(ctx.camera.quaternion);
        ctx.owner.add(ctx.camera);
        ctx.camera.position.set(0, eyeHeight, 0);
        ctx.camera.quaternion.identity();

        canvasEl = document.querySelector('canvas#canvas-3d');
        if (canvasEl) canvasEl.addEventListener('click', onCanvasClick);
        ctx.input.lock();
      },
      update(dt: number) {
        if (!body || !collider || !cc) return;
        const physics = getPhysics();
        if (!physics?.world) return;

        if (ctx.input.isPointerLocked()) {
          const m = ctx.input.getMouseDelta();
          yaw -= m.x * sensitivity;
          pitch -= m.y * sensitivity;
          pitch = THREE.MathUtils.clamp(
            pitch,
            -Math.PI / 2 + 0.01,
            Math.PI / 2 - 0.01,
          );
        }
        ctx.owner.rotation.set(0, yaw, 0);
        ctx.camera.rotation.set(pitch, 0, 0);

        const isSprint = ctx.input.isKeyDown('shift');
        const sp = moveSpeed * (isSprint ? sprintMul : 1);
        tmpForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

        const moveDir = new THREE.Vector3();
        if (ctx.input.isKeyDown('w')) moveDir.add(tmpForward);
        if (ctx.input.isKeyDown('s')) moveDir.sub(tmpForward);
        if (ctx.input.isKeyDown('d')) moveDir.add(tmpRight);
        if (ctx.input.isKeyDown('a')) moveDir.sub(tmpRight);
        if (moveDir.lengthSq() > 0) moveDir.normalize().multiplyScalar(sp);

        // Gravity / jump
        const grounded = cc.computedGrounded();
        if (grounded && verticalVelocity < 0) verticalVelocity = 0;
        if (grounded && (ctx.input.isKeyDown(' ') || ctx.input.isKeyDown('space'))) {
          verticalVelocity = jumpSpeed;
        }
        verticalVelocity -= 9.81 * dt;

        const desired = {
          x: moveDir.x * dt,
          y: verticalVelocity * dt,
          z: moveDir.z * dt,
        };
        cc.computeColliderMovement(collider, desired);
        const corrected = cc.computedMovement();
        const t = body.translation();
        const next = {
          x: t.x + corrected.x,
          y: t.y + corrected.y,
          z: t.z + corrected.z,
        };
        body.setNextKinematicTranslation(next);

        // Sync Three transform (subtract half-height because capsule centre is mid-body)
        const halfHeight = height * 0.5;
        ctx.owner.position.set(next.x, next.y - halfHeight, next.z);

        if (ctx.input.isKeyDown('escape')) ctx.input.unlock();
      },
      stop() {
        if (canvasEl) canvasEl.removeEventListener('click', onCanvasClick);
        ctx.input.unlock();
        const physics = getPhysics();
        if (physics?.world && cc) physics.world.removeCharacterController(cc);
        if (body && physics) physics.removeBody(body);
        body = null;
        collider = null;
        cc = null;
        if (prevParent) prevParent.add(ctx.camera);
        ctx.camera.position.copy(prevCamPos);
        ctx.camera.quaternion.copy(prevCamQuat);
      },
    };
  },
});

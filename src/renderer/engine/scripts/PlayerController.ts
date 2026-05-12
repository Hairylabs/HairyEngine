import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// First-person controller: WASD movement, mouse-look (pointer lock on click),
// Space to jump (simple kinematic — no real gravity until the physics system
// lands). The camera is parented to the owner during play so users can attach
// this to a "Player" object (e.g. a cube) and have the engine camera follow.
//
// On Stop, we detach the camera and restore its prior parent / transform so
// the editor camera takes over again.

registerScript({
  type: 'PlayerController',
  label: 'Player Controller',
  description: 'WASD + mouse look. Attach to an object you want to drive.',
  category: 'Player',
  params: [
    { key: 'speed', label: 'Move speed', kind: 'number', default: 5, step: 0.5 },
    { key: 'sprint', label: 'Sprint multiplier', kind: 'number', default: 1.6, step: 0.1 },
    { key: 'eyeHeight', label: 'Eye height', kind: 'number', default: 1.6, step: 0.05 },
    { key: 'sensitivity', label: 'Mouse sensitivity', kind: 'number', default: 0.002, step: 0.0005 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const speed = Number(params.speed ?? 5);
    const sprint = Number(params.sprint ?? 1.6);
    const eyeHeight = Number(params.eyeHeight ?? 1.6);
    const sensitivity = Number(params.sensitivity ?? 0.002);

    let yaw = 0;
    let pitch = 0;
    let prevParent: THREE.Object3D | null = null;
    let prevCamPos = new THREE.Vector3();
    let prevCamQuat = new THREE.Quaternion();

    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();

    const onCanvasClick = () => {
      if (!ctx.input.isPointerLocked()) ctx.input.lock();
    };

    let canvasEl: HTMLCanvasElement | null = null;

    return {
      start() {
        // Initialize yaw from owner's current Y rotation so the player
        // doesn't jerk on Play.
        yaw = ctx.owner.rotation.y;
        pitch = 0;

        // Save camera state and reparent it to the owner.
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
        // Mouse look — only when pointer is locked, so editing isn't disrupted.
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

        // Movement
        const isSprint = ctx.input.isKeyDown('shift');
        const speedNow = speed * (isSprint ? sprint : 1) * dt;
        tmpForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

        if (ctx.input.isKeyDown('w')) ctx.owner.position.addScaledVector(tmpForward, speedNow);
        if (ctx.input.isKeyDown('s')) ctx.owner.position.addScaledVector(tmpForward, -speedNow);
        if (ctx.input.isKeyDown('d')) ctx.owner.position.addScaledVector(tmpRight, speedNow);
        if (ctx.input.isKeyDown('a')) ctx.owner.position.addScaledVector(tmpRight, -speedNow);
        if (ctx.input.isKeyDown(' ') || ctx.input.isKeyDown('space')) {
          ctx.owner.position.y += speedNow;
        }
        if (ctx.input.isKeyDown('c') || ctx.input.isKeyDown('keyc')) {
          ctx.owner.position.y -= speedNow;
        }

        // Press Escape to release mouse lock without leaving Play Mode.
        if (ctx.input.isKeyDown('escape')) {
          ctx.input.unlock();
        }
      },
      stop() {
        if (canvasEl) canvasEl.removeEventListener('click', onCanvasClick);
        ctx.input.unlock();
        // Restore camera
        if (prevParent) prevParent.add(ctx.camera);
        ctx.camera.position.copy(prevCamPos);
        ctx.camera.quaternion.copy(prevCamQuat);
      },
    };
  },
});

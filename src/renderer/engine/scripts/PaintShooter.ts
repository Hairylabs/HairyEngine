import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { Scene } from '../Scene';
import { makePaintball } from '../Paintball';

// PaintShooter — fires a physics paintball on left-click. Different from
// the raycast-based Shooter script: paintballs are real Rigidbody objects
// that arc + bounce + splatter on impact, which feels more game-y.
// Attach to a player or to a paint gun mount; spawn position is `barrel`
// offset along forward, defaulting to in front of the camera at chest height.

registerScript({
  type: 'PaintShooter',
  label: 'Paint Shooter',
  description: 'Left-click to fire a paintball with physics. Spawns a Rigidbody sphere that arcs and splatters.',
  params: [
    { key: 'rate', label: 'Rate (per second)', kind: 'number', default: 4, step: 1 },
    { key: 'speed', label: 'Muzzle speed (m/s)', kind: 'number', default: 25, step: 1 },
    { key: 'color', label: 'Color (hex int)', kind: 'number', default: 0xff3a8c, step: 1 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const rate = Math.max(0.5, Number(params.rate ?? 4));
    const cooldown = 1 / rate;
    const speed = Number(params.speed ?? 25);
    const color = Number(params.color ?? 0xff3a8c);
    let timeSinceFire = cooldown;
    let prevDown = false;

    return {
      update(dt: number) {
        timeSinceFire += dt;
        const down = ctx.input.isMouseDown(0) && ctx.input.isPointerLocked();
        if (down && !prevDown && timeSinceFire >= cooldown) {
          timeSinceFire = 0;
          fire(ctx.scene, ctx.camera, color, speed);
        }
        prevDown = down;
      },
      stop() {
        // Spawned paintballs clean themselves up via PaintImpact.
      },
    };
  },
});

function fire(scene: Scene, camera: THREE.PerspectiveCamera, color: number, speed: number) {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir).normalize();
  // Spawn just in front of camera so the projectile isn't created inside the player.
  const spawn = origin.clone().addScaledVector(dir, 0.6);
  const ball = makePaintball(color, spawn);
  // Stash initial velocity for PaintImpact's start hook to apply via Rapier.
  ball.userData.__paintLaunch = {
    vx: dir.x * speed,
    vy: dir.y * speed,
    vz: dir.z * speed,
  };
  ball.userData.__paintTtl = 5; // seconds before cleanup
  scene.addInternal(ball);
}

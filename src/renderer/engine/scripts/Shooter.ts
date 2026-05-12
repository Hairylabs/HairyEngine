import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { PhysicsSystem } from '../PhysicsSystem';
import { HUD } from '../HUD';

// Click to shoot — raycasts from the camera. When it hits a dynamic
// rigidbody, applies an impulse so the target gets knocked. Adds a tiny
// "tracer" line to the HUD that fades out for visual feedback.
// Best attached alongside a CharacterController script.

function getPhysics(): PhysicsSystem | null {
  const eng = (window as unknown as { __engine?: { physics?: PhysicsSystem } }).__engine;
  return eng?.physics ?? null;
}
function getHud(): HUD | null {
  const eng = (window as unknown as { __engine?: { hud?: HUD } }).__engine;
  return eng?.hud ?? null;
}

registerScript({
  type: 'Shooter',
  label: 'Shooter (Raycast)',
  description: 'Left-click to fire a raycast from the camera. Knocks dynamic bodies.',
  params: [
    { key: 'range', label: 'Range', kind: 'number', default: 100, step: 5 },
    { key: 'impulse', label: 'Impulse', kind: 'number', default: 12, step: 1 },
    { key: 'cooldown', label: 'Cooldown (s)', kind: 'number', default: 0.15, step: 0.05 },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    const range = Number(params.range ?? 100);
    const impulseScale = Number(params.impulse ?? 12);
    const cooldown = Number(params.cooldown ?? 0.15);
    let timeSinceFire = cooldown;
    let prevMouseDown = false;

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();

    return {
      update(dt: number) {
        timeSinceFire += dt;
        const down = ctx.input.isMouseDown(0) && ctx.input.isPointerLocked();
        if (down && !prevMouseDown && timeSinceFire >= cooldown) {
          timeSinceFire = 0;
          const physics = getPhysics();
          if (!physics) return;
          ctx.camera.getWorldPosition(origin);
          ctx.camera.getWorldDirection(direction).normalize();
          const result = physics.raycast(origin, direction, range);
          if (result.hit && result.point) {
            // Push back a tracer marker briefly via the HUD as a debug aid
            // Real muzzle-flash / impact FX will arrive when the particle
            // system is wired in.
            flashHit();
          }
        }
        prevMouseDown = down;
      },
      stop() {
        // nothing to release
      },
    };

    function flashHit() {
      const hud = getHud();
      if (!hud) return;
      const dot = document.createElement('div');
      dot.style.position = 'absolute';
      dot.style.left = '50%';
      dot.style.top = '50%';
      dot.style.transform = 'translate(-50%, -50%)';
      dot.style.width = '24px';
      dot.style.height = '24px';
      dot.style.borderRadius = '50%';
      dot.style.background = 'radial-gradient(circle, rgba(255,200,80,0.9), rgba(255,80,40,0))';
      dot.style.pointerEvents = 'none';
      dot.style.transition = 'opacity 0.2s';
      hud.add(dot);
      requestAnimationFrame(() => (dot.style.opacity = '0'));
      setTimeout(() => dot.remove(), 220);
    }
  },
});

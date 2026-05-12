import { registerScript, ScriptCtx } from '../Script';

// Spins the owner around the Y axis. Useful as a smoke-test for the
// scripting system.

registerScript({
  type: 'Rotator',
  label: 'Rotator',
  description: 'Spins the owner each frame.',
  params: [
    { key: 'speed', label: 'Speed (deg/sec)', kind: 'number', default: 90, step: 5 },
    { key: 'axis', label: 'Axis (x/y/z)', kind: 'string', default: 'y' },
  ],
  create: (ctx: ScriptCtx, params) => {
    const speedDeg = Number(params.speed ?? 90);
    const speedRad = (speedDeg * Math.PI) / 180;
    const axis = String(params.axis ?? 'y').toLowerCase();
    return {
      update(dt: number) {
        const ang = speedRad * dt;
        if (axis === 'x') ctx.owner.rotation.x += ang;
        else if (axis === 'z') ctx.owner.rotation.z += ang;
        else ctx.owner.rotation.y += ang;
      },
    };
  },
});

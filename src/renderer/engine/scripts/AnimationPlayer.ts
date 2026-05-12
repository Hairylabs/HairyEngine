import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';
import { getAnimations } from '../Animations';
import { AnimationSystem } from '../AnimationSystem';

// Plays a named animation clip on a GLB. Set `clip` to a clip name (use
// "*" or empty to autoplay the first clip).

function getAnimationSystem(): AnimationSystem | null {
  const eng = (window as unknown as { __engine?: { animations?: AnimationSystem } }).__engine;
  return eng?.animations ?? null;
}

registerScript({
  type: 'AnimationPlayer',
  label: 'Animation Player',
  description: 'Plays a named animation clip from the GLB. Use "*" to play the first.',
  params: [
    { key: 'clip', label: 'Clip name', kind: 'string', default: '*' },
    { key: 'speed', label: 'Speed', kind: 'number', default: 1, step: 0.1 },
    { key: 'loop', label: 'Loop', kind: 'boolean', default: true },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    let action: THREE.AnimationAction | null = null;
    return {
      start() {
        const clips = getAnimations(ctx.owner);
        if (clips.length === 0) {
          console.warn(`[AnimationPlayer] No clips on "${ctx.owner.name}"`);
          return;
        }
        const animSys = getAnimationSystem();
        if (!animSys) {
          console.warn('[AnimationPlayer] AnimationSystem not ready');
          return;
        }
        const requested = String(params.clip ?? '*').trim();
        const clip =
          !requested || requested === '*'
            ? clips[0]
            : clips.find((c) => c.name === requested) ?? clips[0];
        const mixer = animSys.getMixer(ctx.owner);
        action = mixer.clipAction(clip);
        action.timeScale = Number(params.speed ?? 1);
        action.setLoop(
          params.loop === false ? THREE.LoopOnce : THREE.LoopRepeat,
          Infinity,
        );
        action.reset().play();
      },
      stop() {
        if (action) {
          action.stop();
          action = null;
        }
        const animSys = getAnimationSystem();
        if (animSys) animSys.releaseMixer(ctx.owner);
      },
    };
  },
});

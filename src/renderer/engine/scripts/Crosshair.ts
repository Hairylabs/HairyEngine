import { registerScript, Script, ScriptCtx } from '../Script';
import { HUD } from '../HUD';

function getHud(): HUD | null {
  const eng = (window as unknown as { __engine?: { hud?: HUD } }).__engine;
  return eng?.hud ?? null;
}

registerScript({
  type: 'Crosshair',
  label: 'Crosshair',
  description: 'Adds a small + crosshair to the HUD. Best attached to the player object.',
  category: 'Player',
  params: [],
  create: (_ctx: ScriptCtx): Script => {
    let el: HTMLElement | null = null;
    return {
      start() {
        const hud = getHud();
        if (!hud) return;
        el = document.createElement('div');
        el.className = 'hud-crosshair';
        hud.add(el);
      },
      stop() {
        if (el && el.parentElement) el.parentElement.removeChild(el);
        el = null;
      },
    };
  },
});

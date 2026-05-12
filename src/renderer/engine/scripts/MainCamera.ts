import { registerScript, Script, ScriptCtx } from '../Script';

// Marks the owner (a scene Camera) as the active render camera in Play Mode.
// Only one camera should be the main camera per scene; if multiple are
// flagged, Viewport picks the first found.

registerScript({
  type: 'MainCamera',
  label: 'Main Camera',
  description: 'Marks this camera as the active render camera during Play Mode.',
  params: [],
  create: (ctx: ScriptCtx): Script => {
    return {
      start() {
        ctx.owner.userData.isMainCamera = true;
      },
      stop() {
        // Leave the flag in place so editor sees which camera *would* be active
        // — but Viewport.findMainCamera only matters during Play anyway.
      },
    };
  },
});

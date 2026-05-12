import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// Add a THREE.AudioListener to the owner (typically the player or main
// camera). PositionalAudio sources in the scene mix relative to this
// listener's position and orientation. There should normally be one
// active AudioListener per scene.
//
// Stash the listener on window.__hairy_audio so AudioSource scripts can
// find it without depending on the script registry order.

registerScript({
  type: 'AudioListener',
  label: 'Audio Listener',
  description:
    "Adds an Audio Listener at this object (usually the camera or player). All 3D audio sources are heard relative to this object's position.",
  params: [],
  create: (ctx: ScriptCtx): Script => {
    let listener: THREE.AudioListener | null = null;
    return {
      start() {
        listener = new THREE.AudioListener();
        ctx.owner.add(listener);
        (window as unknown as { __hairy_audio?: THREE.AudioListener }).__hairy_audio = listener;
      },
      stop() {
        if (listener) {
          ctx.owner.remove(listener);
          if (
            (window as unknown as { __hairy_audio?: THREE.AudioListener })
              .__hairy_audio === listener
          ) {
            delete (window as unknown as { __hairy_audio?: THREE.AudioListener }).__hairy_audio;
          }
        }
        listener = null;
      },
    };
  },
});

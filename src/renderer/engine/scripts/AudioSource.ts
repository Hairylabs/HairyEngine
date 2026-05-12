import * as THREE from 'three';
import { registerScript, Script, ScriptCtx } from '../Script';

// Plays an audio clip (URL or library path) when Play starts.
// In 3D mode, attenuates with distance to the AudioListener.
//
// Requires an AudioListener somewhere in the scene (we look it up off
// window.__hairy_audio). If none exists, we auto-create one on the camera
// so first-time users hear something without configuring two scripts.

function getOrCreateListener(ctx: ScriptCtx): THREE.AudioListener {
  const existing = (window as unknown as { __hairy_audio?: THREE.AudioListener }).__hairy_audio;
  if (existing) return existing;
  const listener = new THREE.AudioListener();
  ctx.camera.add(listener);
  (window as unknown as { __hairy_audio?: THREE.AudioListener }).__hairy_audio = listener;
  return listener;
}

registerScript({
  type: 'AudioSource',
  label: 'Audio Source',
  description:
    'Plays an audio file (URL or asset library path). 3D = falls off with distance from the Audio Listener; 2D = constant volume.',
  category: 'Audio',
  params: [
    {
      key: 'url',
      label: 'Audio URL (mp3/ogg/wav)',
      kind: 'string',
      default: '',
    },
    { key: 'loop', label: 'Loop', kind: 'boolean', default: true },
    { key: 'autoplay', label: 'Auto play on start', kind: 'boolean', default: true },
    {
      key: 'volume',
      label: 'Volume (0-1)',
      kind: 'number',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'positional',
      label: '3D positional',
      kind: 'boolean',
      default: true,
    },
    {
      key: 'refDistance',
      label: 'Distance at full volume (3D)',
      kind: 'number',
      default: 3,
      step: 0.5,
    },
    {
      key: 'rolloff',
      label: 'Distance falloff (3D)',
      kind: 'number',
      default: 1,
      step: 0.1,
    },
  ],
  create: (ctx: ScriptCtx, params): Script => {
    let sound: THREE.Audio | THREE.PositionalAudio | null = null;
    return {
      start() {
        const url = String(params.url ?? '').trim();
        if (!url) {
          console.warn('[AudioSource] no URL configured');
          return;
        }
        const listener = getOrCreateListener(ctx);
        const positional = params.positional !== false;
        const audio = positional
          ? new THREE.PositionalAudio(listener)
          : new THREE.Audio(listener);
        sound = audio;
        if (positional) {
          (audio as THREE.PositionalAudio).setRefDistance(
            Number(params.refDistance ?? 3),
          );
          (audio as THREE.PositionalAudio).setRolloffFactor(
            Number(params.rolloff ?? 1),
          );
        }
        audio.setVolume(Number(params.volume ?? 0.6));
        audio.setLoop(params.loop !== false);
        ctx.owner.add(audio);

        const loader = new THREE.AudioLoader();
        loader.load(
          url,
          (buffer) => {
            if (!sound) return; // stopped before load completed
            sound.setBuffer(buffer);
            if (params.autoplay !== false) {
              try {
                sound.play();
              } catch (err) {
                console.warn('[AudioSource] play failed:', err);
              }
            }
          },
          undefined,
          (err) => console.error('[AudioSource] load failed:', err),
        );
      },
      stop() {
        if (sound) {
          try {
            if (sound.isPlaying) sound.stop();
          } catch {
            // ignore
          }
          ctx.owner.remove(sound);
          sound = null;
        }
      },
    };
  },
});

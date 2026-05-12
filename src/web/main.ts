import * as THREE from 'three';
import { Scene } from '../renderer/engine/Scene';
import { Viewport } from '../renderer/engine/Viewport';
import { History } from '../renderer/engine/History';
import { PlayState } from '../renderer/engine/PlayState';
import { HUD } from '../renderer/engine/HUD';
import '../renderer/engine/scripts'; // register built-in scripts

// Standalone web runtime: no editor UI, just renders + auto-plays a scene
// shipped alongside the bundle as scene.json. Designed to be opened directly
// from a static host (or `file://` after unzipping).
//
// Drop-in replacement for window.hairy so engine modules that reach for the
// bridge (e.g. Blender chat) no-op cleanly instead of throwing.

(window as unknown as { hairy?: unknown }).hairy = {
  version: 'web-0.0.3',
  blender: {
    connect: async () => ({ ok: false, error: 'Blender unavailable in web build' }),
    disconnect: async () => ({ ok: true }),
    status: async () => ({ connected: false }),
    send: async () => ({ status: 'error', message: 'Blender unavailable in web build' }),
  },
  project: {
    open: async () => ({ canceled: true }),
    openPath: async () => ({ canceled: false, error: 'Not supported in web build' }),
    save: async () => ({ ok: false, error: 'Not supported in web build' }),
    saveAs: async () => ({ canceled: true }),
  },
  window: { setTitle: async () => undefined },
  dialog: { openGlb: async () => ({ canceled: true }) },
  ai: {
    hasKey: async () => false,
    listConversations: async () => [],
    loadConversation: async () => null,
    deleteConversation: async () => undefined,
    newConversation: async () => ({
      id: 'web',
      title: 'New chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }),
    send: async () => ({ ok: true }),
    onStream: () => () => undefined,
  },
  tools: { onInvoke: () => () => undefined, result: async () => undefined },
  assets: {
    list: async () => [],
    read: async () => ({ ok: false, error: 'No asset library in web build' }),
    import: async () => ({ canceled: true }),
    reveal: async () => undefined,
    openLibrary: async () => undefined,
  },
  updater: {
    check: async () => ({ ok: false, error: 'Not supported in web build' }),
    install: async () => undefined,
    onEvent: () => () => undefined,
  },
};

const canvas = document.getElementById('canvas-3d') as HTMLCanvasElement;
const loadingEl = document.getElementById('loading') as HTMLElement;

async function boot() {
  // 1. Load scene.json sitting next to this bundle.
  let sceneData: unknown = null;
  try {
    const res = await fetch('./scene.json');
    if (res.ok) sceneData = await res.json();
  } catch {
    // ignore — empty scene is fine
  }

  // 2. Build the same Scene/Viewport stack as the editor, minus editor UI.
  const scene = new Scene();
  if (sceneData) {
    try {
      scene.deserialize(sceneData);
    } catch (err) {
      console.error('Failed to load scene.json:', err);
      scene.seedDefault();
    }
  } else {
    scene.seedDefault();
  }

  const history = new History();
  const play = new PlayState(scene, history);
  const viewport = new Viewport(canvas, document.body, scene, history, play);
  const hud = new HUD(document.body, play);

  (window as unknown as { __engine: unknown }).__engine = {
    THREE,
    scene,
    viewport,
    play,
    history,
    hud,
    physics: viewport.physics,
    animations: viewport.animations,
  };

  viewport.start(() => {});

  // 3. Auto-enter Play Mode so visitors don't need an editor button.
  setTimeout(() => {
    play.play();
    loadingEl.style.display = 'none';
  }, 100);
}

boot();

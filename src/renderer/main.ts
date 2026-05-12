import * as THREE from 'three';
import { Viewport } from './engine/Viewport';
import { Scene } from './engine/Scene';
import { Project } from './engine/Project';
import { History } from './engine/History';
import { AddObjectCommand, RemoveObjectCommand } from './engine/Commands';
import { dispatchEngineTool } from './engine/EngineTools';
import { PlayState } from './engine/PlayState';
import { HUD } from './engine/HUD';
import { connectWallet, fetchPonks } from './engine/Web3';
import './engine/scripts'; // side-effect: register built-in scripts
import { installLogBus } from './engine/LogBus';
import { ConsolePanel } from './ui/ConsolePanel';
import { AssetPanel } from './ui/AssetPanel';
import { ClaudePanel } from './ui/ClaudePanel';

// Install the log bus before any other module so we capture even the earliest logs.
installLogBus();
import { HierarchyPanel } from './ui/HierarchyPanel';
import { InspectorPanel } from './ui/InspectorPanel';
import { StatusBar } from './ui/StatusBar';
import { BlenderPanel } from './ui/BlenderPanel';
import { DropZone } from './ui/DropZone';
import { UpdateToast } from './ui/UpdateToast';
import { openMenuPopup, MenuItem } from './ui/Menu';
import {
  makeCube,
  makeSphere,
  makeCylinder,
  makePlane,
  makeTorus,
  makePointLight,
  makeSceneCamera,
  makePhysicsCube,
  makePhysicsSphere,
  makeFPSPlayer,
  makeWall,
  makeFloor,
  makeRamp,
  makeStairs,
  makeSpawnPoint,
} from './engine/Primitives';
import { applyBoolean } from './engine/Booleans';
import {
  dropToFloor,
  snapToGrid,
  duplicateAlongAxis,
  scatter,
  extrudeAlong,
} from './engine/EditTools';
import { Multiplayer } from './engine/Multiplayer';
import { PonksDrawer } from './ui/PonksDrawer';
import { FaceExtrude } from './engine/FaceExtrude';

const canvas = document.getElementById('canvas-3d') as HTMLCanvasElement;
const viewportEl = canvas.parentElement as HTMLElement;
const hierarchyEl = document.getElementById('hierarchy-tree') as HTMLElement;
const inspectorEl = document.getElementById('inspector-body') as HTMLElement;
const blenderEl = document.getElementById('blender-body') as HTMLElement;
const claudeEl = document.getElementById('claude-body') as HTMLElement;
const floatClaude = document.getElementById('float-claude') as HTMLElement;
const floatBlender = document.getElementById('float-blender') as HTMLElement;
const fpsEl = document.getElementById('footer-fps') as HTMLElement;
const selEl = document.getElementById('footer-sel') as HTMLElement;
const versionEl = document.getElementById('footer-version') as HTMLElement;
const statusEl = document.getElementById('app-status') as HTMLElement;

versionEl.textContent = `HairyEngine v${window.hairy?.version ?? '0.0.1'}`;

const scene = new Scene();
scene.seedDefault();

const history = new History();
const playState = new PlayState(scene, history);
const viewport = new Viewport(canvas, viewportEl, scene, history, playState);
const hud = new HUD(viewportEl, playState);
const hierarchy = new HierarchyPanel(hierarchyEl, scene);
const inspector = new InspectorPanel(inspectorEl, scene, history);
const blender = new BlenderPanel(blenderEl, scene, history);
const claude = new ClaudePanel(claudeEl);
void claude;
const project = new Project(scene);
const status = new StatusBar(fpsEl, selEl, statusEl);
const play = playState;
void blender;

// Play / Pause / Stop wiring
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
playBtn.addEventListener('click', () => {
  if (play.getMode() === 'edit') play.play();
  else if (play.getMode() === 'paused') play.resume();
});
pauseBtn.addEventListener('click', () => play.pause());
stopBtn.addEventListener('click', () => play.stop());

play.onChange((mode) => {
  viewportEl.classList.toggle('is-playing', mode === 'play');
  viewportEl.classList.toggle('is-paused', mode === 'paused');
  playBtn.disabled = mode === 'play';
  pauseBtn.disabled = mode !== 'play';
  stopBtn.disabled = mode === 'edit';
  status.setStatus(
    mode === 'play' ? 'playing' : mode === 'paused' ? 'paused' : 'ready',
  );
  // Rebuilding the scene on Stop invalidates any cached selection — refresh.
  if (mode === 'edit') {
    hierarchy.render();
    inspector.show(scene.selection);
  }
});

// Clear history when a new/loaded project replaces the scene wholesale.
project.onChange((s) => {
  if (!s.dirty && s.filePath !== null) history.clear();
});

history.onChange((s) => {
  if (s.lastLabel) status.setStatus(`${s.lastLabel}${s.canUndo ? '' : ''}`);
});

project.onChange((s) => {
  const dirtyMark = s.dirty ? ' •' : '';
  window.hairy.window.setTitle(`HairyEngine — ${s.fileName}${dirtyMark}`);
});
// Initial title sync
window.hairy.window.setTitle(`HairyEngine — ${project.getState().fileName}`);

new DropZone(viewportEl, scene, project, history, (msg) => status.setStatus(msg));
const updateToast = new UpdateToast(document.body);
const ponksDrawer = new PonksDrawer(document.body, scene, (m) => status.setStatus(m));
const multiplayer = new Multiplayer(scene, play);
// Declared up-front so the scene selection listener below can poll its
// isActive() without forward-ref ordering issues.
// eslint-disable-next-line prefer-const
var faceExtrudeRef: { isActive: () => boolean } | null = null;
const faceExtrude = new FaceExtrude(canvas, viewport.camera, scene, history);
faceExtrudeRef = faceExtrude;

// Face mode button (toolbar). Toggle on/off; mutually exclusive with the
// normal translate/rotate/scale gizmo (we just disable picking when active).
const faceModeBtn = document.getElementById('face-mode-btn') as HTMLButtonElement;
faceModeBtn.addEventListener('click', () => {
  const next = !faceExtrude.isActive();
  faceExtrude.setActive(next);
  status.setStatus(
    next
      ? 'Face mode — hover a Box (Wall/Floor/Cube/etc.) and drag the cyan arrow to extrude'
      : 'Face mode off',
  );
});
faceExtrude.onChange((on) => {
  faceModeBtn.classList.toggle('active', on);
  // Block both: the transform gizmo (don't show arrows on a selected mesh
  // while in face mode) AND the viewport's auto-pick on click (which would
  // re-attach the gizmo behind our backs the moment you click a cube's face).
  viewport.setPickingEnabled(!on);
  if (on) {
    viewport.setSelected(null);
  } else if (scene.selection) {
    viewport.setSelected(scene.selection);
  }
});

// Wireframe / mesh mode — overlay clean edge lines on every mesh. We use
// THREE.EdgesGeometry (angle-threshold filter) so a quad's diagonal triangle
// split doesn't clutter the view. Each overlay is a child LineSegments
// tagged with userData.isWireframeOverlay so we can find + remove them all.
let wireframeOn = false;
const WIREFRAME_TAG = '__wireframeOverlay';
const wireframeBtn = document.getElementById('wireframe-btn') as HTMLButtonElement;

function addWireframeOverlay(mesh: THREE.Mesh) {
  // Skip if already wrapped.
  if (mesh.children.some((c) => c.userData[WIREFRAME_TAG])) return;
  const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x4cf8c5 }),
  );
  lines.userData[WIREFRAME_TAG] = true;
  lines.userData.deletable = false;
  lines.renderOrder = 998;
  mesh.add(lines);
}

function removeWireframeOverlays(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const toRemove: THREE.Object3D[] = [];
    for (const c of o.children) {
      if (c.userData[WIREFRAME_TAG]) toRemove.push(c);
    }
    for (const c of toRemove) {
      o.remove(c);
      (c as THREE.LineSegments).geometry.dispose();
      ((c as THREE.LineSegments).material as THREE.Material).dispose();
    }
  });
}

function applyWireframe(on: boolean) {
  if (!on) {
    removeWireframeOverlays(scene.editable);
    return;
  }
  scene.editable.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) addWireframeOverlay(m);
  });
}

wireframeBtn.addEventListener('click', () => {
  wireframeOn = !wireframeOn;
  wireframeBtn.classList.toggle('active', wireframeOn);
  // Always clear first, then re-add if turning on. Defeats any stale overlay
  // state (e.g. extruded mesh kept the old box's edges).
  removeWireframeOverlays(scene.editable);
  applyWireframe(wireframeOn);
  const count = wireframeOn
    ? scene.editable.children.reduce((n, c) => {
        let k = 0;
        c.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) k++;
        });
        return n + k;
      }, 0)
    : 0;
  status.setStatus(
    wireframeOn ? `Wireframe ON (${count} meshes outlined)` : 'Wireframe OFF',
  );
});
// Re-apply when scene changes so newly-added meshes inherit the state and
// re-extruded meshes get fresh overlays at the new geometry.
scene.onSceneChanged(() => {
  if (!wireframeOn) return;
  removeWireframeOverlays(scene.editable);
  applyWireframe(true);
});
// F key toggles face mode for power users.
window.addEventListener('keydown', (e) => {
  if (
    e.key.toLowerCase() === 'f' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !isEditableTarget(e.target)
  ) {
    // Existing F = focus selected; only intercept when in shift+f? Actually
    // 'f' is already focus; switch to a dedicated combo to avoid stomping.
    // Use Shift+F for face mode.
    if (e.shiftKey) {
      e.preventDefault();
      faceExtrude.setActive(!faceExtrude.isActive());
    }
  }
});

// Help / About now live in the native application menu (see src/main/menu.ts).
// The native menu triggers IPC events `menu:showAbout`, `menu:checkUpdates`,
// `menu:openLog` which we handle here.
window.hairy.menu.onAction((action) => {
  switch (action) {
    case 'about':
      showAboutDialog();
      break;
    case 'check-updates':
      updateToast.beginManualCheck();
      window.hairy.updater.check().then((r) => {
        if (!r.ok) status.setStatus(`Update check: ${r.error}`);
      });
      break;
    case 'open-log':
      window.hairy.log.showFile();
      break;
    case 'open-repo':
      window.open('https://github.com/Hairylabs/HairyEngine', '_blank');
      break;
    case 'open-releases':
      window.open('https://github.com/Hairylabs/HairyEngine/releases', '_blank');
      break;
    case 'new-project':
      project.newProject();
      break;
    case 'open-project':
      project.open();
      break;
    case 'save':
      project.save();
      break;
    case 'save-as':
      project.saveAs();
      break;
  }
});

function showAboutDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'claude-modal-backdrop';
  dialog.innerHTML = `
    <div class="claude-modal">
      <div class="claude-modal-head">HairyEngine</div>
      <div class="claude-modal-body">
        <div style="font-size:13px; line-height:1.5;">
          <div style="font-size:18px; font-weight:700;">v${window.hairy.version}</div>
          <div style="margin-top:8px; color: var(--muted);">
            Desktop scene editor for browser games.<br>
            Three.js + Electron + Rapier physics + Blender MCP + in-engine Claude chat using your Claude Code subscription.
          </div>
          <div style="margin-top:14px;">
            <button class="claude-btn primary" id="about-update">Check for updates</button>
            <button class="claude-btn" id="about-log">Show log file</button>
          </div>
          <div style="margin-top:14px; color: var(--muted); font-size:11px;">
            <a href="#" id="about-repo" style="color: var(--accent-2);">Hairylabs/HairyEngine</a> · MIT (planned)
          </div>
        </div>
      </div>
      <div class="claude-modal-actions">
        <button class="claude-btn" id="about-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('#about-close')?.addEventListener('click', () => dialog.remove());
  dialog.querySelector('#about-update')?.addEventListener('click', async () => {
    updateToast.beginManualCheck();
    const r = await window.hairy.updater.check();
    if (!r.ok) status.setStatus(`Update check: ${r.error}`);
    dialog.remove();
  });
  dialog.querySelector('#about-log')?.addEventListener('click', () => {
    window.hairy.log.showFile();
  });
  dialog.querySelector('#about-repo')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://github.com/Hairylabs/HairyEngine', '_blank');
  });
}

// Console panel + bottom-tab switching + collapse toggle
const consoleEl = document.getElementById('console-body') as HTMLElement;
const assetsEl = document.getElementById('assets-body') as HTMLElement;
const consolePanel = new ConsolePanel(consoleEl);
const assetPanel = new AssetPanel(assetsEl, scene, history, (msg) => status.setStatus(msg));
void consolePanel;
void assetPanel;
document.getElementById('console-clear')?.addEventListener('click', () => {
  consolePanel.clear();
});
const bottomTabs = document.querySelectorAll<HTMLButtonElement>('.bottom-tabs .panel-tab');
bottomTabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.bottomTab as 'console' | 'assets';
    bottomTabs.forEach((b) => b.classList.toggle('active', b === btn));
    consoleEl.hidden = tab !== 'console';
    assetsEl.hidden = tab !== 'assets';
  });
});
const centerEl = document.querySelector('.center') as HTMLElement;
document.getElementById('bottom-collapse')?.addEventListener('click', () => {
  centerEl.classList.toggle('is-collapsed');
  const collapseBtn = document.getElementById('bottom-collapse') as HTMLElement;
  collapseBtn.textContent = centerEl.classList.contains('is-collapsed') ? '⌃' : '⌄';
});

// Register the renderer-side handler for engine tools Claude calls
window.hairy.tools.onInvoke(async (evt) => {
  const result = dispatchEngineTool(evt.tool, evt.input, scene, history);
  await window.hairy.tools.result(evt.id, result);
});

// Wallet Connect — PulseChain + Ponks NFTs.
const walletBtn = document.getElementById('wallet-btn') as HTMLButtonElement;
walletBtn.addEventListener('click', async () => {
  walletBtn.textContent = 'Connecting…';
  const address = await connectWallet();
  if (!address) {
    walletBtn.textContent = '🦊 Connect Wallet';
    return;
  }
  walletBtn.textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  walletBtn.classList.add('connected');
  status.setStatus('Reading Ponks…');
  try {
    const ponks = await fetchPonks(address);
    status.setStatus(`Loaded ${ponks.length} Ponk${ponks.length === 1 ? '' : 's'}`);
    console.info('Ponks:', ponks);
    (window as unknown as { __ponks?: unknown }).__ponks = ponks;
    ponksDrawer.show(ponks);
  } catch (err) {
    console.error('[ponks] fetch failed:', err);
    status.setStatus('Ponks fetch failed — see Console');
  }
});

console.info(`HairyEngine v${window.hairy.version} ready.`);

scene.onSelectionChanged((obj) => {
  // While face mode is active, ignore selection changes — face-extrude
  // owns the click, and re-attaching the gizmo on every cube click would
  // fight the face widget for events.
  if (!faceExtrudeRef?.isActive()) {
    viewport.setSelected(obj);
  }
  inspector.show(obj);
  status.setSelection(obj);
});
scene.onSceneChanged(() => {
  hierarchy.render();
});

hierarchy.render();
status.setSelection(null);
status.setStatus('ready');

// Gizmo mode toolbar — only the buttons that actually carry a data-mode
// attribute. Without this filter, the ⊞ / ✂ / ⤓ / ∷ / ❀ / ⚡ buttons would
// also match (they share .gizmo-btn for styling), call setGizmoMode(undefined),
// and corrupt the TransformControls helper into a crash next frame
// ("Cannot read properties of undefined (reading 'children')").
const toolbarBtns = document.querySelectorAll<HTMLButtonElement>(
  '#viewport-toolbar .gizmo-btn[data-mode]',
);
toolbarBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode as 'translate' | 'rotate' | 'scale';
    if (mode !== 'translate' && mode !== 'rotate' && mode !== 'scale') return;
    viewport.setGizmoMode(mode);
  });
});
viewport.onGizmoModeChanged((mode) => {
  toolbarBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
});

// Grid snap toggle — Hammer/ProBuilder-style level-builder mode.
// Tied to the visible grid size so the snap step is exactly what the user
// sees as grid bars. Click the size button to cycle through preset spacings.
const gridSnapBtn = document.getElementById('grid-snap-btn') as HTMLButtonElement;
const gridSizeBtn = document.getElementById('grid-size-btn') as HTMLButtonElement;
const GRID_SIZE_CYCLE = [0.1, 0.25, 0.5, 1, 2, 5];

function formatGridSize(s: number): string {
  return s >= 1 ? `${s}m` : `${(s * 100).toFixed(0)}cm`;
}

function applyGridSnap() {
  const on = viewport.gizmo.isAlwaysSnap();
  viewport.gizmo.setAlwaysSnap(on, scene.getGridSize());
}

gridSnapBtn.addEventListener('click', () => {
  const on = !viewport.gizmo.isAlwaysSnap();
  viewport.gizmo.setAlwaysSnap(on, scene.getGridSize());
  gridSnapBtn.classList.toggle('active', on);
  status.setStatus(
    on
      ? `Grid snap ON (${formatGridSize(scene.getGridSize())} steps)`
      : 'Grid snap OFF',
  );
});

gridSizeBtn.addEventListener('click', () => {
  const current = scene.getGridSize();
  const idx = GRID_SIZE_CYCLE.findIndex((s) => Math.abs(s - current) < 1e-6);
  const next = GRID_SIZE_CYCLE[(idx + 1) % GRID_SIZE_CYCLE.length];
  scene.setGridSize(next);
});

scene.onGridSizeChanged((size) => {
  gridSizeBtn.textContent = formatGridSize(size);
  applyGridSnap();
  status.setStatus(`Grid size: ${formatGridSize(size)}`);
});

// Initial label
gridSizeBtn.textContent = formatGridSize(scene.getGridSize());

// Boolean tools — Subtract / Merge work the same way: first click marks the
// selection as "operand A", second click on a target mesh runs the op.
type PendingOp = { mesh: THREE.Mesh; kind: 'subtract' | 'union' };
let pendingOp: PendingOp | null = null;
const subtractBtn = document.getElementById('subtract-btn') as HTMLButtonElement;
const mergeBtn = document.getElementById('merge-btn') as HTMLButtonElement;
subtractBtn.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel || !(sel as THREE.Mesh).isMesh) {
    status.setStatus('Select a mesh to use as the cutter first (the doorway shape)');
    return;
  }
  pendingOp = { mesh: sel as THREE.Mesh, kind: 'subtract' };
  subtractBtn.classList.add('active');
  mergeBtn.classList.remove('active');
  status.setStatus(`Subtract: now click the WALL to cut "${pendingOp.mesh.name}" out of`);
});
mergeBtn.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel || !(sel as THREE.Mesh).isMesh) {
    status.setStatus('Select a mesh first, then click Merge, then click another mesh to fuse them.');
    return;
  }
  pendingOp = { mesh: sel as THREE.Mesh, kind: 'union' };
  mergeBtn.classList.add('active');
  subtractBtn.classList.remove('active');
  status.setStatus(`Merge: now click another mesh to fuse with "${pendingOp.mesh.name}"`);
});

// --- Selection toolbar (context-sensitive, shows on selection) -----------
const selToolbar = document.getElementById('selection-toolbar') as HTMLElement;
const selLabel = document.getElementById('selection-label') as HTMLElement;
function updateSelToolbar(obj: THREE.Object3D | null) {
  if (!obj) {
    selToolbar.hidden = true;
    return;
  }
  selToolbar.hidden = false;
  selLabel.textContent = obj.name || obj.type;
  renderAnimationButtons(obj);
}
scene.onSelectionChanged((obj) => updateSelToolbar(obj));

// Animation buttons — Mixamo-style preview. When the selected object (or any
// of its descendants) shipped with AnimationClips, render one button per clip.
// Click → play that clip on the selected character. "Stop" pauses everything.
function renderAnimationButtons(obj: THREE.Object3D) {
  const container = document.getElementById('sel-anim-buttons') as HTMLElement;
  const divider = document.getElementById('sel-anim-divider') as HTMLElement;
  const label = document.getElementById('sel-anim-label') as HTMLElement;
  container.innerHTML = '';

  // Walk down to find a SkinnedMesh ancestor of clip-bearing object.
  // attachAnimations stores clips keyed on the root we imported, so use
  // listAnimationNames() to detect.
  // Search self + ancestors + direct descendants for any with clips.
  const candidates: THREE.Object3D[] = [obj];
  obj.traverse((c) => candidates.push(c));
  let clipsHost: THREE.Object3D | null = null;
  for (const c of candidates) {
    if (Array.isArray(c.userData.__animationNames) && c.userData.__animationNames.length > 0) {
      clipsHost = c;
      break;
    }
  }
  if (!clipsHost) {
    divider.hidden = true;
    label.hidden = true;
    return;
  }
  divider.hidden = false;
  label.hidden = false;

  const names = clipsHost.userData.__animationNames as string[];
  for (const name of names) {
    const btn = document.createElement('button');
    btn.className = 'sel-btn';
    btn.textContent = name.length > 14 ? name.slice(0, 12) + '…' : name;
    btn.title = `Play "${name}" on ${clipsHost.name}`;
    btn.addEventListener('click', () => playClipOn(clipsHost as THREE.Object3D, name));
    container.appendChild(btn);
  }
  const stopBtn = document.createElement('button');
  stopBtn.className = 'sel-btn';
  stopBtn.textContent = '⏹ Stop';
  stopBtn.title = 'Stop all clips on this character';
  stopBtn.addEventListener('click', () => stopClipsOn(clipsHost as THREE.Object3D));
  container.appendChild(stopBtn);
}

async function playClipOn(owner: THREE.Object3D, clipName: string) {
  const { getAnimations } = await import('./engine/Animations');
  const clips = getAnimations(owner);
  const clip = clips.find((c) => c.name === clipName);
  if (!clip) {
    status.setStatus(`No clip "${clipName}" on ${owner.name}`);
    return;
  }
  const mixer = viewport.animations.getMixer(owner);
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.reset().play();
  status.setStatus(`Playing "${clipName}" on ${owner.name}`);
}
function stopClipsOn(owner: THREE.Object3D) {
  viewport.animations.getMixer(owner).stopAllAction();
  status.setStatus(`Stopped animations on ${owner.name}`);
}

document.getElementById('sel-duplicate')?.addEventListener('click', () => {
  try {
    const sel = scene.selection;
    if (!sel) return;
    const copy = sel.clone(true);
    copy.position.copy(sel.position).add(new THREE.Vector3(1, 0, 0));
    copy.name = `${sel.name}_copy`;
    history.push(new AddObjectCommand(scene, copy));
    status.setStatus(`Duplicated "${sel.name}"`);
  } catch (err) {
    console.error('[sel-duplicate]', err);
  }
});
document.getElementById('sel-delete')?.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel) return;
  if (sel.userData.deletable === false) {
    status.setStatus('This object is protected from delete');
    return;
  }
  history.push(new RemoveObjectCommand(scene, sel));
});
document.getElementById('sel-focus')?.addEventListener('click', () => viewport.focusSelected());
document.getElementById('sel-reset-rot')?.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel) return;
  sel.rotation.set(0, 0, 0);
  scene.notifyChanged();
});
document.getElementById('sel-reset-scale')?.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel) return;
  sel.scale.set(1, 1, 1);
  scene.notifyChanged();
});
document.getElementById('sel-drop')?.addEventListener('click', () => {
  try {
    dropToFloor(scene, history);
  } catch (err) {
    console.error('[sel-drop]', err);
  }
});
document.getElementById('sel-snap')?.addEventListener('click', () => {
  try {
    snapToGrid(scene, history);
  } catch (err) {
    console.error('[sel-snap]', err);
  }
});
function doExtrude(axis: 'x' | 'y' | 'z') {
  try {
    const ok = extrudeAlong(scene, history, axis, 1);
    status.setStatus(
      ok
        ? `Extruded +1m on ${axis.toUpperCase()}`
        : 'Select a mesh first',
    );
  } catch (err) {
    console.error('[extrude]', err);
    status.setStatus(`Extrude failed: ${(err as Error).message}`);
  }
}
document.getElementById('sel-extrude-x')?.addEventListener('click', () => doExtrude('x'));
document.getElementById('sel-extrude-y')?.addEventListener('click', () => doExtrude('y'));
document.getElementById('sel-extrude-z')?.addEventListener('click', () => doExtrude('z'));

// Chamfer / bevel — replaces the selected mesh's BoxGeometry (or already-
// chamfered RoundedBoxGeometry) with a RoundedBoxGeometry of larger radius.
// Each click adds +5cm bevel, reset returns to sharp box. We stash the
// "logical" size on userData so repeated chamfers don't lose accuracy
// (RoundedBoxGeometry's parameters object doesn't survive shrink/grow well).
async function doChamfer(delta: number) {
  const sel = scene.selection;
  if (!sel || !(sel as THREE.Mesh).isMesh) {
    status.setStatus('Select a Box mesh first');
    return;
  }
  const mesh = sel as THREE.Mesh;
  const { RoundedBoxGeometry } = await import(
    'three/addons/geometries/RoundedBoxGeometry.js'
  );
  const geom = mesh.geometry as THREE.BoxGeometry & {
    parameters?: { width?: number; height?: number; depth?: number };
    type?: string;
  };
  // Recover (width, height, depth) and current chamfer radius.
  const cached = mesh.userData.__chamferDims as
    | { w: number; h: number; d: number }
    | undefined;
  const dims = cached ?? {
    w: geom.parameters?.width ?? 1,
    h: geom.parameters?.height ?? 1,
    d: geom.parameters?.depth ?? 1,
  };
  const currentRadius = Number(mesh.userData.__chamferRadius ?? 0);
  const nextRadius = delta < 0 ? 0 : Math.min(
    Math.min(dims.w, dims.h, dims.d) * 0.49,
    currentRadius + delta,
  );
  mesh.geometry.dispose();
  if (nextRadius <= 0.001) {
    mesh.geometry = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
    delete mesh.userData.__chamferRadius;
  } else {
    mesh.geometry = new RoundedBoxGeometry(
      dims.w,
      dims.h,
      dims.d,
      4, // segments per edge
      nextRadius,
    );
    mesh.userData.__chamferRadius = nextRadius;
  }
  mesh.userData.__chamferDims = dims;
  scene.notifyChanged();
  status.setStatus(
    nextRadius > 0 ? `Chamfer ${(nextRadius * 100).toFixed(0)}cm` : 'Sharp edges',
  );
}
document.getElementById('sel-chamfer-add')?.addEventListener('click', () => doChamfer(0.05));
document.getElementById('sel-chamfer-reset')?.addEventListener('click', () => doChamfer(-1));

// Drop-to-floor (Unreal "End" key)
document.getElementById('drop-floor-btn')?.addEventListener('click', () => {
  try {
    const ok = dropToFloor(scene, history);
    status.setStatus(ok ? 'Dropped to floor' : 'Select an object first');
  } catch (err) {
    console.error('Drop-to-floor failed:', err);
    status.setStatus(`Drop-to-floor failed: ${(err as Error).message}`);
  }
});

// Snap selection to nearest grid intersection (post-hoc cleanup)
window.addEventListener('keydown', (e) => {
  // Hold Shift+G to snap selection to grid (no conflict with WASD)
  if (e.shiftKey && e.key.toLowerCase() === 'g' && !isEditableTarget(e.target)) {
    snapToGrid(scene, history);
    status.setStatus('Snapped to grid');
  }
});

// Duplicate along axis — defaults to 5 copies, 2m apart along X
document.getElementById('dup-axis-btn')?.addEventListener('click', () => {
  try {
    const n = duplicateAlongAxis(scene, history, 5, 'x', 2);
    status.setStatus(
      n > 0 ? `Duplicated ×${n} along +X by 2m` : 'Select an object first',
    );
  } catch (err) {
    console.error('Duplicate-along-axis failed:', err);
    status.setStatus(`Duplicate failed: ${(err as Error).message}`);
  }
});

// Scatter — 8 random clones in a 4m radius
document.getElementById('scatter-btn')?.addEventListener('click', () => {
  try {
    const n = scatter(scene, history, 8, 4);
    status.setStatus(
      n > 0 ? `Scattered ${n} copies within 4m` : 'Select an object first',
    );
  } catch (err) {
    console.error('Scatter failed:', err);
    status.setStatus(`Scatter failed: ${(err as Error).message}`);
  }
});

// Multiplayer connect toggle
const mpBtn = document.getElementById('multiplayer-btn') as HTMLButtonElement;
mpBtn.addEventListener('click', async () => {
  if (multiplayer.isConnected()) {
    multiplayer.disconnect();
    return;
  }
  status.setStatus('Connecting to multiplayer server…');
  const r = await multiplayer.connect();
  if (!r.ok) status.setStatus(`Connect failed: ${r.error}. Run the server: cd server && npm run dev`);
});
multiplayer.onStateChange((connected, info) => {
  mpBtn.classList.toggle('active', connected);
  if (info) status.setStatus(info);
});

scene.onSelectionChanged((obj) => {
  if (!pendingOp) return;
  if (!obj || obj === pendingOp.mesh) return;
  if (!(obj as THREE.Mesh).isMesh) {
    status.setStatus('Boolean target must be a mesh');
    return;
  }
  try {
    const result = applyBoolean(
      obj as THREE.Mesh,
      pendingOp.mesh,
      pendingOp.kind === 'subtract' ? 'subtract' : 'union',
    );
    result.userData = { ...(obj as THREE.Mesh).userData };
    scene.addInternal(result);
    scene.removeInternal(obj);
    scene.removeInternal(pendingOp.mesh);
    history.clear(); // CSG output + undo stack would diverge; safest reset
    scene.select(result);
    status.setStatus(
      pendingOp.kind === 'subtract'
        ? `Cut "${pendingOp.mesh.name}" out of "${obj.name}"`
        : `Merged "${pendingOp.mesh.name}" with "${obj.name}"`,
    );
  } catch (err) {
    status.setStatus(`Boolean failed: ${(err as Error).message}`);
  }
  pendingOp = null;
  subtractBtn.classList.remove('active');
  mergeBtn.classList.remove('active');
});

viewport.start((dt, fps) => {
  status.setFps(fps);
  inspector.tick();
  multiplayer.tick(dt);
});

// Hotkeys not handled inside Gizmo/EditorCamera
window.addEventListener('keydown', (e) => {
  // Save shortcuts even when an input isn't focused — fires globally.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (e.shiftKey) {
      project.saveAs();
    } else {
      project.save();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !isEditableTarget(e.target)) {
    e.preventDefault();
    project.open();
    return;
  }
  // Undo / redo — work everywhere except when typing in an input.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !isEditableTarget(e.target)) {
    e.preventDefault();
    history.redo();
    return;
  }

  if (isEditableTarget(e.target)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = scene.selection;
    if (sel && sel.userData.deletable !== false) {
      history.push(new RemoveObjectCommand(scene, sel));
    }
  }
  if (e.key === 'f') viewport.focusSelected();
  if (e.key === 'Escape') scene.select(null);

  // Blender-style shortcuts (only when not typing in an input):
  //   Ctrl+C — copy selected to clipboard
  //   Ctrl+V — paste (clone + offset)
  //   Ctrl+D — duplicate (paste alongside original immediately)
  //   Shift+D — duplicate (Blender alias)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    const sel = scene.selection;
    if (sel) {
      clipboard = sel;
      status.setStatus(`Copied "${sel.name}"`);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    pasteClipboard();
    return;
  }
  if (
    (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') ||
      (e.shiftKey && e.key.toLowerCase() === 'd')) &&
    !isEditableTarget(e.target)
  ) {
    e.preventDefault();
    const sel = scene.selection;
    if (sel) {
      clipboard = sel;
      pasteClipboard();
    }
    return;
  }

  // Group / Ungroup (Ctrl+G / Shift+Ctrl+G)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !isEditableTarget(e.target)) {
    e.preventDefault();
    if (e.shiftKey) ungroupSelection();
    else groupSelection();
    return;
  }
});

// Group: wraps the selected object + any siblings the user shift-selected
// (multi-select still pending) into a new Group at the centroid.
// For now (single-select only) we wrap just the selection in a Group so
// that further actions treat it as one unit.
function groupSelection() {
  const sel = scene.selection;
  if (!sel) return;
  if (sel.userData.deletable === false) {
    status.setStatus(`"${sel.name}" cannot be grouped`);
    return;
  }
  const parent = sel.parent;
  if (!parent) return;
  const group = new THREE.Group();
  group.name = `${sel.name}_group`;
  // World-space center → group origin
  const box = new THREE.Box3().setFromObject(sel);
  const center = box.getCenter(new THREE.Vector3());
  group.position.copy(center);
  parent.add(group);
  // Reparent sel into group with adjusted local position
  group.attach(sel);
  scene.notifyChanged();
  scene.select(group);
  status.setStatus(`Grouped "${sel.name}" into "${group.name}"`);
}
function ungroupSelection() {
  const sel = scene.selection;
  if (!sel) return;
  if (!(sel as THREE.Group).isGroup) {
    status.setStatus('Ungroup needs a Group selected');
    return;
  }
  const parent = sel.parent;
  if (!parent) return;
  // Move children up to parent, preserving world transforms
  const children = sel.children.slice();
  for (const c of children) {
    parent.attach(c);
  }
  scene.removeInternal(sel);
  scene.notifyChanged();
  status.setStatus(`Ungrouped "${sel.name}"`);
}

// Clipboard for copy/paste — stores a reference to the source object;
// each paste does a deep `.clone(true)` so further edits to the clipboard
// don't affect already-pasted copies.
let clipboard: THREE.Object3D | null = null;
function pasteClipboard() {
  if (!clipboard) {
    status.setStatus('Clipboard empty — Ctrl+C to copy first');
    return;
  }
  const copy = clipboard.clone(true);
  copy.position.copy(clipboard.position).add(new THREE.Vector3(1, 0, 0));
  copy.name = `${clipboard.name}_copy`;
  history.push(new AddObjectCommand(scene, copy));
  status.setStatus(`Pasted "${clipboard.name}" → "${copy.name}"`);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Menus
const addBtn = document.getElementById('menu-add') as HTMLButtonElement;
addBtn.addEventListener('click', () => {
  openMenuPopup(addBtn, [
    { label: '👤 Character (FPS)', onClick: () => addAndSelect(makeFPSPlayer()) },
    { label: '◆ Spawn Point', onClick: () => addAndSelect(makeSpawnPoint()) },
    { sep: true },
    { label: '▮ Wall', onClick: () => addAndSelect(makeWall()) },
    { label: '▭ Floor', onClick: () => addAndSelect(makeFloor()) },
    { label: '◢ Ramp', onClick: () => addAndSelect(makeRamp()) },
    { label: '▤ Stairs', onClick: () => addAndSelect(makeStairs()) },
    { sep: true },
    { label: 'Cube', onClick: () => addAndSelect(makeCube()) },
    { label: 'Sphere', onClick: () => addAndSelect(makeSphere()) },
    { label: 'Cylinder', onClick: () => addAndSelect(makeCylinder()) },
    { label: 'Plane', onClick: () => addAndSelect(makePlane()) },
    { label: 'Torus Knot', onClick: () => addAndSelect(makeTorus()) },
    { sep: true },
    { label: 'Physics Cube', onClick: () => addAndSelect(makePhysicsCube()) },
    { label: 'Physics Sphere', onClick: () => addAndSelect(makePhysicsSphere()) },
    { sep: true },
    { label: 'Point Light', onClick: () => addAndSelect(makePointLight()) },
    { label: 'Camera', onClick: () => addAndSelect(makeSceneCamera()) },
  ]);
});

function addAndSelect(obj: THREE.Object3D) {
  history.push(new AddObjectCommand(scene, obj));
}

// File operations now triggered by the native menu (Help|File menu in main).
// The action handler at the bottom of this file dispatches to project methods.
// Floating dropdown chats — toggled by their header buttons.
const claudeBtn = document.getElementById('menu-claude') as HTMLButtonElement;
const blenderBtn = document.getElementById('menu-blender') as HTMLButtonElement;
function toggleFloat(panel: HTMLElement, btn: HTMLButtonElement) {
  const showing = panel.hidden;
  // Close both first, then open the one we want — keeps state sane.
  floatClaude.hidden = true;
  floatBlender.hidden = true;
  claudeBtn.classList.remove('active');
  blenderBtn.classList.remove('active');
  if (showing) {
    panel.hidden = false;
    btn.classList.add('active');
  }
}
claudeBtn.addEventListener('click', () => toggleFloat(floatClaude, claudeBtn));
blenderBtn.addEventListener('click', () => toggleFloat(floatBlender, blenderBtn));
function closeFloat(which: 'claude' | 'blender') {
  if (which === 'claude') {
    floatClaude.hidden = true;
    claudeBtn.classList.remove('active');
  } else {
    floatBlender.hidden = true;
    blenderBtn.classList.remove('active');
  }
}
// Belt + braces. (1) Direct click listener on each known button id. (2) An
// event-delegation listener as fallback in case the button was replaced or a
// click lands on an inner text node. Either path fires closeFloat exactly once
// (stopPropagation prevents the doc-level handler from firing if the direct
// one already did).
function wireCloseDirect(id: string, which: 'claude' | 'blender') {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeFloat(which);
  });
}
wireCloseDirect('float-claude-close', 'claude');
wireCloseDirect('float-blender-close', 'blender');
document.addEventListener('click', (e) => {
  // Walk up from the click target to find an Element (text-node clicks).
  let node: Node | null = e.target as Node | null;
  while (node && !(node instanceof Element)) node = node.parentNode;
  if (!node) return;
  const hit = (node as Element).closest(
    '#float-claude-close, #float-blender-close',
  );
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  closeFloat(hit.id === 'float-claude-close' ? 'claude' : 'blender');
});
// Escape closes any open floating panel.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!floatClaude.hidden) {
      floatClaude.hidden = true;
      claudeBtn.classList.remove('active');
    }
    if (!floatBlender.hidden) {
      floatBlender.hidden = true;
      blenderBtn.classList.remove('active');
    }
  }
});

// Expose engine internals globally — scripts use this to find the physics
// system; the debugger appreciates it too.
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

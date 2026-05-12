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
const faceExtrude = new FaceExtrude(canvas, viewport.camera, scene, history);

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
  viewport.setSelected(obj);
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
const gridSnapBtn = document.getElementById('grid-snap-btn') as HTMLButtonElement;
gridSnapBtn.addEventListener('click', () => {
  const on = !viewport.gizmo.isAlwaysSnap();
  viewport.gizmo.setAlwaysSnap(on, 1.0);
  gridSnapBtn.classList.toggle('active', on);
  status.setStatus(on ? 'Grid snap ON (1m steps)' : 'Grid snap OFF');
});

// Boolean subtract — first click marks the selection as "cutter", second
// click on a target mesh runs the cut. Esc to cancel.
let pendingCutter: THREE.Mesh | null = null;
const subtractBtn = document.getElementById('subtract-btn') as HTMLButtonElement;
subtractBtn.addEventListener('click', () => {
  const sel = scene.selection;
  if (!sel || !(sel as THREE.Mesh).isMesh) {
    status.setStatus('Select a mesh to use as the cutter first (the doorway shape)');
    return;
  }
  pendingCutter = sel as THREE.Mesh;
  subtractBtn.classList.add('active');
  status.setStatus(`Subtract: now click the WALL to cut "${pendingCutter.name}" out of`);
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
}
scene.onSelectionChanged((obj) => updateSelToolbar(obj));

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
  if (!pendingCutter) return;
  if (!obj || obj === pendingCutter) return;
  if (!(obj as THREE.Mesh).isMesh) {
    status.setStatus('Subtract target must be a mesh — pick a wall or floor');
    return;
  }
  try {
    const result = applyBoolean(obj as THREE.Mesh, pendingCutter, 'subtract');
    result.userData = { ...(obj as THREE.Mesh).userData };
    scene.addInternal(result);
    scene.removeInternal(obj);
    scene.removeInternal(pendingCutter);
    history.clear(); // mixing CSG output with the undo stack would be messy
    scene.select(result);
    status.setStatus(`Cut "${pendingCutter.name}" out of "${obj.name}"`);
  } catch (err) {
    status.setStatus(`Subtract failed: ${(err as Error).message}`);
  }
  pendingCutter = null;
  subtractBtn.classList.remove('active');
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
});

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Menus
const addBtn = document.getElementById('menu-add') as HTMLButtonElement;
addBtn.addEventListener('click', () => {
  openMenuPopup(addBtn, [
    { label: '👤 FPS Player', onClick: () => addAndSelect(makeFPSPlayer()) },
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

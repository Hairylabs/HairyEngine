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
} from './engine/Primitives';

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
new UpdateToast(document.body);

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
    // Future: render thumbnails in a sidebar drawer + let user drag onto a
    // character's head to apply the NFT image as a texture.
    (window as unknown as { __ponks?: unknown }).__ponks = ponks;
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

// Gizmo mode toolbar
const toolbarBtns = document.querySelectorAll<HTMLButtonElement>('#viewport-toolbar .gizmo-btn');
toolbarBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode as 'translate' | 'rotate' | 'scale';
    viewport.setGizmoMode(mode);
  });
});
viewport.onGizmoModeChanged((mode) => {
  toolbarBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
});

viewport.start((_dt, fps) => {
  status.setFps(fps);
  inspector.tick();
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

const fileBtn = document.getElementById('menu-file') as HTMLButtonElement;
fileBtn.addEventListener('click', () => {
  const items: MenuItem[] = [
    { label: 'New', onClick: () => project.newProject() },
    { label: 'Open…  Ctrl+O', onClick: () => project.open() },
    { label: 'Save  Ctrl+S', onClick: () => project.save() },
    { label: 'Save As…  Ctrl+Shift+S', onClick: () => project.saveAs() },
  ];
  const recents = project.recents();
  if (recents.length > 0) {
    items.push({ sep: true });
    for (const r of recents.slice(0, 6)) {
      items.push({
        label: shortenPath(r),
        onClick: () => project.openPath(r),
      });
    }
  }
  openMenuPopup(fileBtn, items);
});

function shortenPath(p: string): string {
  if (p.length <= 40) return p;
  return '…' + p.slice(-39);
}
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
// Event delegation on document so we don't depend on when the buttons get
// added to the DOM, and so clicks on the inner ✕ text still match the button.
document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement | null)?.closest(
    '#float-claude-close, #float-blender-close',
  ) as HTMLElement | null;
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  closeFloat(target.id === 'float-claude-close' ? 'claude' : 'blender');
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

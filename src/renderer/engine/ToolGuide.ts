// First-use guide popup for each tool. Shown the first time a user clicks
// a toolbar button. After dismissal we record the tool id in localStorage so
// it doesn't pop up again. A "Help" tip icon next to each button lets the
// user re-trigger the guide at will.

const SEEN_KEY = 'hairy.toolGuides.seen.v1';

type Guide = {
  title: string;
  body: string;
  shortcut?: string;
};

const GUIDES: Record<string, Guide> = {
  'face-mode': {
    title: 'Face Mode',
    body: 'Click a flat face on any mesh (Cube, Wall, GLB, anything) to start extruding. Drag the cyan arrow to push the face in or out. Hold Ctrl to snap to 0.25 m. Esc cancels mid-drag. Works on imported GLBs too — the engine flood-fills coplanar triangles to find the whole "face".',
    shortcut: 'Shift+F',
  },
  'wireframe': {
    title: 'Wireframe',
    body: 'Overlays clean edge lines on every mesh in the scene. Uses an angle threshold so a quad\'s diagonal triangle split doesn\'t show. Toggle anytime — runs across the whole scene so you can spot triangle-density issues.',
  },
  'grid-snap': {
    title: 'Grid Snap',
    body: 'When ON, moving objects snaps them to the visible grid spacing. Cycle the grid size with the button next to it. Great for Hammer / ProBuilder-style level blockouts.',
  },
  'grid-size': {
    title: 'Grid Size',
    body: 'Click to cycle through 10 cm, 25 cm, 50 cm, 1 m, 2 m, 5 m grids. The grid you see is what you snap to.',
  },
  'subtract': {
    title: 'Subtract (Boolean Cut)',
    body: 'Select the CUTTER mesh first (e.g. a small box shaped like a doorway). Click ⨯ Subtract. Now click the TARGET (e.g. the wall). The cutter is removed from the target. Use for doors, windows, recesses.',
  },
  'merge': {
    title: 'Merge (Boolean Union)',
    body: 'Select one mesh, click ⨃ Merge, then click another mesh. Both become one fused mesh. Use for combining cover blocks, joining a wall + pillar, etc.',
  },
  'drop-floor': {
    title: 'Drop to Floor',
    body: 'Raycasts straight down from the selected object\'s bottom and snaps it to whichever surface it hits. If nothing\'s below, drops it to y=0. Saves you from manually nudging things into the floor.',
    shortcut: 'End (planned)',
  },
  'dup-axis': {
    title: 'Duplicate Along Axis',
    body: 'Makes 5 copies of the selected object spaced 2 m apart along +X. Great for fence posts, pillars, floor tiles. Each copy is independent and editable.',
  },
  'scatter': {
    title: 'Scatter',
    body: 'Drops 8 random copies of the selected object within a 4 m radius around it, each with random Y rotation. Use for foliage, debris, scattered cover.',
  },
  'topdown': {
    title: 'Top-Down Split View',
    body: 'Opens a Hammer-style orthographic top-down camera on the right 40% of the viewport. RMB drag pans, mouse wheel zooms, double-click frames the whole scene. Click an object in either view to select it — selection stays in sync.',
  },
  'modeling': {
    title: 'Modeling Tools (UE5-style)',
    body: 'Drop-down with 5 mesh ops you apply to the selected object:\n• Extrude Poly — grow on an axis symmetrically.\n• Extrude Path — sweep 8 clones along a curve.\n• Warp — bend the mesh on Y.\n• Lattice — taper / twist / bulge (cycles each click).\n• Edit Pivot — relocate origin to center or bottom (keeps world position).',
  },
  'paintball': {
    title: 'Paintball Arena',
    body: 'Bootstraps a complete playable paintball map in one click — 30 m field, boundary walls, 6 cover boxes, two team spawn points, and a Red player you can drive immediately. Hit ▶ Play to start. Click to shoot.',
  },
  'multiplayer': {
    title: 'Multiplayer',
    body: 'Connects to a local Colyseus + geckos.io server on localhost:2567. Run "cd server && npm run dev" in another terminal first. Once connected, your character\'s position broadcasts to other clients in real time.',
  },
  'levels': {
    title: 'Levels',
    body: 'Each .hairy project can hold multiple Levels (MainMenu, Arena1, Lobby, …). Click a level name to switch — your current scene auto-saves first. Click + to add a new empty level.',
  },
  'mixamo': {
    title: 'Animation Library',
    body: 'Apply a clip to the selected character. Built-in procedural clips (Wave, Idle, Jump, Dance) work on any rig that uses Mixamo-style bone names (mixamorig:*). To add Mixamo clips you exported yourself: drop the .glb into the Assets panel — they\'ll appear here.',
  },
};

let activeGuide: HTMLElement | null = null;

export function showGuide(toolId: string, force = false) {
  if (!force && hasSeen(toolId)) return;
  const g = GUIDES[toolId];
  if (!g) return;
  closeGuide();
  markSeen(toolId);

  const modal = document.createElement('div');
  modal.className = 'tool-guide';
  modal.innerHTML = `
    <div class="tool-guide-card">
      <div class="tool-guide-head">
        <span class="tool-guide-icon">💡</span>
        <span class="tool-guide-title">${escapeHtml(g.title)}</span>
        <button class="tool-guide-close" id="tg-close" title="Close">×</button>
      </div>
      <div class="tool-guide-body">${escapeHtml(g.body).replace(/\n/g, '<br>')}</div>
      ${g.shortcut ? `<div class="tool-guide-shortcut">Shortcut: <kbd>${escapeHtml(g.shortcut)}</kbd></div>` : ''}
      <div class="tool-guide-foot">
        <label><input type="checkbox" id="tg-dont-show"> Don't show again</label>
        <button class="claude-btn primary" id="tg-ok">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  activeGuide = modal;

  const dontShow = modal.querySelector('#tg-dont-show') as HTMLInputElement;
  // Default "Don't show" to checked — we don't want to nag.
  dontShow.checked = true;

  const dismiss = () => {
    if (!dontShow.checked) clearSeen(toolId);
    closeGuide();
  };

  modal.querySelector('#tg-ok')?.addEventListener('click', dismiss);
  modal.querySelector('#tg-close')?.addEventListener('click', dismiss);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) dismiss();
  });
}

export function closeGuide() {
  if (activeGuide) {
    activeGuide.remove();
    activeGuide = null;
  }
}

function hasSeen(toolId: string): boolean {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return false;
    const set = new Set(JSON.parse(raw));
    return set.has(toolId);
  } catch {
    return false;
  }
}

function markSeen(toolId: string) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!arr.includes(toolId)) arr.push(toolId);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function clearSeen(toolId: string) {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return;
    const arr: string[] = JSON.parse(raw);
    const next = arr.filter((id) => id !== toolId);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function resetAllGuides() {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

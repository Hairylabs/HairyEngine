import { registerScript, listScripts, ScriptDefinition } from './Script';

// User-defined scripts — the artist can write their own behaviors inside the
// engine without leaving the editor. Each script lives in localStorage so it
// round-trips across sessions; we wrap the user's source in a tiny harness
// that calls registerScript() at load time.
//
// Storage key: hairy.userScripts.v1 → Array<UserScript>
// Each entry stores the original source so the editor can re-open it and
// the next session can re-eval. The user's source gets prefixed by an
// "API surface" comment block when the editor is first opened on a blank
// script — see DEFAULT_SCRIPT_BODY below.

export type UserScript = {
  id: string;
  name: string;       // typed by the user
  type: string;       // registry key (derived from name, kebab-case)
  body: string;       // raw JS source
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
};

const STORAGE_KEY = 'hairy.userScripts.v1';

let cache: UserScript[] | null = null;

export function listUserScripts(): UserScript[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const arr = JSON.parse(raw);
    cache = Array.isArray(arr) ? arr : [];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
  } catch (err) {
    console.warn('[UserScripts] persist failed:', err);
  }
}

export function getUserScript(id: string): UserScript | null {
  return listUserScripts().find((s) => s.id === id) ?? null;
}

export function saveUserScript(input: Omit<UserScript, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): UserScript {
  const list = listUserScripts();
  const now = Date.now();
  let entry: UserScript;
  if (input.id) {
    const existing = list.find((s) => s.id === input.id);
    if (existing) {
      Object.assign(existing, {
        name: input.name,
        type: input.type,
        body: input.body,
        enabled: input.enabled,
        updatedAt: now,
      });
      entry = existing;
    } else {
      entry = { ...input, id: input.id, createdAt: now, updatedAt: now };
      list.push(entry);
    }
  } else {
    entry = {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      name: input.name,
      type: input.type,
      body: input.body,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    list.push(entry);
  }
  persist();
  if (entry.enabled) tryRegister(entry);
  return entry;
}

export function deleteUserScript(id: string): boolean {
  const list = listUserScripts();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

/** Try to register a user script. Returns the registered definition's `type`
 *  on success, or throws on syntax/runtime error from the user code. */
function tryRegister(script: UserScript): string {
  // The user code is expected to call registerScript(...). We provide a
  // closure-scoped `registerScript` so they don't have to import anything.
  // If their code throws or doesn't call registerScript, we surface that.
  let registered: ScriptDefinition | null = null;
  const localRegister = (def: ScriptDefinition) => {
    registered = def;
    registerScript(def);
  };
  // We pass globals the user code might reasonably want (THREE, console).
  // Anything else is reachable via window.__engine.
  try {
    const fn = new Function('registerScript', 'THREE', 'console', script.body);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fn(localRegister, (window as unknown as { THREE?: unknown }).THREE ?? null, console);
  } catch (err) {
    console.error(`[UserScripts] "${script.name}" failed to load:`, err);
    throw err;
  }
  if (!registered) {
    throw new Error(`Script "${script.name}" did not call registerScript()`);
  }
  return (registered as ScriptDefinition).type;
}

/** Boot-time load: re-evaluate every enabled user script so the +Add
 *  Component menu picks them up. Errors are logged but never block the app. */
export function bootUserScripts() {
  const list = listUserScripts();
  for (const s of list) {
    if (!s.enabled) continue;
    try {
      tryRegister(s);
    } catch (err) {
      console.error(`[UserScripts] "${s.name}" boot failed:`, err);
    }
  }
}

// --- Editor UI ------------------------------------------------------------

const DEFAULT_SCRIPT_BODY = `// HairyEngine user script — runs on Play.
// Lifecycle: start() once, update(dt) every frame, stop() on Play end.
//
// Helpers in scope: registerScript, THREE, console.
// Engine internals: window.__engine.{scene, viewport, physics, ...}
//
// Save below the // === DO NOT EDIT line; the harness call shape is fixed.

registerScript({
  type: 'MyScript',
  label: 'My Script',
  description: 'A custom behavior I wrote.',
  params: [
    { key: 'speed', label: 'Speed', kind: 'number', default: 1, step: 0.1 },
  ],
  create: (ctx, params) => {
    const speed = Number(params.speed ?? 1);
    return {
      start() {
        console.log('[MyScript] start on', ctx.owner.name);
      },
      update(dt) {
        // Example: rotate the owner around the Y axis.
        ctx.owner.rotation.y += dt * speed;
      },
      stop() {
        // Cleanup goes here.
      },
    };
  },
});
`;

let editorBackdrop: HTMLElement | null = null;

export function openScriptEditor(scriptId: string | null, onSaved: () => void) {
  closeScriptEditor();
  const script = scriptId ? getUserScript(scriptId) : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'script-editor-backdrop';
  backdrop.innerHTML = `
    <div class="script-editor">
      <div class="script-editor-head">
        <span style="color: var(--accent-2); font-weight: 700;">📝 Script Editor</span>
        <input id="se-name" placeholder="MyScript" value="${escapeAttr(script?.name ?? '')}">
        <label style="font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px;">
          <input type="checkbox" id="se-enabled" ${script?.enabled !== false ? 'checked' : ''}>
          Enabled
        </label>
      </div>
      <textarea id="se-body" spellcheck="false">${escapeText(script?.body ?? DEFAULT_SCRIPT_BODY)}</textarea>
      <div class="script-editor-foot">
        <button class="claude-btn" id="se-test">Test compile</button>
        <span class="test-output" id="se-test-out"></span>
        <span class="spacer"></span>
        <button class="claude-btn" id="se-cancel">Cancel</button>
        <button class="claude-btn primary" id="se-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  editorBackdrop = backdrop;

  const nameInput = backdrop.querySelector('#se-name') as HTMLInputElement;
  const bodyInput = backdrop.querySelector('#se-body') as HTMLTextAreaElement;
  const enabledInput = backdrop.querySelector('#se-enabled') as HTMLInputElement;
  const testOut = backdrop.querySelector('#se-test-out') as HTMLElement;

  backdrop.querySelector('#se-test')?.addEventListener('click', () => {
    try {
      const dummy: UserScript = {
        id: 'test',
        name: nameInput.value || 'Test',
        type: typeFromName(nameInput.value || 'Test'),
        body: bodyInput.value,
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      };
      // Temporarily register, then check it was picked up.
      const before = listScripts().length;
      tryRegister(dummy);
      const after = listScripts().length;
      testOut.textContent = `✔ Compiled — ${after - before} type registered`;
      testOut.style.color = 'var(--accent-2)';
    } catch (err) {
      testOut.textContent = `✘ ${(err as Error).message.slice(0, 80)}`;
      testOut.style.color = '#ff7878';
    }
  });

  backdrop.querySelector('#se-save')?.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'UnnamedScript';
    try {
      saveUserScript({
        ...(script?.id ? { id: script.id } : {}),
        name,
        type: typeFromName(name),
        body: bodyInput.value,
        enabled: enabledInput.checked,
      });
      onSaved();
      closeScriptEditor();
    } catch (err) {
      testOut.textContent = `Save failed: ${(err as Error).message}`;
      testOut.style.color = '#ff7878';
    }
  });

  backdrop.querySelector('#se-cancel')?.addEventListener('click', closeScriptEditor);

  // Esc to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeScriptEditor();
  };
  window.addEventListener('keydown', onKey);
  backdrop.addEventListener('remove', () => window.removeEventListener('keydown', onKey));
}

export function closeScriptEditor() {
  if (editorBackdrop) {
    editorBackdrop.remove();
    editorBackdrop = null;
  }
}

function typeFromName(name: string): string {
  // Kebab-case for storage; the user can pick whatever `type` they put in
  // registerScript({}), but we keep a default consistent with the name.
  return name.replace(/\s+/g, '');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

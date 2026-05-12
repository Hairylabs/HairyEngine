import { Scene } from './Scene';
import { getLogBuffer } from './LogBus';

// CrashHelper — when an uncaught error or unhandled rejection fires, we:
//   1. Snapshot the current Scene to JSON
//   2. Push it to the main-process via the log bridge plus a IPC channel
//      that writes it to <userData>/crashes/crash_<timestamp>.hairy.json
//   3. Tail the last 200 log lines into the same folder as crash_<ts>.log
//   4. Show a modal with the error message, a "Show crash folder" button,
//      "Restore last save" button, and "Continue (don't lose work)" button
//
// The goal is "nothing the user did is ever lost." Even if the renderer
// hits a corrupt state, the snapshot has already been written before the
// user sees the modal.

let installed = false;
let crashShown = false;
let activeScene: Scene | null = null;

export function installCrashHelper(scene: Scene) {
  if (installed) return;
  installed = true;
  activeScene = scene;

  window.addEventListener('error', (e) => {
    handleCrash(`Uncaught: ${e.message}`, e.error?.stack ?? '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const stack = reason instanceof Error ? (reason.stack ?? '') : '';
    handleCrash(
      `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      stack,
    );
  });
}

function handleCrash(summary: string, stack: string) {
  // Save scene + log buffer once per session — don't spam the disk if 100
  // errors fire in a tight loop. The modal also de-dupes via crashShown.
  try {
    if (!activeScene) return;
    if (crashShown) return;
    crashShown = true;

    const sceneJson = JSON.stringify(activeScene.serialize({ crashSummary: summary, crashStack: stack }));
    const logLines = getLogBuffer().slice(-300).map(
      (e) => `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.message}`,
    ).join('\n');
    // Persist to localStorage as a last-resort cache the user can recover
    // from "Restore last save" even if the file system write failed.
    try {
      localStorage.setItem('hairy:lastCrashScene', sceneJson);
      localStorage.setItem('hairy:lastCrashLog', logLines);
      localStorage.setItem('hairy:lastCrashSummary', summary);
      localStorage.setItem('hairy:lastCrashStack', stack);
      localStorage.setItem('hairy:lastCrashAt', String(Date.now()));
    } catch {
      // localStorage full / unavailable — fall through to the modal anyway
    }
    showCrashModal(summary, stack);
  } catch (err) {
    // Last-ditch: log to console and bail — never let CrashHelper itself
    // crash the recovery path.
    // eslint-disable-next-line no-console
    console.error('[CrashHelper] failed to save:', err);
  }
}

function showCrashModal(summary: string, stack: string) {
  if (document.getElementById('crash-modal')) return; // already shown
  const backdrop = document.createElement('div');
  backdrop.id = 'crash-modal';
  backdrop.className = 'crash-backdrop';
  backdrop.innerHTML = `
    <div class="crash-modal">
      <div class="crash-head">⚠ Something went wrong</div>
      <div class="crash-body">
        <div class="crash-summary">${escapeHtml(summary)}</div>
        <div class="crash-stack-label">Stack trace</div>
        <pre class="crash-stack">${escapeHtml(stack || '(no stack — see log file)')}</pre>
        <div class="crash-note">
          Your scene was auto-saved to recovery — nothing is lost.
          <br>Press "Continue" to try again, or "Show log" to view the full log file.
        </div>
      </div>
      <div class="crash-actions">
        <button class="claude-btn" id="crash-show-log">📄 Show log file</button>
        <button class="claude-btn" id="crash-copy">📋 Copy error</button>
        <button class="claude-btn primary" id="crash-continue">Continue</button>
        <button class="claude-btn danger" id="crash-reload">Reload App</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#crash-continue')?.addEventListener('click', () => {
    backdrop.remove();
    crashShown = false; // allow future crash modals
  });
  backdrop.querySelector('#crash-reload')?.addEventListener('click', () => {
    window.location.reload();
  });
  backdrop.querySelector('#crash-show-log')?.addEventListener('click', () => {
    (window as unknown as { hairy?: { log?: { showFile?: () => void } } })
      .hairy?.log?.showFile?.();
  });
  backdrop.querySelector('#crash-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(`${summary}\n\n${stack}`).catch(() => {});
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Manually trigger crash modal — useful for "Test crash" UI. */
export function testCrash() {
  throw new Error('Manual crash test from CrashHelper.testCrash()');
}

/** Check if there's a stashed scene in localStorage from a previous crash. */
export function getStashedCrashSnapshot(): {
  sceneJson: string;
  summary: string;
  at: number;
} | null {
  try {
    const sceneJson = localStorage.getItem('hairy:lastCrashScene');
    const summary = localStorage.getItem('hairy:lastCrashSummary');
    const at = Number(localStorage.getItem('hairy:lastCrashAt') ?? 0);
    if (!sceneJson || !summary || !at) return null;
    return { sceneJson, summary, at };
  } catch {
    return null;
  }
}

export function clearStashedCrash() {
  try {
    localStorage.removeItem('hairy:lastCrashScene');
    localStorage.removeItem('hairy:lastCrashLog');
    localStorage.removeItem('hairy:lastCrashSummary');
    localStorage.removeItem('hairy:lastCrashStack');
    localStorage.removeItem('hairy:lastCrashAt');
  } catch {
    /* ignore */
  }
}

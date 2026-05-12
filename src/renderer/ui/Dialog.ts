// Custom replacements for window.prompt / window.confirm. Electron disables
// these blocking native dialogs (they hang the renderer), so we route all
// existing prompt() / confirm() callers through this module.
//
// Both functions return Promises and never throw. The modal is keyboard-
// friendly: Enter submits, Esc cancels, autofocus on the input.

export type PromptOptions = {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
};

export function promptModal(opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'claude-modal-backdrop';
    const title = opts.title ?? 'Enter value';
    const message = opts.message ?? '';
    const defaultValue = opts.defaultValue ?? '';
    const placeholder = opts.placeholder ?? '';
    const okLabel = opts.okLabel ?? 'OK';
    const cancelLabel = opts.cancelLabel ?? 'Cancel';
    backdrop.innerHTML = `
      <div class="claude-modal" style="width: 420px; max-width: 90vw;">
        <div class="claude-modal-head">${escapeHtml(title)}</div>
        <div class="claude-modal-body">
          ${message ? `<div style="margin-bottom: 10px; font-size: 12px; color: var(--muted); line-height: 1.45;">${escapeHtml(message)}</div>` : ''}
          <input id="dlg-input" type="text"
            value="${escapeAttr(defaultValue)}"
            placeholder="${escapeAttr(placeholder)}"
            style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-family: inherit; font-size: 13px;" />
        </div>
        <div class="claude-modal-actions">
          <button class="claude-btn" id="dlg-cancel">${escapeHtml(cancelLabel)}</button>
          <button class="claude-btn primary" id="dlg-ok">${escapeHtml(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('#dlg-input') as HTMLInputElement;
    input.select();
    input.focus();
    const close = (value: string | null) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.querySelector('#dlg-cancel')?.addEventListener('click', () => close(null));
    backdrop.querySelector('#dlg-ok')?.addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
    // Click outside closes (matches the wallet modal's behavior).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
  });
}

export type ConfirmOptions = {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'claude-modal-backdrop';
    backdrop.innerHTML = `
      <div class="claude-modal" style="width: 420px; max-width: 90vw;">
        <div class="claude-modal-head">${escapeHtml(opts.title ?? 'Confirm')}</div>
        <div class="claude-modal-body">
          <div style="font-size: 13px; color: var(--text); line-height: 1.5;">${escapeHtml(opts.message)}</div>
        </div>
        <div class="claude-modal-actions">
          <button class="claude-btn" id="dlg-cancel">${escapeHtml(opts.cancelLabel ?? 'Cancel')}</button>
          <button class="claude-btn ${opts.danger ? 'danger' : 'primary'}" id="dlg-ok">${escapeHtml(opts.okLabel ?? 'OK')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.querySelector('#dlg-cancel')?.addEventListener('click', () => close(false));
    backdrop.querySelector('#dlg-ok')?.addEventListener('click', () => close(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true); window.removeEventListener('keydown', onKey); }
      if (e.key === 'Escape') { e.preventDefault(); close(false); window.removeEventListener('keydown', onKey); }
    };
    window.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

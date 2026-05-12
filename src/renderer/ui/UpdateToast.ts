// Tiny toast in the bottom-right corner that surfaces auto-updater state.
// States: idle (hidden), downloading (progress bar), ready (Restart button),
// error (red text + dismiss).

type State =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version?: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

export class UpdateToast {
  private root: HTMLElement;
  private body: HTMLElement;
  private state: State = { kind: 'hidden' };
  private beforeInstall: (() => Promise<boolean>) | null = null;

  /** Register a hook that runs before quitAndInstall. Return `false` to
   *  cancel the install (e.g. user said "Cancel" on the save prompt). */
  setBeforeInstall(hook: () => Promise<boolean>) {
    this.beforeInstall = hook;
  }

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'update-toast';
    this.root.hidden = true;
    this.body = document.createElement('div');
    this.body.className = 'update-toast-body';
    this.root.appendChild(this.body);
    parent.appendChild(this.root);

    window.hairy.updater.onEvent((e) => {
      switch (e.type) {
        case 'checking':
          // Only surface the "Checking…" toast if a manual check kicked us off
          // (i.e. we're not already in a steady state). Auto-poll noise stays hidden.
          if (this.state.kind === 'checking') break;
          if (this.state.kind === 'hidden') break;
          this.setState({ kind: 'checking' });
          break;
        case 'update-not-available':
          if (this.state.kind === 'checking') {
            this.setState({ kind: 'up-to-date' });
            // Auto-dismiss after a moment so it doesn't clutter the viewport.
            setTimeout(() => {
              if (this.state.kind === 'up-to-date') this.setState({ kind: 'hidden' });
            }, 3500);
          } else if (this.state.kind !== 'hidden') {
            this.setState({ kind: 'hidden' });
          }
          break;
        case 'update-available':
          this.setState({ kind: 'downloading', version: e.version, percent: 0 });
          break;
        case 'download-progress':
          if (this.state.kind === 'downloading') {
            this.setState({
              kind: 'downloading',
              version: this.state.version,
              percent: e.percent,
            });
          }
          break;
        case 'update-downloaded':
          this.setState({ kind: 'ready', version: e.version });
          break;
        case 'error':
          this.setState({ kind: 'error', message: e.message });
          break;
      }
    });
  }

  /** Called by Help → Check for updates so the toast is primed. */
  beginManualCheck() {
    this.setState({ kind: 'checking' });
  }

  private setState(s: State) {
    this.state = s;
    this.render();
  }

  private render() {
    const s = this.state;
    if (s.kind === 'hidden') {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    if (s.kind === 'checking') {
      this.body.innerHTML = `
        <div class="update-toast-head">Checking for updates…</div>
        <div class="update-toast-sub">Talking to GitHub Releases.</div>
      `;
    } else if (s.kind === 'up-to-date') {
      this.body.innerHTML = `
        <div class="update-toast-head">You're up to date</div>
        <div class="update-toast-sub">Running the latest HairyEngine.</div>
      `;
    } else if (s.kind === 'downloading') {
      this.body.innerHTML = `
        <div class="update-toast-head">Downloading v${s.version ?? ''}…</div>
        <div class="update-toast-bar"><div style="width:${Math.round(s.percent)}%"></div></div>
        <div class="update-toast-sub">${Math.round(s.percent)}%</div>
      `;
    } else if (s.kind === 'ready') {
      this.body.innerHTML = `
        <div class="update-toast-head">HairyEngine v${s.version} ready</div>
        <div class="update-toast-row">
          <button class="update-toast-btn primary" id="update-install">Restart & install</button>
          <button class="update-toast-btn" id="update-later">Later</button>
        </div>
      `;
      this.body.querySelector<HTMLButtonElement>('#update-install')?.addEventListener('click', async () => {
        if (this.beforeInstall) {
          const ok = await this.beforeInstall();
          if (!ok) return;
        }
        window.hairy.updater.install();
      });
      this.body.querySelector<HTMLButtonElement>('#update-later')?.addEventListener('click', () => {
        this.setState({ kind: 'hidden' });
      });
    } else if (s.kind === 'error') {
      this.body.innerHTML = `
        <div class="update-toast-head is-error">Update check failed</div>
        <div class="update-toast-sub">${escapeHtml(s.message)}</div>
        <div class="update-toast-row">
          <button class="update-toast-btn" id="update-dismiss">Dismiss</button>
        </div>
      `;
      this.body.querySelector<HTMLButtonElement>('#update-dismiss')?.addEventListener('click', () => {
        this.setState({ kind: 'hidden' });
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

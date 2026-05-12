// Tiny floating menu helper — used by the +Add button and (later) the File menu.
// One menu open at a time; auto-closes on outside click or Escape.

export type MenuItem =
  | { label: string; onClick: () => void }
  | { sep: true };

let openMenu: HTMLElement | null = null;

export function openMenuPopup(anchor: HTMLElement, items: MenuItem[]) {
  closeMenu();
  const rect = anchor.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'menu-popup';
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  // After mount, clamp to viewport so long lists scroll inside the popup
  // rather than disappearing off the bottom of the screen.
  requestAnimationFrame(() => {
    const pRect = popup.getBoundingClientRect();
    const margin = 8;
    if (pRect.bottom > window.innerHeight - margin) {
      const newTop = Math.max(margin, window.innerHeight - margin - pRect.height);
      popup.style.top = `${newTop}px`;
    }
    if (pRect.right > window.innerWidth - margin) {
      popup.style.left = `${Math.max(margin, window.innerWidth - margin - pRect.width)}px`;
    }
  });

  for (const item of items) {
    if ('sep' in item) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      popup.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        item.onClick();
        closeMenu();
      });
      popup.appendChild(btn);
    }
  }

  document.body.appendChild(popup);
  openMenu = popup;

  // Close on outside click. Defer to next tick so the click that opened
  // the menu doesn't immediately close it.
  setTimeout(() => {
    const onClickAway = (e: MouseEvent) => {
      if (!openMenu) return;
      if (e.target instanceof Node && openMenu.contains(e.target)) return;
      closeMenu();
      document.removeEventListener('mousedown', onClickAway);
    };
    document.addEventListener('mousedown', onClickAway);
  }, 0);
}

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

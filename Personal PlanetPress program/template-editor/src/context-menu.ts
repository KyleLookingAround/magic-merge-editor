// Context-menu helper. Carved out of legacy.ts in Phase 10.
//
// Single shared mini-menu used by the file tree, scripts panel, search results
// and "+ New script" picker. Auto-dismisses on the next document click; only
// one menu is alive at a time.
//
// API:
//   - `openContextMenu(items, x, y)` builds + mounts a menu from a list of
//     items. Each item is `{ label, onClick, danger?, title? }` or
//     `{ sep: true }` for a divider.
//   - `closeCtxMenu()` removes any active menu.
//
// The global click listener that drives auto-dismiss is registered at module
// load time. Phase 10 also removed the `configureScriptForm({ showCtxMenu,
// closeCtxMenu })` DI seam — script-form.ts now imports these directly.

export interface CtxMenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  title?: string;
  sep?: boolean;
}

let activeMenu: HTMLElement | null = null;

export function closeCtxMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

export function openContextMenu(items: CtxMenuItem[], x: number, y: number): HTMLElement {
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'item' + (it.danger ? ' danger' : '');
    el.textContent = it.label ?? '';
    if (it.title) el.title = it.title;
    el.addEventListener('click', () => {
      closeCtxMenu();
      try { it.onClick && it.onClick(); } catch (e) { console.error(e); }
    });
    menu.appendChild(el);
  }
  document.body.appendChild(menu);
  activeMenu = menu;
  return menu;
}

document.addEventListener('click', closeCtxMenu);

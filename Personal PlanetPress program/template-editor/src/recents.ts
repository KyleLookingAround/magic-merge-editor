// IndexedDB-backed recent files list. Carved out of legacy.ts as
// the second Phase 3 module.
//
// Phase 12: openRecentItem + the recents-menu DOM wiring carved in,
// now that loadFromHandle / scanFolderTemplates / setStatus are all
// available as module imports.

import { state } from './state';
import { setStatus } from './status';
import { escapeHtml } from './tree';
import { loadFromHandle, scanFolderTemplates } from './file-ops';

const RECENTS_DB = 'planetpress-template-editor';
const RECENTS_STORE = 'recents';
const RECENTS_MAX = 10;

export interface RecentItem {
  name: string;
  kind: 'file' | 'folder';
  handle: any; // FileSystemFileHandle | FileSystemDirectoryHandle
  openedAt: number;
}

function recentsOpenDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENTS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECENTS_STORE)) {
        db.createObjectStore(RECENTS_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function recentsAdd(handle: any, kind: 'file' | 'folder'): Promise<void> {
  if (!handle) return;
  try {
    const db = await recentsOpenDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(RECENTS_STORE, 'readwrite');
      tx.objectStore(RECENTS_STORE).put({ name: handle.name, kind, handle, openedAt: Date.now() });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch (_) { /* IDB may be disabled in some contexts; ignore */ }
}

export async function recentsList(): Promise<RecentItem[]> {
  try {
    const db = await recentsOpenDb();
    const items = await new Promise<RecentItem[]>((res, rej) => {
      const tx = db.transaction(RECENTS_STORE, 'readonly');
      const req = tx.objectStore(RECENTS_STORE).getAll();
      req.onsuccess = () => res((req.result as RecentItem[]) || []);
      req.onerror = () => rej(req.error);
    });
    db.close();
    items.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    return items.slice(0, RECENTS_MAX);
  } catch (_) { return []; }
}

export async function recentsRemove(name: string): Promise<void> {
  try {
    const db = await recentsOpenDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(RECENTS_STORE, 'readwrite');
      tx.objectStore(RECENTS_STORE).delete(name);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch (_) {}
}

export async function recentsClear(): Promise<void> {
  try {
    const db = await recentsOpenDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(RECENTS_STORE, 'readwrite');
      tx.objectStore(RECENTS_STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch (_) {}
}

export function formatRecentTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// ============================================================
// OPEN RECENT ITEM (Phase 12 — carved from legacy.ts)
// ============================================================

export async function openRecentItem(item: RecentItem): Promise<void> {
  try {
    if (item.handle.queryPermission) {
      let perm = await item.handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await item.handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { setStatus('Permission denied.', 'err'); return; }
      }
    }
    if (item.kind === 'folder') {
      state.dirHandle = item.handle;
      state.dirName = item.handle.name;
      await scanFolderTemplates(item.handle, false);
      document.getElementById('folder-panel')!.style.display = '';
      document.getElementById('tree-panel')!.style.display = 'none';
      document.getElementById('folder-name')!.textContent = item.handle.name;
      (document.getElementById('btn-back') as HTMLButtonElement).style.display = 'none';
      document.getElementById('empty')!.classList.remove('hidden');
      (document.getElementById('editor-tab') as HTMLElement).style.display = 'none';
      document.getElementById('editor')!.style.display = 'none';
      document.getElementById('binary-view')!.classList.remove('show');
      (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = true;
      (document.getElementById('btn-save') as HTMLButtonElement).disabled = true;
      document.getElementById('filename')!.textContent = `Folder: ${item.handle.name}`;
    } else {
      state.dirHandle = null; state.folderTemplates = []; state.dirName = null;
      (document.getElementById('btn-back') as HTMLButtonElement).style.display = 'none';
      document.getElementById('folder-panel')!.style.display = 'none';
      await loadFromHandle(item.handle);
    }
    await recentsAdd(item.handle, item.kind);
  } catch (e: any) {
    setStatus('Could not re-open ' + item.name + ': ' + e.message, 'err');
    if (e.name === 'NotFoundError') await recentsRemove(item.name);
  }
}

// ============================================================
// RECENTS MENU DOM WIRING (Phase 12 — carved from legacy.ts)
// ============================================================

document.getElementById('btn-recents')!.addEventListener('click', async e => {
  e.stopPropagation();
  const menu = document.getElementById('recents-menu')!;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  const items = await recentsList();
  menu.innerHTML = '';
  if (!items.length) {
    menu.innerHTML = "<div class=\"empty\">No recent files yet — open a template and it'll show up here.</div>";
  } else {
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<span class="name">${it.kind === 'folder' ? '📁 ' : ''}${escapeHtml(it.name)}</span><span class="when">${formatRecentTime(it.openedAt || 0)}</span>`;
      row.addEventListener('click', async () => {
        menu.classList.remove('show');
        await openRecentItem(it);
      });
      menu.appendChild(row);
    }
    const clear = document.createElement('div');
    clear.className = 'clear';
    clear.textContent = 'Clear recent files';
    clear.addEventListener('click', async () => {
      menu.classList.remove('show');
      await recentsClear();
      setStatus('Recent files cleared.', 'ok');
    });
    menu.appendChild(clear);
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.classList.add('show');
});

document.addEventListener('click', e => {
  const m = document.getElementById('recents-menu');
  if (m && m.classList.contains('show') && !m.contains(e.target as Node) && (e.target as HTMLElement).id !== 'btn-recents') {
    m.classList.remove('show');
  }
});

// IndexedDB-backed recent files list. Carved out of legacy.ts as
// the second Phase 3 module.
//
// Scope: only the pure persistence + formatting helpers. The
// DOM/menu wiring and `openRecentItem` (which calls into
// loadFromHandle / scanFolderTemplates / setStatus) still live in
// legacy.ts and will move out once those modules are also carved.

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

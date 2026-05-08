// File management dialogs + file-toolbar state. Carved out of
// legacy.ts as part of Phase 12.
//
// Contains: updateFileButtons, promptNewFile, openNewFileModal,
// bindAutotypeByMap, renameFile, deleteFile, copyToClipboard,
// revealInTree, unlockTemplateFolders, and the context-menu handler
// for tree / navigator / search result rows.

import { state } from './state';
import { setStatus } from './status';
import { on as hookOn } from './hooks';
import { extOf, langFor, findLockedFolderEntries } from './fs';
import { buildTree, refreshTreeDirtyMarkers } from './tree';
import { setSidebarMode } from './sidebar';
import { normalizeNavPath } from './navigator';
import { runSearch } from './search';
import { openContextMenu } from './context-menu';
import { openFile } from './file-ops';

/* global monaco */
declare const monaco: any;

// ============================================================
// FILE TOOLBAR BUTTON STATE
// ============================================================

export function updateFileButtons(): void {
  const has = !!state.currentPath && !!state.files[state.currentPath];
  (document.getElementById('btn-file-rename') as HTMLButtonElement).disabled = !has;
  (document.getElementById('btn-file-delete') as HTMLButtonElement).disabled = !has;
  const unlockBtn = document.getElementById('btn-file-unlock') as HTMLButtonElement | null;
  if (unlockBtn) {
    const lockedCount = (state.zip && !state.standalone) ? findLockedFolderEntries().length : 0;
    unlockBtn.disabled = lockedCount === 0;
    unlockBtn.title = lockedCount === 0
      ? 'No locked folder markers in this template'
      : `Unlock ${lockedCount} folder${lockedCount === 1 ? '' : 's'} (snippets / translations / js / fonts / color-profiles)`;
  }
  const ctx = document.getElementById('file-toolbar-ctx')!;
  if (state.currentPath) {
    const dir = state.currentPath.includes('/')
      ? state.currentPath.substring(0, state.currentPath.lastIndexOf('/') + 1)
      : '/';
    ctx.textContent = 'in: ' + dir;
    ctx.title = 'New files will be created in: ' + dir;
  } else {
    ctx.textContent = '';
    ctx.title = '';
  }
}

// ============================================================
// LOCKED-FOLDER UNLOCK
// ============================================================

export function unlockTemplateFolders(): void {
  if (!state.fileHandle || !state.zip) {
    setStatus('Open a .OL-template first.', 'warn');
    return;
  }
  const markers = findLockedFolderEntries();
  if (!markers.length) {
    setStatus('No locked folder markers detected — nothing to unlock.', 'warn');
    return;
  }
  for (const p of markers) {
    delete state.files[p];
    if (state.monacoModels && state.monacoModels[p]) {
      try { state.monacoModels[p].dispose(); } catch (_) {}
      delete state.monacoModels[p];
    }
    if (state.currentPath === p) state.currentPath = null;
  }
  buildTree();
  refreshTreeDirtyMarkers();
  updateFileButtons();
  const human = markers.map(p => p.replace(/\\/g, '/')).join(', ');
  setStatus(
    `Unlocked ${markers.length} folder${markers.length === 1 ? '' : 's'}: ${human}. Use + New to add files inside (e.g. public/document/snippets/MySnippet.html); click Review & Save to write the unlock to disk.`,
    'ok'
  );
}

// ============================================================
// CLIPBOARD HELPER
// ============================================================

export function copyToClipboard(text: string): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setStatus(`Copied: ${text}`, 'ok'),
        () => fallback()
      );
      return;
    }
  } catch (_) {}
  fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); setStatus(`Copied: ${text}`, 'ok'); }
    catch (_) { setStatus('Copy failed.', 'err'); }
    ta.remove();
  }
}

// ============================================================
// REVEAL IN TREE
// ============================================================

export function revealInTree(path: string): void {
  try { setSidebarMode('files'); } catch (_) {}
  setTimeout(() => {
    try {
      const el = document.querySelector<HTMLElement>(`.tree-item.file[data-path="${CSS.escape(path)}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } catch (_) {}
  }, 30);
}

// ============================================================
// FILE ADD
// ============================================================

export function promptNewFile(): void {
  if (!state.fileHandle) { setStatus('Open a template first.', 'warn'); return; }
  if (state.standalone) { setStatus('Cannot add files to a standalone file — open a .OL-template or .OL-datamapper.', 'warn'); return; }
  const baseDir = (state.currentPath && state.currentPath.includes('/'))
    ? state.currentPath.substring(0, state.currentPath.lastIndexOf('/') + 1)
    : '';

  const dirSet = new Set<string>();
  for (const path of Object.keys(state.files)) {
    const norm = path.replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    if (i > 0) dirSet.add(norm.slice(0, i + 1));
  }
  const dirs = [...dirSet].sort();
  const knownDirs = [
    'public/document/snippets/',
    'public/document/translations/',
    'public/document/js/',
    'public/document/fonts/',
    'public/document/color-profiles/',
    'SampleDataFiles/',
  ];
  for (const d of knownDirs) if (!dirSet.has(d)) dirs.push(d);

  openNewFileModal({ baseDir, dirs }, ({ dir, name, ext }) => {
    const cleanDir = (dir || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const cleanName = (name || '').trim().replace(/^\/+/, '');
    if (!cleanName) { setStatus('Empty filename.', 'warn'); return; }
    const hasExt = /\.[^./\\]+$/.test(cleanName);
    const finalName = hasExt ? cleanName : (ext ? `${cleanName}.${ext}` : cleanName);
    const path = (cleanDir ? (cleanDir.endsWith('/') ? cleanDir : cleanDir + '/') : '') + finalName;
    if (!path) { setStatus('Empty filename.', 'warn'); return; }
    if (state.files[path]) { setStatus('A file with that path already exists.', 'err'); return; }

    const e2 = extOf(path);
    let initial = '';
    if (e2 === 'xml') initial = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root>\n</root>\n';
    else if (e2 === 'json') initial = '{\n}\n';
    else if (e2 === 'html' || e2 === 'htm') initial = '<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n</body>\n</html>\n';

    state.files[path] = { content: initial, isText: true, dirty: true, added: true };
    buildTree();
    refreshTreeDirtyMarkers();
    openFile(path);
    setStatus(`Added ${path}. Click Review & Save to write it into the template.`, 'ok');
  });
}

function bindAutotypeByMap(srcInput: HTMLInputElement | null, dstSelect: HTMLSelectElement | null, mapping: Record<string, string>): void {
  if (!srcInput || !dstSelect) return;
  const handler = () => {
    const key = (srcInput.value || '').toLowerCase();
    let target = mapping[key];
    if (!target) {
      let bestLen = 0;
      for (const k of Object.keys(mapping)) {
        if (key.startsWith(k) && k.length > bestLen) { bestLen = k.length; target = mapping[k]; }
      }
    }
    if (target) {
      if (!(dstSelect as any).dataset.userTouched) dstSelect.value = target;
    }
  };
  srcInput.addEventListener('change', handler);
  srcInput.addEventListener('input', handler);
  dstSelect.addEventListener('change', () => { (dstSelect as any).dataset.userTouched = '1'; });
}

function openNewFileModal(
  { baseDir, dirs }: { baseDir: string; dirs: string[] },
  onConfirm: (result: { dir: string; name: string; ext: string }) => void
): void {
  const existing = document.getElementById('new-file-modal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'new-file-modal';
  wrap.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 500;
    display: flex; align-items: center; justify-content: center;
  `;
  wrap.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--border);border-radius:6px;
                padding:18px 20px;min-width:480px;max-width:90vw;color:var(--text);
                font-family:inherit;font-size:13px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">Add a new file</div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:2;display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Folder</label>
          <input id="nf-dir" list="nf-dir-list" autocomplete="off" spellcheck="false"
                 style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                        border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
          <datalist id="nf-dir-list"></datalist>
        </div>
        <div style="flex:0 0 110px;display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Extension</label>
          <select id="nf-ext"
                  style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                         border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
            <option value="">(none)</option>
            <option value="xml">xml</option>
            <option value="html">html</option>
            <option value="htm">htm</option>
            <option value="json">json</option>
            <option value="css">css</option>
            <option value="js">js</option>
            <option value="md">md</option>
            <option value="txt">txt</option>
          </select>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px;">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Filename</label>
        <input id="nf-name" autocomplete="off" spellcheck="false"
               style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                      border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
      </div>
      <div style="color:var(--muted);font-size:11px;margin-bottom:12px;">
        Pick a folder from the list (or type a new one). Picking a known folder
        auto-fills a sensible extension.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="nf-cancel" class="ghost" style="background:transparent;color:var(--muted);
                border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;">Cancel</button>
        <button id="nf-ok" style="background:var(--accent);color:white;border:0;
                border-radius:3px;padding:6px 16px;cursor:pointer;">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const dl = wrap.querySelector<HTMLElement>('#nf-dir-list')!;
  for (const d of dirs) {
    const opt = document.createElement('option');
    opt.value = d;
    dl.appendChild(opt);
  }

  const dirInput = wrap.querySelector<HTMLInputElement>('#nf-dir')!;
  const nameInput = wrap.querySelector<HTMLInputElement>('#nf-name')!;
  const extSelect = wrap.querySelector<HTMLSelectElement>('#nf-ext')!;

  dirInput.value = baseDir || '';
  nameInput.value = 'new-file';
  extSelect.value = 'xml';

  bindAutotypeByMap(dirInput, extSelect, {
    'public/document/snippets/': 'html',
    'public/document/translations/': 'xml',
    'public/document/js/': 'js',
    'public/document/fonts/': '',
    'public/document/color-profiles/': '',
    'sampledatafiles/': 'xml',
  });

  function close() { wrap.remove(); document.removeEventListener('keydown', escClose, true); }
  function escClose(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', escClose, true);
  wrap.querySelector('#nf-cancel')!.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#nf-ok')!.addEventListener('click', () => {
    const dir = dirInput.value.trim();
    const name = nameInput.value.trim();
    const ext = extSelect.value.trim();
    close();
    onConfirm({ dir, name, ext });
  });
  for (const inp of [dirInput, nameInput]) {
    inp.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); (wrap.querySelector('#nf-ok') as HTMLElement).click(); }
    });
  }
  setTimeout(() => nameInput.focus(), 0);
}

// ============================================================
// FILE RENAME
// ============================================================

export function renameFile(oldPath: string): void {
  if (!state.files[oldPath]) return;
  if (state.standalone) { setStatus('Standalone files cannot be renamed from here.', 'warn'); return; }
  const next = prompt('New path for this file:', oldPath);
  if (next == null) return;
  const newPath = next.trim().replace(/^\/+/, '');
  if (!newPath || newPath === oldPath) return;
  if (state.files[newPath]) { setStatus('A file already exists at that path.', 'err'); return; }

  const f = state.files[oldPath];
  if (state.monacoModels[oldPath]) f.content = state.monacoModels[oldPath].getValue();
  state.files[newPath] = Object.assign({}, f, { dirty: true, renamedFrom: f.renamedFrom || oldPath });
  delete state.files[oldPath];

  if (state.monacoModels[oldPath]) {
    const oldModel = state.monacoModels[oldPath];
    const newModel = monaco.editor.createModel(oldModel.getValue(), langFor(newPath));
    newModel.onDidChangeContent(() => {
      state.files[newPath].dirty = true;
      refreshTreeDirtyMarkers();
      (document.getElementById('btn-save') as HTMLButtonElement).disabled = false;
    });
    state.monacoModels[newPath] = newModel;
    oldModel.dispose();
    delete state.monacoModels[oldPath];
  }
  if (state.currentPath === oldPath) state.currentPath = newPath;
  buildTree();
  refreshTreeDirtyMarkers();
  if (state.currentPath === newPath) openFile(newPath);
  setStatus(`Renamed to ${newPath}.`, 'ok');
}

// ============================================================
// FILE DELETE
// ============================================================

export function deleteFile(path: string): void {
  if (!state.files[path]) return;
  if (state.standalone) { setStatus('Cannot delete the standalone file (just close it).', 'warn'); return; }
  if (!confirm(`Delete "${path}" from this template?\n\nThe file will be removed when you Review & Save.`)) return;
  if (state.monacoModels[path]) {
    state.monacoModels[path].dispose();
    delete state.monacoModels[path];
  }
  delete state.files[path];

  if (state.currentPath === path) {
    state.currentPath = null;
    document.getElementById('editor')!.style.display = 'none';
    (document.getElementById('editor-tab') as HTMLElement).style.display = 'none';
    document.getElementById('binary-view')!.classList.remove('show');
    (document.getElementById('btn-save') as HTMLButtonElement).disabled = true;
  }
  buildTree();
  refreshTreeDirtyMarkers();
  setStatus(`Removed ${path}. Click Review & Save to apply.`, 'ok');
}

// ============================================================
// CONTEXT MENU FOR TREE / NAVIGATOR / SEARCH ROWS
// ============================================================

document.addEventListener('contextmenu', e => {
  const fileItem = (e.target as Element).closest?.('.tree-item.file') as HTMLElement | null;
  if (fileItem) {
    e.preventDefault();
    const path = fileItem.dataset.path;
    if (!path) return;
    openContextMenu([
      { label: 'Open', onClick: () => openFile(path) },
      { label: 'Open in new tab', onClick: () => {
          const f = state.files[path];
          if (!f) return;
          if (f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = path;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[path] ? state.monacoModels[path].getValue() : f.content) || '';
            }
          } else {
            setStatus('Binary file — open in new tab not supported.', 'warn');
          }
        }
      },
      { label: 'Copy path', onClick: () => copyToClipboard(path) },
      { sep: true },
      { label: 'Rename…', onClick: () => renameFile(path) },
      { label: 'Delete', onClick: () => deleteFile(path), danger: true },
    ], (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    return;
  }

  const navItem = (e.target as Element).closest?.('.nav-item') as HTMLElement | null;
  if (navItem) {
    e.preventDefault();
    const path = (navItem.title || '').trim();
    if (!path) return;
    const resolved = normalizeNavPath(path);
    openContextMenu([
      { label: 'Open', onClick: () => openFile(resolved) },
      { label: 'Open in new tab', onClick: () => {
          const f = state.files[resolved];
          if (f && f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = resolved;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[resolved] ? state.monacoModels[resolved].getValue() : f.content) || '';
            }
          } else {
            setStatus('No content for ' + resolved, 'warn');
          }
        }
      },
      { label: 'Copy path', onClick: () => copyToClipboard(resolved) },
      { sep: true },
      { label: 'Reveal in tree', onClick: () => revealInTree(resolved) },
    ], (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    return;
  }

  const searchHit = (e.target as Element).closest?.('.search-hit') as HTMLElement | null;
  const searchFile = (e.target as Element).closest?.('.search-file') as HTMLElement | null;
  if (searchHit || searchFile) {
    e.preventDefault();
    let path = '';
    if (searchFile) {
      const txt = searchFile.textContent || '';
      const m = /^(.*)\s+\(\d+\)\s*$/.exec(txt);
      path = m ? m[1] : txt.trim();
    } else if (searchHit) {
      let prev = searchHit.previousElementSibling;
      while (prev && !prev.classList.contains('search-file')) prev = prev.previousElementSibling;
      if (prev) {
        const txt = prev.textContent || '';
        const m = /^(.*)\s+\(\d+\)\s*$/.exec(txt);
        path = m ? m[1] : txt.trim();
      }
    }
    if (!path || !state.files[path]) return;
    openContextMenu([
      { label: 'Open', onClick: () => openFile(path) },
      { label: 'Open in new tab', onClick: () => {
          const f = state.files[path];
          if (f && f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = path;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[path] ? state.monacoModels[path].getValue() : f.content) || '';
            }
          }
        }
      },
      { label: 'Copy path', onClick: () => copyToClipboard(path) },
      { sep: true },
      { label: 'Replace match in this file…', onClick: () => {
          const q = (document.getElementById('search-input') as HTMLInputElement | null)?.value || '';
          if (!q) { setStatus('Search query is empty.', 'warn'); return; }
          const replacement = prompt(`Replace all "${q}" in ${path} with:`, q);
          if (replacement == null) return;
          const f = state.files[path];
          if (!f) return;
          const model = state.monacoModels[path];
          const text = model ? model.getValue() : f.content;
          const useRegex = (document.getElementById('search-regex') as HTMLInputElement | null)?.checked;
          const caseSensitive = (document.getElementById('search-case') as HTMLInputElement | null)?.checked;
          const wholeWord = (document.getElementById('search-word') as HTMLInputElement | null)?.checked;
          let pattern: RegExp;
          try {
            let src = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (wholeWord) src = `\\b(?:${src})\\b`;
            pattern = new RegExp(src, caseSensitive ? 'g' : 'gi');
          } catch (err: any) { setStatus('Bad regex: ' + err.message, 'err'); return; }
          const before = text;
          const updated = before.replace(pattern, replacement);
          if (updated === before) { setStatus('No matches replaced.', 'warn'); return; }
          if (model) {
            const range = model.getFullModelRange();
            model.pushEditOperations([], [{ range, text: updated }], () => null);
          }
          f.content = updated;
          f.dirty = true;
          refreshTreeDirtyMarkers();
          runSearch();
          setStatus(`Replaced matches in ${path}. Click Review & Save to apply.`, 'ok');
        }
      },
    ], (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    return;
  }
});

// ============================================================
// FILE TOOLBAR BUTTON WIRING (runs at module load)
// ============================================================

document.getElementById('btn-file-new')!.addEventListener('click', () => promptNewFile());
document.getElementById('btn-file-rename')!.addEventListener('click', () => {
  if (state.currentPath) renameFile(state.currentPath);
});
document.getElementById('btn-file-delete')!.addEventListener('click', () => {
  if (state.currentPath) deleteFile(state.currentPath);
});
document.getElementById('btn-file-unlock')?.addEventListener('click', () => unlockTemplateFolders());

// Update file button states after each file open and after template load
hookOn('afterOpenFile', () => updateFileButtons());

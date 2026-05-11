// File-open / commit / save / folder-scan flows. Carved out of
// legacy.ts as part of Phase 12.
//
// Contains: openFile, commitCurrentEdit, rezipAndSave,
// pickAndOpenFile, pickAndOpenFolder, scanFolderTemplates,
// renderTemplatesList, backToFolderList, loadFromHandle, hasUnsaved.
//
// The test-only wireTestFileInput helper is also registered here at
// module load time.

import { state } from './state';
import { setStatus } from './status';
import { on as hookOn, emit as hookEmit, emitAsync as hookEmitAsync } from './hooks';
import {
  extOf, langFor, isTextPath, isImagePath,
  ZIP_EXTS, looksLikeText, decodeBytes,
} from './fs';
import { buildTree, refreshTreeDirtyMarkers, escapeHtml } from './tree';
import { validateXml } from './editor';
import { setSidebarMode } from './sidebar';
import { previewState, closePreview, refreshPreview } from './preview';

/* global JSZip, monaco */
declare const JSZip: any;
declare const monaco: any;

// ============================================================
// HELPERS
// ============================================================

export function hasUnsaved(): boolean {
  return Object.values(state.files).some((f: any) => f.dirty)
    || (state.standalone && state.standalone.dirty);
}

// ============================================================
// OPEN FILE IN MONACO EDITOR
// ============================================================

export function openFile(path: string): void {
  hookEmit('beforeOpenFile', path);
  state.currentPath = path;
  document.querySelectorAll<HTMLElement>('.tree-item.file').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
  document.getElementById('tab-name')!.textContent = path;
  document.getElementById('tab-lang')!.textContent = langFor(path);
  const f = state.files[path];

  const editorEl = document.getElementById('editor')!;
  const binaryEl = document.getElementById('binary-view')!;
  binaryEl.classList.remove('show');
  binaryEl.innerHTML = '';
  document.getElementById('editor-tab')!.style.display = 'flex';

  if (f.isText) {
    const sizeKb = (new Blob([f.content]).size / 1024).toFixed(1);
    document.getElementById('tab-size')!.textContent = sizeKb + ' KB';
    editorEl.style.display = '';
    if (!state.monacoReady) {
      const tries = setInterval(() => {
        if (state.monacoReady) { clearInterval(tries); openFile(path); }
      }, 100);
      hookEmit('afterOpenFile', path);
      return;
    }
    let model = state.monacoModels[path];
    if (!model) {
      model = monaco.editor.createModel(f.content, langFor(path));
      model.onDidChangeContent(() => {
        f.dirty = true;
        refreshTreeDirtyMarkers();
        (document.getElementById('btn-save') as HTMLButtonElement).disabled = false;
      });
      state.monacoModels[path] = model;
    }
    state.editor.setModel(model);
    state.editor.focus();
    (document.getElementById('btn-save') as HTMLButtonElement).disabled = state.isDocx;
    (document.getElementById('btn-preview') as HTMLButtonElement).disabled =
      !['html', 'htm'].includes(extOf(path));
    if (document.getElementById('preview-pane')!.classList.contains('show') &&
        ['html', 'htm'].includes(extOf(path))) {
      refreshPreview();
    }
  } else {
    editorEl.style.display = 'none';
    (document.getElementById('btn-preview') as HTMLButtonElement).disabled = true;
    (document.getElementById('btn-save') as HTMLButtonElement).disabled = true;
    const bytes = f.content as Uint8Array;
    const sizeKb = (bytes.length / 1024).toFixed(1);
    document.getElementById('tab-size')!.textContent = sizeKb + ' KB (binary)';
    binaryEl.classList.add('show');
    if (isImagePath(path)) {
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const url = URL.createObjectURL(blob);
      binaryEl.innerHTML = `<div>${escapeHtml(path)}</div><img src="${url}" alt="">`;
    } else {
      binaryEl.innerHTML = `<div>🔒 Binary file (${sizeKb} KB)</div>
        <div>This file isn't editable as text. It will be preserved unchanged when you rezip.</div>`;
    }
  }
  hookEmit('afterOpenFile', path);
}

// ============================================================
// COMMIT CURRENT MONACO EDIT TO state.files
// ============================================================

export function commitCurrentEdit(showStatus: boolean): void {
  if (!state.currentPath) return;
  const f = state.files[state.currentPath];
  if (!f || !f.isText) return;
  const model = state.monacoModels[state.currentPath];
  if (!model) return;
  const newContent = model.getValue();

  const ext = extOf(state.currentPath);
  if (['xml', 'xsl', 'xslt', 'svg', 'config'].includes(ext)) {
    const v = validateXml(newContent, false);
    if (!v.ok) {
      const proceed = confirm(`XML validation warning in ${state.currentPath}:\n\n${v.error}\n\nKeep edit anyway?`);
      if (!proceed) return;
    }
  } else if (ext === 'html' || ext === 'htm') {
    const v = validateXml(newContent, true);
    if (!v.ok && showStatus) setStatus('HTML parse note: ' + v.error, 'warn');
  } else if (ext === 'json') {
    try { JSON.parse(newContent); } catch (e: any) {
      const proceed = confirm(`JSON parse error in ${state.currentPath}:\n\n${e.message}\n\nKeep edit anyway?`);
      if (!proceed) return;
    }
  }

  f.content = newContent;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  if (showStatus) setStatus('Edit committed (not yet written to disk).', 'ok');
  hookEmit('afterCommitCurrentEdit', showStatus);
}

// ============================================================
// REZIP / SAVE (final version — handles added files)
// ============================================================

export async function rezipAndSave(): Promise<void> {
  if (!state.fileHandle) return;
  commitCurrentEdit(false);

  (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = true;
  try {
    let blob: Blob;
    if (state.zip) {
      setStatus('Building zip...');
      const out = new JSZip();
      const seen = new Set<string>();
      state.zip.forEach((path: string, entry: any) => {
        if (entry.dir) return;
        const f = state.files[path];
        if (!f) return;
        seen.add(path);
        const date = entry.date || new Date();
        if (f.isText) out.file(path, f.content, { date });
        else out.file(path, f.content, { date, binary: true });
      });
      const now = new Date();
      for (const [path, f] of Object.entries(state.files) as [string, any][]) {
        if (seen.has(path)) continue;
        if (f.isText) out.file(path, f.content, { date: now });
        else out.file(path, f.content, { date: now, binary: true });
      }
      blob = await out.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    } else if (state.standalone) {
      const f = state.files[state.fileName as string];
      blob = new Blob([f.content], { type: 'text/plain' });
    } else {
      return;
    }

    if (state.fileHandle.queryPermission) {
      const perm = await state.fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const req = await state.fileHandle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') {
          setStatus('Write permission denied.', 'err');
          return;
        }
      }
    }
    const writable = await state.fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    for (const f of Object.values(state.files) as any[]) { f.dirty = false; f.added = false; }
    if (state.standalone) state.standalone.dirty = false;
    refreshTreeDirtyMarkers();

    const sizeKb = (blob.size / 1024).toFixed(1);
    setStatus(`Saved ${state.fileName} (${sizeKb} KB).`, 'ok');

    if (state.zip) {
      try {
        const file = await state.fileHandle.getFile();
        state.zip = await JSZip.loadAsync(file);
      } catch (_) { /* ignore */ }
    }
  } catch (e: any) {
    setStatus('Save failed: ' + e.message, 'err');
    console.error(e);
  } finally {
    (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = false;
  }
}

// ============================================================
// FILE / FOLDER PICKER
// ============================================================

export async function pickAndOpenFile(): Promise<void> {
  if (!(window as any).showOpenFilePicker) {
    alert("Your browser doesn't support the File System Access API. Please open this in Chrome or Edge.");
    return;
  }
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them and open a new file?')) return;
  let handle: any;
  try {
    [handle] = await (window as any).showOpenFilePicker({ multiple: false });
  } catch (e: any) {
    if (e.name === 'AbortError') return;
    setStatus('Open failed: ' + e.message, 'err');
    return;
  }
  state.dirHandle = null; state.folderTemplates = []; state.dirName = null;
  (document.getElementById('btn-back') as HTMLButtonElement).style.display = 'none';
  document.getElementById('folder-panel')!.style.display = 'none';
  await loadFromHandle(handle);
}

export async function pickAndOpenFolder(): Promise<void> {
  if (!(window as any).showDirectoryPicker) {
    alert("Your browser doesn't support directory picking. Please open this in Chrome or Edge.");
    return;
  }
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them and open a new folder?')) return;
  let dirHandle: any;
  try {
    dirHandle = await (window as any).showDirectoryPicker();
  } catch (e: any) {
    if (e.name === 'AbortError') return;
    setStatus('Open folder failed: ' + e.message, 'err');
    return;
  }
  state.dirHandle = dirHandle;
  state.dirName = dirHandle.name;
  await scanFolderTemplates(dirHandle, false);
  document.getElementById('folder-panel')!.style.display = '';
  document.getElementById('tree-panel')!.style.display = 'none';
  document.getElementById('folder-name')!.textContent = dirHandle.name;
  (document.getElementById('btn-back') as HTMLButtonElement).style.display = 'none';
  document.getElementById('empty')!.classList.remove('hidden');
  (document.getElementById('editor-tab') as HTMLElement).style.display = 'none';
  document.getElementById('editor')!.style.display = 'none';
  document.getElementById('binary-view')!.classList.remove('show');
  (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = true;
  (document.getElementById('btn-save') as HTMLButtonElement).disabled = true;
  document.getElementById('filename')!.textContent = `Folder: ${dirHandle.name}`;
  await hookEmitAsync('afterPickAndOpenFolder');
}

export async function scanFolderTemplates(dirHandle: any, isRescan: boolean): Promise<void> {
  setStatus('Scanning folder...');
  const items: any[] = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const ext = extOf(entry.name);
      if (ZIP_EXTS.has(ext) || ext === 'ol-datamodel' || ext === 'docx') {
        items.push({ name: entry.name, handle: entry, ext });
      }
    }
  } catch (e: any) {
    setStatus('Scan failed: ' + e.message, 'err');
    return;
  }
  items.sort((a: any, b: any) => a.name.localeCompare(b.name));
  state.folderTemplates = items;
  renderTemplatesList();
  setStatus(`Found ${items.length} template${items.length === 1 ? '' : 's'}${isRescan ? ' (rescanned)' : ''}.`, 'ok');
}

export function renderTemplatesList(): void {
  const list = document.getElementById('templates-list')!;
  list.innerHTML = '';
  if (!state.folderTemplates.length) {
    list.innerHTML = '<div class="empty-msg">No .OL-template / .OL-datamapper / .OL-datamodel / .docx files found.</div>';
    return;
  }
  for (const t of state.folderTemplates as any[]) {
    const el = document.createElement('div');
    el.className = 'template-item';
    if (state.fileHandle && state.fileHandle.name === t.name) el.classList.add('active');
    const kindLabel = t.ext === 'ol-datamapper' ? 'DM' : t.ext === 'ol-datamodel' ? 'MDL' : 'TPL';
    el.innerHTML = `<span class="kind">${kindLabel}</span><span>${escapeHtml(t.name)}</span>`;
    el.addEventListener('click', async () => {
      if (hasUnsaved() && !confirm('You have unsaved edits in the current template. Discard them?')) return;
      await loadFromHandle(t.handle);
    });
    list.appendChild(el);
  }
}

export async function backToFolderList(): Promise<void> {
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them?')) return;
  document.getElementById('folder-panel')!.style.display = '';
  document.getElementById('tree-panel')!.style.display = 'none';
  (document.getElementById('btn-back') as HTMLButtonElement).style.display = 'none';
  (document.getElementById('editor-tab') as HTMLElement).style.display = 'none';
  document.getElementById('editor')!.style.display = 'none';
  document.getElementById('binary-view')!.classList.remove('show');
  document.getElementById('empty')!.classList.remove('hidden');
  (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = true;
  (document.getElementById('btn-save') as HTMLButtonElement).disabled = true;
  document.getElementById('filename')!.textContent = `Folder: ${state.dirName}`;
  state.zip = null; state.fileHandle = null; state.fileName = null; state.files = {};
  state.currentPath = null; state.standalone = null;
  state.isDocx = false; state.docxBytes = null;
  Object.values(state.monacoModels).forEach((m: any) => m.dispose());
  state.monacoModels = {};
  document.getElementById('mode-theme')!.style.display = 'none';
  document.getElementById('mode-nav')!.style.display = '';
  document.getElementById('mode-scripts')!.style.display = '';
  if (previewState && previewState.open) closePreview();
  renderTemplatesList();
}

// ============================================================
// LOAD FROM HANDLE (zip, docx, or standalone text file)
// ============================================================

export async function loadFromHandle(handle: any): Promise<void> {
  setStatus('Reading...');
  const file = await handle.getFile();
  const headBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = headBytes.length >= 2 && headBytes[0] === 0x50 && headBytes[1] === 0x4B;

  state.zip = null;
  state.standalone = null;
  state.isDocx = false;
  state.docxBytes = null;
  if (typeof previewState === 'object') {
    previewState.lastDocxHtml = '';
    previewState.lastDocxHtmlFor = null;
  }
  state.fileHandle = handle;
  state.fileName = handle.name;
  state.files = {};
  state.currentPath = null;
  Object.values(state.monacoModels).forEach((m: any) => m.dispose());
  state.monacoModels = {};

  if (isZip) {
    let zip: any;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e: any) {
      setStatus('Not a valid zip: ' + e.message, 'err');
      return;
    }
    state.zip = zip;

    const paths: string[] = [];
    zip.forEach((path: string, entry: any) => { if (!entry.dir) paths.push(path); });

    const progressEvery = Math.max(1, Math.floor(paths.length / 20));
    let i = 0;
    for (const path of paths) {
      const entry = zip.file(path);
      const bytes = await entry.async('uint8array');
      const known = isTextPath(path);
      const isTxt = known || (!isImagePath(path) && looksLikeText(bytes));
      state.files[path] = isTxt
        ? { content: decodeBytes(bytes), isText: true, dirty: false }
        : { content: bytes, isText: false, dirty: false };
      i++;
      if (i % progressEvery === 0) setStatus(`Reading... ${i}/${paths.length}`);
    }
    const looksLikeDocx = paths.some(p => /(?:^|[\/\\])word[\/\\]document\.xml$/i.test(p))
      || extOf(handle.name) === 'docx';
    state.isDocx = looksLikeDocx;
    console.log('[docx] detection', { fileName: handle.name, isDocx: state.isDocx, partCount: paths.length, hasWordDocXml: paths.some(p => /(?:^|[\/\\])word[\/\\]document\.xml$/i.test(p)) });
    document.getElementById('tree-title')!.textContent = handle.name;
    buildTree();
    (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = state.isDocx;
    if (state.isDocx) {
      (document.getElementById('btn-rezip') as HTMLButtonElement).title = 'Save disabled for .docx — modifying the package can corrupt it. Use Word to edit the source.';
    } else {
      (document.getElementById('btn-rezip') as HTMLButtonElement).title = '';
    }
    setStatus(`Loaded ${paths.length} files${state.isDocx ? ' (Word document — read-only)' : ''}.`, 'ok');
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isTxt = isTextPath(handle.name) || looksLikeText(bytes);
    if (!isTxt) {
      setStatus("That file is binary and isn't a zip — nothing to edit.", 'err');
      return;
    }
    state.standalone = {
      isText: true,
      content: decodeBytes(bytes),
      dirty: false,
    };
    state.files[handle.name] = { content: state.standalone.content, isText: true, dirty: false, standalone: true };
    document.getElementById('tree-title')!.textContent = handle.name;
    buildTree();
    (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = false;
    setStatus('Loaded standalone file.', 'ok');
  }

  document.getElementById('filename')!.textContent = handle.name;
  document.getElementById('filename')!.classList.remove('dirty');
  document.getElementById('empty')!.classList.add('hidden');
  document.getElementById('tree-panel')!.style.display = '';
  (document.getElementById('btn-rezip') as HTMLButtonElement).textContent = state.zip ? 'Rezip & Overwrite' : 'Save & Overwrite';

  document.getElementById('mode-theme')!.style.display = state.isDocx ? '' : 'none';
  document.getElementById('mode-nav')!.style.display = state.isDocx ? 'none' : '';
  document.getElementById('mode-scripts')!.style.display = state.isDocx ? 'none' : '';
  const themeOn = document.getElementById('mode-theme')!.classList.contains('active');
  const navOn = document.getElementById('mode-nav')!.classList.contains('active');
  const scriptsOn = document.getElementById('mode-scripts')!.classList.contains('active');
  if ((themeOn && !state.isDocx) || ((navOn || scriptsOn) && state.isDocx)) {
    setSidebarMode('files');
  }

  if (state.dirHandle) {
    (document.getElementById('btn-back') as HTMLButtonElement).style.display = '';
    document.getElementById('folder-panel')!.style.display = '';
    renderTemplatesList();
  }

  const firstText = Object.entries(state.files).find(([, f]: [string, any]) => f.isText);
  if (firstText) openFile(firstText[0]);

  await hookEmitAsync('afterLoadFromHandle', handle);
}

// ============================================================
// DOM EVENT WIRING (runs at module load)
// ============================================================

document.getElementById('btn-open')!.addEventListener('click', () => pickAndOpenFile());
document.getElementById('btn-open-folder')!.addEventListener('click', () => pickAndOpenFolder());
document.getElementById('btn-save')!.addEventListener('click', () => commitCurrentEdit(true));
document.getElementById('btn-back')!.addEventListener('click', backToFolderList);
document.getElementById('btn-rescan')!.addEventListener('click', () => state.dirHandle && scanFolderTemplates(state.dirHandle, true));

window.addEventListener('beforeunload', e => {
  if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
});

// Test-only: hidden <input type=file> that loads a template without the
// File System Access API (which requires a real user gesture Playwright
// can't produce).
(function wireTestFileInput() {
  const inp = document.querySelector<HTMLInputElement>('input[type=file][data-testid="load-template"]');
  if (!inp) return;
  inp.addEventListener('change', () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const fakeHandle = { getFile: async () => file, name: file.name };
    inp.value = '';
    loadFromHandle(fakeHandle);
  });
})();

// ============================================================
// ADDITIONAL HOOK REGISTRATIONS (runs at module load)
// ============================================================

// Initial btn-rezip disabled state (re-enabled after each load)
(document.getElementById('btn-rezip') as HTMLButtonElement).disabled = !state.fileHandle;

// Track standalone original so diff works for non-zip files
hookOn('afterLoadFromHandle', () => {
  if (state.standalone) state.standalone.original = state.standalone.content;
});

// Re-enable rezip after a template loads
hookOn('afterLoadFromHandle', () => {
  (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = false;
});

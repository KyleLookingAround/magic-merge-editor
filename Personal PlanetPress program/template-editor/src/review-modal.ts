// Review/diff modal + zip text-map helper. Carved out of legacy.ts
// as the eighth Phase 3 module.
//
// Scope: openModal / closeModal / renderDiff (the modal shell) plus
// zipTextMap (a pure JSZip helper used by compareTemplates).
//
// Phase 8: compareTemplates and reviewAndSave migrated here.
//
// Globals: `Diff` (jsdiff) and `JSZip` are loaded from CDN and read off
// globalThis. JSZip instances are passed in by callers.

import { state } from './state';
import { escapeHtml } from './tree';
import { isTextPath, isImagePath, looksLikeText, decodeBytes } from './fs';

const getDiff = () => (globalThis as any).Diff;

interface ModalEls {
  backdrop: HTMLElement;
  title: HTMLElement;
  sidebar: HTMLElement;
  main: HTMLElement;
  status: HTMLElement;
  cancel: HTMLElement;
  action: HTMLElement;
  close: HTMLElement;
}

let cachedEls: ModalEls | null = null;

function els(): ModalEls {
  if (cachedEls) return cachedEls;
  const grab = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error('Modal element missing: ' + id);
    return el;
  };
  cachedEls = {
    backdrop: grab('modal-backdrop'),
    title: grab('modal-title'),
    sidebar: grab('modal-sidebar'),
    main: grab('modal-main'),
    status: grab('modal-status'),
    cancel: grab('modal-cancel'),
    action: grab('modal-action'),
    close: grab('modal-close'),
  };
  cachedEls.close.addEventListener('click', closeModal);
  cachedEls.cancel.addEventListener('click', closeModal);
  cachedEls.backdrop.addEventListener('click', e => {
    if (e.target === cachedEls!.backdrop) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cachedEls!.backdrop.classList.contains('show')) closeModal();
  });
  return cachedEls;
}

/** Internal accessor for callers in legacy.ts that still populate the
 *  modal sidebar/main/status directly (compareTemplates,
 *  reviewAndSave). Lazily wires the dismiss handlers on first use. */
export function getModalEls(): ModalEls { return els(); }

export function openModal(title: string, actionLabel: string, onAction: () => void): void {
  const m = els();
  m.title.textContent = title;
  m.action.textContent = actionLabel;
  (m.action as HTMLElement).onclick = onAction;
  m.backdrop.classList.add('show');
}

export function closeModal(): void {
  const m = els();
  m.backdrop.classList.remove('show');
  m.sidebar.innerHTML = '';
  m.main.innerHTML = '<div class="diff-empty">Pick a file on the left.</div>';
  m.status.textContent = '';
  (m.action as HTMLElement).onclick = null;
}

/** Render a unified diff of two text strings into the modal's main
 *  pane. Bails out gracefully if jsdiff didn't load or there are no
 *  textual differences. */
export function renderDiff(originalText: string, currentText: string): void {
  const main = els().main;
  const Diff = getDiff();
  if (!Diff) {
    main.innerHTML = '<div class="diff-empty">diff library failed to load.</div>';
    return;
  }
  if (originalText === currentText) {
    main.innerHTML = '<div class="diff-empty">No changes.</div>';
    return;
  }
  const patch = Diff.structuredPatch('original', 'current', originalText || '', currentText || '', '', '', { context: 3 });
  const frag = document.createDocumentFragment();
  if (!patch.hunks.length) {
    main.innerHTML = '<div class="diff-empty">No textual differences.</div>';
    return;
  }
  for (const hunk of patch.hunks) {
    const h = document.createElement('div');
    h.className = 'diff-hunk-header';
    h.textContent = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    frag.appendChild(h);
    for (const ln of hunk.lines) {
      const el = document.createElement('div');
      el.className = 'diff-line ' + (ln[0] === '+' ? 'add' : ln[0] === '-' ? 'del' : 'ctx');
      el.textContent = ln.slice(1);
      frag.appendChild(el);
    }
  }
  const wrap = document.createElement('div');
  wrap.className = 'diff-pane';
  wrap.appendChild(frag);
  main.innerHTML = '';
  main.appendChild(wrap);
}

/** Read every text-ish entry in a JSZip into a path -> string map.
 *  Skips images and binary files using the same heuristic as the
 *  main editor (isTextPath || (!isImagePath && looksLikeText)). */
export async function zipTextMap(zip: any): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const paths: string[] = [];
  zip.forEach((p: string, e: any) => { if (!e.dir) paths.push(p); });
  for (const p of paths) {
    const bytes: Uint8Array = await zip.file(p).async('uint8array');
    if (isTextPath(p) || (!isImagePath(p) && looksLikeText(bytes))) {
      try { out[p] = decodeBytes(bytes); } catch (_) { /* skip */ }
    }
  }
  return out;
}

// ============================================================
// COMPARE + REVIEW (carved from legacy.ts in Phase 8)
// ============================================================

interface ReviewModalDeps {
  setStatus: (msg: string, kind?: string) => void;
  commitCurrentEdit: (showStatus: boolean) => void;
  rezipAndSave: () => Promise<void>;
}

let rmDeps: ReviewModalDeps = {
  setStatus: () => {},
  commitCurrentEdit: () => {},
  rezipAndSave: async () => {},
};

export function configureReviewModal(d: ReviewModalDeps): void { rmDeps = d; }

export async function compareTemplates(): Promise<void> {
  if (!state.zip) {
    rmDeps.setStatus('Open a template first, then click Compare to pick a second one.', 'warn');
    return;
  }
  if (!(window as any).showOpenFilePicker) return;
  let handle: any;
  try {
    [handle] = await (window as any).showOpenFilePicker({ multiple: false });
  } catch (e: any) { if (e.name !== 'AbortError') rmDeps.setStatus(e.message, 'err'); return; }

  rmDeps.setStatus('Loading second template...');
  const file = await handle.getFile();
  let other: any;
  try { other = await (globalThis as any).JSZip.loadAsync(file); }
  catch (e: any) { rmDeps.setStatus('Not a valid zip: ' + e.message, 'err'); return; }

  const A = await zipTextMap(state.zip);
  const B = await zipTextMap(other);

  const allPaths = new Set([...Object.keys(A), ...Object.keys(B)]);
  const items: { path: string; status: string; a: string; b: string }[] = [];
  for (const p of [...allPaths].sort()) {
    const a = A[p], b = B[p];
    if (a === undefined && b !== undefined) items.push({ path: p, status: 'added', a: '', b });
    else if (a !== undefined && b === undefined) items.push({ path: p, status: 'removed', a, b: '' });
    else if (a !== b) items.push({ path: p, status: 'modified', a, b });
  }

  if (!items.length) { rmDeps.setStatus('Templates are identical (text content).', 'ok'); return; }

  openModal(`Compare — ${state.fileName} ↔ ${handle.name}`, 'Close', closeModal);
  const m = getModalEls();
  m.status.textContent = `${items.length} differing file${items.length === 1 ? '' : 's'}.`;

  m.sidebar.innerHTML = '';
  items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'modal-file-item' + (i === 0 ? ' active' : '');
    const badge = it.status === 'added' ? 'ADD' : it.status === 'removed' ? 'DEL' : 'CHG';
    el.innerHTML = `<span class="badge ${it.status}">${badge}</span><span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.path)}</span>`;
    el.addEventListener('click', () => {
      m.sidebar.querySelectorAll('.modal-file-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      renderDiff(it.a, it.b);
    });
    m.sidebar.appendChild(el);
  });
  renderDiff(items[0].a, items[0].b);
  rmDeps.setStatus('', '');
}

export async function reviewAndSave(): Promise<void> {
  if (!state.fileHandle) return;
  rmDeps.commitCurrentEdit(false);

  const changes: { path: string; original: string; current: string; status: string }[] = [];
  if (state.zip) {
    const inZip = new Set<string>();
    state.zip.forEach((p: string, e: any) => { if (!e.dir) inZip.add(p); });
    for (const path of Object.keys(state.files)) {
      const f = state.files[path];
      if (!inZip.has(path)) {
        const current = f.isText ? f.content : `(${(f.content && f.content.length) || 0} bytes binary)`;
        changes.push({ path, original: '', current, status: 'added' });
        continue;
      }
      if (!f.isText) continue;
      const original: string = await state.zip.file(path).async('string');
      if (original !== f.content) changes.push({ path, original, current: f.content, status: 'modified' });
    }
    for (const p of inZip) {
      if (!state.files[p]) {
        let original = '';
        try { original = await state.zip.file(p).async('string'); } catch (_) {}
        changes.push({ path: p, original, current: '', status: 'removed' });
      }
    }
  } else if (state.standalone) {
    const f = state.files[state.fileName as string];
    const original: string = state.standalone.original ?? '';
    if (original !== f.content) changes.push({ path: state.fileName as string, original, current: f.content, status: 'modified' });
  }

  if (!changes.length) {
    rmDeps.setStatus('No changes to save.', 'warn');
    return;
  }

  openModal(
    `Review changes — ${state.fileName}`,
    `Save ${changes.length} file${changes.length === 1 ? '' : 's'} to disk`,
    async () => { closeModal(); await rmDeps.rezipAndSave(); },
  );
  const m = getModalEls();
  m.status.textContent = `${changes.length} file${changes.length === 1 ? '' : 's'} changed.`;

  m.sidebar.innerHTML = '';
  changes.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'modal-file-item' + (i === 0 ? ' active' : '');
    const badge = c.status === 'added' ? '<span class="badge added">ADD</span>'
                : c.status === 'removed' ? '<span class="badge removed">DEL</span>'
                : '<span class="badge modified">CHG</span>';
    el.innerHTML = `${badge}<span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.path)}</span>`;
    el.addEventListener('click', () => {
      m.sidebar.querySelectorAll('.modal-file-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      renderDiff(c.original, c.current);
    });
    m.sidebar.appendChild(el);
  });
  renderDiff(changes[0].original, changes[0].current);
}

// Review/diff modal + zip text-map helper. Carved out of legacy.ts
// as the eighth Phase 3 module.
//
// Scope: openModal / closeModal / renderDiff (the modal shell) plus
// zipTextMap (a pure JSZip helper used by compareTemplates).
// reviewAndSave and compareTemplates stay in legacy.ts - both reach
// into commitCurrentEdit / setStatus / loadFromHandle, all of which
// are still legacy-resident and heavily monkey-patched.
//
// Globals: `Diff` (jsdiff) is loaded from CDN and read off
// globalThis. JSZip instances are passed in by callers.

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

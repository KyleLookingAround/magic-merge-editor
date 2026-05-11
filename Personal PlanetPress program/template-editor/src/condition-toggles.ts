// Conditional script toggles + truth-table modal.
//
// Lets the user force-override the show/hide outcome of any conditional
// script whose selector actually matches an element in the current preview
// document, and step through all 2^N permutations.
//
// All state is preview-only (ephemeral); nothing is written back to the zip.

import { scriptsState, ParsedScript } from './scripts-panel';
import { state } from './state';
import { decodeBytes } from './fs';
import { buildPreviewHtml } from './preview';

interface ConditionTogglesState {
  /** Explicit overrides keyed by script id. Missing entry = evaluate normally. */
  overrides: Map<string, boolean>;
  /** Script ids included in the truth-table, in column order. */
  applicableIds: string[];
  /** Selected truth-table row index, or null if no row is selected. */
  tableIndex: number | null;
}

export const conditionTogglesState: ConditionTogglesState = {
  overrides: new Map(),
  applicableIds: [],
  tableIndex: null,
};

let deps: { refreshPreview: () => void } | null = null;

const MAX_SCRIPTS = 10;          // 2^10 = 1024 rows; anything larger is unusable
const ROW_HEIGHT = 24;           // px; used for the virtualised list
const VISIBLE_PAD = 6;           // rows of overscan on each side

export function configureConditionToggles(d: { refreshPreview: () => void }): void {
  deps = d;
  wireButtons();
}

/** Read helper for preview.ts. Returns the forced outcome, or undefined to
 *  fall through to normal datamodel evaluation. */
export function getConditionOverride(id: string): boolean | undefined {
  return conditionTogglesState.overrides.get(id);
}

export function hasAnyConditionOverride(): boolean {
  return conditionTogglesState.overrides.size > 0;
}

export function clearConditionOverrides(): void {
  conditionTogglesState.overrides.clear();
  conditionTogglesState.tableIndex = null;
  if (deps) deps.refreshPreview();
}

// ============================================================
// APPLICABILITY
// ============================================================

/** Filter scriptsState.list to conditional scripts whose selector matches
 *  at least one element in the current preview document. */
function computeApplicable(): ParsedScript[] {
  const candidates = (scriptsState.list || []).filter(
    s => s.kind === 'CONDITIONAL' && s.selectorType === 'QUERY' && !!s.selectorText,
  );
  if (!candidates.length) return [];

  // Build a transient preview DOM from the currently-open HTML file. We use
  // the same `buildPreviewHtml` path the live preview uses so selector
  // matches stay consistent with what the user actually sees.
  const htmlPath = pickPreviewHtmlPath();
  if (!htmlPath) return [];
  const f = state.files[htmlPath];
  if (!f) return [];
  const htmlText = typeof f.content === 'string'
    ? f.content
    : decodeBytes(f.content as Uint8Array);

  let built: string;
  try { built = buildPreviewHtml(htmlPath, htmlText, { withData: false }); }
  catch (_) { return []; }

  let doc: Document;
  try { doc = new DOMParser().parseFromString(built, 'text/html'); }
  catch (_) { return []; }
  if (!doc.body) return [];

  const out: ParsedScript[] = [];
  for (const s of candidates) {
    try {
      if (doc.body.querySelectorAll(s.selectorText).length > 0) out.push(s);
    } catch (_) { /* invalid selector — skip */ }
  }
  out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return out;
}

function pickPreviewHtmlPath(): string | null {
  // Same heuristic as the rest of the editor — favour the currently-open
  // file if it's HTML, otherwise scan for an .html under public/document.
  if (state.currentPath && /\.html?$/i.test(state.currentPath)) return state.currentPath;
  for (const p of Object.keys(state.files)) {
    const norm = p.replace(/\\/g, '/');
    if (/^public\/document\/.*\.html?$/i.test(norm)) return p;
  }
  return null;
}

// ============================================================
// MODAL
// ============================================================

function getEls() {
  return {
    backdrop: document.getElementById('cond-toggles-backdrop')!,
    list:     document.getElementById('cond-toggles-list')!,
    table:    document.getElementById('cond-toggles-table')!,
    tableViewport: document.getElementById('cond-toggles-table-viewport')!,
    tableHeader:   document.getElementById('cond-toggles-table-header')!,
    tableSpacer:   document.getElementById('cond-toggles-table-spacer')!,
    tableRows:     document.getElementById('cond-toggles-table-rows')!,
    indexLabel:    document.getElementById('cond-toggles-index-label')!,
    btnPrev:    document.getElementById('cond-toggles-prev') as HTMLButtonElement,
    btnNext:    document.getElementById('cond-toggles-next') as HTMLButtonElement,
    btnClose:   document.getElementById('cond-toggles-close') as HTMLButtonElement,
    btnClear:   document.getElementById('cond-toggles-clear') as HTMLButtonElement,
    warn:       document.getElementById('cond-toggles-warn')!,
    empty:      document.getElementById('cond-toggles-empty')!,
    body:       document.getElementById('cond-toggles-body')!,
  };
}

export function openConditionTogglesModal(): void {
  const applicable = computeApplicable();
  conditionTogglesState.applicableIds = applicable.map(s => s.id);

  // Drop any overrides that no longer correspond to an applicable script —
  // the document may have changed since they were set.
  for (const id of Array.from(conditionTogglesState.overrides.keys())) {
    if (!conditionTogglesState.applicableIds.includes(id)) {
      conditionTogglesState.overrides.delete(id);
    }
  }

  const els = getEls();
  renderToggleList(applicable);
  renderTruthTable(applicable);
  els.backdrop.classList.add('show');
}

function closeModal(): void {
  getEls().backdrop.classList.remove('show');
}

function renderToggleList(applicable: ParsedScript[]): void {
  const els = getEls();
  const list = els.list;
  list.innerHTML = '';

  if (!applicable.length) {
    els.empty.style.display = '';
    els.body.style.display = 'none';
    return;
  }
  els.empty.style.display = 'none';
  els.body.style.display = '';

  for (const s of applicable) {
    const row = document.createElement('label');
    row.className = 'cond-toggle-row';
    const current = conditionTogglesState.overrides.get(s.id);
    row.innerHTML =
      `<input type="checkbox" data-script-id="${s.id}" ${current === true ? 'checked' : ''}>` +
      `<span class="cond-toggle-name"></span>` +
      `<span class="cond-toggle-sel"></span>` +
      `<span class="cond-toggle-state">${current === undefined ? 'auto' : (current ? 'TRUE' : 'FALSE')}</span>`;
    (row.querySelector('.cond-toggle-name') as HTMLElement).textContent = s.name || '(unnamed)';
    (row.querySelector('.cond-toggle-sel') as HTMLElement).textContent = s.selectorText;
    const cb = row.querySelector('input') as HTMLInputElement;
    // Three-state: unchecked -> auto; click -> TRUE; click -> FALSE; click -> auto.
    // Implemented via a cycle on the row click; the checkbox just shows TRUE state.
    row.addEventListener('click', (e) => {
      // Let the implicit label-click toggle the checkbox; then we override
      // semantics ourselves.
      e.preventDefault();
      const cur = conditionTogglesState.overrides.get(s.id);
      let next: boolean | undefined;
      if (cur === undefined) next = true;
      else if (cur === true)  next = false;
      else                    next = undefined;
      if (next === undefined) conditionTogglesState.overrides.delete(s.id);
      else conditionTogglesState.overrides.set(s.id, next);
      cb.checked = next === true;
      cb.indeterminate = next === false;
      (row.querySelector('.cond-toggle-state') as HTMLElement).textContent =
        next === undefined ? 'auto' : (next ? 'TRUE' : 'FALSE');
      // Manual flips desync the truth-table selection.
      conditionTogglesState.tableIndex = null;
      updateTableSelection();
      if (deps) deps.refreshPreview();
    });
    cb.indeterminate = current === false;
    list.appendChild(row);
  }
}

// ============================================================
// TRUTH TABLE (virtualised)
// ============================================================

function renderTruthTable(applicable: ParsedScript[]): void {
  const els = getEls();
  const n = applicable.length;

  if (!n) {
    els.tableHeader.innerHTML = '';
    els.tableRows.innerHTML = '';
    els.tableSpacer.style.height = '0px';
    els.indexLabel.textContent = '—';
    els.warn.style.display = 'none';
    return;
  }

  if (n > MAX_SCRIPTS) {
    els.warn.style.display = '';
    els.warn.textContent =
      `${n} applicable scripts (2^${n} = ${2 ** n} rows). Truth table capped at ${MAX_SCRIPTS} scripts — ` +
      `narrow the document or disable some scripts first.`;
    els.tableHeader.innerHTML = '';
    els.tableRows.innerHTML = '';
    els.tableSpacer.style.height = '0px';
    return;
  }
  els.warn.style.display = 'none';

  // Header: # column then one column per script (short name).
  const headerCols = ['<div class="tt-cell tt-idx">#</div>'];
  for (const s of applicable) {
    const label = (s.name || '(unnamed)').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c]);
    headerCols.push(`<div class="tt-cell" title="${label}">${label}</div>`);
  }
  els.tableHeader.innerHTML = headerCols.join('');

  const rows = 2 ** n;
  els.tableSpacer.style.height = (rows * ROW_HEIGHT) + 'px';

  const repaint = () => {
    const vp = els.tableViewport;
    const scrollTop = vp.scrollTop;
    const viewH = vp.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_PAD);
    const end = Math.min(rows, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + VISIBLE_PAD);

    const html: string[] = [];
    for (let i = start; i < end; i++) {
      const selected = i === conditionTogglesState.tableIndex;
      const cells: string[] = [`<div class="tt-cell tt-idx">${i}</div>`];
      for (let c = 0; c < n; c++) {
        const bit = (i >> c) & 1;
        cells.push(`<div class="tt-cell tt-bit ${bit ? 'on' : 'off'}">${bit ? 'T' : 'F'}</div>`);
      }
      html.push(
        `<div class="tt-row${selected ? ' selected' : ''}" data-row="${i}" ` +
        `style="position:absolute;top:${i * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;left:0;right:0;">` +
        cells.join('') + `</div>`,
      );
    }
    els.tableRows.innerHTML = html.join('');
  };

  els.tableViewport.onscroll = repaint;
  els.tableRows.onclick = (e) => {
    const target = (e.target as HTMLElement).closest('.tt-row') as HTMLElement | null;
    if (!target) return;
    const idx = Number(target.getAttribute('data-row'));
    if (!Number.isFinite(idx)) return;
    selectRow(idx);
  };

  // Reset scroll only when we don't already have a selected row that's
  // worth keeping centred.
  if (conditionTogglesState.tableIndex == null) {
    els.tableViewport.scrollTop = 0;
  }
  repaint();
  updateIndexLabel();
}

function applyRowToOverrides(idx: number): void {
  const ids = conditionTogglesState.applicableIds;
  for (let c = 0; c < ids.length; c++) {
    const bit = (idx >> c) & 1;
    conditionTogglesState.overrides.set(ids[c], bit === 1);
  }
}

function selectRow(idx: number): void {
  conditionTogglesState.tableIndex = idx;
  applyRowToOverrides(idx);
  // Refresh toggle row UI to reflect new states.
  const list = getEls().list;
  list.querySelectorAll('.cond-toggle-row').forEach(row => {
    const cb = row.querySelector('input') as HTMLInputElement;
    const id = cb.getAttribute('data-script-id')!;
    const v = conditionTogglesState.overrides.get(id);
    cb.checked = v === true;
    cb.indeterminate = v === false;
    (row.querySelector('.cond-toggle-state') as HTMLElement).textContent =
      v === undefined ? 'auto' : (v ? 'TRUE' : 'FALSE');
  });
  updateTableSelection();
  scrollRowIntoView(idx);
  updateIndexLabel();
  if (deps) deps.refreshPreview();
}

function updateTableSelection(): void {
  const rows = getEls().tableRows.querySelectorAll<HTMLElement>('.tt-row');
  rows.forEach(r => {
    const idx = Number(r.getAttribute('data-row'));
    r.classList.toggle('selected', idx === conditionTogglesState.tableIndex);
  });
}

function scrollRowIntoView(idx: number): void {
  const vp = getEls().tableViewport;
  const top = idx * ROW_HEIGHT;
  if (top < vp.scrollTop) vp.scrollTop = top;
  else if (top + ROW_HEIGHT > vp.scrollTop + vp.clientHeight) {
    vp.scrollTop = top - vp.clientHeight + ROW_HEIGHT;
  }
  // Repaint will run via the onscroll handler; trigger a tick just in case
  // the assignment was a no-op (already in view).
  vp.dispatchEvent(new Event('scroll'));
}

function updateIndexLabel(): void {
  const n = conditionTogglesState.applicableIds.length;
  const els = getEls();
  if (!n || n > MAX_SCRIPTS) { els.indexLabel.textContent = '—'; return; }
  const total = 2 ** n;
  const idx = conditionTogglesState.tableIndex;
  els.indexLabel.textContent = (idx == null ? '—' : String(idx)) + ' / ' + (total - 1);
}

function step(delta: number): void {
  const n = conditionTogglesState.applicableIds.length;
  if (!n || n > MAX_SCRIPTS) return;
  const total = 2 ** n;
  const cur = conditionTogglesState.tableIndex ?? -1;
  let next = cur + delta;
  if (next < 0) next = total - 1;
  if (next >= total) next = 0;
  selectRow(next);
}

// ============================================================
// BUTTON WIRING
// ============================================================

function wireButtons(): void {
  document.getElementById('btn-cond-toggles')?.addEventListener('click', openConditionTogglesModal);

  const els = getEls();
  els.btnClose.addEventListener('click', closeModal);
  els.btnClear.addEventListener('click', () => {
    clearConditionOverrides();
    openConditionTogglesModal();        // re-render with fresh state
  });
  els.btnPrev.addEventListener('click', () => step(-1));
  els.btnNext.addEventListener('click', () => step(+1));
  els.backdrop.addEventListener('click', (e) => {
    if (e.target === els.backdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (!els.backdrop.classList.contains('show')) return;
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { step(+1); e.preventDefault(); }
    else if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { step(-1); e.preventDefault(); }
  });
}

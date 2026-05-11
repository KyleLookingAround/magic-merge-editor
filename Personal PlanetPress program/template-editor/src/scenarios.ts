// Scenario state, orchestrators, and form/diff UI. Carved from legacy.ts
// across Phases 5, 6, and 12.
//
// Phase 12 additions: scenario form (openScenarioForm /
// openScenarioFormForActive / closeScenarioForm / scenarioMapToXml),
// coverage matrix (openCoverageMatrix), scenario diff (openScenarioDiff),
// and the wireScenarios DOM wiring (previously an IIFE in legacy.ts).
//
// Circular import note: this module imports from preview.ts, which
// imports scenariosState back from this module. That cycle is safe because
// scenariosState is a module-level const initialized before any runtime
// call into preview.ts, and preview.ts only reads it inside functions.

import { state } from './state';
import { decodeBytes, encodeXmlText } from './fs';
import { escapeHtml } from './tree';
import { openModal, closeModal, getModalEls } from './review-modal';
import { parseNavigatorEntries, normalizeNavPath } from './navigator';
import { scriptsState } from './scripts-panel';
import {
  buildPreviewHtml, applyDatamodelPersonalization,
  openPreview, refreshPreview as _refreshPreview, previewState,
} from './preview';
import { setStatus } from './status';
import { openFile } from './file-ops';
import { on as hookOn } from './hooks';

export interface Scenario {
  name: string;
  path: string;
  xmlText: string;
  valueByPath: Map<string, string>;
}

export interface ScenariosState {
  source: string | null;
  sourceHandle: FileSystemFileHandle | null;
  list: Scenario[];
  active: string | null;
  activeOverrides: Map<string, string> | null;
}

export const scenariosState: ScenariosState = {
  source: null,
  sourceHandle: null,
  list: [],
  active: null,
  activeOverrides: null,
};

// ============================================================
// SCENARIO HELPERS (carved from legacy.ts in Phase 6)
// ============================================================

/** localStorage key that persists the last-selected scenario per template. */
export function scnPersistKey(): string {
  return 'cw_scn:' + (state.fileName || '');
}

/** Walk an XML document and build a path→value map for every leaf element.
 *  Path is the dotted join of element names from root down. Each leaf is also
 *  indexed under every suffix of its path so substitution finds it regardless
 *  of how the datamodel names the field. First occurrence wins. */
export function parseScenarioXmlToMap(xmlText: string): Map<string, string> {
  const map = new Map<string, string>();
  let doc: Document;
  try { doc = new DOMParser().parseFromString(xmlText, 'application/xml'); }
  catch (_) { return map; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === 'parsererror') return map;
  function setIfAbsent(k: string, v: string) { if (k && !map.has(k)) map.set(k, v); }
  function walk(node: Element, ancestors: string[]) {
    for (const child of Array.from(node.children)) {
      const tag = child.localName || child.nodeName;
      const newAncestors = ancestors.concat([tag]);
      if (child.children && child.children.length > 0) {
        walk(child, newAncestors);
      } else {
        const value = (child.textContent || '').trim();
        for (let i = 0; i < newAncestors.length; i++) {
          setIfAbsent(newAncestors.slice(i).join('.'), value);
        }
      }
    }
  }
  walk(root, []);
  return map;
}

// ============================================================
// SCENARIO ORCHESTRATORS (carved from legacy.ts in Phase 6)
// ============================================================

/* global JSZip */
declare const JSZip: any;

export function configureScenarios(): void {
  // Wire the scenario picker UI (was wireScenarios IIFE in legacy.ts).
  const sel = document.getElementById('preview-scenario') as HTMLSelectElement | null;
  if (sel) sel.addEventListener('change', () => activateScenario(sel.value || null, false));
  const loadBtn = document.getElementById('btn-scenario-load');
  if (loadBtn) loadBtn.addEventListener('click', pickAndLoadScenarios);
  const matrixBtn = document.getElementById('btn-scenario-matrix');
  if (matrixBtn) matrixBtn.addEventListener('click', openCoverageMatrix);
  const diffBtn = document.getElementById('btn-scenario-diff');
  if (diffBtn) diffBtn.addEventListener('click', openScenarioDiff);
  const editBtn = document.getElementById('btn-scenario-edit');
  if (editBtn) editBtn.addEventListener('click', openScenarioFormForActive);
}

/** Load scenario XML files from a JSZip instance's SampleDataFiles/ folder. */
export async function readScenariosFromZip(zip: any, sourceLabel: string | null): Promise<Scenario[]> {
  const out: Scenario[] = [];
  const entries: { path: string; entry: any }[] = [];
  zip.forEach((path: string, entry: any) => { if (!entry.dir) entries.push({ path, entry }); });
  for (const { path, entry } of entries) {
    const norm = path.replace(/\\/g, '/');
    if (!/^SampleDataFiles\//i.test(norm)) continue;
    if (!/\.xml$/i.test(norm)) continue;
    let text: string;
    try {
      const bytes = await entry.async('uint8array');
      text = decodeBytes(bytes);
    } catch (_) { continue; }
    const valueByPath = parseScenarioXmlToMap(text);
    out.push({ name: norm.split('/').pop()!, path, xmlText: text, valueByPath });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  scenariosState.source = sourceLabel;
  scenariosState.list = out;
  return out;
}

/** If open in folder mode, find a sibling .OL-datamapper and auto-load its scenarios. */
export async function autoLoadScenariosFromFolder(): Promise<boolean> {
  if (!state.dirHandle) return false;
  const dm = (state.folderTemplates as { ext: string; handle: any; name: string }[])
    .find(t => t.ext === 'ol-datamapper');
  if (!dm) return false;
  try {
    const file = await dm.handle.getFile();
    const zip = await JSZip.loadAsync(file);
    await readScenariosFromZip(zip, dm.name);
    scenariosState.sourceHandle = dm.handle;
    return true;
  } catch (e) {
    console.warn('[scenarios] auto-load failed:', e);
    return false;
  }
}

/** User-initiated: pick a .OL-datamapper from disk and load its scenarios. */
export async function pickAndLoadScenarios(): Promise<void> {
  if (!(window as any).showOpenFilePicker) {
    alert('File picker not available — try Chrome or Edge.');
    return;
  }
  let handle: any;
  try { [handle] = await (window as any).showOpenFilePicker({ multiple: false }); }
  catch (e: any) { if (e.name !== 'AbortError') setStatus('Pick failed: ' + e.message, 'err'); return; }
  try {
    const file = await handle.getFile();
    const zip = await JSZip.loadAsync(file);
    await readScenariosFromZip(zip, handle.name);
    scenariosState.sourceHandle = handle;
    populateScenarioPicker();
    setStatus(`Loaded ${scenariosState.list.length} scenario${scenariosState.list.length === 1 ? '' : 's'} from ${handle.name}.`, 'ok');
  } catch (e: any) { setStatus('Load failed: ' + e.message, 'err'); }
}

/** Reflect scenariosState.list in the preview scenario <select>. */
export function populateScenarioPicker(): void {
  const wrap = document.getElementById('preview-scenario-wrap');
  const row = document.getElementById('preview-scenario-row');
  const sel = document.getElementById('preview-scenario') as HTMLSelectElement | null;
  const matrixBtn = document.getElementById('btn-scenario-matrix') as HTMLButtonElement | null;
  const diffBtn = document.getElementById('btn-scenario-diff') as HTMLButtonElement | null;
  const editBtn = document.getElementById('btn-scenario-edit') as HTMLButtonElement | null;
  if (!wrap || !sel) return;
  const isHostUseful = !state.isDocx;
  wrap.style.display = isHostUseful ? '' : 'none';
  if (row) row.style.display = isHostUseful ? '' : 'none';
  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = scenariosState.list.length
    ? `(datamodel sample) — ${scenariosState.list.length} scenarios available`
    : '(datamodel sample) — no scenarios loaded';
  sel.appendChild(def);
  for (const s of scenariosState.list) {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name + (scenariosState.source ? '  ·  ' + scenariosState.source : '');
    sel.appendChild(opt);
  }
  let restore: string | null = null;
  try { restore = localStorage.getItem(scnPersistKey()); } catch (_) {}
  if (restore && scenariosState.list.some(s => s.name === restore)) {
    sel.value = restore;
    activateScenario(restore, true);
  } else {
    sel.value = '';
    activateScenario(null, true);
  }
  const anyScenarios = scenariosState.list.length > 0;
  if (matrixBtn) matrixBtn.disabled = !anyScenarios;
  if (diffBtn) diffBtn.disabled = scenariosState.list.length < 2;
  if (editBtn) editBtn.disabled = !scenariosState.active;
}

/** Activate or clear the named scenario, persist the choice, and trigger a
 *  preview refresh if the preview is currently open. */
export function activateScenario(name: string | null, silent: boolean): void {
  if (!name) {
    scenariosState.active = null;
    scenariosState.activeOverrides = null;
  } else {
    const s = scenariosState.list.find(x => x.name === name);
    if (!s) { scenariosState.active = null; scenariosState.activeOverrides = null; }
    else { scenariosState.active = name; scenariosState.activeOverrides = s.valueByPath; }
  }
  try { localStorage.setItem(scnPersistKey(), scenariosState.active || ''); } catch (_) {}
  const wrap = document.getElementById('preview-scenario-wrap');
  if (wrap) wrap.classList.toggle('has-active', !!scenariosState.active);
  const editBtn = document.getElementById('btn-scenario-edit') as HTMLButtonElement | null;
  if (editBtn) editBtn.disabled = !scenariosState.active;
  // Only refresh if preview is currently open — check via the DOM flag rather
  // than importing previewState to avoid a module cycle.
  if (document.getElementById('preview-pane')?.classList.contains('show')) {
    _refreshPreview();
  }
  if (!silent) {
    setStatus(scenariosState.active
      ? `Scenario: ${scenariosState.active}`
      : 'Scenario cleared (using datamodel lastValue)', 'ok');
  }
}

// ============================================================
// SCENARIO FORM (Phase 12 — carved from legacy.ts)
// ============================================================

export function openScenarioFormForActive(): void {
  if (!scenariosState.active) { setStatus('Pick a scenario first.', 'warn'); return; }
  const s = scenariosState.list.find(x => x.name === scenariosState.active);
  if (!s) return;
  openScenarioForm(s);
}

export function openScenarioForm(scenario: Scenario): void {
  document.getElementById('editor')!.style.display = 'none';
  document.getElementById('binary-view')!.classList.remove('show');
  document.getElementById('script-form-view')!.classList.remove('show');
  const view = document.getElementById('scenario-form-view')!;
  view.classList.add('show');
  (document.getElementById('editor-tab') as HTMLElement).style.display = 'none';

  document.getElementById('scn-form-title')!.textContent = 'Scenario: ' + scenario.name;
  document.getElementById('scn-form-sub')!.textContent =
    scenario.path + (scenariosState.source ? '  ·  in ' + scenariosState.source : '');

  const dmFields = (scriptsState && scriptsState.datamodelFields) || [];
  const allPaths = new Set<string>();
  for (const f of dmFields) if (f.type !== 'table') allPaths.add(f.path);
  for (const k of scenario.valueByPath.keys()) allPaths.add(k);

  const grouped = new Map<string, string[]>();
  for (const p of allPaths) {
    const parts = p.split('.');
    const head = parts.length > 1 ? parts[0] : '(top-level)';
    if (!grouped.has(head)) grouped.set(head, []);
    grouped.get(head)!.push(p);
  }

  const body = document.getElementById('scn-form-body')!;
  body.innerHTML = '';
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();

  for (const head of Array.from(grouped.keys()).sort()) {
    const grp = document.createElement('div');
    grp.className = 'group';
    const gh = document.createElement('div');
    gh.className = 'group-head';
    gh.innerHTML = `<span class="toggle">▾</span><span>${escapeHtml(head)}</span><span style="flex:1;"></span><span style="color:var(--muted);">${grouped.get(head)!.length} fields</span>`;
    gh.addEventListener('click', () => grp.classList.toggle('collapsed'));
    grp.appendChild(gh);
    const gb = document.createElement('div');
    gb.className = 'group-body';
    for (const p of grouped.get(head)!.sort()) {
      const row = document.createElement('div');
      row.className = 'field-row';
      const lbl = document.createElement('label');
      lbl.textContent = p;
      row.appendChild(lbl);
      const val = scenario.valueByPath.get(p) || '';
      const input: HTMLInputElement | HTMLTextAreaElement = (val.length > 80 || /\n/.test(val))
        ? document.createElement('textarea')
        : document.createElement('input');
      if (input.tagName === 'INPUT') (input as HTMLInputElement).type = 'text';
      input.value = val;
      (input as any).dataset.path = p;
      row.appendChild(input);
      inputs.set(p, input);
      gb.appendChild(row);
    }
    grp.appendChild(gb);
    body.appendChild(grp);
  }

  document.getElementById('scn-form-revert')!.onclick = () => openScenarioForm(scenario);
  document.getElementById('scn-form-close')!.onclick = closeScenarioForm;
  document.getElementById('scn-form-apply')!.onclick = () => {
    for (const [p, inp] of inputs.entries()) {
      scenario.valueByPath.set(p, inp.value);
    }
    if (scenariosState.active === scenario.name) {
      scenariosState.activeOverrides = scenario.valueByPath;
    }
    closeScenarioForm();
    if (previewState && previewState.open) _refreshPreview();
    setStatus('Scenario edits applied (in-memory). Use "Save as new XML…" to persist.', 'ok');
  };
  document.getElementById('scn-form-save-as')!.onclick = async () => {
    if (!state.dirHandle) { setStatus('Save-as needs a folder open (Open Folder).', 'warn'); return; }
    const name = prompt('Save as XML filename (in the open folder):', scenario.name.replace(/\.xml$/i, '_edited.xml'));
    if (!name) return;
    for (const [p, inp] of inputs.entries()) scenario.valueByPath.set(p, inp.value);
    const xml = scenarioMapToXml(scenario.valueByPath);
    try {
      const fh = await state.dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([xml], { type: 'application/xml' }));
      await w.close();
      setStatus(`Saved ${name} to folder.`, 'ok');
    } catch (e: any) { setStatus('Save failed: ' + e.message, 'err'); }
  };
}

export function closeScenarioForm(): void {
  document.getElementById('scenario-form-view')!.classList.remove('show');
  if (state.currentPath) openFile(state.currentPath);
}

export function scenarioMapToXml(map: Map<string, string>): string {
  interface TreeNode { children: Map<string, TreeNode>; value: string | null; }
  const root: TreeNode = { children: new Map(), value: null };
  for (const [p, v] of map.entries()) {
    const parts = p.split('.');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map(), value: null });
      node = node.children.get(seg)!;
      if (i === parts.length - 1) node.value = v;
    }
  }
  function serialize(node: TreeNode, indent: string): string {
    const lines: string[] = [];
    for (const [name, child] of node.children) {
      const safe = encodeXmlText(child.value || '');
      if (child.children.size === 0) {
        lines.push(`${indent}<${name}>${safe}</${name}>`);
      } else {
        lines.push(`${indent}<${name}>`);
        lines.push(serialize(child, indent + '  '));
        lines.push(`${indent}</${name}>`);
      }
    }
    return lines.join('\n');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Application>\n' + serialize(root, '  ') + '\n</Application>\n';
}

// ============================================================
// COVERAGE MATRIX (Phase 12 — carved from legacy.ts)
// ============================================================

export function openCoverageMatrix(): void {
  if (!scenariosState.list.length) { setStatus('No scenarios loaded.', 'warn'); return; }
  const sectionPaths = collectSectionHtmlPaths();
  if (!sectionPaths.length) { setStatus('No section HTML found in this template.', 'warn'); return; }

  const rows: { name: string; valueByPath: Map<string, string> | null }[] =
    scenariosState.list.map(s => ({ name: s.name, valueByPath: s.valueByPath }));
  rows.unshift({ name: '(datamodel sample)', valueByPath: null });

  const m = getModalEls();
  openModal('Scenario coverage matrix', 'Close', closeModal);
  m.action.textContent = 'Close';
  m.cancel.style.display = 'none';
  m.sidebar.innerHTML = '<div id="matrix-help">Click a cell to render that scenario × section into the main preview pane.</div>';

  const tbl = document.createElement('table');
  tbl.className = 'matrix-grid';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = '<th>Scenario</th>' + sectionPaths.map(p => `<th title="${escapeHtml(p.path)}">${escapeHtml(p.name)}</th>`).join('');
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = r.name;
    th.style.maxWidth = '240px';
    th.style.overflow = 'hidden';
    th.style.textOverflow = 'ellipsis';
    tr.appendChild(th);
    for (const sec of sectionPaths) {
      const td = document.createElement('td');
      td.className = 'matrix-cell';
      const summary = summarizeScenarioForSection(r.valueByPath, sec.path);
      td.innerHTML = summary.html;
      td.title = summary.tip;
      td.addEventListener('click', () => {
        const sel = document.getElementById('preview-scenario') as HTMLSelectElement;
        sel.value = r.valueByPath ? r.name : '';
        activateScenario(r.valueByPath ? r.name : null, false);
        openFile(sec.path);
        if (!previewState.open) openPreview();
        else _refreshPreview();
        closeModal();
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  m.main.innerHTML = '';
  m.main.appendChild(tbl);
}

function collectSectionHtmlPaths(): { name: string; path: string }[] {
  const groups = parseNavigatorEntries();
  const out: { name: string; path: string }[] = [];
  for (const sec of (groups.sections || [])) {
    const p = normalizeNavPath(sec.location);
    if (state.files[p]) out.push({ name: sec.name, path: p });
  }
  return out;
}

function summarizeScenarioForSection(
  overrides: Map<string, string> | null,
  sectionPath: string
): { html: string; tip: string } {
  const f = state.files[sectionPath];
  if (!f || !f.isText) return { html: '<span class="badge unres">?</span>', tip: 'no file' };
  const html = state.monacoModels[sectionPath]
    ? state.monacoModels[sectionPath].getValue()
    : f.content;
  const stash = scenariosState.activeOverrides;
  scenariosState.activeOverrides = overrides;
  let shownCount = 0, hiddenCount = 0;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc && doc.body) {
      applyDatamodelPersonalization(doc);
      doc.body.querySelectorAll('[style]').forEach(el => {
        if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) hiddenCount++;
        else shownCount++;
      });
    }
  } catch (_) {}
  scenariosState.activeOverrides = stash;
  return {
    html: `<span class="badge shown">${shownCount}</span> <span class="badge hidden">${hiddenCount}</span>`,
    tip: `${shownCount} visible block(s), ${hiddenCount} hidden`,
  };
}

// ============================================================
// SCENARIO DIFF (Phase 12 — carved from legacy.ts)
// ============================================================

export function openScenarioDiff(): void {
  if (scenariosState.list.length < 2) { setStatus('Need at least 2 scenarios.', 'warn'); return; }
  let target = state.currentPath && /\.html?$/i.test(state.currentPath) ? state.currentPath : null;
  if (!target) {
    const secs = collectSectionHtmlPaths();
    if (secs.length) target = secs[0].path;
  }
  if (!target) { setStatus('Open an HTML file first.', 'warn'); return; }

  const m = getModalEls();
  openModal('Scenario diff', 'Close', closeModal);
  m.action.textContent = 'Close';
  m.cancel.style.display = 'none';
  m.sidebar.innerHTML = `<div id="matrix-help">Pick two scenarios, see the rendered output and field-level deltas.</div>`;
  m.main.innerHTML = `
    <div id="scenario-diff-pane">
      <div id="scenario-diff-pickers">
        <span>Left:</span>
        <select id="scn-diff-a"></select>
        <span style="margin-left:18px;">Right:</span>
        <select id="scn-diff-b"></select>
        <span style="margin-left:18px; color:var(--muted);">Target:</span>
        <span style="font-family:monospace;">${escapeHtml(target)}</span>
      </div>
      <div id="scenario-diff-frames">
        <div class="pane">
          <div class="pane-label" id="scn-diff-a-label">left</div>
          <iframe id="scn-diff-a-frame" sandbox="allow-same-origin allow-scripts"></iframe>
        </div>
        <div class="pane">
          <div class="pane-label" id="scn-diff-b-label">right</div>
          <iframe id="scn-diff-b-frame" sandbox="allow-same-origin allow-scripts"></iframe>
        </div>
      </div>
      <div id="scenario-diff-text"><div class="row" style="color:var(--muted); font-style:italic;">Field-level differences appear here once both sides are picked.</div></div>
    </div>
  `;
  const selA = document.getElementById('scn-diff-a') as HTMLSelectElement;
  const selB = document.getElementById('scn-diff-b') as HTMLSelectElement;
  for (const s of scenariosState.list) {
    selA.appendChild(new Option(s.name, s.name));
    selB.appendChild(new Option(s.name, s.name));
  }
  selA.value = scenariosState.list[0].name;
  selB.value = scenariosState.list[1].name;

  const tgt = target; // capture for closure
  function rerender() {
    const a = scenariosState.list.find(x => x.name === selA.value);
    const b = scenariosState.list.find(x => x.name === selB.value);
    document.getElementById('scn-diff-a-label')!.textContent = a ? a.name : '—';
    document.getElementById('scn-diff-b-label')!.textContent = b ? b.name : '—';
    if (!a || !b) return;
    const tt = state.monacoModels[tgt] ? state.monacoModels[tgt].getValue() : state.files[tgt].content;
    const stash = scenariosState.activeOverrides;
    scenariosState.activeOverrides = a.valueByPath;
    const ahtml = buildPreviewHtml(tgt, tt, { withData: true });
    scenariosState.activeOverrides = b.valueByPath;
    const bhtml = buildPreviewHtml(tgt, tt, { withData: true });
    scenariosState.activeOverrides = stash;
    (document.getElementById('scn-diff-a-frame') as HTMLIFrameElement).srcdoc = ahtml;
    (document.getElementById('scn-diff-b-frame') as HTMLIFrameElement).srcdoc = bhtml;
    const out = document.getElementById('scenario-diff-text')!;
    out.innerHTML = '';
    const allKeys = new Set([...a.valueByPath.keys(), ...b.valueByPath.keys()]);
    let diffs = 0;
    for (const k of Array.from(allKeys).sort()) {
      const va = a.valueByPath.get(k) || '';
      const vb = b.valueByPath.get(k) || '';
      if (va === vb) continue;
      diffs++;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="field">${escapeHtml(k)}</span> <span class="a">${escapeHtml(va || '(empty)')}</span> → <span class="b">${escapeHtml(vb || '(empty)')}</span>`;
      out.appendChild(row);
    }
    if (!diffs) out.innerHTML = '<div class="row" style="color:var(--muted); font-style:italic;">No field-level differences between these scenarios.</div>';
  }
  selA.addEventListener('change', rerender);
  selB.addEventListener('change', rerender);
  rerender();
}

// Self-invoke at module load time.
configureScenarios();

hookOn('afterLoadFromHandle', async () => {
  try {
    if (!scenariosState.list.length) await autoLoadScenariosFromFolder();
    populateScenarioPicker();
  } catch (e) { console.warn('[scenarios] hook failed:', e); }
});

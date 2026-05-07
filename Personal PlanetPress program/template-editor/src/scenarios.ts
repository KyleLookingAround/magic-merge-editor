// Scenario state shell. Carved out of legacy.ts as part of Phase 5.
// scnPersistKey + parseScenarioXmlToMap carved out in Phase 6.
//
// A "scenario" is one of the SampleDataFiles/*.xml files inside an
// .OL-datamapper.  When active, its leaf-element path → text-content map
// overrides the datamodel's lastValue substitution in the preview so the
// same template can be tested against many inputs without leaving the editor.
//
// All orchestrators that mutate this state (loadScenarios, renderScenarioPicker,
// applyScenario, openScenarioDiff, etc.) still live in legacy.ts; this export
// is the first step of that migration.

import { state } from './state';
import { decodeBytes } from './fs';

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

export interface ScenarioDeps {
  setStatus: (msg: string, kind?: string) => void;
  refreshPreview: () => void;
}

let deps: ScenarioDeps = { setStatus: () => {}, refreshPreview: () => {} };

export function configureScenarios(d: ScenarioDeps): void { deps = d; }

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
  catch (e: any) { if (e.name !== 'AbortError') deps.setStatus('Pick failed: ' + e.message, 'err'); return; }
  try {
    const file = await handle.getFile();
    const zip = await JSZip.loadAsync(file);
    await readScenariosFromZip(zip, handle.name);
    scenariosState.sourceHandle = handle;
    populateScenarioPicker();
    deps.setStatus(`Loaded ${scenariosState.list.length} scenario${scenariosState.list.length === 1 ? '' : 's'} from ${handle.name}.`, 'ok');
  } catch (e: any) { deps.setStatus('Load failed: ' + e.message, 'err'); }
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
    deps.refreshPreview();
  }
  if (!silent) {
    deps.setStatus(scenariosState.active
      ? `Scenario: ${scenariosState.active}`
      : 'Scenario cleared (using datamodel lastValue)', 'ok');
  }
}

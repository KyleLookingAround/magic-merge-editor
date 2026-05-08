// Script form UI, CRUD operations, and associated event wiring.
// Carved out of legacy.ts in Phase 7.
//
// Exports:
//   configureScriptForm(deps) — call once from the IIFE to inject
//                               callbacks and wire all event listeners.
//   openScriptForm(id)        — open the overlay for a script.
//   closeScriptForm()         — close and restore the previous view.
//   applyScriptForm()         — flush form values into index.xml.
//   toggleScriptEnabled(id, enabled)
//   cloneScript(id)
//   moveScript(fromId, toId, position)
//   createScript(kind)
//   deleteScript(id)

import { state } from './state';
import { on as hookOn, emit as hookEmit } from './hooks';
import { extOf, indentAt, encodeXmlText } from './fs';
import { escapeHtml, refreshTreeDirtyMarkers } from './tree';
import { openContextMenu } from './context-menu';
import {
  scriptsState,
  ParsedScript,
  ScriptKind,
  ScriptForm,
  serializeScriptBack,
  buildNewScriptXml,
  dmTypeToFormType,
  renderScriptsList,
  refreshScriptsList,
  computeVisibleScripts,
} from './scripts-panel';

declare const monaco: any;

// ---- DOM helpers --------------------------------------------------------

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $inp = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

// ---- Injected dependencies ----------------------------------------------

export interface ScriptFormDeps {
  openFile: (path: string) => void;
  setStatus: (msg: string, kind?: string) => void;
  setSidebarMode: (mode: string) => void;
}

let deps: ScriptFormDeps = {
  openFile: () => {},
  setStatus: () => {},
  setSidebarMode: () => {},
};

// ---- Configure ----------------------------------------------------------

export function configureScriptForm(d: ScriptFormDeps): void {
  deps = d;

  // Startup wiring (DOM must be ready)
  bindFieldPathAutotype('sf-field-path', 'sf-field-type');
  bindFieldPathAutotype('sf-cond-field', 'sf-cond-field-type');
  bindFieldMetaLiveUpdate();

  // Form buttons
  $('sf-apply').addEventListener('click', applyScriptForm);

  $('script-form-view').addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      if (!$('script-form-view').classList.contains('show')) return;
      e.preventDefault();
      e.stopPropagation();
      if (scriptsState.active) applyScriptForm();
    }
  });

  $('sf-revert').addEventListener('click', () => {
    if (scriptsState.active) openScriptForm(scriptsState.active);
  });
  $('sf-close').addEventListener('click', closeScriptForm);
  $('sf-open-raw').addEventListener('click', () => {
    if (!scriptsState.hostPath) return;
    closeScriptForm();
    deps.openFile(scriptsState.hostPath);
    const s = scriptsState.list.find((x: ParsedScript) => x.id === scriptsState.active);
    if (s && state.monacoModels[scriptsState.hostPath]) {
      const text = state.monacoModels[scriptsState.hostPath].getValue() as string;
      const idx = text.indexOf(s._raw.slice(0, 60));
      if (idx >= 0) {
        const line = text.slice(0, idx).split('\n').length;
        state.editor.revealLineInCenter(line);
        state.editor.setPosition({ lineNumber: line, column: 1 });
        state.editor.focus();
      }
    }
  });

  // Scripts panel controls
  $('scripts-search').addEventListener('input', (e: Event) => {
    scriptsState.filter = (e.target as HTMLInputElement).value;
    renderScriptsList();
  });

  $('scripts-kind-chips').addEventListener('click', (e: MouseEvent) => {
    const chip = e.target instanceof Element ? e.target.closest('.chip') : null;
    if (!chip) return;
    const kind = (chip as HTMLElement).dataset.kind ?? 'ALL';
    scriptsState.kindFilter = kind as 'ALL' | ScriptKind;
    document.querySelectorAll('#scripts-kind-chips .chip').forEach(c => {
      c.classList.toggle('active', (c as HTMLElement).dataset.kind === kind);
    });
    renderScriptsList();
  });

  $('scripts-bulk-all').addEventListener('change', (e: Event) => {
    const visible = computeVisibleScripts();
    if ((e.target as HTMLInputElement).checked) {
      for (const s of visible) scriptsState.selected.add(s.id);
    } else {
      for (const s of visible) scriptsState.selected.delete(s.id);
    }
    renderScriptsList();
  });
  $('scripts-bulk-enable').addEventListener('click', () => bulkSetEnabled(true));
  $('scripts-bulk-disable').addEventListener('click', () => bulkSetEnabled(false));
  $('scripts-bulk-delete').addEventListener('click', () => bulkDelete());

  // Sidebar mode buttons (scripts + navigator)
  $('mode-scripts').addEventListener('click', () => deps.setSidebarMode('scripts'));
  $('mode-nav').addEventListener('click', () => deps.setSidebarMode('nav'));

  // "+ New script" picker
  $('btn-script-new').addEventListener('click', (e: MouseEvent) => {
    if (!scriptsState.hostPath) { deps.setStatus('Open a template first.', 'warn'); return; }
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu([
      { label: 'Field text script (FLD)', onClick: () => createScript('STANDARD') },
      { label: 'Control / JS script (JS)', onClick: () => createScript('CONTROL') },
    ], rect.left, rect.bottom + 4);
  });

  // Delete buttons
  $('sf-delete').addEventListener('click', () => {
    if (scriptsState.active) deleteScript(scriptsState.active);
  });
  $('btn-script-delete').addEventListener('click', () => {
    if (scriptsState.active) deleteScript(scriptsState.active);
  });

  // Keep toolbar delete button in sync with active script
  hookOn('afterOpenScriptForm', (...args: unknown[]) => {
    ($('btn-script-delete') as HTMLButtonElement).disabled = !args[0];
  });
  hookOn('afterCloseScriptForm', () => {
    ($('btn-script-delete') as HTMLButtonElement).disabled = true;
  });

  // Right-click on a script item → context menu
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const item = e.target instanceof Element ? e.target.closest('.script-item') : null;
    if (!item) return;
    e.preventDefault();
    const id = (item as HTMLElement).dataset.scriptId;
    if (!id) return;
    openContextMenu([
      { label: 'Open', onClick: () => openScriptForm(id) },
      { label: 'Duplicate', onClick: () => cloneScript(id) },
      { sep: true },
      { label: 'Delete script', danger: true, onClick: () => {
        scriptsState.active = id;
        deleteScript(id);
      }},
    ], e.clientX, e.clientY);
  });
}

// ---- Private helpers ----------------------------------------------------

function bindFieldPathAutotype(pathInputId: string, typeSelectId: string): void {
  const input = document.getElementById(pathInputId) as HTMLInputElement | null;
  const select = document.getElementById(typeSelectId);
  if (!input || !select) return;
  const handler = (): void => {
    const fields = scriptsState.datamodelFields || [];
    const match = fields.find(f => f.path === input.value);
    if (match) {
      const formType = dmTypeToFormType(match.type);
      if (formType) setSelectValue(typeSelectId, formType);
    }
  };
  input.addEventListener('change', handler);
  input.addEventListener('input', handler);
}

function bindFieldMetaLiveUpdate(): void {
  const cfg: [string, string, () => boolean][] = [
    ['sf-field-path', 'sf-field-meta', () => {
      const a = scriptsState.list.find(x => x.id === scriptsState.active);
      return !!(a && a.kind === 'TEXT');
    }],
    ['sf-cond-field', 'sf-cond-field-meta', () => {
      const a = scriptsState.list.find(x => x.id === scriptsState.active);
      return !!(a && a.kind === 'CONDITIONAL');
    }],
  ];
  for (const [pid, mid, isVis] of cfg) {
    const inp = document.getElementById(pid) as HTMLInputElement | null;
    if (!inp) continue;
    const handler = (): void => updateFieldMeta(mid, inp.value, isVis());
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
  }
}

function setSelectValue(id: string, value: string): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  if (!Array.from(sel.options).some(o => o.value === value)) {
    const o = document.createElement('option');
    o.value = value; o.textContent = value;
    sel.appendChild(o);
  }
  sel.value = value;
}

function ensureScriptSourceEditor(): void {
  if (scriptsState.sourceEditor || !state.monacoReady) return;
  const host = $('script-source-host');
  scriptsState.sourceEditor = monaco.editor.create(host, {
    value: '',
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 13,
    scrollBeyondLastLine: false,
  });
  (scriptsState.sourceEditor as any).addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => { if (scriptsState.active) applyScriptForm(); }
  );
}

function updateFieldMeta(elId: string, fieldPath: string, isVisible: boolean): void {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!isVisible || !fieldPath) {
    el.innerHTML = '';
    return;
  }
  const fields = scriptsState.datamodelFields || [];
  const match = fields.find(f => f.path === fieldPath);
  if (match) {
    const sample = match.lastValue == null || match.lastValue === ''
      ? '<span class="sample" style="font-style:italic;">(empty)</span>'
      : `<span class="sample">${escapeHtml(String(match.lastValue))}</span>`;
    el.innerHTML = `<span class="ok">✓ ${escapeHtml(match.type)}</span>${sample}`;
  } else if (fields.length) {
    el.innerHTML = `<span class="err">✗ Not found in datamodel</span>`;
  } else {
    el.innerHTML = `<span style="color:var(--muted);">(no datamodel loaded — can't validate)</span>`;
  }
}

function updateUsagesPanel(findText: string, selectorText: string): void {
  const el = $('sf-usages');
  const needles: { label: string; text: string }[] = [];
  const ft = (findText || '').trim();
  const st = (selectorText || '').trim();
  if (ft) needles.push({ label: 'findText', text: ft });
  if (st && st !== ft) needles.push({ label: 'selectorText', text: st });
  if (!needles.length) {
    el.innerHTML = '<div class="none">No findText or selectorText set on this script.</div>';
    return;
  }

  const byPath = new Map<string, { byNeedle: Record<string, number>; total: number }>();
  for (const [path, f] of Object.entries(state.files)) {
    if (!(f as { isText?: boolean }).isText) continue;
    if (path === scriptsState.hostPath) continue;
    const ext = extOf(path);
    if (!['html', 'htm', 'xml', 'xsl', 'xslt'].includes(ext)) continue;
    const text = state.monacoModels[path]
      ? (state.monacoModels[path] as { getValue(): string }).getValue()
      : (f as { content: string }).content;
    if (!text) continue;
    for (const n of needles) {
      let count = 0, idx = 0;
      while ((idx = text.indexOf(n.text, idx)) !== -1) { count++; idx += n.text.length; }
      if (count) {
        if (!byPath.has(path)) byPath.set(path, { byNeedle: {}, total: 0 });
        const e = byPath.get(path)!;
        e.byNeedle[n.text] = (e.byNeedle[n.text] || 0) + count;
        e.total += count;
      }
    }
  }

  if (!byPath.size) {
    const labels = needles.map(n => `<code>${escapeHtml(n.text)}</code>`).join(' or ');
    el.innerHTML = `<div class="none">No HTML/XML files reference ${labels}.</div>`;
    return;
  }

  const hits = [...byPath.entries()].map(([path, e]) => ({ path, byNeedle: e.byNeedle, total: e.total }));
  hits.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));

  const totalAll = hits.reduce((n, h) => n + h.total, 0);
  const filesAll = hits.length;
  const head = `<div class="head">${totalAll} occurrence${totalAll === 1 ? '' : 's'} across ${filesAll} file${filesAll === 1 ? '' : 's'} — searching: ${needles.map(n => `<code>${escapeHtml(n.text)}</code>`).join(' + ')}</div>`;

  el.innerHTML = head + hits.map(h => {
    const breakdown = needles.length > 1
      ? Object.entries(h.byNeedle).map(([t, c]) => `${escapeHtml(t)}×${c}`).join(', ')
      : `×${h.total}`;
    return `<div class="row" data-path="${escapeHtml(h.path)}">${escapeHtml(h.path)}<span class="count">${breakdown}</span></div>`;
  }).join('');

  el.querySelectorAll('.row').forEach(row => {
    row.addEventListener('click', () => {
      const p = (row as HTMLElement).dataset.path;
      if (!p) return;
      closeScriptForm();
      deps.openFile(p);
      setTimeout(() => {
        if (state.editor && state.monacoModels[p]) {
          const text = (state.monacoModels[p] as { getValue(): string }).getValue();
          let firstIdx = -1;
          for (const n of needles) {
            const i = text.indexOf(n.text);
            if (i >= 0 && (firstIdx === -1 || i < firstIdx)) firstIdx = i;
          }
          if (firstIdx >= 0) {
            const line = text.slice(0, firstIdx).split('\n').length;
            state.editor.revealLineInCenter(line);
            state.editor.setPosition({ lineNumber: line, column: 1 });
            state.editor.focus();
          }
        }
      }, 50);
    });
  });
}

function bulkSetEnabled(enabled: boolean): void {
  const visible = new Set(computeVisibleScripts().map(s => s.id));
  const ids = [...scriptsState.selected].filter(id => visible.has(id));
  if (!ids.length) return;
  if (!scriptsState.hostPath) return;
  const f = state.files[scriptsState.hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[scriptsState.hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  let text = model ? model.getValue() : f.content;
  let touched = 0;
  for (const id of ids) {
    const s = scriptsState.list.find(x => x.id === id);
    if (!s) continue;
    const idx = text.indexOf(s._raw);
    if (idx === -1) continue;
    const newRaw = s._raw.replace(
      /(<enabled>)[\s\S]*?(<\/enabled>)/,
      (_m, a: string, c: string) => `${a}${enabled ? 'true' : 'false'}${c}`
    );
    text = text.slice(0, idx) + newRaw + text.slice(idx + s._raw.length);
    touched++;
  }
  if (!touched) { deps.setStatus('Could not locate any selected scripts in index.xml.', 'err'); return; }
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }
  f.content = text;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();
  deps.setStatus(`${enabled ? 'Enabled' : 'Disabled'} ${touched} script${touched === 1 ? '' : 's'}. Click Review & Save to apply.`, 'ok');
}

function bulkDelete(): void {
  const visible = new Set(computeVisibleScripts().map(s => s.id));
  const ids = [...scriptsState.selected].filter(id => visible.has(id));
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} script${ids.length === 1 ? '' : 's'} from index.xml?\n\nThis removes the entire <script> blocks. Click Review & Save afterwards to write to disk.`)) return;
  if (!scriptsState.hostPath) return;
  const f = state.files[scriptsState.hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[scriptsState.hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  let text = model ? model.getValue() : f.content;
  const targets = ids.map(id => scriptsState.list.find(x => x.id === id)).filter((s): s is ParsedScript => !!s);
  let touched = 0;
  for (const s of targets) {
    const idx = text.indexOf(s._raw);
    if (idx === -1) continue;
    let start = idx;
    while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
    if (start > 0 && text[start - 1] === '\n') start--;
    text = text.slice(0, start) + text.slice(idx + s._raw.length);
    touched++;
  }
  if (!touched) { deps.setStatus('Could not locate any selected scripts in index.xml.', 'err'); return; }
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }
  f.content = text;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  if (scriptsState.active && ids.includes(scriptsState.active)) {
    scriptsState.active = null;
    $('script-form-view').classList.remove('show');
    if (state.currentPath) deps.openFile(state.currentPath);
  }
  refreshScriptsList();
  deps.setStatus(`Deleted ${touched} script${touched === 1 ? '' : 's'}. Click Review & Save to apply.`, 'ok');
}

function offerRenameTokenAcrossFiles(oldToken: string, newToken: string): void {
  if (!oldToken || !newToken || oldToken === newToken) return;
  const hits: { path: string; count: number }[] = [];
  let total = 0;
  for (const [path, f] of Object.entries(state.files)) {
    if (!(f as { isText?: boolean }).isText) continue;
    if (path === scriptsState.hostPath) continue;
    const ext = extOf(path);
    if (!['html', 'htm', 'xml', 'xsl', 'xslt'].includes(ext)) continue;
    const text = state.monacoModels[path]
      ? (state.monacoModels[path] as { getValue(): string }).getValue()
      : (f as { content: string }).content;
    if (!text) continue;
    let count = 0, idx = 0;
    while ((idx = text.indexOf(oldToken, idx)) !== -1) { count++; idx += oldToken.length; }
    if (count) { hits.push({ path, count }); total += count; }
  }
  if (!total) return;
  const summary = hits.map(h => `  ${h.path} (${h.count})`).join('\n');
  const ok = confirm(
    `findText changed:\n  ${oldToken}  →  ${newToken}\n\n` +
    `Found ${total} occurrence${total === 1 ? '' : 's'} of "${oldToken}" in ${hits.length} file${hits.length === 1 ? '' : 's'}:\n\n` +
    summary +
    `\n\nReplace every occurrence with "${newToken}"? (Click Review & Save afterwards to write to disk.)`
  );
  if (!ok) return;
  let touched = 0, replaced = 0;
  for (const h of hits) {
    const f = state.files[h.path] as { content: string; dirty: boolean } | undefined;
    if (!f) continue;
    const model = state.monacoModels[h.path] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
    const text = model ? model.getValue() : f.content;
    const updated = text.split(oldToken).join(newToken);
    if (updated === text) continue;
    if (model) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
    }
    f.content = updated;
    f.dirty = true;
    touched++;
    replaced += h.count;
  }
  refreshTreeDirtyMarkers();
  if (scriptsState.usagesCache && typeof scriptsState.usagesCache.invalidate === 'function') {
    scriptsState.usagesCache.invalidate();
  }
  refreshScriptsList();
  deps.setStatus(`Renamed token in ${touched} file${touched === 1 ? '' : 's'} (${replaced} occurrence${replaced === 1 ? '' : 's'}). Click Review & Save to apply.`, 'ok');
}

// ---- Script form --------------------------------------------------------

export function openScriptForm(id: string): void {
  const s = scriptsState.list.find(x => x.id === id);
  if (!s) return;
  scriptsState.active = id;

  $('editor').style.display = 'none';
  $('binary-view').classList.remove('show');
  $('script-form-view').classList.add('show');
  $('editor-tab').style.display = 'none';

  document.querySelectorAll('.script-item').forEach(el => el.classList.remove('active'));
  renderScriptsList();

  $('sf-title').textContent = s.name || '(unnamed script)';
  $('sf-sub').textContent = `${s.type || 'SCRIPT'} — in ${scriptsState.hostPath}`;
  $inp('sf-name').value = s.name;
  $inp('sf-find').value = s.findText;
  $inp('sf-enabled').checked = !!s.enabled;
  setSelectValue('sf-scope', s.scope || 'NONE');
  setSelectValue('sf-selector-type', s.selectorType || 'TEXT');
  $inp('sf-selector-text').value = s.selectorText;

  const stdSection = $('sf-standard-section');
  const condSection = $('sf-conditional-section');
  if (s.kind === 'TEXT') {
    stdSection.style.display = '';
    condSection.style.display = 'none';
    $inp('sf-field-path').value = s.fieldPath;
    setSelectValue('sf-field-type', s.fieldType || 'STRING');
    setSelectValue('sf-format-type', s.formatType || 'NONE');
    setSelectValue('sf-insert-method', s.insertMethod || 'HTML');
    $inp('sf-prefix').value = s.prefix;
    $inp('sf-suffix').value = s.suffix;
  } else if (s.kind === 'CONDITIONAL') {
    stdSection.style.display = 'none';
    condSection.style.display = '';
    $inp('sf-cond-field').value = s.condField || '';
    setSelectValue('sf-cond-field-type', s.condFieldType || 'STRING');
    setSelectValue('sf-condition', s.condition || 'EQUAL_TO');
    $inp('sf-cond-value').value = s.condValue || '';
    setSelectValue('sf-cond-action', s.condAction || 'SHOW');
    $inp('sf-cond-case').checked = !!s.condCaseInsensitive;
    $inp('sf-cond-toggle').checked = !!s.condToggleVisibility;
  } else {
    stdSection.style.display = 'none';
    condSection.style.display = 'none';
  }
  const kindLabel = s.kind === 'CONDITIONAL' ? 'STANDARD (conditional)'
    : s.kind === 'TEXT' ? 'STANDARD (field text)'
    : (s.type || '');
  $inp('sf-type').value = kindLabel;

  ensureScriptSourceEditor();
  const sourceEditor = scriptsState.sourceEditor as any;
  if (sourceEditor) {
    const oldModel = sourceEditor.getModel();
    const fresh = monaco.editor.createModel(s.source || '', 'javascript');
    sourceEditor.setModel(fresh);
    if (oldModel && oldModel !== fresh) {
      try { oldModel.dispose(); } catch { /* model may have been re-used elsewhere */ }
    }
  }

  updateFieldMeta('sf-field-meta', s.fieldPath, s.kind === 'TEXT');
  updateFieldMeta('sf-cond-field-meta', s.condField, s.kind === 'CONDITIONAL');
  updateUsagesPanel(s.findText, s.selectorText);

  ($('btn-save') as HTMLButtonElement).disabled = true;
  hookEmit('afterOpenScriptForm', id);
}

export function closeScriptForm(): void {
  $('script-form-view').classList.remove('show');
  scriptsState.active = null;
  if (state.currentPath) {
    deps.openFile(state.currentPath);
  } else {
    $('editor-tab').style.display = 'none';
    $('editor').style.display = 'none';
    $('binary-view').classList.remove('show');
    $('empty').classList.remove('hidden');
  }
  hookEmit('afterCloseScriptForm');
}

export function applyScriptForm(): void {
  const id = scriptsState.active;
  if (!id || !scriptsState.hostPath) return;
  const s = scriptsState.list.find(x => x.id === id);
  if (!s) return;

  const isText = s.kind === 'TEXT';
  const isCond = s.kind === 'CONDITIONAL';
  const $val = (elId: string): string => $inp(elId).value;
  const $chk = (elId: string): boolean => $inp(elId).checked;
  const sourceEditor = scriptsState.sourceEditor as any;
  const form: ScriptForm = {
    name: $val('sf-name'),
    findText: $val('sf-find'),
    enabled: $chk('sf-enabled'),
    scope: $val('sf-scope'),
    selectorType: $val('sf-selector-type'),
    selectorText: $val('sf-selector-text'),
    source: sourceEditor ? sourceEditor.getValue() : (s.source || ''),
    fieldPath: isText ? $val('sf-field-path') : s.fieldPath,
    fieldType: isText ? $val('sf-field-type') : s.fieldType,
    prefix: isText ? $val('sf-prefix') : s.prefix,
    suffix: isText ? $val('sf-suffix') : s.suffix,
    formatType: isText ? $val('sf-format-type') : s.formatType,
    insertMethod: isText ? $val('sf-insert-method') : s.insertMethod,
    isConditional: !!s.isConditional,
    condField: isCond ? $val('sf-cond-field') : s.condField,
    condFieldType: isCond ? $val('sf-cond-field-type') : s.condFieldType,
    condValue: isCond ? $val('sf-cond-value') : s.condValue,
    condition: isCond ? $val('sf-condition') : s.condition,
    condAction: isCond ? $val('sf-cond-action') : s.condAction,
    condCaseInsensitive: isCond ? $chk('sf-cond-case') : s.condCaseInsensitive,
    condToggleVisibility: isCond ? $chk('sf-cond-toggle') : s.condToggleVisibility,
  };

  const newRaw = serializeScriptBack(s, form);

  const hostPath = scriptsState.hostPath;
  const f = state.files[hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  const currentText = model ? model.getValue() : f.content;

  let start = -1, end = -1;
  if (s._start >= 0 && currentText.slice(s._start, s._end) === s._raw) {
    start = s._start; end = s._end;
  } else {
    const idx = currentText.indexOf(s._raw);
    if (idx >= 0) { start = idx; end = idx + s._raw.length; }
  }
  if (start === -1) {
    deps.setStatus('Could not locate the script in index.xml — file may have been edited externally.', 'err');
    return;
  }
  const updated = currentText.slice(0, start) + newRaw + currentText.slice(end);

  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
  }
  f.content = updated;
  f.dirty = true;
  refreshTreeDirtyMarkers();

  deps.setStatus(`Applied changes to "${form.name || 'script'}". Click Review & Save to write to disk.`, 'ok');

  const oldFind = (s.findText || '').trim();
  const newFind = (form.findText || '').trim();
  if (oldFind && newFind && oldFind !== newFind) {
    setTimeout(() => offerRenameTokenAcrossFiles(oldFind, newFind), 0);
  }

  refreshScriptsList();
  const reopen = scriptsState.list.find(x => x.name === form.name && x.findText === form.findText)
              || scriptsState.list.find(x => x.name === form.name);
  if (reopen) { scriptsState.active = reopen.id; openScriptForm(reopen.id); }
}

// ---- Script enable / disable --------------------------------------------

export function toggleScriptEnabled(id: string, enabled: boolean): void {
  const s = scriptsState.list.find(x => x.id === id);
  if (!s || !scriptsState.hostPath) return;
  const f = state.files[scriptsState.hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[scriptsState.hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  const currentText = model ? model.getValue() : f.content;
  const idx = currentText.indexOf(s._raw);
  if (idx === -1) {
    deps.setStatus('Could not locate script — please re-open the template.', 'err');
    return;
  }
  const newRaw = s._raw.replace(
    /(<enabled>)[\s\S]*?(<\/enabled>)/,
    (_m, a: string, c: string) => `${a}${enabled ? 'true' : 'false'}${c}`
  );
  const updated = currentText.slice(0, idx) + newRaw + currentText.slice(idx + s._raw.length);
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
  }
  f.content = updated;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();
  deps.setStatus(`Script "${s.name}" ${enabled ? 'enabled' : 'disabled'}. Click Review & Save to apply.`, 'ok');
}

// ---- Clone / move -------------------------------------------------------

export function cloneScript(id: string): void {
  const s = scriptsState.list.find(x => x.id === id);
  if (!s || !scriptsState.hostPath) return;
  const f = state.files[scriptsState.hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[scriptsState.hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  const currentText = model ? model.getValue() : f.content;
  const idx = currentText.indexOf(s._raw);
  if (idx === -1) {
    deps.setStatus('Could not locate script to clone.', 'err');
    return;
  }

  let nName = (s.name || 'Script') + '_copy';
  while (scriptsState.list.some(x => x.name === nName)) nName += '_copy';
  let nFind = s.findText;
  if (s.findText && /^@.+@$/.test(s.findText)) {
    nFind = '@' + nName + '@';
  }

  let copy = s._raw
    .replace(/(<name>)[\s\S]*?(<\/name>)/, (_m, a: string, c: string) => `${a}${encodeXmlText(nName)}${c}`)
    .replace(/(<findText>)[\s\S]*?(<\/findText>)/, (_m, a: string, c: string) => `${a}${encodeXmlText(nFind)}${c}`);
  if (!(/(<findText>)/.test(copy))) {
    copy = copy.replace(/<findText\s*\/>/, `<findText>${encodeXmlText(nFind)}</findText>`);
  }

  const indent = indentAt(currentText, idx);
  const insertOffset = idx + s._raw.length;
  const updated = currentText.slice(0, insertOffset) + '\n' + indent + copy + currentText.slice(insertOffset);

  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
  }
  f.content = updated;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();

  const newStart = insertOffset + 1 /* the \n */ + indent.length;
  const created = scriptsState.list.find(x => x._start === newStart)
              || [...scriptsState.list].reverse().find(x => x.name === nName);
  if (created) openScriptForm(created.id);
  deps.setStatus(`Cloned script as "${nName}". Click Review & Save to apply.`, 'ok');
}

export function moveScript(fromId: string, toId: string, position: 'before' | 'after'): void {
  if (!scriptsState.hostPath || fromId === toId) return;
  const src = scriptsState.list.find(x => x.id === fromId);
  const dst = scriptsState.list.find(x => x.id === toId);
  if (!src || !dst) return;
  const f = state.files[scriptsState.hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[scriptsState.hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  let text = model ? model.getValue() : f.content;

  const srcIdx = text.indexOf(src._raw);
  if (srcIdx === -1) { deps.setStatus('Could not locate the dragged script — please re-open the template.', 'err'); return; }

  let liftStart = srcIdx;
  while (liftStart > 0 && (text[liftStart - 1] === ' ' || text[liftStart - 1] === '\t')) liftStart--;
  if (liftStart > 0 && text[liftStart - 1] === '\n') liftStart--;
  const liftEnd = srcIdx + src._raw.length;
  const liftedChunk = text.slice(liftStart, liftEnd);
  text = text.slice(0, liftStart) + text.slice(liftEnd);

  const dstIdx = text.indexOf(dst._raw);
  if (dstIdx === -1) {
    text = text.slice(0, liftStart) + liftedChunk + text.slice(liftStart);
    deps.setStatus('Lost track of the drop target — reorder cancelled.', 'err');
    return;
  }
  let insertAt: number;
  if (position === 'before') {
    insertAt = dstIdx;
    while (insertAt > 0 && (text[insertAt - 1] === ' ' || text[insertAt - 1] === '\t')) insertAt--;
    if (insertAt > 0 && text[insertAt - 1] === '\n') insertAt--;
  } else {
    insertAt = dstIdx + dst._raw.length;
  }

  const indent = indentAt(text, dstIdx >= 0 ? dstIdx : insertAt);
  const stripped = liftedChunk.replace(/^\n[ \t]*/, '');
  const reindented = '\n' + indent + stripped;
  text = text.slice(0, insertAt) + reindented + text.slice(insertAt);

  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }
  f.content = text;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();
  deps.setStatus(`Moved "${src.name || '(unnamed)'}" ${position} "${dst.name || '(unnamed)'}". Click Review & Save to apply.`, 'ok');
}

// ---- Create / delete ----------------------------------------------------

export function createScript(kind: 'CONTROL' | 'STANDARD'): void {
  if (!scriptsState.hostPath) {
    deps.setStatus('Open a template first to create scripts.', 'warn');
    return;
  }
  const name = prompt(
    kind === 'CONTROL'
      ? 'Name for the new control script:'
      : 'Name for the new field script (this is also the @find@ token):',
    kind === 'CONTROL' ? 'New Control' : 'NewField'
  );
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) { deps.setStatus('Empty name.', 'warn'); return; }

  const hostPath = scriptsState.hostPath;
  const f = state.files[hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  const currentText = model ? model.getValue() : f.content;

  let anchor = scriptsState.list.find(s => s.type === kind);
  if (!anchor && kind === 'STANDARD') anchor = scriptsState.list.find(s => s.type !== 'CONTROL');
  if (!anchor && kind === 'CONTROL') anchor = scriptsState.list.find(s => s.type === 'CONTROL') || scriptsState.list[0];

  let insertOffset: number, indent: string;
  if (anchor) {
    const idx = currentText.indexOf(anchor._raw);
    if (idx === -1) {
      deps.setStatus("Couldn't locate a sibling script to anchor on. Edit raw index.xml manually.", 'err');
      return;
    }
    insertOffset = idx + anchor._raw.length;
    indent = indentAt(currentText, idx);
  } else {
    const close = currentText.indexOf('</scripts>');
    if (close === -1) {
      deps.setStatus('No <scripts> container found in index.xml.', 'err');
      return;
    }
    insertOffset = close;
    indent = indentAt(currentText, close);
  }

  const newScript = buildNewScriptXml(kind, trimmed, indent);
  const updated = currentText.slice(0, insertOffset) + '\n' + indent + newScript + currentText.slice(insertOffset);

  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
  }
  f.content = updated;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();

  const created = scriptsState.list.find(s => s.name === trimmed && s.type === kind);
  if (created) {
    scriptsState.active = created.id;
    openScriptForm(created.id);
  }
  deps.setStatus(`Added ${kind === 'CONTROL' ? 'control' : 'field'} script "${trimmed}". Click Review & Save to write to disk.`, 'ok');
}

export function deleteScript(id: string): void {
  const s = scriptsState.list.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`Delete script "${s.name || '(unnamed)'}" from index.xml?\n\nThis removes the entire <script> block.`)) return;

  const hostPath = scriptsState.hostPath;
  if (!hostPath) return;
  const f = state.files[hostPath] as { content: string; dirty: boolean } | undefined;
  if (!f) return;
  const model = state.monacoModels[hostPath] as { getValue(): string; getFullModelRange(): unknown; pushEditOperations(a: unknown[], b: unknown[], c: unknown): void } | undefined;
  const currentText = model ? model.getValue() : f.content;

  const idx = currentText.indexOf(s._raw);
  if (idx === -1) {
    deps.setStatus('Could not locate the script in index.xml — file may have changed.', 'err');
    return;
  }
  let start = idx;
  while (start > 0 && (currentText[start - 1] === ' ' || currentText[start - 1] === '\t')) start--;
  if (start > 0 && currentText[start - 1] === '\n') start--;
  const end = idx + s._raw.length;
  const updated = currentText.slice(0, start) + currentText.slice(end);

  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: updated }], () => null);
  }
  f.content = updated;
  f.dirty = true;
  refreshTreeDirtyMarkers();
  refreshScriptsList();

  if (scriptsState.active === id) {
    scriptsState.active = null;
    $('script-form-view').classList.remove('show');
    if (state.currentPath) deps.openFile(state.currentPath);
  }
  deps.setStatus(`Deleted script "${s.name || '(unnamed)'}". Click Review & Save to apply.`, 'ok');
}

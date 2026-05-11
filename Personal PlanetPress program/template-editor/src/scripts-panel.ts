// Pure parsers + serializers for the Scripts panel. Carved out of
// legacy.ts as the tenth and final Phase 3 module.
//
// Scope: the side-effect-free XML helpers that turn the host
// `index.xml` text into an in-memory script list and back. The
// orchestration around them (refreshScriptsList, renderScriptsList,
// openScriptForm / applyScriptForm, createScript / deleteScript /
// cloneScript / moveScript / bulk*, scenarios, notes, recent
// scripts, openCoverageMatrix / openScenarioDiff, the overlay form
// helpers and preset editor, and the navigator) all stay in
// legacy.ts: each reaches deep into scriptsState / scenariosState /
// state / DOM / setStatus, and most are wrapped by monkey-patches
// that span sections.

import { encodeXmlText, encodeXmlAttr, replaceTagInner, decodeXmlEntities, makeMemoCache, MemoCache, extOf } from './fs';
import { state } from './state';
import { emit as hookEmit } from './hooks';
import { escapeHtml } from './tree';
import { runSearch } from './search';
import { setStatus } from './status';

/** Filenames inside a template that may host the <script> blocks. */
export const SCRIPT_HOST_CANDIDATES: readonly string[] = ['index.xml'];

export type ScriptKind = 'TEXT' | 'CONDITIONAL' | 'CONTROL' | 'OTHER';

export interface ParsedScript {
  id: string;
  name: string;
  type: string;
  kind: ScriptKind;
  findText: string;
  enabled: boolean;
  scope: string;
  selectorText: string;
  selectorType: string;
  source: string;
  fieldPath: string;
  fieldType: string;
  prefix: string;
  suffix: string;
  formatType: string;
  insertMethod: string;
  isConditional: boolean;
  condField: string;
  condFieldType: string;
  condValue: string;
  condition: string;
  condAction: string;
  condCaseInsensitive: boolean;
  condToggleVisibility: boolean;
  _start: number;
  _end: number;
  _raw: string;
}

export interface ScriptForm {
  name: string;
  findText: string;
  enabled: boolean;
  scope: string;
  selectorType: string;
  selectorText: string;
  source: string;
  fieldPath: string;
  fieldType: string;
  prefix: string;
  suffix: string;
  formatType: string;
  insertMethod: string;
  isConditional: boolean;
  condField: string;
  condFieldType: string;
  condValue: string;
  condition: string;
  condAction: string;
  condCaseInsensitive: boolean;
  condToggleVisibility: boolean;
}

export interface DatamodelField {
  path: string;
  type: string;
  lastValue?: string;
}

/** Strip CDATA sections by replacing each one with same-length
 *  whitespace. Length parity matters: match offsets we pull off the
 *  blanked copy must still be valid offsets into the original text
 *  so `_raw` and `_start` stay in sync for splice-back later.
 *  Inside the blanked region, `<script>`-like sequences hiding in JS
 *  source no longer fool the outer regex. */
export function stripCdataKeepingOffsets(text: string): string {
  return text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, m => ' '.repeat(m.length));
}

/** Parse all `<script>...</script>` blocks from a chunk of XML text.
 *  Uses a regex on the raw text (rather than DOMParser) so the
 *  edited XML can later be spliced back into the file at the same
 *  byte offsets without disturbing whitespace, comments or
 *  namespaces around it. */
export function parseScriptsFromXml(xmlText: string): ParsedScript[] {
  const scripts: ParsedScript[] = [];
  const safe = stripCdataKeepingOffsets(xmlText);
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(safe)) !== null) {
    const fullStart = m.index;
    const fullEnd = re.lastIndex;
    const attrs = m[1] || '';
    // Use the original text for inner so CDATA contents are preserved.
    const rawChunk = xmlText.slice(fullStart, fullEnd);
    const openMatch = /^<script(\s[^>]*)?>/.exec(rawChunk);
    const inner = openMatch
      ? rawChunk.slice(openMatch[0].length, rawChunk.length - '<\/script>'.length)
      : m[2];
    const typeMatch = /\btype\s*=\s*"([^"]*)"/.exec(attrs);
    const type = typeMatch ? typeMatch[1] : '';

    function pluck(tag: string): string | null {
      const r = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`);
      const mm = r.exec(inner);
      return mm ? mm[1] : null;
    }
    function pluckEmpty(tag: string): string | null {
      if (new RegExp(`<${tag}\\s*/>`).test(inner)) return '';
      return pluck(tag);
    }
    const name = pluckEmpty('name') ?? '';
    const findText = pluckEmpty('findText') ?? '';
    const enabled = (pluckEmpty('enabled') || '').trim() !== 'false';
    const scope = (pluckEmpty('scope') || 'NONE').trim();
    const selectorText = pluckEmpty('selectorText') ?? '';
    const selectorType = (pluckEmpty('selectorType') || 'TEXT').trim();
    const source = pluckEmpty('source') ?? '';

    let fieldPath = '', fieldType = '', prefix = '', suffix = '';
    let formatType = 'NONE', insertMethod = 'HTML';
    const tsm = /<com\.objectiflune\.scripting\.text\.TextScriptModel[^>]*>([\s\S]*?)<\/com\.objectiflune\.scripting\.text\.TextScriptModel>/.exec(inner);
    if (tsm) {
      const tsmInner = tsm[1];
      const fp = /<path>([\s\S]*?)<\/path>/.exec(tsmInner);
      if (fp) fieldPath = fp[1];
      const ft = /<entry>[\s\S]*?<field>[\s\S]*?<type>([\s\S]*?)<\/type>/.exec(tsmInner);
      if (ft) fieldType = ft[1].trim();
      const pf = /<prefix>([\s\S]*?)<\/prefix>/.exec(tsmInner);
      if (pf) prefix = pf[1];
      const sf = /<suffix>([\s\S]*?)<\/suffix>/.exec(tsmInner);
      if (sf) suffix = sf[1];
      const fmt = /<format(?:\s+type="([^"]*)")?\s*\/?>/.exec(tsmInner);
      if (fmt && fmt[1]) formatType = fmt[1];
      const im = /<insertMethod>([\s\S]*?)<\/insertMethod>/.exec(tsmInner);
      if (im) insertMethod = im[1].trim();
      if (prefix === null && /<prefix\s*\/>/.test(tsmInner)) prefix = '';
      if (suffix === null && /<suffix\s*\/>/.test(tsmInner)) suffix = '';
    }

    let isConditional = false;
    let condField = '', condFieldType = '', condValue = '';
    let condition = 'EQUAL_TO', condAction = 'SHOW';
    let condCaseInsensitive = false, condToggleVisibility = true;
    const csm = /<com\.objectiflune\.scripting\.conditional\.ConditionalScriptModel[^>]*>([\s\S]*?)<\/com\.objectiflune\.scripting\.conditional\.ConditionalScriptModel>/.exec(inner);
    if (csm) {
      isConditional = true;
      const ci = csm[1];
      const cf = /<field>[\s\S]*?<path>([\s\S]*?)<\/path>/.exec(ci);
      if (cf) condField = cf[1];
      const cft = /<field>[\s\S]*?<type>([\s\S]*?)<\/type>/.exec(ci);
      if (cft) condFieldType = cft[1].trim();
      const cv = /<value>([\s\S]*?)<\/value>/.exec(ci);
      if (cv) condValue = cv[1];
      const cc = /<condition>([\s\S]*?)<\/condition>/.exec(ci);
      if (cc) condition = cc[1].trim();
      const ca = /<action>([\s\S]*?)<\/action>/.exec(ci);
      if (ca) condAction = ca[1].trim();
      const cci = /<caseInsensitive>([\s\S]*?)<\/caseInsensitive>/.exec(ci);
      if (cci) condCaseInsensitive = cci[1].trim() === 'true';
      const ctv = /<toggleVisibility>([\s\S]*?)<\/toggleVisibility>/.exec(ci);
      if (ctv) condToggleVisibility = ctv[1].trim() === 'true';
    }

    scripts.push({
      id: 'sc' + (idx++),
      name: decodeXmlEntities(name || ''),
      type,
      kind: isConditional ? 'CONDITIONAL' : (tsm ? 'TEXT' : (type === 'CONTROL' ? 'CONTROL' : 'OTHER')),
      findText: decodeXmlEntities(findText || ''),
      enabled,
      scope,
      selectorText: decodeXmlEntities(selectorText || ''),
      selectorType,
      source: decodeXmlEntities(source || ''),
      fieldPath,
      fieldType,
      prefix: decodeXmlEntities(prefix || ''),
      suffix: decodeXmlEntities(suffix || ''),
      formatType,
      insertMethod,
      isConditional,
      condField: decodeXmlEntities(condField || ''),
      condFieldType,
      condValue: decodeXmlEntities(condValue || ''),
      condition,
      condAction,
      condCaseInsensitive,
      condToggleVisibility,
      _start: fullStart,
      _end: fullEnd,
      // Original text for _raw - the safe-blanked copy would lose CDATA contents.
      _raw: rawChunk,
    });
  }
  return scripts;
}

/** Build the new `<script>...</script>` XML using the form values
 *  on top of the original raw chunk. The result is spliced back
 *  into the host file at the same byte offsets it came from. */
export function serializeScriptBack(orig: ParsedScript, form: ScriptForm): string {
  let raw = orig._raw;

  raw = replaceTagInner(raw, 'name', encodeXmlText(form.name));
  raw = replaceTagInner(raw, 'findText', encodeXmlText(form.findText));
  raw = replaceTagInner(raw, 'enabled', form.enabled ? 'true' : 'false');
  raw = replaceTagInner(raw, 'scope', encodeXmlText(form.scope));
  raw = replaceTagInner(raw, 'selectorType', encodeXmlText(form.selectorType));
  raw = replaceTagInner(raw, 'selectorText', encodeXmlText(form.selectorText));
  raw = replaceTagInner(raw, 'source', encodeXmlText(form.source));

  // TEXT script block (TextScriptModel).
  if (/TextScriptModel/.test(raw)) {
    raw = raw.replace(/(<field>\s*<path>)([\s\S]*?)(<\/path>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.fieldPath)}${c}`);
    raw = raw.replace(/(<field>[\s\S]*?<type>)([\s\S]*?)(<\/type>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.fieldType)}${c}`);
    raw = raw.replace(/<prefix\s*\/>/, '<prefix></prefix>');
    raw = raw.replace(/(<prefix>)([\s\S]*?)(<\/prefix>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.prefix)}${c}`);
    raw = raw.replace(/<suffix\s*\/>/, '<suffix></suffix>');
    raw = raw.replace(/(<suffix>)([\s\S]*?)(<\/suffix>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.suffix)}${c}`);
    raw = raw.replace(/<format(\s+type="[^"]*")?\s*\/>/, `<format type="${encodeXmlAttr(form.formatType || 'NONE')}"/>`);
    raw = raw.replace(/(<insertMethod>)([\s\S]*?)(<\/insertMethod>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.insertMethod)}${c}`);
  }

  // CONDITIONAL script block (ConditionalScriptModel).
  if (/ConditionalScriptModel/.test(raw) && form.isConditional) {
    raw = raw.replace(
      /(<com\.objectiflune\.scripting\.conditional\.ConditionalScriptModel[^>]*>[\s\S]*?<field>[\s\S]*?<path>)([\s\S]*?)(<\/path>)/,
      (_m, a, _b, c) => `${a}${encodeXmlText(form.condField)}${c}`,
    );
    raw = raw.replace(
      /(<com\.objectiflune\.scripting\.conditional\.ConditionalScriptModel[^>]*>[\s\S]*?<field>[\s\S]*?<type>)([\s\S]*?)(<\/type>)/,
      (_m, a, _b, c) => `${a}${encodeXmlText(form.condFieldType)}${c}`,
    );
    raw = raw.replace(/(<condition>)([\s\S]*?)(<\/condition>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.condition)}${c}`);
    raw = raw.replace(
      /(<com\.objectiflune\.scripting\.conditional\.ConditionalScriptModel[^>]*>[\s\S]*?<value>)([\s\S]*?)(<\/value>)/,
      (_m, a, _b, c) => `${a}${encodeXmlText(form.condValue)}${c}`,
    );
    raw = raw.replace(/(<action>)([\s\S]*?)(<\/action>)/, (_m, a, _b, c) => `${a}${encodeXmlText(form.condAction)}${c}`);
    raw = raw.replace(/(<caseInsensitive>)([\s\S]*?)(<\/caseInsensitive>)/, (_m, a, _b, c) => `${a}${form.condCaseInsensitive ? 'true' : 'false'}${c}`);
    raw = raw.replace(/(<toggleVisibility>)([\s\S]*?)(<\/toggleVisibility>)/, (_m, a, _b, c) => `${a}${form.condToggleVisibility ? 'true' : 'false'}${c}`);
  }

  return raw;
}

/** Build a fresh script block (TEXT or CONTROL) using `indent` as
 *  the leading whitespace of the surrounding sibling scripts. The
 *  caller passes its own DEFAULT_SCRIPT_INDENT so we don't need to
 *  duplicate that constant here. */
export function buildNewScriptXml(
  kind: 'CONTROL' | 'STANDARD',
  name: string,
  indent: string,
): string {
  const ind = indent;
  const nm = encodeXmlText(name || (kind === 'CONTROL' ? 'New Control' : 'NewField'));
  if (kind === 'CONTROL') {
    return [
      `<script type="CONTROL">`,
      `${ind}    <enabled>true</enabled>`,
      `${ind}    <findText></findText>`,
      `${ind}    <name>${nm}</name>`,
      `${ind}    <origin/>`,
      `${ind}    <scope>NONE</scope>`,
      `${ind}    <selectorText></selectorText>`,
      `${ind}    <selectorType>QUERY</selectorType>`,
      `${ind}    <source>// new control script</source>`,
      `${ind}<\/script>`,
    ].join('\n');
  }
  return [
    `<script type="STANDARD">`,
    `${ind}    <com.objectiflune.scripting.text.TextScriptModel schemaVersion="1.0.0.1">`,
    `${ind}        <entry>`,
    `${ind}            <field>`,
    `${ind}                <path>${nm}</path>`,
    `${ind}                <type>STRING</type>`,
    `${ind}            </field>`,
    `${ind}            <fieldFormatString>`,
    `${ind}                <type>NONE</type>`,
    `${ind}            </fieldFormatString>`,
    `${ind}            <format type="NONE"/>`,
    `${ind}            <prefix></prefix>`,
    `${ind}            <suffix></suffix>`,
    `${ind}        </entry>`,
    `${ind}        <attribute></attribute>`,
    `${ind}        <convertToJSON>false</convertToJSON>`,
    `${ind}        <insertMethod>HTML</insertMethod>`,
    `${ind}    </com.objectiflune.scripting.text.TextScriptModel>`,
    `${ind}    <enabled>true</enabled>`,
    `${ind}    <findText>@${nm}@</findText>`,
    `${ind}    <name>${nm}</name>`,
    `${ind}    <origin/>`,
    `${ind}    <scope>RESULT_SET</scope>`,
    `${ind}    <selectorText></selectorText>`,
    `${ind}    <selectorType>TEXT</selectorType>`,
    `${ind}    <source></source>`,
    `${ind}</script>`,
  ].join('\n');
}

/** Parse an `.OL-datamodel` XML body into a flat list of fields.
 *  Tables show up both as their own entry (type="table") and as a
 *  prefix on each child path (dotted notation). */
export function parseDatamodelFields(xmlText: string): DatamodelField[] {
  const out: DatamodelField[] = [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch (_) { return out; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === 'parsererror') return out;

  function walk(node: Element, prefix: string): void {
    for (const child of Array.from(node.children)) {
      const tag = child.localName || child.nodeName;
      if (tag === 'configs') {
        walk(child, prefix);
      } else if (tag === 'field') {
        const name = child.getAttribute('name');
        const type = child.getAttribute('type') || '';
        const lastValue = child.getAttribute('lastValue');
        if (name) out.push({ path: prefix + name, type, lastValue: lastValue == null ? '' : lastValue });
      } else if (tag === 'table') {
        const name = child.getAttribute('name');
        if (name) {
          out.push({ path: prefix + name, type: 'table' });
          walk(child, prefix + name + '.');
        }
      } else {
        // Unknown structural wrapper - recurse anyway.
        walk(child, prefix);
      }
    }
  }
  walk(root, '');
  return out;
}

/** Shared mutable state for the scripts panel.
 *
 *  Exported so legacy.ts can access it without needing a separate shell.
 *  None of the orchestrators that mutate this object have moved out of
 *  legacy.ts yet; this export is the first step of that migration.
 */
export interface ScriptsState {
  hostPath: string | null;
  list: ParsedScript[];
  active: string | null;
  sourceEditor: unknown | null;
  filter: string;
  kindFilter: 'ALL' | ScriptKind;
  selected: Set<string>;
  datamodelFields?: DatamodelField[];
  usagesCache: MemoCache<number>;
}

export const scriptsState: ScriptsState = {
  hostPath: null,
  list: [],
  active: null,
  sourceEditor: null,
  filter: '',
  kindFilter: 'ALL',
  selected: new Set(),
  usagesCache: makeMemoCache(),
};

/** Map a PlanetPress datamodel type string onto the script form's
 *  <select> options. Returns null for unknown types. */
export function dmTypeToFormType(dmType: string | null | undefined): string | null {
  const t = (dmType || '').toLowerCase();
  if (t === 'string') return 'STRING';
  if (t === 'boolean') return 'BOOLEAN';
  if (t === 'integer') return 'INTEGER';
  if (t === 'float' || t === 'number') return 'FLOAT';
  if (t === 'currency') return 'CURRENCY';
  if (t === 'date') return 'DATE';
  if (t === 'datetime') return 'DATETIME';
  if (t === 'time') return 'TIME';
  if (t === 'html' || t === 'htmlstring') return 'HTMLSTRING';
  if (t === 'object') return 'OBJECT';
  return null;
}

// ============================================================
// SCRIPTS-PANEL ORCHESTRATORS (carved from legacy.ts in Phase 6)
// ============================================================

/** Return the path of the first .OL-datamodel file found in the open template. */
export function findDatamodelPath(): string | null {
  for (const path of Object.keys(state.files)) {
    if (/\.OL-datamodel$/i.test(path)) return path;
  }
  return null;
}

/** Return true when a script references a field path that isn't present in the
 *  loaded datamodel. Returns false when no datamodel is loaded (can't validate). */
export function isScriptFieldInvalid(s: ParsedScript): boolean {
  const fields = scriptsState.datamodelFields;
  if (!fields || !fields.length) return false;
  const path = s.kind === 'TEXT' ? s.fieldPath
             : s.kind === 'CONDITIONAL' ? s.condField
             : null;
  if (!path) return false;
  return !fields.some(f => f.path === path);
}

/** Count how many times a script's findText / selectorText appears across the
 *  template's HTML and XML files. Result is memoised in scriptsState.usagesCache
 *  so renderScriptsList stays cheap. Returns -1 when not applicable. */
export function countScriptUsages(s: ParsedScript): number {
  if (!scriptsState.usagesCache || typeof scriptsState.usagesCache.getOrCompute !== 'function') {
    scriptsState.usagesCache = makeMemoCache();
  }
  return scriptsState.usagesCache.getOrCompute(s.id, () => {
    const needles: string[] = [];
    const ft = (s.findText || '').trim();
    const st = (s.selectorText || '').trim();
    if (ft) needles.push(ft);
    if (st && st !== ft) needles.push(st);
    if (!needles.length) return -1;
    let total = 0;
    for (const [path, f] of Object.entries(state.files)) {
      if (!(f as { isText?: boolean }).isText) continue;
      if (path === scriptsState.hostPath) continue;
      const ext = extOf(path);
      if (!['html', 'htm', 'xml', 'xsl', 'xslt'].includes(ext)) continue;
      const text = (state.monacoModels as Record<string, { getValue(): string }>)[path]
        ? (state.monacoModels as Record<string, { getValue(): string }>)[path].getValue()
        : (f as { content: string }).content;
      if (!text) continue;
      for (const n of needles) {
        let idx = 0;
        while ((idx = text.indexOf(n, idx)) !== -1) { total++; idx += n.length; }
      }
    }
    return total;
  });
}

/** Populate the #datamodel-fields <datalist> from the .OL-datamodel in the open
 *  template and store the parsed fields in scriptsState.datamodelFields. */
export function refreshDatamodelFields(): void {
  const list = document.getElementById('datamodel-fields');
  if (!list) return;
  list.innerHTML = '';
  const dmPath = findDatamodelPath();
  if (!dmPath) {
    scriptsState.datamodelFields = [];
    return;
  }
  const text = (state.monacoModels as Record<string, { getValue(): string }>)[dmPath]
    ? (state.monacoModels as Record<string, { getValue(): string }>)[dmPath].getValue()
    : (state.files[dmPath] as { content: string }).content;
  const fields = parseDatamodelFields(text);
  fields.sort((a, b) => a.path.localeCompare(b.path));
  for (const f of fields) {
    const opt = document.createElement('option');
    opt.value = f.path;
    if (f.type) opt.label = f.type;
    list.appendChild(opt);
  }
  scriptsState.datamodelFields = fields;
}

/** Re-parse index.xml, rebuild the in-memory script list, then emit
 *  'afterReparseScripts' so legacy.ts can call renderScriptsList(). */
export function refreshScriptsList(): void {
  scriptsState.list = [];
  scriptsState.hostPath = null;
  if (scriptsState.usagesCache && typeof scriptsState.usagesCache.invalidate === 'function') {
    scriptsState.usagesCache.invalidate();
  } else {
    scriptsState.usagesCache = makeMemoCache();
  }
  if (scriptsState.selected) scriptsState.selected.clear();
  for (const cand of SCRIPT_HOST_CANDIDATES) {
    const f = state.files[cand] as { isText?: boolean } | undefined;
    if (f && f.isText) {
      scriptsState.hostPath = cand;
      break;
    }
  }
  if (!scriptsState.hostPath) {
    hookEmit('afterReparseScripts');
    refreshDatamodelFields();
    return;
  }
  const text = (state.monacoModels as Record<string, { getValue(): string }>)[scriptsState.hostPath]
    ? (state.monacoModels as Record<string, { getValue(): string }>)[scriptsState.hostPath].getValue()
    : (state.files[scriptsState.hostPath] as { content: string }).content;
  scriptsState.list = parseScriptsFromXml(text);
  hookEmit('afterReparseScripts');
  refreshDatamodelFields();
}

// ============================================================
// SCRIPTS LIST RENDERER (carved from legacy.ts in Phase 6)
// ============================================================

export interface ScriptListDeps {
  openScriptForm: (id: string) => void;
  toggleScriptEnabled: (id: string, enabled: boolean) => void;
  moveScript: (fromId: string, toId: string, position: 'before' | 'after') => void;
  setSidebarMode: (mode: string) => void;
}

let listDeps: ScriptListDeps = {
  openScriptForm: () => {},
  toggleScriptEnabled: () => {},
  moveScript: () => {},
  setSidebarMode: () => {},
};

export function configureScriptsList(d: ScriptListDeps): void { listDeps = d; }

/** Shared in-flight drag-source id; reset in dragend. */
const scriptsDnd: { from: string | null } = { from: null };

/** Switch the sidebar to the Search panel and pre-fill the query input. */
function jumpToSearch(needle: string): void {
  listDeps.setSidebarMode('search');
  const inp = document.getElementById('search-input') as HTMLInputElement | null;
  if (!inp) return;
  inp.value = needle;
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  runSearch();
}

/** Re-filter scriptsState.list against the current filter/kindFilter without
 *  re-rendering. Used by bulk operations so they act only on visible scripts. */
export function computeVisibleScripts(): ParsedScript[] {
  const filter = (scriptsState.filter || '').toLowerCase();
  const kindFilter = scriptsState.kindFilter || 'ALL';
  return scriptsState.list.filter(s => {
    if (filter && !(s.name.toLowerCase().includes(filter) || (s.findText || '').toLowerCase().includes(filter))) return false;
    if (kindFilter !== 'ALL' && s.kind !== kindFilter) return false;
    return true;
  });
}

/** Sync the bulk-action bar's checkbox and button states with the current
 *  selection. Only counts scripts that are currently visible (filter-passing). */
export function updateBulkBar(visibleScripts: ParsedScript[]): void {
  const bar = document.getElementById('scripts-bulk-bar');
  if (!bar) return;
  const visIds = visibleScripts.map(s => s.id);
  const sel = scriptsState.selected || new Set<string>();
  let visibleSelected = 0;
  for (const id of visIds) if (sel.has(id)) visibleSelected++;
  const allCheckbox = document.getElementById('scripts-bulk-all') as HTMLInputElement | null;
  const countEl = document.getElementById('scripts-bulk-count');
  if (allCheckbox) {
    allCheckbox.checked = visIds.length > 0 && visibleSelected === visIds.length;
    allCheckbox.indeterminate = visibleSelected > 0 && visibleSelected < visIds.length;
    allCheckbox.disabled = visIds.length === 0;
  }
  if (countEl) countEl.textContent = visibleSelected ? `${visibleSelected} selected` : '0 selected';
  for (const id of ['scripts-bulk-enable', 'scripts-bulk-disable', 'scripts-bulk-delete']) {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = visibleSelected === 0;
  }
}

/** Re-render the #scripts-list DOM from scriptsState. */
export function renderScriptsList(): void {
  const list = document.getElementById('scripts-list')!;
  list.innerHTML = '';
  if (!scriptsState.hostPath) {
    list.innerHTML = '<div class="scripts-empty">Open a template (with index.xml) to list its scripts.</div>';
    updateBulkBar([]);
    return;
  }
  if (!scriptsState.list.length) {
    list.innerHTML = '<div class="scripts-empty">No &lt;script&gt; elements found in index.xml.</div>';
    updateBulkBar([]);
    return;
  }
  const filter = (scriptsState.filter || '').toLowerCase();
  const kindFilter = scriptsState.kindFilter || 'ALL';
  const groups: Record<string, ParsedScript[]> = { CONTROL: [], TEXT: [], CONDITIONAL: [], OTHER: [] };
  const visibleScripts: ParsedScript[] = [];
  for (const s of scriptsState.list) {
    if (filter && !(s.name.toLowerCase().includes(filter) || (s.findText || '').toLowerCase().includes(filter))) continue;
    if (kindFilter !== 'ALL' && s.kind !== kindFilter) continue;
    const g = s.kind === 'CONTROL' ? 'CONTROL'
            : s.kind === 'TEXT' ? 'TEXT'
            : s.kind === 'CONDITIONAL' ? 'CONDITIONAL'
            : 'OTHER';
    groups[g].push(s);
    visibleScripts.push(s);
  }
  const order: [string, string][] = [
    ['CONTROL', 'Control / JS'],
    ['TEXT', 'Field text (FLD)'],
    ['CONDITIONAL', 'Conditional (IF)'],
    ['OTHER', 'Other'],
  ];
  let total = 0;
  for (const [key, label] of order) {
    if (!groups[key].length) continue;
    const head = document.createElement('div');
    head.className = 'scripts-group';
    head.textContent = `${label}  (${groups[key].length})`;
    list.appendChild(head);
    for (const s of groups[key]) {
      total++;
      const invalid = isScriptFieldInvalid(s);
      const usageCount = invalid ? null : countScriptUsages(s);
      const unused = usageCount === 0;
      const isPicked = !!(scriptsState.selected && scriptsState.selected.has(s.id));
      const el = document.createElement('div');
      el.className = 'script-item'
        + (scriptsState.active === s.id ? ' active' : '')
        + (s.enabled ? '' : ' disabled')
        + (invalid ? ' invalid' : '')
        + (unused ? ' unused' : '');
      el.dataset.scriptId = s.id;
      el.draggable = true;
      const drag = `<span class="drag" title="Drag to reorder in &lt;scripts&gt;">⋮⋮</span>`;
      const pick = `<input type="checkbox" class="pick" title="Select for bulk actions" ${isPicked ? 'checked' : ''}>`;
      const badge = s.kind === 'CONDITIONAL' ? '<span class="badge cnd">IF</span>'
                  : s.kind === 'TEXT' ? '<span class="badge std">FLD</span>'
                  : s.kind === 'CONTROL' ? '<span class="badge ctl">JS</span>'
                  : `<span class="badge">${escapeHtml(s.type || '?')}</span>`;
      const find = s.findText ? `<span class="find">${escapeHtml(s.findText)}</span>` : '';
      const statusBadge = invalid
        ? '<span class="badge bad" title="Field path not in datamodel">!</span>'
        : (unused
            ? `<span class="badge unused" title="Click to search the template for this token (no usages found in HTML/XML files — searched findText${s.selectorText ? ' and selectorText' : ''})">?</span>`
            : '');
      const toggle = `<input type="checkbox" class="toggle" title="Enable / disable" ${s.enabled ? 'checked' : ''}>`;
      el.innerHTML = `${drag}${pick}${toggle}${badge}<span class="name">${escapeHtml(s.name || '(unnamed)')}</span>${find}${statusBadge}`;

      el.addEventListener('click', (ev: MouseEvent) => {
        const t = ev.target as Element | null;
        if (t && t.classList && (
          t.classList.contains('toggle') ||
          t.classList.contains('pick') ||
          t.classList.contains('drag') ||
          (t.classList.contains('badge') && t.classList.contains('unused'))
        )) return;
        listDeps.openScriptForm(s.id);
      });

      const toggleEl = el.querySelector('.toggle') as HTMLInputElement;
      toggleEl.addEventListener('click', (ev: Event) => ev.stopPropagation());
      toggleEl.addEventListener('change', () => listDeps.toggleScriptEnabled(s.id, toggleEl.checked));

      const pickEl = el.querySelector('.pick') as HTMLInputElement;
      pickEl.addEventListener('click', (ev: Event) => ev.stopPropagation());
      pickEl.addEventListener('change', () => {
        if (pickEl.checked) scriptsState.selected.add(s.id);
        else scriptsState.selected.delete(s.id);
        updateBulkBar(visibleScripts);
      });

      const unusedBadge = el.querySelector('.badge.unused') as HTMLElement | null;
      if (unusedBadge) {
        unusedBadge.addEventListener('click', (ev: Event) => {
          ev.stopPropagation();
          const needle = (s.findText || s.selectorText || '').trim();
          if (!needle) { setStatus('No findText / selectorText to search for.', 'warn'); return; }
          jumpToSearch(needle);
        });
      }

      el.addEventListener('dragstart', (ev: DragEvent) => {
        scriptsDnd.from = s.id;
        el.classList.add('dragging');
        try { ev.dataTransfer?.setData('text/plain', s.id); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; } catch (_) {}
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        document.querySelectorAll('.script-item.drop-before, .script-item.drop-after')
          .forEach(x => x.classList.remove('drop-before', 'drop-after'));
        scriptsDnd.from = null;
      });
      el.addEventListener('dragover', (ev: DragEvent) => {
        if (!scriptsDnd.from || scriptsDnd.from === s.id) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const before = (ev.clientY - rect.top) < (rect.height / 2);
        el.classList.toggle('drop-before', before);
        el.classList.toggle('drop-after', !before);
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drop-before', 'drop-after');
      });
      el.addEventListener('drop', (ev: DragEvent) => {
        if (!scriptsDnd.from || scriptsDnd.from === s.id) return;
        ev.preventDefault();
        const rect = el.getBoundingClientRect();
        const before = (ev.clientY - rect.top) < (rect.height / 2);
        const fromId = scriptsDnd.from;
        el.classList.remove('drop-before', 'drop-after');
        listDeps.moveScript(fromId, s.id, before ? 'before' : 'after');
      });

      list.appendChild(el);
    }
  }
  if (total === 0 && (filter || kindFilter !== 'ALL')) {
    const empty = document.createElement('div');
    empty.className = 'scripts-empty';
    empty.textContent = 'No scripts match the current filter.';
    list.appendChild(empty);
  }
  updateBulkBar(visibleScripts);
}

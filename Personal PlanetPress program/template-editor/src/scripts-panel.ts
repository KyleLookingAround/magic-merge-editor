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

import { encodeXmlText, encodeXmlAttr, replaceTagInner, decodeXmlEntities } from './fs';

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

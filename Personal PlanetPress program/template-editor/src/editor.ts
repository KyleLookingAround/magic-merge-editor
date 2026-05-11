// Pure editor utilities. Carved out of legacy.ts as the sixth Phase 3
// module.
//
// Phase 12: formatCurrent carved in here from legacy.ts. It reaches
// into Monaco state and calls setStatus, but has no other legacy deps.

import { state } from './state';
import { extOf } from './fs';
import { setStatus } from './status';

/* global monaco */
declare const monaco: any;

export interface XmlValidation { ok: boolean; error?: string; }

/** Parse `text` as XML (or HTML when `asHtml`) and return an
 *  ok/error result. Truncates the parser error message to a single
 *  line of <=240 chars - mirrors the original behaviour exactly. */
export function validateXml(text: string, asHtml = false): XmlValidation {
  try {
    const parser = new DOMParser();
    const mime = asHtml ? 'text/html' : 'application/xml';
    const doc = parser.parseFromString(text, mime);
    const errEl = doc.getElementsByTagName('parsererror')[0];
    if (errEl) {
      const msg = (errEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Pretty-print an XML document. CDATA, comments and processing
 *  instructions are stashed before reformatting and restored after,
 *  so the output is round-trip safe for the inputs the editor sees
 *  (PlanetPress index.xml, datamapper, presets). */
export function formatXml(xml: string): string {
  const stash: string[] = [];
  const protect = (re: RegExp) => {
    xml = xml.replace(re, m => { stash.push(m); return 'STASH' + (stash.length - 1) + 'HSATS'; });
  };
  protect(/<!\[CDATA\[[\s\S]*?\]\]>/g);
  protect(/<!--[\s\S]*?-->/g);
  protect(/<\?[\s\S]*?\?>/g);

  // Insert breaks between tags but keep text content tied to its tags.
  xml = xml.replace(/>\s+</g, '><');
  xml = xml.replace(/></g, '>\n<');

  const lines = xml.split('\n');
  let indent = 0;
  const indentStr = '  ';
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isClose = /^<\/[^>]+>$/.test(line);
    const isSelfClose = /<[^>]+\/>$/.test(line) || /^<[?!]/.test(line);
    const isInlineFull = /^<([^\s\/>]+)[^>]*>[\s\S]*<\/\1>$/.test(line); // <a>x</a>
    if (isClose) indent = Math.max(0, indent - 1);
    out.push(indentStr.repeat(indent) + line);
    if (!isClose && !isSelfClose && !isInlineFull && /^<[^\/!?]/.test(line)) indent++;
  }
  let result = out.join('\n');
  result = result.replace(/STASH(\d+)HSATS/g, (_, i) => stash[+i]);
  return result;
}

/** Pretty-print the currently-open file in Monaco (XML or JSON only). */
export function formatCurrent(): void {
  if (!state.currentPath) return;
  const f = state.files[state.currentPath];
  if (!f || !f.isText) return;
  const model = state.monacoModels[state.currentPath];
  if (!model) return;
  const text = model.getValue();
  const ext = extOf(state.currentPath);
  let out: string | null = null, label = '';
  try {
    if (ext === 'json') { out = JSON.stringify(JSON.parse(text), null, 2); label = 'JSON'; }
    else if (['xml','xsl','xslt','svg','config','html','htm','ol-datamodel','ol-jobpreset','ol-outputpreset','ol-script','ol-config'].includes(ext)) {
      out = formatXml(text); label = 'XML';
    } else { setStatus('No formatter for this file type.', 'warn'); return; }
  } catch (e: any) {
    setStatus('Format failed: ' + e.message, 'err');
    return;
  }
  if (out === text) { setStatus('Already formatted.', 'ok'); return; }
  const range = model.getFullModelRange();
  state.editor.executeEdits('format', [{ range, text: out }]);
  setStatus(`Formatted as ${label}.`, 'ok');
}

// Ctrl+Alt+L → format current file (runs at module load)
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'L' || e.key === 'l')) {
    e.preventDefault();
    formatCurrent();
  }
});

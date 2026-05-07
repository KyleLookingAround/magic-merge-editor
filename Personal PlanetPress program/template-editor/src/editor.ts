// Pure editor utilities. Carved out of legacy.ts as the sixth Phase 3
// module.
//
// Scope: just the side-effect-free helpers (validateXml, formatXml).
// The orchestrators (openFile, commitCurrentEdit, formatCurrent) stay
// in legacy.ts because they reach into Monaco / state / DOM and are
// wrapped by multiple cross-section monkey-patches that need to be
// converted to a hook system before they can move.

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

// File-system / bytes / XML primitives. Carved out of legacy.ts as the
// fourth Phase 3 module.
//
// Scope: pure helpers only. The handle-driven flows (pickAndOpenFile,
// pickAndOpenFolder, scanFolderTemplates, loadFromHandle, rezipAndSave)
// stay in legacy.ts because they're wrapped by multiple monkey-patches
// scattered across the file - those move out wholesale once their
// dependents (recents.openRecentItem, scenarios, notes, scripts panel)
// are themselves in modules.

export const TEXT_EXTS = new Set<string>([
  'xml','html','htm','js','mjs','css','json','txt','md','svg','xsl','xslt',
  'csv','tsv','yml','yaml','config','log','properties','ini',
  // PlanetPress / Connect XML formats
  'ol-datamodel','ol-jobpreset','ol-outputpreset','ol-script','ol-config',
]);

export const LANG_BY_EXT: Record<string, string> = {
  xml: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml', config: 'xml',
  html: 'html', htm: 'html',
  js: 'javascript', mjs: 'javascript',
  css: 'css',
  json: 'json',
  md: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  'ol-datamodel': 'xml', 'ol-jobpreset': 'xml', 'ol-outputpreset': 'xml',
  'ol-script': 'xml', 'ol-config': 'xml',
};

export const IMAGE_EXTS = new Set<string>(['png','jpg','jpeg','gif','bmp','webp','ico']);

// Top-level container files we treat as zip archives to unpack.
export const ZIP_EXTS = new Set<string>(['ol-template','ol-datamapper','zip']);

export function extOf(path: string): string {
  const m = /\.([^.\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function langFor(path: string): string { return LANG_BY_EXT[extOf(path)] || 'plaintext'; }
export function isTextPath(path: string): boolean { return TEXT_EXTS.has(extOf(path)); }
export function isImagePath(path: string): boolean { return IMAGE_EXTS.has(extOf(path)); }
export function isZipExt(path: string): boolean { return ZIP_EXTS.has(extOf(path)); }

// ---------- shared XML / text helpers ----------
// Round-trip safe: the encoder escapes the same five entities the
// decoder recognises (& < > " ').

export function decodeXmlEntities(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function encodeXmlText(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// encodeXmlText already escapes both quotes, so attr context is just text.
export function encodeXmlAttr(s: unknown): string { return encodeXmlText(s); }

// Find the indentation prefix on the line that contains a given absolute
// offset. Used by anything that splices text into another text and wants
// the new content to honour the surrounding indentation (clone/create/
// delete script, +New file dialog, format helpers).
export function indentAt(text: string, offset: number): string {
  let i = offset;
  while (i > 0 && text[i - 1] !== '\n') i--;
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
  return text.slice(i, j);
}

// Replace the inner text of a single top-level child tag inside a chunk.
// Preserves indentation; supports empty-element <tag/> by expanding it.
export function replaceTagInner(chunk: string, tag: string, newInner: string): string {
  const reFull = new RegExp(`(<${tag}(?:\\s[^>]*)?)>([\\s\\S]*?)(<\\/${tag}>)`);
  if (reFull.test(chunk)) {
    return chunk.replace(reFull, (_m, open, _old, close) => `${open}>${newInner}${close}`);
  }
  // self-closing: <tag/> -> <tag>X</tag>
  const reSelf = new RegExp(`<${tag}(\\s[^>]*)?\\s*/>`);
  if (reSelf.test(chunk)) {
    return chunk.replace(reSelf, (_m, attrs) => `<${tag}${attrs || ''}>${newInner}</${tag}>`);
  }
  return chunk; // tag absent - leave as-is
}

export interface MemoCache<V = unknown> {
  get(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V): V;
  getOrCompute(key: string, compute: () => V): V;
  invalidate(key?: string | null): void;
}

// Generic memoise-by-key cache. No auto-invalidation - callers invoke
// .invalidate() when underlying state changes.
export function makeMemoCache<V = unknown>(): MemoCache<V> {
  const store: Record<string, V> = Object.create(null);
  return {
    get(key) { return store[key]; },
    has(key) { return Object.prototype.hasOwnProperty.call(store, key); },
    set(key, value) { store[key] = value; return value; },
    getOrCompute(key, compute) {
      if (Object.prototype.hasOwnProperty.call(store, key)) return store[key];
      const v = compute();
      store[key] = v;
      return v;
    },
    invalidate(key) {
      if (key == null) {
        for (const k of Object.keys(store)) delete store[k];
      } else {
        delete store[key];
      }
    },
  };
}

// Sniff whether bytes look like text. Used as fallback for unknown extensions.
export function looksLikeText(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length === 0) return true;
  // ZIP / common binary magic
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) return false; // PK
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return false; // %PDF
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return false; // PNG
  const limit = Math.min(bytes.length, 4096);
  let nulls = 0;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) { nulls++; if (nulls > 1) return false; }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, limit));
    return true;
  } catch (_) {
    // Treat as text anyway if mostly printable - falls back to latin1 decode at load
    return true;
  }
}

// Try UTF-8 first; fall back to latin1.
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    return new TextDecoder('latin1').decode(bytes);
  }
}

// HTML-preview helpers. Carved out of legacy.ts as the ninth Phase 3
// module.
//
// Phase 6 second pass: previewState, revokePreviewBlobs, renderTokensStrip,
// scriptByToken, jumpToScriptByToken, attachTokenJumpHandlers, renderCssView,
// openPreviewNewTab migrated here.
//
// Phase 8: full preview pipeline migrated here — setPreviewMode, zoom
// controls, togglePreview, openPreview, closePreview, refreshPreview,
// buildPreviewHtml, applyDatamodelPersonalization.
//
import { state } from './state';
import { escapeHtml } from './tree';
import { extOf, decodeBytes } from './fs';
import { scriptsState } from './scripts-panel';
import { scenariosState } from './scenarios';
import { setStatus } from './status';
import { openScriptForm } from './script-form';

export interface ThemePaletteEntry { key: string; name: string; hex: string; }
export interface ThemeFontSlot { latin: string; ea: string; cs: string; }
export interface ThemeNamedStyle {
  id: string; name: string; type: string; font: string;
  sizePt: number; color: string; bold: boolean; italic: boolean;
}
export interface ThemeState {
  palette: ThemePaletteEntry[];
  fonts: { major: ThemeFontSlot; minor: ThemeFontSlot };
  styles: ThemeNamedStyle[];
}

export const themeState: ThemeState = {
  palette: [],
  fonts: { major: { latin: '', ea: '', cs: '' }, minor: { latin: '', ea: '', cs: '' } },
  styles: [],
};

/** Discrete zoom steps used by the preview's +/- controls. */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

/** Walk a parsed HTML Document and collect any `@name@`-shaped tokens
 *  that survived datamodel substitution. Skips text inside <script>
 *  and <style> elements, and inspects the standard token-bearing
 *  attributes (alt/title/href/src/value). Result is sorted ASC. */
export function collectUnresolvedTokens(doc: Document | null | undefined): string[] {
  if (!doc || !doc.body) return [];
  const re = /@[A-Za-z0-9_./\-]+@/g;
  const found = new Set<string>();
  // Text nodes (skip <script>/<style> - those aren't user-visible content).
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      if (n.parentNode && /^(SCRIPT|STYLE)$/i.test((n.parentNode as Element).nodeName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const v = (n as Text).nodeValue;
    if (!v) continue;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(v)) !== null) found.add(m[0]);
  }
  // Token-bearing attributes.
  doc.body.querySelectorAll('[alt],[title],[href],[src],[value]').forEach(el => {
    (['alt', 'title', 'href', 'src', 'value'] as const).forEach(attr => {
      if (!el.hasAttribute(attr)) return;
      const v = el.getAttribute(attr);
      if (!v) return;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(v)) !== null) found.add(m[0]);
    });
  });
  return Array.from(found).sort();
}

// ============================================================
// DOCX THEME ORCHESTRATORS (carved from legacy.ts in Phase 6)
// ============================================================

/** Read a file from the open zip by path, tolerating backslash/case variants. */
export function getZipText(path: string): string | null {
  let f = state.files[path] || state.files[path.replace(/\//g, '\\')];
  if (!f) {
    const wantLower = path.toLowerCase();
    const match = Object.keys(state.files).find(k =>
      k.toLowerCase() === wantLower ||
      k.toLowerCase().replace(/\\/g, '/') === wantLower);
    if (match) f = state.files[match];
  }
  if (!f) return null;
  return typeof f.content === 'string' ? f.content : decodeBytes(f.content);
}

/** Parse word/theme/theme1.xml + word/styles.xml into themeState. */
export function parseDocxTheme(): void {
  themeState.palette = [];
  themeState.fonts = { major: { latin: '', ea: '', cs: '' }, minor: { latin: '', ea: '', cs: '' } };
  themeState.styles = [];

  const themeXml = getZipText('word/theme/theme1.xml');
  if (themeXml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(themeXml, 'application/xml');
    const PALETTE_KEYS: [string, string][] = [
      ['dk1', 'Text 1 (dk1)'], ['lt1', 'Background 1 (lt1)'],
      ['dk2', 'Text 2 (dk2)'], ['lt2', 'Background 2 (lt2)'],
      ['accent1', 'Accent 1'], ['accent2', 'Accent 2'], ['accent3', 'Accent 3'],
      ['accent4', 'Accent 4'], ['accent5', 'Accent 5'], ['accent6', 'Accent 6'],
      ['hlink', 'Hyperlink'], ['folHlink', 'Followed hyperlink'],
    ];
    const scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
    if (scheme) {
      for (const [k, label] of PALETTE_KEYS) {
        const el = Array.from(scheme.children).find(c => c.localName === k);
        if (!el) continue;
        const srgb = Array.from(el.children).find(c => c.localName === 'srgbClr');
        const sys = Array.from(el.children).find(c => c.localName === 'sysClr');
        const hex = srgb ? srgb.getAttribute('val')
                  : sys  ? sys.getAttribute('lastClr')
                  : null;
        if (hex) themeState.palette.push({ key: k, name: label, hex: '#' + hex.toUpperCase() });
      }
    }
    const fontScheme = doc.getElementsByTagNameNS('*', 'fontScheme')[0];
    if (fontScheme) {
      for (const role of ['majorFont', 'minorFont'] as const) {
        const f = Array.from(fontScheme.children).find(c => c.localName === role);
        if (!f) continue;
        const slot = role === 'majorFont' ? 'major' : 'minor';
        for (const script of ['latin', 'ea', 'cs'] as const) {
          const el = Array.from(f.children).find(c => c.localName === script);
          if (el) themeState.fonts[slot][script] = el.getAttribute('typeface') || '';
        }
      }
    }
  }

  const stylesXml = getZipText('word/styles.xml');
  if (stylesXml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(stylesXml, 'application/xml');
    const styles = Array.from(doc.getElementsByTagNameNS('*', 'style'));
    const wAttr = (el: Element | null | undefined, name: string): string | null =>
      el ? (el.getAttribute('w:' + name) || el.getAttribute(name) || null) : null;
    for (const s of styles) {
      const type = wAttr(s, 'type') || '';
      const id = wAttr(s, 'styleId') || '';
      if (!['paragraph', 'character', 'table'].includes(type)) continue;
      const nameEl = Array.from(s.children).find(c => c.localName === 'name');
      const name = wAttr(nameEl, 'val') || id;
      const rPr = Array.from(s.children).find(c => c.localName === 'rPr');
      let font: string | null = null, sizePt: number | null = null;
      let color: string | null = null, bold = false, italic = false;
      if (rPr) {
        const rFonts = Array.from(rPr.children).find(c => c.localName === 'rFonts');
        if (rFonts) font = wAttr(rFonts, 'ascii') || wAttr(rFonts, 'hAnsi') || null;
        const sz = Array.from(rPr.children).find(c => c.localName === 'sz');
        if (sz) {
          const v = parseInt(wAttr(sz, 'val') ?? '', 10);
          if (!isNaN(v)) sizePt = v / 2;
        }
        const colorEl = Array.from(rPr.children).find(c => c.localName === 'color');
        if (colorEl) {
          const v = wAttr(colorEl, 'val');
          if (v && v !== 'auto') color = '#' + v.toUpperCase();
        }
        bold = !!Array.from(rPr.children).find(c => c.localName === 'b');
        italic = !!Array.from(rPr.children).find(c => c.localName === 'i');
      }
      themeState.styles.push({ id, name, type, font: font ?? '', sizePt: sizePt ?? 0, color: color ?? '', bold, italic });
    }
    const order: Record<string, number> = { paragraph: 0, character: 1, table: 2 };
    themeState.styles.sort((a, b) => {
      const t = (order[a.type] ?? 3) - (order[b.type] ?? 3);
      return t !== 0 ? t : a.name.localeCompare(b.name);
    });
  }
}

/** Render the Theme sidebar panel from themeState. */
export function renderThemePanel(): void {
  const host = document.getElementById('theme-content');
  if (!host) return;
  if (!state.isDocx) {
    host.innerHTML = '<div class="empty-msg">Open a .docx to view its theme.</div>';
    return;
  }
  parseDocxTheme();
  const parts: string[] = [];

  parts.push('<h3>Colour palette</h3>');
  if (themeState.palette.length) {
    parts.push('<div class="theme-swatches">');
    for (const c of themeState.palette) {
      parts.push(
        '<div class="theme-swatch" title="' + escapeHtml(c.key) + '">' +
        '<span class="chip" style="background:' + escapeHtml(c.hex) + '"></span>' +
        '<span class="label">' + escapeHtml(c.name) + '</span>' +
        '<span class="hex">' + escapeHtml(c.hex) + '</span>' +
        '</div>',
      );
    }
    parts.push('</div>');
  } else {
    parts.push('<div class="empty-msg">No colour scheme found in theme1.xml.</div>');
  }

  parts.push('<h3>Font scheme</h3>');
  parts.push('<div class="theme-fonts">');
  parts.push(
    '<div class="theme-font-row"><span class="role">Heading</span>' +
    '<span class="face">' + escapeHtml(themeState.fonts.major.latin || '—') + '</span></div>',
  );
  parts.push(
    '<div class="theme-font-row"><span class="role">Body</span>' +
    '<span class="face">' + escapeHtml(themeState.fonts.minor.latin || '—') + '</span></div>',
  );
  parts.push('</div>');

  parts.push('<h3>Named styles <span style="color:var(--muted);font-weight:normal;text-transform:none;letter-spacing:0;">(' + themeState.styles.length + ')</span></h3>');
  if (themeState.styles.length) {
    parts.push('<div class="theme-styles">');
    for (const s of themeState.styles) {
      const meta: string[] = [];
      if (s.font) meta.push(escapeHtml(s.font));
      if (s.sizePt) meta.push(s.sizePt + 'pt');
      if (s.color) meta.push('<span class="swatch-inline" style="background:' + escapeHtml(s.color) + '"></span>' + escapeHtml(s.color));
      if (s.bold) meta.push('bold');
      if (s.italic) meta.push('italic');
      meta.push(s.type);
      parts.push(
        '<div class="theme-style-row">' +
        '<span class="name">' + escapeHtml(s.name) + '</span>' +
        '<span class="id">' + escapeHtml(s.id) + '</span>' +
        '<span class="meta">' + meta.join(' · ') + '</span>' +
        '</div>',
      );
    }
    parts.push('</div>');
  } else {
    parts.push('<div class="empty-msg">No named styles found in styles.xml.</div>');
  }

  host.innerHTML = parts.join('');
}

/** Serialise themeState as a CSS block with custom properties + named-style classes. */
export function buildThemeCss(): string {
  if (!themeState.palette.length && !themeState.styles.length) return '';
  const lines: string[] = [];
  lines.push('/* Extracted from ' + (state.fileName || 'Word document') + ' */');
  lines.push(':root {');
  for (const c of themeState.palette) {
    lines.push('  --theme-' + c.key + ': ' + c.hex + ';');
  }
  if (themeState.fonts.major.latin) {
    lines.push('  --theme-font-heading: "' + themeState.fonts.major.latin + '";');
  }
  if (themeState.fonts.minor.latin) {
    lines.push('  --theme-font-body: "' + themeState.fonts.minor.latin + '";');
  }
  lines.push('}');
  if (themeState.styles.length) {
    lines.push('');
    lines.push('/* Named styles */');
    for (const s of themeState.styles) {
      const cls = '.style-' + s.id.replace(/[^A-Za-z0-9_-]/g, '-');
      const decls: string[] = [];
      if (s.font) decls.push('font-family: "' + s.font + '"');
      if (s.sizePt) decls.push('font-size: ' + s.sizePt + 'pt');
      if (s.color) decls.push('color: ' + s.color);
      if (s.bold) decls.push('font-weight: bold');
      if (s.italic) decls.push('font-style: italic');
      if (!decls.length) continue;
      lines.push(cls + ' { ' + decls.join('; ') + '; } /* ' + s.name + ' */');
    }
  }
  return lines.join('\n');
}

// ============================================================
// PREVIEW STATE + HELPERS (carved from legacy.ts in Phase 6)
// ============================================================

export interface CssBlock { label: string; css: string; bytes: number; }

export interface PreviewState {
  open: boolean;
  blobUrls: string[];
  htmlPath: string | null;
  zoom: number;
  mode: string;
  modeByPath: Record<string, string>;
  lastCss: string;
  lastCssBlocks: CssBlock[];
  lastDocxHtml: string;
  lastDocxHtmlFor: string | null;
  unresolved: string[];
  tokensDismissed: boolean;
}

export const previewState: PreviewState = {
  open: false,
  blobUrls: [],
  htmlPath: null,
  zoom: 1,
  mode: 'data',
  modeByPath: {},
  lastCss: '',
  lastCssBlocks: [],
  lastDocxHtml: '',
  lastDocxHtmlFor: null,
  unresolved: [],
  tokensDismissed: false,
};

/** Revoke all blob URLs created for the current preview to prevent leaks. */
export function revokePreviewBlobs(): void {
  for (const u of previewState.blobUrls) URL.revokeObjectURL(u);
  previewState.blobUrls = [];
}

// ============================================================
// PREVIEW PANEL HELPERS
// Deps for cross-panel navigation are injected via configurePreviewHelpers().
// ============================================================

export interface PreviewHelperDeps {
  setSidebarMode: (mode: string) => void;
}

let helperDeps: PreviewHelperDeps = {
  setSidebarMode: () => {},
};

export function configurePreviewHelpers(d: PreviewHelperDeps): void { helperDeps = d; }

/** Find the script whose findText exactly matches @token@. */
export function scriptByToken(token: string): import('./scripts-panel').ParsedScript | null {
  const list = scriptsState?.list ?? [];
  return list.find(s => s.findText === token) ?? null;
}

/** Switch the sidebar to Scripts mode and open the matching script's form. */
export function jumpToScriptByToken(token: string): void {
  const s = scriptByToken(token);
  if (!s) { setStatus('No script binds ' + token, 'warn'); return; }
  helperDeps.setSidebarMode('scripts');
  openScriptForm(s.id);
  setStatus('Jumped to script: ' + (s.name || token), 'ok');
}

/** Wire click handlers onto __cw_raw_token spans inside an iframe so users
 *  can jump from a token in the rendered preview straight to its script. */
export function attachTokenJumpHandlers(frame: HTMLIFrameElement): void {
  let doc: Document | null;
  try { doc = frame.contentDocument; } catch (_) { return; }
  if (!doc || !doc.body) return;
  doc.body.querySelectorAll('.__cw_raw_token').forEach(el => {
    const span = el as HTMLElement;
    if (span.dataset.cwBound === '1') return;
    span.dataset.cwBound = '1';
    span.style.cursor = 'pointer';
    span.title = 'Click: jump to the script that binds this token';
    span.addEventListener('click', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const token = span.textContent?.trim() ?? '';
      if (!token) return;
      jumpToScriptByToken(token);
    });
  });
}

/** Render (or hide) the unresolved-tokens strip above the preview. */
export function renderTokensStrip(): void {
  const strip = document.getElementById('preview-tokens-strip');
  const list = document.getElementById('preview-tokens-list');
  if (!strip || !list) return;
  const tokens = previewState.unresolved ?? [];
  const meaningful = (previewState.mode === 'data' || previewState.mode === 'split');
  if (!meaningful || !tokens.length || previewState.tokensDismissed) {
    strip.classList.remove('show');
    return;
  }
  list.innerHTML = '';
  for (const tok of tokens) {
    const chip = document.createElement('span');
    chip.className = 't-chip';
    chip.textContent = tok;
    const bound = scriptByToken(tok);
    if (bound) {
      chip.classList.add('has-script');
      chip.title = 'Jump to script: ' + (bound.name || tok);
      chip.addEventListener('click', () => jumpToScriptByToken(tok));
    } else {
      chip.title = 'No script binds this token — value is missing from the datamodel sample';
    }
    list.appendChild(chip);
  }
  strip.classList.add('show');
}

/** Render the cached merged CSS into the CSS tab with lightweight syntax
 *  highlighting and a per-source label. */
export function renderCssView(): void {
  const codeEl = document.getElementById('preview-css-code');
  const statsEl = document.getElementById('preview-css-stats');
  if (!codeEl || !statsEl) return;
  const blocks = previewState.lastCssBlocks ?? [];
  if (!blocks.length) {
    codeEl.innerHTML = '<span class="comment">/* No CSS found in this template. */</span>';
    statsEl.textContent = 'No CSS yet';
    return;
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function highlight(css: string): string {
    let s = esc(css);
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => 'C' + m + '');
    s = s.replace(/(@[-\w]+)/g, 'A$1');
    s = s.replace(/([^{};\n]+)\{/g, (_m, sel: string) => 'S' + sel + '{');
    s = s.replace(/([-\w]+)\s*:\s*([^;{}\n]+)([;}])/g, (_m, p: string, v: string, t: string) => 'P' + p + ':V' + v + '' + t);
    return s
      .replace(/C([\s\S]*?)/g, (_, x: string) => '<span class="comment">' + x + '</span>')
      .replace(/A([^]*)/g, (_, x: string) => '<span class="at">' + x + '</span>')
      .replace(/S([^]*)/g, (_, x: string) => '<span class="selector">' + x + '</span>')
      .replace(/P([^]*)/g, (_, x: string) => '<span class="prop">' + x + '</span>')
      .replace(/V([^]*)/g, (_, x: string) => '<span class="val">' + x + '</span>');
  }
  const html = blocks.map(b => {
    const head = '<span class="src-tag">/* ' + esc(b.label) + ' — ' + (b.bytes || 0) + ' bytes */</span>';
    return head + highlight(b.css);
  }).join('\n\n');
  codeEl.innerHTML = html;
  const totalBytes = blocks.reduce((s, b) => s + (b.bytes || 0), 0);
  statsEl.innerHTML =
    '<span class="pill">' + blocks.length + ' source' + (blocks.length === 1 ? '' : 's') + '</span>' +
    '<span class="pill">' + totalBytes.toLocaleString() + ' bytes</span>';
}

/** Open the current preview in a new browser tab. */
export function openPreviewNewTab(): void {
  if (!previewState.open || !state.currentPath) return;
  const text = (state.monacoModels as Record<string, { getValue(): string }>)[state.currentPath]
    ? (state.monacoModels as Record<string, { getValue(): string }>)[state.currentPath].getValue()
    : (state.files[state.currentPath] as { content?: string }).content ?? '';
  const withData = previewState.mode !== 'raw';
  const built = buildPreviewHtml(state.currentPath, text, { withData });
  const blob = new Blob([built], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ============================================================
// PREVIEW PIPELINE (carved from legacy.ts in Phase 8)
// ============================================================

export function setPreviewMode(mode: string): void {
  if (!['data', 'raw', 'split', 'css'].includes(mode)) return;
  previewState.mode = mode;
  previewState.tokensDismissed = false;

  document.getElementById('btn-pv-tab-data')!.classList.toggle('active', mode === 'data');
  document.getElementById('btn-pv-tab-raw')!.classList.toggle('active', mode === 'raw');
  document.getElementById('btn-pv-tab-split')!.classList.toggle('active', mode === 'split');
  document.getElementById('btn-pv-tab-css')!.classList.toggle('active', mode === 'css');
  const zoomCluster = document.querySelector('#preview-header .zoom-cluster') as HTMLElement | null;
  if (zoomCluster) zoomCluster.style.visibility = (mode === 'css') ? 'hidden' : 'visible';
  const frame = document.getElementById('preview-frame')!;
  const split = document.getElementById('preview-split')!;
  const cssView = document.getElementById('preview-css-view')!;
  frame.classList.toggle('hidden', mode !== 'data' && mode !== 'raw' && mode !== 'doc');
  split.classList.toggle('show', mode === 'split');
  cssView.classList.toggle('show', mode === 'css');
  if (previewState.open) refreshPreview();
}

export function stepZoom(dir: number): void {
  const cur = previewState.zoom;
  let idx = ZOOM_STEPS.findIndex(z => Math.abs(z - cur) < 0.001);
  if (idx === -1) {
    idx = ZOOM_STEPS.reduce((best, z, i) =>
      Math.abs(z - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? i : best, 0);
  }
  idx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir));
  setZoom(ZOOM_STEPS[idx]);
}

export function setZoom(z: number): void {
  previewState.zoom = z;
  (document.getElementById('preview-zoom-level') as HTMLElement).textContent = Math.round(z * 100) + '%';
  (document.getElementById('btn-preview-zoom-out') as HTMLButtonElement).disabled = z <= ZOOM_STEPS[0];
  (document.getElementById('btn-preview-zoom-in') as HTMLButtonElement).disabled = z >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  applyZoomToFrame();
}

export function applyZoomToFrame(): void {
  applyZoomToFrameEl(document.getElementById('preview-frame') as HTMLIFrameElement | null);
  if (previewState.mode === 'split') {
    applyZoomToFrameEl(document.getElementById('preview-frame-data') as HTMLIFrameElement | null);
    applyZoomToFrameEl(document.getElementById('preview-frame-raw') as HTMLIFrameElement | null);
  }
}

export function applyZoomToFrameEl(frame: HTMLElement | null): void {
  if (!frame) return;
  const iframeEl = frame as HTMLIFrameElement;
  let doc: Document | null;
  try { doc = iframeEl.contentDocument; } catch (_) { doc = null; }
  if (!doc || !doc.documentElement) return;
  let style = doc.getElementById('__cw_zoom__') as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style') as HTMLStyleElement;
    style.id = '__cw_zoom__';
    (doc.head || doc.documentElement).appendChild(style);
  }
  style.textContent = 'html { zoom: ' + previewState.zoom + '; }';
}

export function togglePreview(): void {
  if (previewState.open) closePreview();
  else openPreview();
}

export function openPreview(): void {
  if (!state.currentPath) return;
  const ext = extOf(state.currentPath);
  if (!['html', 'htm'].includes(ext)) {
    setStatus('Preview only supports HTML files.', 'warn');
    return;
  }
  previewState.open = true;
  document.getElementById('preview-pane')!.classList.add('show');
  (document.getElementById('preview-resizer') as HTMLElement).style.display = '';
  document.getElementById('btn-preview')!.classList.add('active');
  const restored = previewState.modeByPath[state.currentPath] || previewState.mode || 'data';
  setPreviewMode(restored);
}

export function closePreview(): void {
  previewState.open = false;
  document.getElementById('preview-pane')!.classList.remove('show');
  (document.getElementById('preview-resizer') as HTMLElement).style.display = 'none';
  document.getElementById('btn-preview')!.classList.remove('active');
  revokePreviewBlobs();
}

export function refreshPreview(): void {
  if (!previewState.open) return;
  if (previewState.mode === 'doc') {
    const frame = document.getElementById('preview-frame') as HTMLIFrameElement | null;
    if (frame) frame.srcdoc = '<div style="font:13px sans-serif;color:#888;padding:16px;line-height:1.5">Document preview was removed (mammoth.js was unreliable on these templates).<br><br>Use the <strong>Theme</strong> sidebar for colours, fonts, and styles, or open the .docx in Word directly.</div>';
    return;
  }
  let target: string | null = null;
  if (state.currentPath && ['html', 'htm'].includes(extOf(state.currentPath))) {
    target = state.currentPath;
  } else if (previewState.htmlPath && state.files[previewState.htmlPath]) {
    target = previewState.htmlPath;
  }
  if (!target) return;
  const text: string = state.monacoModels[target]
    ? state.monacoModels[target].getValue()
    : state.files[target].content;

  previewState.htmlPath = target;
  (document.getElementById('preview-title') as HTMLElement).textContent = target;
  previewState.modeByPath[target] = previewState.mode;

  const mode = previewState.mode;
  if (mode === 'css') {
    buildPreviewHtml(target, text, { withData: true });
    renderCssView();
    renderTokensStrip();
    return;
  }

  if (mode === 'split') {
    const builtData = buildPreviewHtml(target, text, { withData: true });
    const unresolvedFromData = previewState.unresolved.slice();
    const builtRaw = buildPreviewHtml(target, text, { withData: false });
    previewState.unresolved = unresolvedFromData;
    const fData = document.getElementById('preview-frame-data') as HTMLIFrameElement;
    const fRaw  = document.getElementById('preview-frame-raw') as HTMLIFrameElement;
    fData.onload = () => { applyZoomToFrameEl(fData); attachTokenJumpHandlers(fData); };
    fRaw.onload  = () => { applyZoomToFrameEl(fRaw);  attachTokenJumpHandlers(fRaw);  };
    fData.srcdoc = builtData;
    fRaw.srcdoc  = builtRaw;
    renderTokensStrip();
    return;
  }

  const withData = mode === 'data';
  const built = buildPreviewHtml(target, text, { withData });
  const frame = document.getElementById('preview-frame') as HTMLIFrameElement;
  frame.onload = () => { applyZoomToFrame(); attachTokenJumpHandlers(frame); };
  frame.srcdoc = built;
  renderTokensStrip();
}

/** Build a self-contained HTML string for the preview iframe from a zip entry.
 *  Rewrites asset references (CSS, images, scripts, fonts) to blob URLs so
 *  the sandboxed iframe can render them without file-system access. */
export function buildPreviewHtml(htmlPath: string, htmlText: string, opts?: { withData?: boolean }): string {
  const withData = opts?.withData !== false;
  revokePreviewBlobs();

  const htmlPathFwd = htmlPath.replace(/\\/g, '/');
  const baseDir = htmlPathFwd.includes('/')
    ? htmlPathFwd.substring(0, htmlPathFwd.lastIndexOf('/') + 1)
    : '';

  function normalizePath(p: string): string {
    const parts = p.replace(/\\/g, '/').split('/');
    const out: string[] = [];
    for (const part of parts) {
      if (part === '..') out.pop();
      else if (part !== '.' && part !== '') out.push(part);
    }
    return out.join('/');
  }

  function lookupZipKey(norm: string): string | null {
    if (state.files[norm]) return norm;
    const back = norm.replace(/\//g, '\\');
    if (state.files[back]) return back;
    return null;
  }

  function resolveZipPath(rel: string | null): string | null {
    if (!rel) return null;
    rel = rel.trim();
    if (/^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(rel)) return null;
    rel = rel.split('?')[0].split('#')[0];
    if (!rel) return null;
    rel = rel.replace(/\\/g, '/');
    if (rel.startsWith('/')) rel = rel.substring(1);
    else rel = baseDir + rel;
    return lookupZipKey(normalizePath(rel));
  }

  const mimeFor = (path: string): string => {
    const e = extOf(path);
    return ({
      css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
      json: 'application/json', html: 'text/html', htm: 'text/html',
      svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
      eot: 'application/vnd.ms-fontobject',
    } as Record<string, string>)[e] || 'application/octet-stream';
  };

  const blobCache = new Map<string, string>();
  function blobUrlFor(zipPath: string): string | null {
    if (blobCache.has(zipPath)) return blobCache.get(zipPath)!;
    const f = state.files[zipPath];
    if (!f) return null;
    const blob = new Blob([f.content], { type: mimeFor(zipPath) });
    const url = URL.createObjectURL(blob);
    blobCache.set(zipPath, url);
    previewState.blobUrls.push(url);
    return url;
  }

  function rewriteCss(css: string, cssDir: string): string {
    function resolveRelToCss(rel: string): string | null {
      if (!rel) return null;
      rel = rel.trim();
      if (/^(?:https?:|data:|blob:|\/\/)/i.test(rel)) return null;
      rel = rel.split('?')[0].split('#')[0];
      if (!rel) return null;
      rel = rel.replace(/\\/g, '/');
      const p = rel.startsWith('/') ? rel.substring(1) : (cssDir + rel);
      return lookupZipKey(normalizePath(p));
    }
    return css
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m: string, _q: string, url: string) => {
        const zp = resolveRelToCss(url);
        if (!zp) return _m;
        const burl = blobUrlFor(zp);
        return burl ? 'url("' + burl + '")' : _m;
      })
      .replace(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\)?/g, (_m: string, _q: string, url: string) => {
        const zp = resolveRelToCss(url);
        if (!zp) return _m;
        const f = state.files[zp];
        if (f && f.isText) {
          const zpFwd = zp.replace(/\\/g, '/');
          const subDir = zpFwd.includes('/') ? zpFwd.substring(0, zpFwd.lastIndexOf('/') + 1) : '';
          return rewriteCss(f.content, subDir);
        }
        const burl = blobUrlFor(zp);
        return burl ? '@import url("' + burl + '")' : _m;
      });
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const cssBlocks: CssBlock[] = [];

  doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(link => {
    const href = link.getAttribute('href');
    const zp = resolveZipPath(href);
    if (!zp) return;
    const f = state.files[zp];
    if (f && f.isText) {
      const zpFwd = zp.replace(/\\/g, '/');
      const cssDir = zpFwd.includes('/') ? zpFwd.substring(0, zpFwd.lastIndexOf('/') + 1) : '';
      const rewritten = rewriteCss(f.content, cssDir);
      const style = doc.createElement('style');
      style.setAttribute('data-from', zp);
      style.textContent = rewritten;
      link.replaceWith(style);
      cssBlocks.push({ label: zp + ' (linked stylesheet)', css: rewritten, bytes: rewritten.length });
    } else {
      const burl = blobUrlFor(zp);
      if (burl) link.setAttribute('href', burl);
    }
  });

  doc.querySelectorAll('style').forEach((s, i) => {
    if (s.getAttribute('data-from')) return;
    const rewritten = rewriteCss(s.textContent || '', baseDir);
    s.textContent = rewritten;
    cssBlocks.push({ label: htmlPath + ' <style #' + (i + 1) + '>', css: rewritten, bytes: rewritten.length });
  });

  doc.querySelectorAll('[style]').forEach(el => {
    el.setAttribute('style', rewriteCss(el.getAttribute('style') || '', baseDir));
  });

  doc.querySelectorAll('img[src]').forEach(img => {
    const zp = resolveZipPath(img.getAttribute('src'));
    if (zp) { const u = blobUrlFor(zp); if (u) img.setAttribute('src', u); }
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const rebuilt = srcset.split(',').map(part => {
        const tok = part.trim().split(/\s+/);
        const zp2 = resolveZipPath(tok[0]);
        if (zp2) { const u = blobUrlFor(zp2); if (u) tok[0] = u; }
        return tok.join(' ');
      }).join(', ');
      img.setAttribute('srcset', rebuilt);
    }
  });

  doc.querySelectorAll('source[src], video[src], audio[src]').forEach(el => {
    const zp = resolveZipPath(el.getAttribute('src'));
    if (zp) { const u = blobUrlFor(zp); if (u) el.setAttribute('src', u); }
  });

  doc.querySelectorAll('script[src]').forEach(s => {
    const zp = resolveZipPath(s.getAttribute('src'));
    if (!zp) return;
    const f = state.files[zp];
    if (f && f.isText) {
      const inline = doc.createElement('script');
      const t = s.getAttribute('type'); if (t) inline.setAttribute('type', t);
      inline.textContent = f.content;
      s.replaceWith(inline);
    } else {
      const u = blobUrlFor(zp);
      if (u) s.setAttribute('src', u);
    }
  });

  doc.querySelectorAll('link[href]:not([rel~="stylesheet"])').forEach(link => {
    const zp = resolveZipPath(link.getAttribute('href'));
    if (zp) { const u = blobUrlFor(zp); if (u) link.setAttribute('href', u); }
  });

  doc.querySelectorAll('object[data], embed[src], iframe[src]').forEach(el => {
    const attr = el.tagName.toLowerCase() === 'object' ? 'data' : 'src';
    const zp = resolveZipPath(el.getAttribute(attr));
    if (zp) { const u = blobUrlFor(zp); if (u) el.setAttribute(attr, u); }
  });

  doc.querySelectorAll('base').forEach(b => b.remove());

  const resolvedCount = withData ? applyDatamodelPersonalization(doc) : 0;
  previewState.unresolved = collectUnresolvedTokens(doc);

  const banner = doc.createElement('div');
  let bannerText: string, bannerBg: string, bannerFg: string, bannerBorder: string;
  if (!withData) {
    bannerText = 'Preview (Raw) — datamodel substitution disabled; @field@ tokens shown literally';
    bannerBg = '#e1edf7'; bannerFg = '#0a3a66'; bannerBorder = '#b6d4ee';
  } else if (resolvedCount > 0) {
    const scn = scenariosState?.active ?? null;
    if (scn) {
      bannerText = `Preview (With Data) — scenario "${scn}", ${resolvedCount} field${resolvedCount === 1 ? '' : 's'} resolved`;
      bannerBg = '#d1f0d4'; bannerFg = '#1f4d23'; bannerBorder = '#a8dcb0';
    } else {
      bannerText = `Preview (With Data) — ${resolvedCount} field${resolvedCount === 1 ? '' : 's'} resolved from datamodel sample values`;
      bannerBg = '#fff3cd'; bannerFg = '#664d03'; bannerBorder = '#ffecb5';
    }
  } else {
    bannerText = 'Preview (With Data) — open a template with a datamodel to resolve @field@ placeholders';
    bannerBg = '#fff3cd'; bannerFg = '#664d03'; bannerBorder = '#ffecb5';
  }
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:' + bannerBg + ';color:' + bannerFg + ';border-bottom:1px solid ' + bannerBorder + ';font:11px -apple-system,sans-serif;padding:4px 8px;z-index:99999;';
  banner.textContent = bannerText;
  if (doc.body) doc.body.insertBefore(banner, doc.body.firstChild);

  if (!withData && doc.body) {
    const tokenStyle = doc.createElement('style');
    tokenStyle.textContent =
      '/* injected by editor — highlight @field@ tokens in raw preview */\n' +
      '.__cw_raw_token { background:#fde68a; color:#7c2d12; padding:0 2px; border-radius:2px; }';
    if (doc.head) doc.head.appendChild(tokenStyle);
    const re = /@[A-Za-z0-9_./\-]+@/g;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    const targets: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n.parentNode && /^(SCRIPT|STYLE)$/i.test((n.parentNode as Element).nodeName)) continue;
      if (re.test((n as Text).nodeValue ?? '')) targets.push(n as Text);
      re.lastIndex = 0;
    }
    for (const t of targets) {
      const frag = doc.createDocumentFragment();
      let last = 0;
      const text = t.nodeValue ?? '';
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const span = doc.createElement('span');
        span.className = '__cw_raw_token';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      t.parentNode!.replaceChild(frag, t);
    }
  }

  previewState.lastCssBlocks = cssBlocks;
  previewState.lastCss = cssBlocks.map(b => '/* ' + b.label + ' */\n' + b.css).join('\n\n');

  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

/** Substitute @field@ placeholders and apply conditional show/hide rules
 *  from the script blocks in index.xml. Returns the count of distinct
 *  fields resolved. */
export function applyDatamodelPersonalization(doc: Document): number {
  const fields = scriptsState?.datamodelFields ?? [];
  const overrides = scenariosState?.activeOverrides ?? null;
  if (!fields.length && !overrides) return 0;
  if (!doc.body) return 0;

  const valueByPath = new Map<string, string>();
  for (const f of fields) valueByPath.set(f.path, f.lastValue == null ? '' : String(f.lastValue));
  if (overrides) {
    for (const [path, val] of overrides.entries()) valueByPath.set(path, val == null ? '' : String(val));
  }

  const tokenToValue = new Map<string, string>();
  const conditionals: import('./scripts-panel').ParsedScript[] = [];
  for (const s of scriptsState?.list ?? []) {
    if (s.kind === 'TEXT' && s.findText && s.fieldPath) {
      const v = valueByPath.has(s.fieldPath) ? valueByPath.get(s.fieldPath) : null;
      if (v != null) tokenToValue.set(s.findText, (s.prefix || '') + v + (s.suffix || ''));
    } else if (s.kind === 'CONDITIONAL' && s.condField && s.selectorType === 'QUERY' && s.selectorText) {
      conditionals.push(s);
    }
  }
  for (const [path, val] of valueByPath.entries()) {
    const token = '@' + path + '@';
    if (!tokenToValue.has(token)) tokenToValue.set(token, val);
  }

  if (!tokenToValue.size && !conditionals.length) return 0;

  const tokens = Array.from(tokenToValue.keys());
  if (tokens.length) {
    const escTokens = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('(' + escTokens.join('|') + ')', 'g');
    const replace = (text: string) => text.replace(re, m => tokenToValue.get(m) ?? m);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    const replacements: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if ((n as Text).nodeValue && re.test((n as Text).nodeValue!)) replacements.push(n as Text);
      re.lastIndex = 0;
    }
    for (const n of replacements) n.nodeValue = replace(n.nodeValue!);
    doc.body.querySelectorAll('[alt],[title],[href],[src],[value]').forEach(el => {
      (['alt', 'title', 'href', 'src', 'value'] as const).forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const v = el.getAttribute(attr);
        if (v && re.test(v)) { re.lastIndex = 0; el.setAttribute(attr, replace(v)); }
      });
    });
  }

  for (const s of conditionals) {
    const v = valueByPath.get(s.condField!);
    if (v == null) continue;
    let pass: boolean;
    const a = s.condCaseInsensitive ? String(v).toLowerCase() : String(v);
    const b = s.condCaseInsensitive ? String(s.condValue).toLowerCase() : String(s.condValue);
    switch (s.condition) {
      case 'EQUAL_TO':              pass = a === b; break;
      case 'NOT_EQUAL_TO':          pass = a !== b; break;
      case 'GREATER_THAN':          pass = parseFloat(a) >  parseFloat(b); break;
      case 'GREATER_THAN_OR_EQUAL': pass = parseFloat(a) >= parseFloat(b); break;
      case 'LESS_THAN':             pass = parseFloat(a) <  parseFloat(b); break;
      case 'LESS_THAN_OR_EQUAL':    pass = parseFloat(a) <= parseFloat(b); break;
      case 'CONTAINS':              pass = a.indexOf(b) !== -1; break;
      case 'STARTS_WITH':           pass = a.startsWith(b); break;
      case 'ENDS_WITH':             pass = a.endsWith(b); break;
      case 'IS_EMPTY':              pass = !a; break;
      case 'IS_NOT_EMPTY':          pass = !!a; break;
      default:                      pass = true;
    }
    const shouldShow = (s.condAction === 'SHOW') ? pass : !pass;
    let matches: NodeListOf<Element>;
    try { matches = doc.body.querySelectorAll(s.selectorText!); }
    catch (_) { continue; }
    matches.forEach(el => {
      if (s.condToggleVisibility !== false) {
        (el as HTMLElement).style.display = shouldShow ? '' : 'none';
      } else if (!shouldShow) {
        el.remove();
      }
    });
  }

  return tokenToValue.size;
}

// ============================================================
// PREVIEW BUTTON WIRING (runs at module load)
// ============================================================
(function wirePreviewButtons() {
  document.getElementById('btn-preview')!.addEventListener('click', togglePreview);
  document.getElementById('btn-preview-refresh')!.addEventListener('click', refreshPreview);
  document.getElementById('btn-preview-newtab')!.addEventListener('click', openPreviewNewTab);
  document.getElementById('btn-preview-close')!.addEventListener('click', closePreview);
  document.getElementById('btn-preview-zoom-in')!.addEventListener('click', () => stepZoom(1));
  document.getElementById('btn-preview-zoom-out')!.addEventListener('click', () => stepZoom(-1));
  document.getElementById('preview-zoom-level')!.addEventListener('click', () => setZoom(1));
  document.getElementById('btn-pv-tab-data')!.addEventListener('click', () => setPreviewMode('data'));
  document.getElementById('btn-pv-tab-raw')!.addEventListener('click', () => setPreviewMode('raw'));
  document.getElementById('btn-pv-tab-split')!.addEventListener('click', () => setPreviewMode('split'));
  document.getElementById('btn-pv-tab-css')!.addEventListener('click', () => setPreviewMode('css'));
  document.getElementById('btn-preview-css-copy')!.addEventListener('click', () => {
    const css = previewState.lastCss || '';
    if (!css) { setStatus('No CSS to copy yet.', 'warn'); return; }
    navigator.clipboard.writeText(css).then(
      () => setStatus('CSS copied to clipboard.', 'ok'),
      () => setStatus('Copy failed.', 'err'),
    );
  });
  document.getElementById('btn-preview-tokens-dismiss')!.addEventListener('click', () => {
    previewState.tokensDismissed = true;
    document.getElementById('preview-tokens-strip')!.classList.remove('show');
  });
  document.getElementById('preview-pane')!.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  document.getElementById('btn-theme-copy')!.addEventListener('click', () => {
    if (!state.isDocx) { setStatus('Open a .docx first.', 'warn'); return; }
    const css = buildThemeCss();
    if (!css) { setStatus('No theme data to copy.', 'warn'); return; }
    navigator.clipboard.writeText(css).then(
      () => setStatus('Theme CSS copied to clipboard.', 'ok'),
      () => setStatus('Copy failed.', 'err'),
    );
  });
})();

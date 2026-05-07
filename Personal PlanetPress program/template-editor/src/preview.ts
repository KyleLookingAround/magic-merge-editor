// HTML-preview helpers. Carved out of legacy.ts as the ninth Phase 3
// module.
//
// Phase 6 second pass: previewState, revokePreviewBlobs, renderTokensStrip,
// scriptByToken, jumpToScriptByToken, attachTokenJumpHandlers, renderCssView,
// openPreviewNewTab migrated here. The remaining orchestrators (togglePreview,
// openPreview, closePreview, refreshPreview, setPreviewMode, zoom controls,
// buildPreviewHtml, applyDatamodelPersonalization) still live in legacy.ts —
// they depend on the full preview open/close/refresh pipeline.
//
import { state } from './state';
import { escapeHtml } from './tree';
import { decodeBytes } from './fs';
import { scriptsState } from './scripts-panel';

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
  openScriptForm: (id: string) => void;
  setStatus: (msg: string, kind?: string) => void;
  buildPreviewHtml: (htmlPath: string, htmlText: string, opts?: { withData?: boolean }) => string;
}

let helperDeps: PreviewHelperDeps = {
  setSidebarMode: () => {},
  openScriptForm: () => {},
  setStatus: () => {},
  buildPreviewHtml: () => '',
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
  if (!s) { helperDeps.setStatus('No script binds ' + token, 'warn'); return; }
  helperDeps.setSidebarMode('scripts');
  helperDeps.openScriptForm(s.id);
  helperDeps.setStatus('Jumped to script: ' + (s.name || token), 'ok');
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
  const built = helperDeps.buildPreviewHtml(state.currentPath, text, { withData });
  const blob = new Blob([built], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

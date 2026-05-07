// HTML-preview helpers. Carved out of legacy.ts as the ninth Phase 3
// module.
//
// Scope is intentionally narrow for now: just the pure helpers that
// don't depend on legacy-resident state shells (scriptsState,
// scenariosState, themeState, blob caches). The orchestrators
// (togglePreview, openPreview, closePreview, refreshPreview,
// buildPreviewHtml, parseDocxTheme, renderThemePanel, buildThemeCss,
// applyDatamodelPersonalization, the zoom controls and token-jump
// handlers) all stay in legacy.ts and will move once the scripts
// panel is itself a module.

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

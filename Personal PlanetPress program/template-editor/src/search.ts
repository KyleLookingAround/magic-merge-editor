// Cross-file search rendering. Carved out of legacy.ts as the
// seventh Phase 3 module.
//
// Scope: just the result-rendering helpers (`appendSearchFile`,
// `renderSnippet`). The toggle (`setSidebarMode`), the search
// driver (`runSearch`) and the script-panel jump (`jumpToSearch`)
// stay in legacy.ts for now - they reach into the scripts panel,
// scenario picker, theme panel and navigator, none of which have
// been carved yet.
//
// `openFile` is supplied via configureSearch so this module never
// imports back into legacy.ts.

import { state } from './state';
import { escapeHtml } from './tree';

export interface SearchHit {
  lineNo: number;
  lineText: string;
  col: number;
}

export interface SearchDeps {
  openFile: (path: string) => void;
}

let deps: SearchDeps = { openFile: () => {} };

export function configureSearch(d: SearchDeps): void { deps = d; }

export function appendSearchFile(
  container: HTMLElement,
  path: string,
  hits: SearchHit[],
  pattern: RegExp,
): void {
  const head = document.createElement('div');
  head.className = 'search-file';
  head.textContent = `${path}  (${hits.length})`;
  head.style.cursor = 'pointer';
  head.addEventListener('click', () => deps.openFile(path));
  container.appendChild(head);
  for (const hit of hits) {
    const el = document.createElement('div');
    el.className = 'search-hit';
    el.title = hit.lineText.trim();
    const lineno = `<span class="lineno">${hit.lineNo}:</span>`;
    const snippet = renderSnippet(hit.lineText, pattern);
    el.innerHTML = lineno + snippet;
    el.addEventListener('click', () => {
      deps.openFile(path);
      // After Monaco loads/sets the model, position the cursor.
      setTimeout(() => {
        if (state.editor && state.monacoModels[path]) {
          state.editor.revealLineInCenter(hit.lineNo);
          state.editor.setPosition({ lineNumber: hit.lineNo, column: hit.col + 1 });
          state.editor.focus();
        }
      }, 50);
    });
    container.appendChild(el);
  }
}

/** Render a single line of search context with the matches highlighted.
 *  Long lines (>200 chars) are trimmed around the first match. */
export function renderSnippet(line: string, pattern: RegExp): string {
  let trimmed = line;
  pattern.lastIndex = 0;
  const m = pattern.exec(line);
  let prefix = '';
  if (line.length > 200 && m) {
    const start = Math.max(0, m.index - 30);
    if (start > 0) prefix = '…';
    trimmed = line.slice(start, start + 200);
  }
  pattern.lastIndex = 0;
  // `trimmed` is HTML-escaped first, so `mm` substrings are already safe to
  // embed directly — double-escaping here would corrupt display of entities.
  const escaped = escapeHtml(trimmed).replace(
    new RegExp(pattern.source, pattern.flags),
    (mm: string) => `<mark>${mm}</mark>`,
  );
  return prefix + escaped;
}

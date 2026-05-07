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

// ============================================================
// SEARCH DRIVER (carved from legacy.ts in Phase 6)
// ============================================================

/** Run a full cross-file search using the current values of the search input
 *  and its three checkboxes. Populates #search-results and #search-summary. */
export function runSearch(): void {
  const q = (document.getElementById('search-input') as HTMLInputElement).value;
  const resultsEl = document.getElementById('search-results')!;
  const summary = document.getElementById('search-summary')!;
  resultsEl.innerHTML = '';
  if (!q) { summary.textContent = ''; return; }

  const caseSensitive = (document.getElementById('search-case') as HTMLInputElement).checked;
  const useRegex = (document.getElementById('search-regex') as HTMLInputElement).checked;
  const wholeWord = (document.getElementById('search-word') as HTMLInputElement).checked;

  let pattern: RegExp;
  try {
    let src = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) src = `\\b(?:${src})\\b`;
    pattern = new RegExp(src, caseSensitive ? 'g' : 'gi');
  } catch (e) {
    summary.textContent = 'Bad regex: ' + (e as Error).message;
    return;
  }

  let totalHits = 0; let filesHit = 0;
  const MAX_HITS_PER_FILE = 50;
  const MAX_TOTAL = 1000;

  const paths = Object.keys(state.files).sort();
  for (const path of paths) {
    const f = state.files[path] as { isText?: boolean; content?: string };
    if (!f.isText) continue;
    const text = (state.monacoModels as Record<string, { getValue(): string }>)[path]
      ? (state.monacoModels as Record<string, { getValue(): string }>)[path].getValue()
      : (f.content ?? '');
    if (!text) continue;

    const hits: { lineNo: number; col: number; lineText: string }[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = pattern.exec(line)) !== null) {
        hits.push({ lineNo: i + 1, col: mm.index, lineText: line });
        if (mm.index === pattern.lastIndex) pattern.lastIndex++;
        if (hits.length >= MAX_HITS_PER_FILE) break;
      }
    }
    if (!hits.length) continue;
    filesHit++;
    totalHits += hits.length;
    appendSearchFile(resultsEl, path, hits, pattern);
    if (totalHits >= MAX_TOTAL) {
      const more = document.createElement('div');
      more.className = 'search-hit';
      more.textContent = `… stopped at ${MAX_TOTAL} matches`;
      resultsEl.appendChild(more);
      break;
    }
  }
  summary.textContent = totalHits
    ? `${totalHits} match${totalHits === 1 ? '' : 'es'} in ${filesHit} file${filesHit === 1 ? '' : 's'}`
    : 'No matches';
}

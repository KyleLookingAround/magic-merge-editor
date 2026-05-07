// Navigator panel — sections/masters/snippets from index.xml.
// Carved from legacy.ts in Phase 6.
//
// parseNavigatorEntries, renderNavigator, normalizeNavPath moved here.
// openFile and setStatus are injected via configureNavigator().

import { state } from './state';
import { escapeHtml } from './tree';
import { decodeXmlEntities } from './fs';
import { scriptsState } from './scripts-panel';

export interface NavEntry { id: string; name: string; location: string; }
export interface NavigatorGroups {
  masters: NavEntry[];
  sections: NavEntry[];
  snippets: NavEntry[];
}

export interface NavigatorDeps {
  openFile: (path: string) => void;
  setStatus: (msg: string, kind?: string) => void;
}

let deps: NavigatorDeps = { openFile: () => {}, setStatus: () => {} };

export function configureNavigator(d: NavigatorDeps): void { deps = d; }

/** Normalize a path found in index.xml (may use forward or back slashes) to
 *  whichever form exists in state.files. Returns the input if neither variant
 *  is found. */
export function normalizeNavPath(p: string): string {
  if (!p) return '';
  if (state.files[p]) return p;
  const back = p.replace(/\//g, '\\');
  if (state.files[back]) return back;
  const fwd = p.replace(/\\/g, '/');
  if (state.files[fwd]) return fwd;
  return p;
}

/** Parse masters/sections/snippets entries from index.xml. */
export function parseNavigatorEntries(): NavigatorGroups {
  const out: NavigatorGroups = { masters: [], sections: [], snippets: [] };
  if (!scriptsState.hostPath) return out;
  const text = (state.monacoModels as Record<string, { getValue(): string }>)[scriptsState.hostPath]
    ? (state.monacoModels as Record<string, { getValue(): string }>)[scriptsState.hostPath].getValue()
    : ((state.files[scriptsState.hostPath] as { content?: string } | undefined)?.content ?? '');
  if (!text) return out;

  function pluck(parentTag: string, childTag: string, key: keyof NavigatorGroups): void {
    const m = new RegExp(`<${parentTag}>([\\s\\S]*?)<\\/${parentTag}>`).exec(text);
    if (!m) return;
    const inner = m[1];
    const re = new RegExp(`<${childTag}\\s+id="([^"]*)"[^>]*>([\\s\\S]*?)<\\/${childTag}>`, 'g');
    let cm: RegExpExecArray | null;
    while ((cm = re.exec(inner)) !== null) {
      const body = cm[2];
      const nameM = /<name>([\s\S]*?)<\/name>/.exec(body);
      const locM = /<location>([\s\S]*?)<\/location>/.exec(body);
      out[key].push({
        id: cm[1],
        name: nameM ? decodeXmlEntities(nameM[1]) : '(unnamed)',
        location: locM ? decodeXmlEntities(locM[1]) : '',
      });
    }
  }
  pluck('masters', 'master', 'masters');
  pluck('sections', 'section', 'sections');
  pluck('snippets', 'snippet', 'snippets');
  return out;
}

/** Render the Navigator sidebar panel from index.xml data. */
export function renderNavigator(): void {
  const list = document.getElementById('nav-list');
  if (!list) return;
  list.innerHTML = '';
  if (!scriptsState.hostPath) {
    list.innerHTML = '<div class="scripts-empty">Open a template (with index.xml) to see its sections.</div>';
    return;
  }
  const groups = parseNavigatorEntries();
  const total = groups.masters.length + groups.sections.length + groups.snippets.length;
  if (!total) {
    list.innerHTML = '<div class="scripts-empty">No sections, masters, or snippets found in index.xml.</div>';
    return;
  }
  const order: [keyof NavigatorGroups, string, string][] = [
    ['sections', 'Sections', '📄'],
    ['masters', 'Master pages', '📑'],
    ['snippets', 'Snippets', '🧩'],
  ];
  for (const [key, label, ico] of order) {
    const items = groups[key];
    if (!items.length) continue;
    const head = document.createElement('div');
    head.className = 'nav-group';
    head.textContent = `${label}  (${items.length})`;
    list.appendChild(head);
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'nav-item' + (state.currentPath && state.currentPath === normalizeNavPath(it.location) ? ' active' : '');
      el.innerHTML = `<span class="ico">${ico}</span><span class="name">${escapeHtml(it.name)}</span>`;
      el.title = it.location;
      el.addEventListener('click', () => {
        const p = normalizeNavPath(it.location);
        if (state.files[p]) {
          deps.openFile(p);
          renderNavigator();
        } else {
          deps.setStatus(`Not found in package: ${p}`, 'warn');
        }
      });
      list.appendChild(el);
    }
  }
}

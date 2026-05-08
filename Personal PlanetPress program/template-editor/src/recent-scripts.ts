// Recently-edited scripts strip. Carved out of legacy.ts in Phase 10.
//
// Persists a per-template list of the most recently opened scripts in
// localStorage and injects a "Recent" group at the top of the scripts panel
// after every reparse. Registered hooks:
//   - `afterOpenScriptForm`: push the just-opened script to the front of the
//     list and re-render so the strip reflects the change.
//   - `afterLoadFromHandle`: reload the list for the new template.
//   - `afterReparseScripts`: inject the "Recent" group above the scripts list.
//
// Phase 10 also de-duped a stray second `afterReparseScripts` handler that did
// the same DOM injection — the old `legacy.ts` had two copies of the recent-
// group rendering body, idempotent but wasteful. Now there's one.
import { state } from './state';
import { on as hookOn } from './hooks';
import { scriptsState, renderScriptsList } from './scripts-panel';
import { openScriptForm } from './script-form';
import { escapeHtml } from './tree';

interface RecentScript {
  name: string;
  findText: string;
  ts: number;
}

interface RecentScriptsState {
  list: RecentScript[];
  max: number;
}

export const recentScriptsState: RecentScriptsState = {
  list: [],
  max: 8,
};

function recentScriptsKey(): string {
  return 'cw_recent_scripts:' + (state.fileName || '');
}

export function loadRecentScripts(): void {
  try {
    const raw = localStorage.getItem(recentScriptsKey());
    recentScriptsState.list = raw ? JSON.parse(raw) : [];
  } catch (_) { recentScriptsState.list = []; }
}

export function saveRecentScripts(): void {
  try { localStorage.setItem(recentScriptsKey(), JSON.stringify(recentScriptsState.list)); } catch (_) {}
}

export function pushRecentScript(s: { name?: string; findText?: string } | null | undefined): void {
  if (!s || !s.name) return;
  const entry: RecentScript = { name: s.name, findText: s.findText || '', ts: Date.now() };
  recentScriptsState.list = [entry, ...recentScriptsState.list.filter(x => x.name !== s.name)].slice(0, recentScriptsState.max);
  saveRecentScripts();
}

function injectRecentGroup(): void {
  if (!recentScriptsState.list.length) return;
  const list = document.getElementById('scripts-list');
  if (!list) return;
  // Avoid duplicates if the hook is re-run quickly
  const existing = list.querySelector('.scripts-group[data-recent="1"]');
  if (existing) existing.remove();
  list.querySelectorAll('.script-item[data-recent="1"]').forEach(el => el.remove());

  const head = document.createElement('div');
  head.className = 'scripts-group';
  head.dataset.recent = '1';
  head.textContent = `Recent  (${recentScriptsState.list.length})`;
  list.insertBefore(head, list.firstChild);

  let prev: Element = head;
  for (const r of recentScriptsState.list) {
    const found = scriptsState.list.find((x: any) => x.name === r.name);
    const el = document.createElement('div');
    el.className = 'script-item' + (found ? '' : ' disabled');
    el.dataset.recent = '1';
    const ago = Math.max(0, Date.now() - r.ts);
    const mins = Math.floor(ago / 60000);
    const when = mins < 1 ? 'just now' : (mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago');
    el.innerHTML = `<span class="badge">${escapeHtml(when)}</span><span class="name">${escapeHtml(r.name)}</span>${r.findText ? `<span class="find">${escapeHtml(r.findText)}</span>` : ''}`;
    el.title = found ? 'Open this script' : 'Script no longer present in this template';
    if (found) el.addEventListener('click', () => openScriptForm(found.id));
    prev.parentNode!.insertBefore(el, prev.nextSibling);
    prev = el;
  }
}

export function configureRecentScripts(): void {
  hookOn('afterOpenScriptForm', (...args: unknown[]) => {
    const id = args[0] as string;
    const s = scriptsState.list.find((x: any) => x.id === id);
    if (s) {
      pushRecentScript(s);
      try { renderScriptsList(); } catch (_) {}
    }
  });
  hookOn('afterLoadFromHandle', () => {
    loadRecentScripts();
    try { renderScriptsList(); } catch (_) {}
  });
  hookOn('afterReparseScripts', injectRecentGroup);
  loadRecentScripts();
}

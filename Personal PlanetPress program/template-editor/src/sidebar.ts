// Sidebar mode switcher. Carved out of legacy.ts in Phase 8.
// Handles all sidebar panel modes: files, nav, scripts, search, theme, notes.
// Replaces both the original setSidebarMode function and the patchSidebarMode
// IIFE that bolted on 'notes' mode support via monkey-patching.
//
// Phase 9: notes loader is now imported directly from ./notes (matching the
// pattern used for refreshScriptsList / renderNavigator / renderThemePanel),
// dropping the old configureSidebar({ onNotes }) dependency-injection seam.
import { refreshScriptsList } from './scripts-panel';
import { renderNavigator } from './navigator';
import { renderThemePanel } from './preview';
import { loadNotesForCurrentTemplate } from './notes';

export function setSidebarMode(mode: string): void {
  const isFiles   = mode === 'files';
  const isNav     = mode === 'nav';
  const isScripts = mode === 'scripts';
  const isSearch  = mode === 'search';
  const isTheme   = mode === 'theme';
  const isNotes   = mode === 'notes';

  document.getElementById('mode-files')!.classList.toggle('active', isFiles);
  const navBtn = document.getElementById('mode-nav');
  if (navBtn) navBtn.classList.toggle('active', isNav);
  const scriptsBtn = document.getElementById('mode-scripts');
  if (scriptsBtn) scriptsBtn.classList.toggle('active', isScripts);
  const themeBtn = document.getElementById('mode-theme');
  if (themeBtn) themeBtn.classList.toggle('active', isTheme);
  document.getElementById('mode-search')!.classList.toggle('active', isSearch);
  const notesBtn = document.getElementById('mode-notes');
  if (notesBtn) notesBtn.classList.toggle('active', isNotes);

  document.getElementById('tree')!.style.display = isFiles ? '' : 'none';
  const fileToolbar = document.getElementById('file-toolbar');
  if (fileToolbar) fileToolbar.style.display = isFiles ? '' : 'none';

  const navPanel = document.getElementById('nav-panel');
  if (navPanel) navPanel.classList.toggle('show', isNav);
  const scriptsPanel = document.getElementById('scripts-panel');
  if (scriptsPanel) scriptsPanel.classList.toggle('show', isScripts);
  document.getElementById('search-panel')!.classList.toggle('show', isSearch);
  const themePanel = document.getElementById('theme-panel');
  if (themePanel) themePanel.classList.toggle('show', isTheme);
  const notesPanel = document.getElementById('notes-panel');
  if (notesPanel) notesPanel.classList.toggle('show', isNotes);

  if (isSearch) document.getElementById('search-input')!.focus();
  if (isScripts) {
    refreshScriptsList();
    document.getElementById('scripts-search')!.focus();
  }
  if (isNav) renderNavigator();
  if (isTheme) renderThemePanel();
  if (isNotes) loadNotesForCurrentTemplate();
}

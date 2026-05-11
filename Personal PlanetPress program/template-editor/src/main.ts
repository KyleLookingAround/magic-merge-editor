// Entry point — Phase 13 final form.
// All logic has been carved into focused modules. This file:
//   1. Imports side-effect modules (styles, layout, event wiring in each module).
//   2. Calls the remaining configure() functions that wire cross-module DI seams.
//   3. Registers the cross-section orchestration hooks.

import './styles.css';

// Side-effect imports: each module registers its own DOM listeners at load time.
import './file-ops';       // btn-open, btn-save, btn-back, btn-rescan, beforeunload, wireTestFileInput
import './file-dialogs';   // btn-file-new/rename/delete/unlock, contextmenu handler, afterOpenFile hook
import './recents';        // recents menu wiring, openRecentItem
import './search';         // search input debounce wiring
import './review-modal';   // btn-rezip, btn-compare
import './notes';          // notes textarea, btn-notes-save, mode-notes
import './preset-overlay'; // overlay-form banner, afterOpenFile hook
import './scenarios';      // scenario picker UI
import './preview';        // preview buttons, zoom, tabs, CSS copy, wheel
import './sidebar';        // mode-files, mode-search, mode-theme, Ctrl+Shift+F
import './editor';         // Ctrl+Alt+L format shortcut
import './layout';         // sidebar + preview-pane resizers
import './monaco-goto';    // Monaco "Go to script" action

// Named imports needed for configure calls and hooks below.
import { bootstrapMonaco, registerFieldTokenCompletion } from './monaco-host';
import { scriptsState, configureScriptsList } from './scripts-panel';
import { configureTree } from './tree';
import { configureScriptForm } from './script-form';
import { openScriptForm, toggleScriptEnabled, moveScript } from './script-form';
import { configureScenarios } from './scenarios';
import { configurePreviewHelpers, previewState, refreshPreview, closePreview, openPreview } from './preview';
import { setSidebarMode } from './sidebar';
import { configureRecentScripts } from './recent-scripts';
import { on as hookOn } from './hooks';
import { state } from './state';
import { openFile } from './file-ops';
import { updateFileButtons } from './file-dialogs';
import { renderNavigator, parseNavigatorEntries, normalizeNavPath } from './navigator';
import { refreshScriptsList, SCRIPT_HOST_CANDIDATES } from './scripts-panel';
import { renderScriptsList } from './scripts-panel';
import { autoLoadScenariosFromFolder, populateScenarioPicker, scenariosState } from './scenarios';
import { loadNotesForCurrentTemplate } from './notes';
import { recentsAdd } from './recents';
import { findLockedFolderEntries } from './fs';
import { setStatus } from './status';
import { getModalEls } from './review-modal';

// ============================================================
// MONACO BOOTSTRAP
// ============================================================
bootstrapMonaco({
  onSave: () => {
    // commitCurrentEdit is in file-ops; import lazily to avoid hoisting issues.
    import('./file-ops').then(m => m.commitCurrentEdit(true));
  },
  onReady: () => {
    registerFieldTokenCompletion(
      ['html'],
      () => (scriptsState && scriptsState.datamodelFields) || [],
    );
  },
});

// ============================================================
// CONFIGURE — cross-module DI seams
// ============================================================

configureTree({ openFile: path => openFile(path) });

configureScriptsList({
  openScriptForm: id => openScriptForm(id),
  toggleScriptEnabled: (id, enabled) => toggleScriptEnabled(id, enabled),
  moveScript: (fromId, toId, pos) => moveScript(fromId, toId, pos),
  setSidebarMode: mode => setSidebarMode(mode),
});

configureScriptForm({ setSidebarMode: mode => setSidebarMode(mode) });

configureScenarios({ openFile: path => openFile(path) });

configurePreviewHelpers({ setSidebarMode: mode => setSidebarMode(mode) });

configureRecentScripts();

// ============================================================
// MODAL HELPERS
// ============================================================
// Warm the modal element cache so dismiss handlers are wired before first use.
getModalEls();

// Track standalone original so diff works for non-zip files.
hookOn('afterLoadFromHandle', () => {
  if (state.standalone) state.standalone.original = state.standalone.content;
});

// Update compare button availability; close preview on template switch.
hookOn('afterLoadFromHandle', () => {
  (document.getElementById('btn-compare') as HTMLButtonElement).disabled = !state.zip;
  closePreview();
});

// ============================================================
// HOOK REGISTRATIONS — cross-section orchestration
// ============================================================

// Auto-refresh preview when an edit is committed.
hookOn('afterCommitCurrentEdit', () => {
  if (previewState.open) refreshPreview();
});

// Re-parse scripts after edit committed to the active script host.
hookOn('afterCommitCurrentEdit', () => {
  if (state.currentPath && SCRIPT_HOST_CANDIDATES.includes(state.currentPath)) {
    refreshScriptsList();
  }
});

// Render scripts list after re-parse.
hookOn('afterReparseScripts', () => {
  renderScriptsList();
});

// Close script form when navigating to a different file.
hookOn('beforeOpenFile', () => {
  document.getElementById('script-form-view')!.classList.remove('show');
  scriptsState.active = null;
});

// Refresh everything after a template loads.
hookOn('afterLoadFromHandle', () => {
  refreshScriptsList();
  updateFileButtons();
  if (typeof renderNavigator === 'function') renderNavigator();
  (document.getElementById('btn-rezip') as HTMLButtonElement).disabled = false;
  if (state.zip && !state.standalone) {
    const locked = findLockedFolderEntries();
    if (locked.length) {
      setStatus(
        `${locked.length} locked folder${locked.length === 1 ? '' : 's'} detected (` +
        locked.map(p => p.replace(/\\/g, '/').replace(/^public\/document\//, '')).join(', ') +
        `). Click 🔓 Unlock in the file toolbar to make them writable.`,
        'warn',
      );
    }
  }
});

// Load scenarios + notes after template load.
hookOn('afterLoadFromHandle', async () => {
  try {
    if (!scenariosState.list.length) await autoLoadScenariosFromFolder();
    populateScenarioPicker();
  } catch (e) { console.warn('[scenarios] hook failed:', e); }
  try { loadNotesForCurrentTemplate(); } catch (e) { console.warn('[notes]', e); }
});

// Record recently-opened file handles.
hookOn('afterLoadFromHandle', (handle: unknown) => {
  if (handle && !state.dirHandle) recentsAdd(handle as any, 'file');
});
hookOn('afterPickAndOpenFolder', () => {
  if (state.dirHandle) recentsAdd(state.dirHandle, 'folder');
});

// Auto-open section 1 + preview on template load.
hookOn('afterLoadFromHandle', async () => {
  if (state.isDocx) return;
  if (state.standalone) return;
  if (!scriptsState || !scriptsState.hostPath) return;
  let entries: ReturnType<typeof parseNavigatorEntries>;
  try { entries = parseNavigatorEntries(); } catch (_) { return; }
  if (!entries || !entries.sections || !entries.sections.length) return;
  const first = entries.sections[0];
  const target = normalizeNavPath(first.location);
  if (!state.files[target]) return;
  try {
    openFile(target);
    if (!previewState.open) openPreview();
    else refreshPreview();
  } catch (e) { console.warn('[auto-open] failed:', e); }
});

// Initial btn-rezip state.
(document.getElementById('btn-rezip') as HTMLButtonElement).disabled = !state.fileHandle;

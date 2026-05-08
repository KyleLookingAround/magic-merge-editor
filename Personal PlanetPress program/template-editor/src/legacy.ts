// @ts-nocheck
// Phase 3–12 carve residue. What remains after Phase 12:
//   • Monaco bootstrap call
//   • configure*() calls that wire cross-module DI seams
//   • A handful of DOM event listeners and hook registrations that
//     are pure cross-section orchestration glue (no home module)
//   • The sidebar / search / preview button event wiring
//   • The Monaco "Go to script" action wiring
//   • The auto-open-section-1 hook
//   • The sidebar and preview-pane resizer IIFEs
//
// New modules added in Phase 12:
//   status      -> ./status.ts       (setStatus)
//   file-ops    -> ./file-ops.ts     (openFile, commitCurrentEdit,
//                                     rezipAndSave, loadFromHandle,
//                                     pickAndOpen*, scan*, hasUnsaved)
//   file-dialogs -> ./file-dialogs.ts (updateFileButtons, promptNewFile,
//                                     renameFile, deleteFile, unlock,
//                                     copyToClipboard, revealInTree,
//                                     contextmenu handler)
//   status added to fs.ts:           (locked-folder predicates)
//   scenarios extended:              (scenario form, matrix, diff,
//                                     wireScenarios wiring)
//   recents extended:                (openRecentItem, menu wiring)
//   editor extended:                 (formatCurrent)
//   tree updated:                    (isLockedFolderMarker DI dropped)

import { state } from './state';
import { on as hookOn, emit as hookEmit, emitAsync as hookEmitAsync } from './hooks';
import { recentsAdd } from './recents';
// recentsAdd / recentsList / formatRecentTime / openRecentItem / menu wiring in ./recents.ts
import { bootstrapMonaco, registerFieldTokenCompletion } from './monaco-host';
import {
  TEXT_EXTS, LANG_BY_EXT, IMAGE_EXTS, ZIP_EXTS,
  extOf, langFor, isTextPath, isImagePath, isZipExt,
  decodeXmlEntities, encodeXmlText, encodeXmlAttr,
  indentAt, replaceTagInner, makeMemoCache, looksLikeText, decodeBytes,
  LOCKED_FOLDER_RELATIVE_PATHS, LOCKED_FOLDER_PATH_SET,
  isLockedFolderMarker, findLockedFolderEntries,
} from './fs';
import { buildTree, refreshTreeDirtyMarkers, escapeHtml, configureTree } from './tree';
import { validateXml, formatXml, formatCurrent } from './editor';
import { appendSearchFile, renderSnippet, configureSearch, runSearch } from './search';
import { openModal, closeModal, renderDiff, zipTextMap, getModalEls, configureReviewModal, compareTemplates, reviewAndSave } from './review-modal';
import {
  ZOOM_STEPS, collectUnresolvedTokens, themeState,
  getZipText, parseDocxTheme, renderThemePanel, buildThemeCss,
  previewState, revokePreviewBlobs,
  renderTokensStrip, scriptByToken, jumpToScriptByToken,
  attachTokenJumpHandlers, renderCssView, openPreviewNewTab,
  configurePreviewHelpers,
  setPreviewMode, stepZoom, setZoom, applyZoomToFrame, applyZoomToFrameEl,
  togglePreview, openPreview, closePreview, refreshPreview,
  buildPreviewHtml, applyDatamodelPersonalization,
} from './preview';
import { setSidebarMode } from './sidebar';
import { loadNotesForCurrentTemplate, configureNotes } from './notes';
import { configureRecentScripts } from './recent-scripts';
import { openContextMenu, closeCtxMenu } from './context-menu';
import { configurePresetOverlay } from './preset-overlay';
import {
  scenariosState, scnPersistKey, parseScenarioXmlToMap,
  readScenariosFromZip, autoLoadScenariosFromFolder,
  pickAndLoadScenarios, populateScenarioPicker, activateScenario,
  configureScenarios,
  openScenarioForm, openScenarioFormForActive, closeScenarioForm, scenarioMapToXml,
  openCoverageMatrix, openScenarioDiff,
} from './scenarios';
import {
  SCRIPT_HOST_CANDIDATES,
  stripCdataKeepingOffsets,
  parseScriptsFromXml,
  serializeScriptBack,
  buildNewScriptXml,
  parseDatamodelFields,
  dmTypeToFormType,
  scriptsState,
  findDatamodelPath,
  isScriptFieldInvalid,
  countScriptUsages,
  refreshDatamodelFields,
  refreshScriptsList,
  renderScriptsList,
  updateBulkBar,
  computeVisibleScripts,
  configureScriptsList,
} from './scripts-panel';
import { renderNavigator, parseNavigatorEntries, normalizeNavPath, configureNavigator } from './navigator';
import {
  openScriptForm, closeScriptForm, applyScriptForm,
  toggleScriptEnabled, cloneScript, moveScript,
  createScript, deleteScript, configureScriptForm,
} from './script-form';
import { setStatus } from './status';
import {
  openFile, commitCurrentEdit, rezipAndSave,
  pickAndOpenFile, pickAndOpenFolder, scanFolderTemplates,
  renderTemplatesList, backToFolderList, loadFromHandle, hasUnsaved,
} from './file-ops';
import {
  updateFileButtons, unlockTemplateFolders,
  promptNewFile, renameFile, deleteFile,
  copyToClipboard, revealInTree,
} from './file-dialogs';

(function () {
'use strict';

// ---------- monaco bootstrap ----------
// onSave invokes commitCurrentEdit on Ctrl+S; getFields reads the
// datamodel field list lazily so completion always reflects the current template.
bootstrapMonaco({
  onSave: () => commitCurrentEdit(true),
  onReady: () => {
    registerFieldTokenCompletion(
      ['html'],
      () => (typeof scriptsState !== 'undefined' && scriptsState.datamodelFields) || [],
    );
  },
});

// ---------- configureTree ----------
// isLockedFolderMarker is now imported from ./fs; no longer in DI seam.
configureTree({
  openFile: path => openFile(path),
});

// ---------- configureSearch ----------
configureSearch({ openFile: path => openFile(path) });

// ---------- configureScriptsList ----------
configureScriptsList({
  openScriptForm: (id) => openScriptForm(id),
  toggleScriptEnabled: (id, enabled) => toggleScriptEnabled(id, enabled),
  setStatus: (msg, kind) => setStatus(msg, kind),
  moveScript: (fromId, toId, pos) => moveScript(fromId, toId, pos),
  setSidebarMode: (mode) => setSidebarMode(mode),
});

// ---------- configureScriptForm ----------
configureScriptForm({
  openFile: (path) => openFile(path),
  setStatus: (msg, kind) => setStatus(msg, kind),
  setSidebarMode: (mode) => setSidebarMode(mode),
});

// ---------- configureNavigator ----------
configureNavigator({
  openFile: (path) => openFile(path),
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// ---------- configureScenarios ----------
// Also wires the scenario picker UI (previously wireScenarios IIFE).
configureScenarios({
  setStatus: (msg, kind) => setStatus(msg, kind),
  refreshPreview: () => refreshPreview(),
  openFile: (path) => openFile(path),
});

// ---------- configurePreviewHelpers ----------
configurePreviewHelpers({
  setSidebarMode: (mode) => setSidebarMode(mode),
  openScriptForm: (id) => openScriptForm(id),
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// ---------- configureNotes ----------
configureNotes({
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// ---------- configureRecentScripts ----------
configureRecentScripts();

// ---------- configurePresetOverlay ----------
configurePresetOverlay({
  openFile: (path) => openFile(path),
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// ---------- configureReviewModal ----------
configureReviewModal({
  setStatus: (msg, kind) => setStatus(msg, kind),
  commitCurrentEdit: (showStatus) => commitCurrentEdit(showStatus),
  rezipAndSave: () => rezipAndSave(),
});

// ============================================================
// MODAL HELPERS
// ============================================================
// modalEls still used in legacy code — fetch once for reuse.
const modalEls = getModalEls();

// Track standalone original so diff works for non-zip files.
hookOn('afterLoadFromHandle', () => {
  if (state.standalone) state.standalone.original = state.standalone.content;
});

// ============================================================
// COMPARE TWO TEMPLATES
// ============================================================
document.getElementById('btn-compare').addEventListener('click', compareTemplates);

hookOn('afterLoadFromHandle', () => {
  document.getElementById('btn-compare').disabled = !state.zip;
  closePreview();
});

// ============================================================
// SIDEBAR MODE TOGGLE
// ============================================================
// setSidebarMode carved to ./sidebar.ts (Phase 8).
document.getElementById('mode-files').addEventListener('click', () => setSidebarMode('files'));
document.getElementById('mode-search').addEventListener('click', () => setSidebarMode('search'));
document.getElementById('mode-theme').addEventListener('click', () => setSidebarMode('theme'));

// Ctrl+Shift+F → search; Ctrl+Alt+L → format
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    if (state.fileHandle) { e.preventDefault(); setSidebarMode('search'); }
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'L' || e.key === 'l')) {
    e.preventDefault(); formatCurrent();
  }
});

// ============================================================
// SEARCH ACROSS FILES
// ============================================================
let searchDebounce = null;
['search-input','search-case','search-regex','search-word'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 150);
  });
});
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; runSearch(); }
});

// ============================================================
// REZIP BUTTON STATE
// ============================================================
document.getElementById('btn-rezip').disabled = !state.fileHandle;

// ============================================================
// HTML PREVIEW
// ============================================================
document.getElementById('btn-preview').addEventListener('click', togglePreview);
document.getElementById('btn-preview-refresh').addEventListener('click', refreshPreview);
document.getElementById('btn-preview-newtab').addEventListener('click', openPreviewNewTab);
document.getElementById('btn-preview-close').addEventListener('click', closePreview);
document.getElementById('btn-preview-zoom-in').addEventListener('click', () => stepZoom(1));
document.getElementById('btn-preview-zoom-out').addEventListener('click', () => stepZoom(-1));
document.getElementById('preview-zoom-level').addEventListener('click', () => setZoom(1));
document.getElementById('btn-pv-tab-data').addEventListener('click', () => setPreviewMode('data'));
document.getElementById('btn-pv-tab-raw').addEventListener('click', () => setPreviewMode('raw'));
document.getElementById('btn-pv-tab-split').addEventListener('click', () => setPreviewMode('split'));
document.getElementById('btn-pv-tab-css').addEventListener('click', () => setPreviewMode('css'));
document.getElementById('btn-preview-css-copy').addEventListener('click', () => {
  const css = previewState.lastCss || '';
  if (!css) { setStatus('No CSS to copy yet.', 'warn'); return; }
  navigator.clipboard.writeText(css).then(
    () => setStatus('CSS copied to clipboard.', 'ok'),
    () => setStatus('Copy failed.', 'err'),
  );
});
document.getElementById('btn-preview-tokens-dismiss').addEventListener('click', () => {
  previewState.tokensDismissed = true;
  document.getElementById('preview-tokens-strip').classList.remove('show');
});

// Ctrl+scroll over preview pane to zoom
document.getElementById('preview-pane').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ============================================================
// DOCX THEME EXTRACTOR
// ============================================================
document.getElementById('btn-theme-copy').addEventListener('click', () => {
  if (!state.isDocx) { setStatus('Open a .docx first.', 'warn'); return; }
  const css = buildThemeCss();
  if (!css) { setStatus('No theme data to copy.', 'warn'); return; }
  navigator.clipboard.writeText(css).then(
    () => setStatus('Theme CSS copied to clipboard.', 'ok'),
    () => setStatus('Copy failed.', 'err'),
  );
});

// ============================================================
// HOOK REGISTRATIONS — cross-section orchestration
// ============================================================

// Auto-refresh preview when an edit is committed
hookOn('afterCommitCurrentEdit', () => {
  if (previewState.open) refreshPreview();
});

// Re-parse scripts after edit; renderScriptsList runs on afterReparseScripts
hookOn('afterCommitCurrentEdit', () => {
  if (state.currentPath && SCRIPT_HOST_CANDIDATES.includes(state.currentPath)) {
    refreshScriptsList();
  }
});

// Render scripts list after re-parse
hookOn('afterReparseScripts', () => {
  renderScriptsList();
});

// Close script form when navigating to a different file
hookOn('beforeOpenFile', () => {
  document.getElementById('script-form-view').classList.remove('show');
  scriptsState.active = null;
});

// Refresh everything after a template loads
hookOn('afterLoadFromHandle', () => {
  refreshScriptsList();
  updateFileButtons();
  if (typeof renderNavigator === 'function') renderNavigator();
  document.getElementById('btn-rezip').disabled = false;
  if (state.zip && !state.standalone) {
    const locked = findLockedFolderEntries();
    if (locked.length) {
      setStatus(
        `${locked.length} locked folder${locked.length === 1 ? '' : 's'} detected (` +
        locked.map(p => p.replace(/\\/g, '/').replace(/^public\/document\//, '')).join(', ') +
        `). Click 🔓 Unlock in the file toolbar to make them writable.`,
        'warn'
      );
    }
  }
});

// Load scenarios + notes after template load
hookOn('afterLoadFromHandle', async () => {
  try {
    if (!scenariosState.list.length) await autoLoadScenariosFromFolder();
    populateScenarioPicker();
  } catch (e) { console.warn('[scenarios] hook failed:', e); }
  try { loadNotesForCurrentTemplate(); } catch (e) { console.warn('[notes]', e); }
});

// Record recently-opened file handles in the recents list
hookOn('afterLoadFromHandle', (handle) => {
  if (handle && !state.dirHandle) recentsAdd(handle, 'file');
});
hookOn('afterPickAndOpenFolder', () => {
  if (state.dirHandle) recentsAdd(state.dirHandle, 'folder');
});

// ============================================================
// MONACO "GO TO SCRIPT" ACTION
// ============================================================
(function wireMonacoGotoScript() {
  function tryRegister() {
    if (!state.editor || typeof monaco === 'undefined') {
      setTimeout(tryRegister, 200);
      return;
    }
    state.editor.addAction({
      id: 'cw.goto-script-for-token',
      label: 'Go to script for @token@',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0.5,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyG],
      run(editor) {
        const model = editor.getModel();
        if (!model) return;
        const pos = editor.getPosition();
        const line = model.getLineContent(pos.lineNumber);
        const re = /@[A-Za-z0-9_./\-]+@/g;
        let m, found = null;
        while ((m = re.exec(line)) !== null) {
          const start = m.index + 1;
          const end = m.index + m[0].length + 1;
          if (pos.column >= start && pos.column <= end) { found = m[0]; break; }
        }
        if (!found) {
          setStatus('Place the cursor inside an @token@ first.', 'warn');
          return;
        }
        if (typeof jumpToScriptByToken === 'function') jumpToScriptByToken(found);
        else setStatus('Scripts panel unavailable in this template.', 'warn');
      },
    });
    if (scriptsState && scriptsState.sourceEditor) {
      scriptsState.sourceEditor.addAction({
        id: 'cw.goto-script-for-token-form',
        label: 'Go to script for @token@',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.5,
        run(editor) {
          const model = editor.getModel();
          const pos = editor.getPosition();
          const line = model.getLineContent(pos.lineNumber);
          const re = /@[A-Za-z0-9_./\-]+@/g;
          let m, found = null;
          while ((m = re.exec(line)) !== null) {
            const a = m.index + 1, b = m.index + m[0].length + 1;
            if (pos.column >= a && pos.column <= b) { found = m[0]; break; }
          }
          if (found && typeof jumpToScriptByToken === 'function') jumpToScriptByToken(found);
        },
      });
    }
  }
  tryRegister();
})();

// ============================================================
// AUTO-OPEN SECTION 1 + PREVIEW ON TEMPLATE LOAD
// ============================================================
hookOn('afterLoadFromHandle', async () => {
  if (state.isDocx) return;
  if (state.standalone) return;
  if (!scriptsState || !scriptsState.hostPath) return;
  let entries;
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

// ============================================================
// SIDEBAR RESIZER
// ============================================================
(function () {
  const sidebar = document.getElementById('sidebar');
  const r = document.getElementById('resizer');
  let dragging = false;
  r.addEventListener('mousedown', e => { dragging = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const min = 200, max = 700;
    let w = Math.max(min, Math.min(max, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

// ============================================================
// PREVIEW PANE RESIZER
// ============================================================
(function () {
  const r = document.getElementById('preview-resizer');
  const pane = document.getElementById('preview-pane');
  let dragging = false, startX = 0, startW = 0;
  r.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startW = pane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const newW = Math.max(240, Math.min(window.innerWidth * 0.8, startW + delta));
    pane.style.width = newW + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

})();

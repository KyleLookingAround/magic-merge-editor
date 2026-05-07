// @ts-nocheck
// Phase 3 carve residue. The original inline <script> from
// template-editor.html (lines 1394-7387) lived here verbatim at the
// start of Phase 3; the pure helpers have since been extracted into
// the ES modules imported below. What remains is the orchestration
// glue: DOM event wiring, the heavy DOM-mutating flows (openFile,
// commitCurrentEdit, rezipAndSave, refreshScriptsList, openScriptForm,
// the preview pipeline, scenarios, notes, navigator, locked-folder
// unlock, file add/rename/delete, preset overlay), and the
// cross-section monkey-patches that stitch them together.
//
// All ten Phase 3 carve targets now have real modules:
//   state         -> ./state.ts
//   recents       -> ./recents.ts (pure DB + format helpers; menu
//                    wiring + openRecentItem stay here for now)
//   monaco-host   -> ./monaco-host.ts (bootstrap + completion provider)
//   fs            -> ./fs.ts (ext tables, predicates, XML codecs,
//                    decodeBytes / looksLikeText / makeMemoCache)
//   tree          -> ./tree.ts (buildTree + renderNode +
//                    refreshTreeDirtyMarkers + escapeHtml)
//   editor        -> ./editor.ts (validateXml + formatXml)
//   search        -> ./search.ts (appendSearchFile + renderSnippet)
//   review-modal  -> ./review-modal.ts (openModal/closeModal/renderDiff
//                    + zipTextMap)
//   preview       -> ./preview.ts (ZOOM_STEPS + collectUnresolvedTokens
//                    + themeState — migrated Phase 5)
//   scripts-panel -> ./scripts-panel.ts (parseScriptsFromXml +
//                    serializeScriptBack + buildNewScriptXml +
//                    parseDatamodelFields + dmTypeToFormType +
//                    stripCdataKeepingOffsets + SCRIPT_HOST_CANDIDATES
//                    + scriptsState — migrated Phase 5)
//   scenarios     -> ./scenarios.ts (scenariosState — migrated Phase 5)
//
// What's still here (and why) - the pieces above were the pure-leaning
// cuts. The DOM-coupled orchestrators stayed for these reasons:
//   - openFile / commitCurrentEdit / loadFromHandle / pickAndOpenFile /
//     rezipAndSave are wrapped by 12+ cross-section monkey-patches.
//     They have to move together with their patch chains — phase 4
//     hook system handles the wiring.
//   - setSidebarMode / refreshScriptsList / openScriptForm /
//     applyScriptForm / createScript / cloneScript / moveScript /
//     bulk* orchestrators still reach into the DOM and the now-exported
//     scriptsState/scenariosState/themeState shells. Moving them out
//     is the next phase of carve work.
//   - parseDocxTheme / buildThemeCss / renderThemePanel / refreshPreview
//     / buildPreviewHtml depend on the blob-URL cache (previewState).
//   - File add/rename/delete dialogs (promptNewFile / renameFile /
//     deleteFile / openNewFileModal / openContextMenu) and
//     revealInTree call into commitCurrentEdit + setStatus + openFile.
//
// External globals (JSZip, Diff, monaco loader) are still loaded
// from CDN <script> tags in index.html and remain on window.
//
// Carve methodology (worked for all ten):
//   1. Create src/<name>.ts exporting the pure functions/types.
//   2. Replace the in-place block here with a one-line carve marker
//      and add the import at the top of this file.
//   3. For monkey-patches (`const _orig = X; X = async function ...`),
//      keep both the original and the patch here until ALL
//      callers/dependents have moved out.
//   4. After each carve: `npx tsc --noEmit && npx vite build`, then
//      smoke-test the built dist/index.html against M2L-KFI.OL-template.
import { state } from './state';
import { on as hookOn, emit as hookEmit, emitAsync as hookEmitAsync } from './hooks';
import { recentsAdd, recentsList, recentsRemove, recentsClear, formatRecentTime } from './recents';
import { bootstrapMonaco, registerFieldTokenCompletion } from './monaco-host';
import {
  TEXT_EXTS, LANG_BY_EXT, IMAGE_EXTS, ZIP_EXTS,
  extOf, langFor, isTextPath, isImagePath, isZipExt,
  decodeXmlEntities, encodeXmlText, encodeXmlAttr,
  indentAt, replaceTagInner, makeMemoCache, looksLikeText, decodeBytes,
} from './fs';
import { buildTree, refreshTreeDirtyMarkers, escapeHtml, configureTree } from './tree';
import { validateXml, formatXml } from './editor';
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
import { setSidebarMode, configureSidebar } from './sidebar';
import {
  scenariosState, scnPersistKey, parseScenarioXmlToMap,
  readScenariosFromZip, autoLoadScenariosFromFolder,
  pickAndLoadScenarios, populateScenarioPicker, activateScenario,
  configureScenarios,
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

(function () {
'use strict';

// Default indent for newly-created <script> elements inside index.xml.
// Matches PlanetPress's existing 16-space indentation of script siblings.
const DEFAULT_SCRIPT_INDENT = ' '.repeat(16);

// ---------- state ----------
// Carved out to ./state.ts. Imported above; same object identity, same keys.

// ---------- monaco bootstrap ----------
// Carved out to ./monaco-host.ts. Dependencies are passed in:
//   - onSave: invokes commitCurrentEdit on Ctrl+S (still legacy-resident)
//   - getFields thunk: reads scriptsState.datamodelFields lazily so the
//     completion provider always sees the latest list
bootstrapMonaco({
  onSave: () => commitCurrentEdit(true),
  onReady: () => {
    // Register @field@ token autocomplete for HTML files. Reads from
    // scriptsState.datamodelFields (populated when a template with a
    // datamodel is opened) so the suggestion list always reflects the
    // current template's data shape.
    registerFieldTokenCompletion(
      ['html'],
      () => (typeof scriptsState !== 'undefined' && scriptsState.datamodelFields) || [],
    );
  },
});

// ---------- helpers ----------
// Pure helpers carved out to ./fs.ts:
//   TEXT_EXTS, LANG_BY_EXT, IMAGE_EXTS, ZIP_EXTS,
//   extOf, langFor, isTextPath, isImagePath, isZipExt,
//   decodeXmlEntities, encodeXmlText, encodeXmlAttr,
//   indentAt, replaceTagInner, makeMemoCache, looksLikeText, decodeBytes
// Imported at the top of this file. Names below are unchanged.

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.className = kind || '';
  if (msg && kind === 'ok') {
    setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = ''; } }, 4000);
  }
}

// decodeBytes carved out to ./fs.ts.

// ---------- open / load ----------
document.getElementById('btn-open').addEventListener('click', () => pickAndOpenFile());
document.getElementById('btn-open-folder').addEventListener('click', () => pickAndOpenFolder());
document.getElementById('btn-save').addEventListener('click', () => commitCurrentEdit(true));
document.getElementById('btn-rezip').addEventListener('click', () => reviewAndSave());
document.getElementById('btn-back').addEventListener('click', backToFolderList);
document.getElementById('btn-rescan').addEventListener('click', () => state.dirHandle && scanFolderTemplates(state.dirHandle, true));

// Test-only: hidden <input type=file> that loads a template without the File
// System Access API (which requires a real user gesture Playwright can't produce).
(function wireTestFileInput() {
  const inp = document.querySelector('input[type=file][data-testid="load-template"]');
  if (!inp) return;
  inp.addEventListener('change', () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    // Wrap the plain File in a handle-shaped object so loadFromHandle works unchanged.
    const fakeHandle = { getFile: async () => file, name: file.name };
    inp.value = ''; // reset so the same file can be reloaded
    loadFromHandle(fakeHandle);
  });
})();

async function pickAndOpenFile() {
  if (!window.showOpenFilePicker) {
    alert('Your browser doesn\'t support the File System Access API. Please open this in Chrome or Edge.');
    return;
  }
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them and open a new file?')) return;
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ multiple: false });
  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus('Open failed: ' + e.message, 'err');
    return;
  }
  // Leaving folder mode: hide back button + folder panel
  state.dirHandle = null; state.folderTemplates = []; state.dirName = null;
  document.getElementById('btn-back').style.display = 'none';
  document.getElementById('folder-panel').style.display = 'none';
  await loadFromHandle(handle);
}

async function pickAndOpenFolder() {
  if (!window.showDirectoryPicker) {
    alert('Your browser doesn\'t support directory picking. Please open this in Chrome or Edge.');
    return;
  }
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them and open a new folder?')) return;
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus('Open folder failed: ' + e.message, 'err');
    return;
  }
  state.dirHandle = dirHandle;
  state.dirName = dirHandle.name;
  await scanFolderTemplates(dirHandle, false);
  // Show the folder panel; hide tree until a template is picked
  document.getElementById('folder-panel').style.display = '';
  document.getElementById('tree-panel').style.display = 'none';
  document.getElementById('folder-name').textContent = dirHandle.name;
  document.getElementById('btn-back').style.display = 'none'; // already in list view
  document.getElementById('empty').classList.remove('hidden');
  document.getElementById('editor-tab').style.display = 'none';
  document.getElementById('editor').style.display = 'none';
  document.getElementById('binary-view').classList.remove('show');
  document.getElementById('btn-rezip').disabled = true;
  document.getElementById('btn-save').disabled = true;
  document.getElementById('filename').textContent = `Folder: ${dirHandle.name}`;
  await hookEmitAsync('afterPickAndOpenFolder');
}

async function scanFolderTemplates(dirHandle, isRescan) {
  setStatus('Scanning folder...');
  const items = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const ext = extOf(entry.name);
      if (ZIP_EXTS.has(ext) || ext === 'ol-datamodel' || ext === 'docx') {
        items.push({ name: entry.name, handle: entry, ext });
      }
    }
  } catch (e) {
    setStatus('Scan failed: ' + e.message, 'err');
    return;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  state.folderTemplates = items;
  renderTemplatesList();
  setStatus(`Found ${items.length} template${items.length === 1 ? '' : 's'}${isRescan ? ' (rescanned)' : ''}.`, 'ok');
}

function renderTemplatesList() {
  const list = document.getElementById('templates-list');
  list.innerHTML = '';
  if (!state.folderTemplates.length) {
    list.innerHTML = '<div class="empty-msg">No .OL-template / .OL-datamapper / .OL-datamodel / .docx files found.</div>';
    return;
  }
  for (const t of state.folderTemplates) {
    const el = document.createElement('div');
    el.className = 'template-item';
    if (state.fileHandle && state.fileHandle.name === t.name) el.classList.add('active');
    const kindLabel = t.ext === 'ol-datamapper' ? 'DM' : t.ext === 'ol-datamodel' ? 'MDL' : 'TPL';
    el.innerHTML = `<span class="kind">${kindLabel}</span><span>${escapeHtml(t.name)}</span>`;
    el.addEventListener('click', async () => {
      if (hasUnsaved() && !confirm('You have unsaved edits in the current template. Discard them?')) return;
      await loadFromHandle(t.handle);
    });
    list.appendChild(el);
  }
}

async function backToFolderList() {
  if (hasUnsaved() && !confirm('You have unsaved edits. Discard them?')) return;
  // Return to folder list view
  document.getElementById('folder-panel').style.display = '';
  document.getElementById('tree-panel').style.display = 'none';
  document.getElementById('btn-back').style.display = 'none';
  document.getElementById('editor-tab').style.display = 'none';
  document.getElementById('editor').style.display = 'none';
  document.getElementById('binary-view').classList.remove('show');
  document.getElementById('empty').classList.remove('hidden');
  document.getElementById('btn-rezip').disabled = true;
  document.getElementById('btn-save').disabled = true;
  document.getElementById('filename').textContent = `Folder: ${state.dirName}`;
  // Drop the current template state so it's not accidentally rezipped
  state.zip = null; state.fileHandle = null; state.fileName = null; state.files = {};
  state.currentPath = null; state.standalone = null;
  state.isDocx = false; state.docxBytes = null;
  Object.values(state.monacoModels).forEach(m => m.dispose());
  state.monacoModels = {};
  // Reset .docx-conditional UI bits and close any open preview
  document.getElementById('mode-theme').style.display = 'none';
  document.getElementById('mode-nav').style.display = '';
  document.getElementById('mode-scripts').style.display = '';
  if (previewState && previewState.open) closePreview();
  renderTemplatesList();
}

function hasUnsaved() {
  return Object.values(state.files).some(f => f.dirty)
      || (state.standalone && state.standalone.dirty);
}

async function loadFromHandle(handle) {
  setStatus('Reading...');
  const file = await handle.getFile();
  const headBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = headBytes.length >= 2 && headBytes[0] === 0x50 && headBytes[1] === 0x4B;

  // Reset state for new file
  state.zip = null;
  state.standalone = null;
  state.isDocx = false;
  state.docxBytes = null;
  if (typeof previewState === 'object') {
    previewState.lastDocxHtml = '';
    previewState.lastDocxHtmlFor = null;
  }
  state.fileHandle = handle;
  state.fileName = handle.name;
  state.files = {};
  state.currentPath = null;
  Object.values(state.monacoModels).forEach(m => m.dispose());
  state.monacoModels = {};

  if (isZip) {
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      setStatus('Not a valid zip: ' + e.message, 'err');
      return;
    }
    state.zip = zip;

    const paths = [];
    zip.forEach((path, entry) => { if (!entry.dir) paths.push(path); });

    const progressEvery = Math.max(1, Math.floor(paths.length / 20));
    let i = 0;
    for (const path of paths) {
      const entry = zip.file(path);
      const bytes = await entry.async('uint8array');
      // Decide text vs binary: known text extension OR sniff
      const known = isTextPath(path);
      const isText = known || (!isImagePath(path) && looksLikeText(bytes));
      state.files[path] = isText
        ? { content: decodeBytes(bytes), isText: true, dirty: false }
        : { content: bytes, isText: false, dirty: false };
      i++;
      if (i % progressEvery === 0) setStatus(`Reading... ${i}/${paths.length}`);
    }
    // Detect Word .docx packages — they're zips containing word/document.xml.
    // Be permissive about path casing and separators; some packagers have been
    // observed to write `Word/Document.xml` or use backslashes. We also fall
    // back to a filename-extension check so a renamed/repackaged docx still
    // gets the docx UI even if its part name is unusual.
    const looksLikeDocx = paths.some(p => /(?:^|[\/\\])word[\/\\]document\.xml$/i.test(p))
      || extOf(handle.name) === 'docx';
    state.isDocx = looksLikeDocx;
    console.log('[docx] detection', { fileName: handle.name, isDocx: state.isDocx, partCount: paths.length, hasWordDocXml: paths.some(p => /(?:^|[\/\\])word[\/\\]document\.xml$/i.test(p)) });
    document.getElementById('tree-title').textContent = handle.name;
    buildTree();
    // Rezip-and-overwrite is unsafe for .docx — JSZip rebuild doesn't preserve
    // the package invariants (Content_Types ordering, rels, embedded media). The
    // editor is read-only for Word docs; users get the file tree, preview, and
    // theme extractor instead.
    document.getElementById('btn-rezip').disabled = state.isDocx;
    if (state.isDocx) {
      document.getElementById('btn-rezip').title = 'Save disabled for .docx — modifying the package can corrupt it. Use Word to edit the source.';
    } else {
      document.getElementById('btn-rezip').title = '';
    }
    setStatus(`Loaded ${paths.length} files${state.isDocx ? ' (Word document — read-only)' : ''}.`, 'ok');
  } else {
    // Standalone file (e.g. a bare .OL-datamodel XML on disk)
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isText = isTextPath(handle.name) || looksLikeText(bytes);
    if (!isText) {
      setStatus('That file is binary and isn\'t a zip — nothing to edit.', 'err');
      return;
    }
    state.standalone = {
      isText: true,
      content: decodeBytes(bytes),
      dirty: false,
    };
    // Use a single virtual entry in state.files so the editor logic reuses
    state.files[handle.name] = { content: state.standalone.content, isText: true, dirty: false, standalone: true };
    document.getElementById('tree-title').textContent = handle.name;
    buildTree();
    document.getElementById('btn-rezip').disabled = false; // re-used: writes the standalone file
    setStatus('Loaded standalone file.', 'ok');
  }

  document.getElementById('filename').textContent = handle.name;
  document.getElementById('filename').classList.remove('dirty');
  document.getElementById('empty').classList.add('hidden');
  document.getElementById('tree-panel').style.display = '';
  document.getElementById('btn-rezip').textContent = state.zip ? 'Rezip & Overwrite' : 'Save & Overwrite';

  // Toggle .docx-conditional UI elements based on what we just loaded.
  // (Single spot so it stays correct across zip / docx / standalone.)
  document.getElementById('mode-theme').style.display = state.isDocx ? '' : 'none';
  document.getElementById('mode-nav').style.display = state.isDocx ? 'none' : '';
  document.getElementById('mode-scripts').style.display = state.isDocx ? 'none' : '';
  // If the user was sitting on Theme/Sections/Scripts and opens an incompatible
  // file, fall back to Files mode so they don't see an empty/wrong panel.
  const themeOn = document.getElementById('mode-theme').classList.contains('active');
  const navOn = document.getElementById('mode-nav').classList.contains('active');
  const scriptsOn = document.getElementById('mode-scripts').classList.contains('active');
  if ((themeOn && !state.isDocx) || ((navOn || scriptsOn) && state.isDocx)) {
    setSidebarMode('files');
  }

  // If we came from folder mode, show the back button and keep folder panel visible
  if (state.dirHandle) {
    document.getElementById('btn-back').style.display = '';
    document.getElementById('folder-panel').style.display = '';
    renderTemplatesList(); // refresh active highlight
  }

  // Auto-open the first text file (or the only file in standalone mode)
  const firstText = Object.entries(state.files).find(([, f]) => f.isText);
  if (firstText) openFile(firstText[0]);

  await hookEmitAsync('afterLoadFromHandle', handle);
}

// ---------- file tree ----------
// PlanetPress packages frequently use BACKSLASH separators inside zip entries
// (e.g. `public\document\css\Header.css`). Split on either separator so the
// tree nests properly regardless of which form the original packager wrote.
// Also: zero-byte entries whose path matches one of OL Connect's reserved
// "locked" folders (snippets / translations / js / fonts / color-profiles)
// are folder markers, not files — render them as empty folders with a 🔒.
// buildTree / renderNode / refreshTreeDirtyMarkers / escapeHtml carved
// out to ./tree.ts. configureTree below wires the legacy-resident
// callbacks (isLockedFolderMarker, openFile) into the new module.
configureTree({
  isLockedFolderMarker: (path, fe) => isLockedFolderMarker(path, fe),
  openFile: path => openFile(path),
});

// ---------- editor open / commit ----------
function openFile(path) {
  hookEmit('beforeOpenFile', path);
  // Commit any pending live edit on the current file's model first (handled per-model)
  state.currentPath = path;
  document.querySelectorAll('.tree-item.file').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
  const tab = document.getElementById('editor-tab');
  document.getElementById('tab-name').textContent = path;
  document.getElementById('tab-lang').textContent = langFor(path);
  const f = state.files[path];

  const editorEl = document.getElementById('editor');
  const binaryEl = document.getElementById('binary-view');
  binaryEl.classList.remove('show');
  binaryEl.innerHTML = '';
  tab.style.display = 'flex';

  if (f.isText) {
    const sizeKb = (new Blob([f.content]).size / 1024).toFixed(1);
    document.getElementById('tab-size').textContent = sizeKb + ' KB';
    editorEl.style.display = '';
    if (!state.monacoReady) {
      // Defer until ready
      const tries = setInterval(() => {
        if (state.monacoReady) { clearInterval(tries); openFile(path); }
      }, 100);
      hookEmit('afterOpenFile', path);
      return;
    }
    let model = state.monacoModels[path];
    if (!model) {
      model = monaco.editor.createModel(f.content, langFor(path));
      model.onDidChangeContent(() => {
        // mark dirty live; we don't push to state.files content until commit
        f.dirty = true;
        refreshTreeDirtyMarkers();
        document.getElementById('btn-save').disabled = false;
      });
      state.monacoModels[path] = model;
    }
    state.editor.setModel(model);
    state.editor.focus();
    document.getElementById('btn-save').disabled = state.isDocx; // .docx is read-only
    // .docx packages always allow Preview (renders the whole document via mammoth);
    // otherwise Preview only makes sense for HTML files.
    document.getElementById('btn-preview').disabled =
      !['html','htm'].includes(extOf(path));
    if (document.getElementById('preview-pane').classList.contains('show') &&
        ['html','htm'].includes(extOf(path))) {
      refreshPreview();
    }
  } else {
    editorEl.style.display = 'none';
    document.getElementById('btn-preview').disabled = true;
    document.getElementById('btn-save').disabled = true;
    const bytes = f.content;
    const sizeKb = (bytes.length / 1024).toFixed(1);
    document.getElementById('tab-size').textContent = sizeKb + ' KB (binary)';
    binaryEl.classList.add('show');
    if (isImagePath(path)) {
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      binaryEl.innerHTML = `<div>${escapeHtml(path)}</div><img src="${url}" alt="">`;
    } else {
      binaryEl.innerHTML = `<div>🔒 Binary file (${sizeKb} KB)</div>
        <div>This file isn't editable as text. It will be preserved unchanged when you rezip.</div>`;
    }
  }
  hookEmit('afterOpenFile', path);
}

function commitCurrentEdit(showStatus) {
  if (!state.currentPath) return;
  const f = state.files[state.currentPath];
  if (!f || !f.isText) return;
  const model = state.monacoModels[state.currentPath];
  if (!model) return;
  const newContent = model.getValue();

  // Validate XML/HTML/SVG on commit
  const ext = extOf(state.currentPath);
  if (['xml','xsl','xslt','svg','config'].includes(ext)) {
    const v = validateXml(newContent, false);
    if (!v.ok) {
      const proceed = confirm(`XML validation warning in ${state.currentPath}:\n\n${v.error}\n\nKeep edit anyway?`);
      if (!proceed) return;
    }
  } else if (ext === 'html' || ext === 'htm') {
    const v = validateXml(newContent, true);
    if (!v.ok && showStatus) setStatus('HTML parse note: ' + v.error, 'warn');
  } else if (ext === 'json') {
    try { JSON.parse(newContent); } catch (e) {
      const proceed = confirm(`JSON parse error in ${state.currentPath}:\n\n${e.message}\n\nKeep edit anyway?`);
      if (!proceed) return;
    }
  }

  f.content = newContent;
  f.dirty = true; // still dirty until rezip-save writes it to disk
  refreshTreeDirtyMarkers();
  if (showStatus) setStatus('Edit committed (not yet written to disk).', 'ok');
  hookEmit('afterCommitCurrentEdit', showStatus);
}

// validateXml carved out to ./editor.ts.

// ---------- save (rezip if zip, plain write if standalone) ----------
async function rezipAndSave() {
  if (!state.fileHandle) return;
  commitCurrentEdit(false);

  document.getElementById('btn-rezip').disabled = true;
  try {
    let blob;
    if (state.zip) {
      setStatus('Building zip...');
      const out = new JSZip();
      const order = [];
      state.zip.forEach((path, entry) => { if (!entry.dir) order.push({ path, entry }); });
      for (const { path, entry } of order) {
        const f = state.files[path];
        if (!f) continue;
        const date = entry.date || new Date();
        if (f.isText) out.file(path, f.content, { date });
        else out.file(path, f.content, { date, binary: true });
      }
      blob = await out.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    } else if (state.standalone) {
      const f = state.files[state.fileName];
      blob = new Blob([f.content], { type: 'text/plain' });
    } else {
      return;
    }

    if (state.fileHandle.queryPermission) {
      const perm = await state.fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const req = await state.fileHandle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') {
          setStatus('Write permission denied.', 'err');
          document.getElementById('btn-rezip').disabled = false;
          return;
        }
      }
    }
    const writable = await state.fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    for (const f of Object.values(state.files)) f.dirty = false;
    if (state.standalone) state.standalone.dirty = false;
    refreshTreeDirtyMarkers();

    const sizeKb = (blob.size / 1024).toFixed(1);
    setStatus(`Saved ${state.fileName} (${sizeKb} KB).`, 'ok');
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'err');
    console.error(e);
  } finally {
    document.getElementById('btn-rezip').disabled = false;
  }
}

// ---------- resizer ----------
(function () {
  const sidebar = document.getElementById('sidebar');
  const r = document.getElementById('resizer');
  let dragging = false;
  r.addEventListener('mousedown', e => { dragging = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const min = 200, max = 700;
    let w = e.clientX;
    w = Math.max(min, Math.min(max, w));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

// ---------- guard against leaving with unsaved edits ----------
window.addEventListener('beforeunload', e => {
  if (hasUnsaved()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ============================================================
// FORMAT (pretty-print)
// ============================================================
document.getElementById('btn-format').addEventListener('click', formatCurrent);

function formatCurrent() {
  if (!state.currentPath) return;
  const f = state.files[state.currentPath];
  if (!f || !f.isText) return;
  const model = state.monacoModels[state.currentPath];
  if (!model) return;
  const text = model.getValue();
  const ext = extOf(state.currentPath);
  let out = null, label = '';
  try {
    if (ext === 'json') { out = JSON.stringify(JSON.parse(text), null, 2); label = 'JSON'; }
    else if (['xml','xsl','xslt','svg','config','html','htm','ol-datamodel','ol-jobpreset','ol-outputpreset','ol-script','ol-config'].includes(ext)) {
      out = formatXml(text); label = 'XML';
    } else { setStatus('No formatter for this file type.', 'warn'); return; }
  } catch (e) {
    setStatus('Format failed: ' + e.message, 'err');
    return;
  }
  if (out === text) { setStatus('Already formatted.', 'ok'); return; }
  // Replace whole document via Monaco edit so undo works
  const range = model.getFullModelRange();
  state.editor.executeEdits('format', [{ range, text: out }]);
  setStatus(`Formatted as ${label}.`, 'ok');
}

// formatXml carved out to ./editor.ts. The dead `_formatXmlOldRestore`
// placeholder that lived alongside it was unreachable and referenced
// undefined names - dropped.

// ============================================================
// SIDEBAR MODE TOGGLE
// ============================================================
// setSidebarMode carved out to ./sidebar.ts (Phase 8).
// Event wiring stays here; the imported function handles all modes.
document.getElementById('mode-files').addEventListener('click', () => setSidebarMode('files'));
document.getElementById('mode-search').addEventListener('click', () => setSidebarMode('search'));
document.getElementById('mode-theme').addEventListener('click', () => setSidebarMode('theme'));

// Ctrl+Shift+F opens search
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    if (state.fileHandle) { e.preventDefault(); setSidebarMode('search'); }
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'L' || e.key === 'l')) {
    // Shift+Alt+F is hard to listen for; offer Ctrl+Alt+L too
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

// runSearch carved out to ./search.ts (Phase 6).

// appendSearchFile / renderSnippet / runSearch carved out to ./search.ts.
// configureSearch wires the legacy-resident openFile callback in.
configureSearch({ openFile: path => openFile(path) });

// Wire deps for the scripts-list renderer (Phase 6 carve).
configureScriptsList({
  openScriptForm: (id) => openScriptForm(id),
  toggleScriptEnabled: (id, enabled) => toggleScriptEnabled(id, enabled),
  setStatus: (msg, kind) => setStatus(msg, kind),
  moveScript: (fromId, toId, pos) => moveScript(fromId, toId, pos),
  setSidebarMode: (mode) => setSidebarMode(mode),
});

// Wire deps for the script form and CRUD operations (Phase 7 carve).
configureScriptForm({
  openFile: (path) => openFile(path),
  setStatus: (msg, kind) => setStatus(msg, kind),
  setSidebarMode: (mode) => setSidebarMode(mode),
  showCtxMenu: (el) => { _ctxMenuEl = el; document.body.appendChild(el); },
  closeCtxMenu: () => closeCtxMenu(),
});

// Wire deps for the navigator panel (Phase 6 carve).
configureNavigator({
  openFile: (path) => openFile(path),
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// Wire deps for scenario orchestrators (Phase 6 carve).
configureScenarios({
  setStatus: (msg, kind) => setStatus(msg, kind),
  refreshPreview: () => refreshPreview(),
});

// Wire deps for preview panel helpers (Phase 6 carve; buildPreviewHtml removed Phase 8 — now local).
configurePreviewHelpers({
  setSidebarMode: (mode) => setSidebarMode(mode),
  openScriptForm: (id) => openScriptForm(id),
  setStatus: (msg, kind) => setStatus(msg, kind),
});

// Wire sidebar configure (Phase 8 carve).
configureSidebar({
  onNotes: () => loadNotesForCurrentTemplate(),
});

// Wire review-modal configure (Phase 8 carve).
configureReviewModal({
  setStatus: (msg, kind) => setStatus(msg, kind),
  commitCurrentEdit: (showStatus) => commitCurrentEdit(showStatus),
  rezipAndSave: () => rezipAndSave(),
});

// ============================================================
// MODAL helpers
// ============================================================
// modalEls / openModal / closeModal / renderDiff / zipTextMap carved out to
// ./review-modal.ts. compareTemplates / reviewAndSave carved out in Phase 8.
const modalEls = getModalEls(); // still used by scenario matrix + diff views

// Track standalone original so diff works for non-zip files.
hookOn('afterLoadFromHandle', () => {
  if (state.standalone) state.standalone.original = state.standalone.content;
});

// ============================================================
// COMPARE TWO TEMPLATES
// ============================================================
// compareTemplates carved out to ./review-modal.ts (Phase 8).
document.getElementById('btn-compare').addEventListener('click', compareTemplates);

// Enable Compare button once a zip-based template is open; reset preview.
hookOn('afterLoadFromHandle', () => {
  document.getElementById('btn-compare').disabled = !state.zip;
  closePreview();
});

// ============================================================
// HTML PREVIEW (split iframe)
// ============================================================
// previewState carved out to ./preview.ts (Phase 6). Imported above.
// ZOOM_STEPS carved out to ./preview.ts.

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

// setPreviewMode, stepZoom, setZoom, applyZoomToFrame, applyZoomToFrameEl
// carved out to ./preview.ts (Phase 8).

// Ctrl + scroll over the preview pane to zoom
document.getElementById('preview-pane').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// togglePreview, openPreview, closePreview carved out to ./preview.ts (Phase 8).
// revokePreviewBlobs already in ./preview.ts (Phase 6) — duplicate removed.

// ============================================================
// DOCX theme extractor (sidebar Theme mode)
// ============================================================
// themeState / getZipText / parseDocxTheme / renderThemePanel / buildThemeCss
// carved out to ./preview.ts (Phase 6). Imported above.
// refreshPreview / renderTokensStrip / attachTokenJumpHandlers / renderCssView
// also in ./preview.ts (Phase 6 + Phase 8).

document.getElementById('btn-theme-copy').addEventListener('click', () => {
  if (!state.isDocx) { setStatus('Open a .docx first.', 'warn'); return; }
  const css = buildThemeCss();
  if (!css) { setStatus('No theme data to copy.', 'warn'); return; }
  navigator.clipboard.writeText(css).then(
    () => setStatus('Theme CSS copied to clipboard.', 'ok'),
    () => setStatus('Copy failed.', 'err'),
  );
});

// buildPreviewHtml and applyDatamodelPersonalization carved out to ./preview.ts (Phase 8).

// Auto-refresh preview when committing an edit to the previewed file
hookOn('afterCommitCurrentEdit', () => {
  if (previewState.open) refreshPreview();
});

// refreshScriptsList (scripts-panel.ts) emits this after re-parsing index.xml.
hookOn('afterReparseScripts', () => {
  renderScriptsList();
});

// Append the "Recent" group on top of the just-rendered scripts list.
// Runs as a second afterReparseScripts handler so it fires after renderScriptsList.
hookOn('afterReparseScripts', () => {
  if (!recentScriptsState.list.length) return;
  const list = document.getElementById('scripts-list');
  if (!list) return;
  const existing = list.querySelector('.scripts-group[data-recent="1"]');
  if (existing) existing.remove();
  list.querySelectorAll('.script-item[data-recent="1"]').forEach(el => el.remove());
  const head = document.createElement('div');
  head.className = 'scripts-group';
  head.dataset.recent = '1';
  head.textContent = `Recent  (${recentScriptsState.list.length})`;
  list.insertBefore(head, list.firstChild);
  let prev = head;
  for (const r of recentScriptsState.list) {
    const found = scriptsState.list.find(x => x.name === r.name);
    const el = document.createElement('div');
    el.className = 'script-item' + (found ? '' : ' disabled');
    el.dataset.recent = '1';
    const ago = Math.max(0, Date.now() - r.ts);
    const mins = Math.floor(ago / 60000);
    const when = mins < 1 ? 'just now' : (mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago');
    el.innerHTML = `<span class="badge">${escapeHtml(when)}</span><span class="name">${escapeHtml(r.name)}</span>${r.findText ? `<span class="find">${escapeHtml(r.findText)}</span>` : ''}`;
    el.title = found ? 'Open this script' : 'Script no longer present in this template';
    if (found) el.addEventListener('click', () => openScriptForm(found.id));
    prev.parentNode.insertBefore(el, prev.nextSibling);
    prev = el;
  }
});

// Preview pane resizer
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

// ============================================================
// SCRIPTS PANEL — parse <script> elements out of index.xml and
// expose a friendly form view for editing them (LenderRegisteredName,
// BrokerFeeOnApplicationRefundable, Control, etc.)
// ============================================================
// scriptsState migrated to ./scripts-panel.ts (Phase 5). Imported above.

// SCRIPT_HOST_CANDIDATES carved out to ./scripts-panel.ts.

// Strip CDATA sections by replacing each one with same-length whitespace.
// We need length parity so that match offsets we pull off `safe` are still
// valid offsets into the original text — that's how _raw and _start get
// captured for splice-back later. Inside `inner`, content that originally
// lived inside CDATA is now blanked out (so a literal "<script>" or
// "<\/script>" hiding inside JS source no longer fools the outer regex).
// stripCdataKeepingOffsets carved out to ./scripts-panel.ts.

// Parse all <script>…<\/script> blocks from a chunk of XML text.
// We use a regex on the raw text (rather than DOMParser) so we can
// later splice the edited XML back into the file at the same location
// without disturbing whitespace, comments or namespaces around it.
// parseScriptsFromXml carved out to ./scripts-panel.ts.

// decodeXmlEntities / encodeXmlText / encodeXmlAttr now live in the shared
// utilities region near the top of this script (search for "shared XML / text
// helpers"). Hoisted so non-Scripts code paths can use the same round-trip-
// safe encode/decode rules.

// replaceTagInner has been hoisted to the shared XML / text helpers region
// near the top of this script. Same behaviour, reused by the preset overlay
// form too.

// Build the new <script>…<\/script> XML using the form values, then splice it
// back into the index.xml content at the same byte offsets it came from.
// serializeScriptBack carved out to ./scripts-panel.ts.

// refreshScriptsList carved out to ./scripts-panel.ts (Phase 6).
// Emits 'afterReparseScripts' instead of calling renderScriptsList() directly.

// ============================================================
// DATAMODEL FIELD-PATH AUTOCOMPLETE
// Parses the .OL-datamodel inside the open template and populates a
// <datalist> so the script form's "Field path" inputs offer real
// suggestions while still allowing free typing.
// ============================================================
// findDatamodelPath carved out to ./scripts-panel.ts (Phase 6).
// parseDatamodelFields carved out to ./scripts-panel.ts.
// refreshDatamodelFields carved out to ./scripts-panel.ts (Phase 6).

// PlanetPress field types map onto the form's <select> options.
// dmTypeToFormType carved out to ./scripts-panel.ts.

// bindFieldPathAutotype / bindFieldMetaLiveUpdate / setSelectValue /
// ensureScriptSourceEditor / updateFieldMeta / updateUsagesPanel /
// toggleScriptEnabled / cloneScript / bulkSetEnabled / bulkDelete /
// moveScript / openScriptForm / closeScriptForm / applyScriptForm /
// offerRenameTokenAcrossFiles carved out to ./script-form.ts (Phase 7).
// Script-panel controls + form event listeners wired via configureScriptForm().

// ============================================================
// SECTION / MASTER / SNIPPET NAVIGATOR
// ============================================================
// parseNavigatorEntries carved out to ./navigator.ts (Phase 6).
// renderNavigator carved out to ./navigator.ts (Phase 6).
// normalizeNavPath carved out to ./navigator.ts (Phase 6).

// ============================================================
// RECENT TEMPLATES (IndexedDB-backed)
// ============================================================
// Pure persistence + formatting helpers carved out to ./recents.ts.
// The DOM menu wiring below and openRecentItem() stay here for now;
// they'll move once fs/tree/editor are extracted (they call into
// loadFromHandle / scanFolderTemplates / setStatus, all still local).

document.getElementById('btn-recents').addEventListener('click', async e => {
  e.stopPropagation();
  const menu = document.getElementById('recents-menu');
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  const items = await recentsList();
  menu.innerHTML = '';
  if (!items.length) {
    menu.innerHTML = '<div class="empty">No recent files yet — open a template and it\'ll show up here.</div>';
  } else {
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<span class="name">${it.kind === 'folder' ? '📁 ' : ''}${escapeHtml(it.name)}</span><span class="when">${formatRecentTime(it.openedAt || 0)}</span>`;
      row.addEventListener('click', async () => {
        menu.classList.remove('show');
        await openRecentItem(it);
      });
      menu.appendChild(row);
    }
    const clear = document.createElement('div');
    clear.className = 'clear';
    clear.textContent = 'Clear recent files';
    clear.addEventListener('click', async () => {
      menu.classList.remove('show');
      await recentsClear();
      setStatus('Recent files cleared.', 'ok');
    });
    menu.appendChild(clear);
  }
  // Position the menu under the button
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.classList.add('show');
});
// Dismiss on outside click
document.addEventListener('click', e => {
  const m = document.getElementById('recents-menu');
  if (m && m.classList.contains('show') && !m.contains(e.target) && e.target.id !== 'btn-recents') {
    m.classList.remove('show');
  }
});

async function openRecentItem(item) {
  try {
    if (item.handle.queryPermission) {
      let perm = await item.handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await item.handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          setStatus('Permission denied.', 'err');
          return;
        }
      }
    }
    if (item.kind === 'folder') {
      state.dirHandle = item.handle;
      state.dirName = item.handle.name;
      await scanFolderTemplates(item.handle, false);
      document.getElementById('folder-panel').style.display = '';
      document.getElementById('tree-panel').style.display = 'none';
      document.getElementById('folder-name').textContent = item.handle.name;
      document.getElementById('btn-back').style.display = 'none';
      document.getElementById('empty').classList.remove('hidden');
      document.getElementById('editor-tab').style.display = 'none';
      document.getElementById('editor').style.display = 'none';
      document.getElementById('binary-view').classList.remove('show');
      document.getElementById('btn-rezip').disabled = true;
      document.getElementById('btn-save').disabled = true;
      document.getElementById('filename').textContent = `Folder: ${item.handle.name}`;
    } else {
      state.dirHandle = null; state.folderTemplates = []; state.dirName = null;
      document.getElementById('btn-back').style.display = 'none';
      document.getElementById('folder-panel').style.display = 'none';
      await loadFromHandle(item.handle);
    }
    await recentsAdd(item.handle, item.kind);
  } catch (e) {
    setStatus('Could not re-open ' + item.name + ': ' + e.message, 'err');
    // If the file's gone or moved, drop it
    if (e.name === 'NotFoundError') await recentsRemove(item.name);
  }
}

// Hook into the existing open flows so newly-opened items get recorded
hookOn('afterLoadFromHandle', (handle) => {
  if (handle && !state.dirHandle) recentsAdd(handle, 'file');
});
hookOn('afterPickAndOpenFolder', () => {
  if (state.dirHandle) recentsAdd(state.dirHandle, 'folder');
});

// ============================================================
// SCRIPT CREATE / DELETE
// ============================================================
// createScript / deleteScript + all CRUD event listeners
// carved out to ./script-form.ts (Phase 7).

// ============================================================
// LOCKED-FOLDER UNLOCK
// ------------------------------------------------------------
// OL Connect Designer marks five folders inside every template as read-only:
// snippets, translations, js, fonts, color-profiles. On disk these show up as
// zero-byte zip entries with the folder's exact path as the entry name (in
// PlanetPress's typical backslash form, e.g. `public\document\snippets`).
// Removing those marker entries from the package is enough to "unlock" the
// folders — Designer no longer enforces the read-only behaviour next time the
// template is opened, and the editor can add files at those paths freely.
// ============================================================
const LOCKED_FOLDER_RELATIVE_PATHS = [
  'public/document/snippets',
  'public/document/translations',
  'public/document/js',
  'public/document/fonts',
  'public/document/color-profiles',
];
const LOCKED_FOLDER_PATH_SET = new Set(LOCKED_FOLDER_RELATIVE_PATHS);

function isLockedFolderMarker(rawPath, fileEntry) {
  if (!fileEntry) return false;
  const norm = rawPath.replace(/\\/g, '/');
  if (!LOCKED_FOLDER_PATH_SET.has(norm)) return false;
  // Marker entries are always zero bytes — both text decode (empty string)
  // and binary (Uint8Array length 0) need to count as empty.
  if (fileEntry.isText) return typeof fileEntry.content === 'string' && fileEntry.content.length === 0;
  return !fileEntry.content || fileEntry.content.length === 0;
}

function findLockedFolderEntries() {
  const out = [];
  for (const [path, f] of Object.entries(state.files)) {
    if (isLockedFolderMarker(path, f)) out.push(path);
  }
  return out;
}

function unlockTemplateFolders() {
  if (!state.fileHandle || !state.zip) {
    setStatus('Open a .OL-template first.', 'warn');
    return 0;
  }
  const markers = findLockedFolderEntries();
  if (!markers.length) {
    setStatus('No locked folder markers detected — nothing to unlock.', 'warn');
    return 0;
  }
  for (const p of markers) {
    delete state.files[p];
    if (state.monacoModels && state.monacoModels[p]) {
      try { state.monacoModels[p].dispose(); } catch (_) {}
      delete state.monacoModels[p];
    }
    if (state.currentPath === p) state.currentPath = null;
  }
  buildTree();
  refreshTreeDirtyMarkers();
  updateFileButtons();
  const human = markers.map(p => p.replace(/\\/g, '/')).join(', ');
  setStatus(
    `Unlocked ${markers.length} folder${markers.length === 1 ? '' : 's'}: ${human}. Use + New to add files inside (e.g. public/document/snippets/MySnippet.html); click Review & Save to write the unlock to disk.`,
    'ok'
  );
  return markers.length;
}

// ============================================================
// FILE ADD / RENAME / DELETE
// ============================================================
document.getElementById('btn-file-new').addEventListener('click', () => promptNewFile());
document.getElementById('btn-file-rename').addEventListener('click', () => {
  if (state.currentPath) renameFile(state.currentPath);
});
document.getElementById('btn-file-delete').addEventListener('click', () => {
  if (state.currentPath) deleteFile(state.currentPath);
});
document.getElementById('btn-file-unlock').addEventListener('click', () => unlockTemplateFolders());

function updateFileButtons() {
  const has = !!state.currentPath && !!state.files[state.currentPath];
  document.getElementById('btn-file-rename').disabled = !has;
  document.getElementById('btn-file-delete').disabled = !has;
  // Unlock is available whenever the open template still has at least one
  // locked-folder marker entry. Standalone files never qualify.
  const unlockBtn = document.getElementById('btn-file-unlock');
  if (unlockBtn) {
    const lockedCount = (state.zip && !state.standalone) ? findLockedFolderEntries().length : 0;
    unlockBtn.disabled = lockedCount === 0;
    unlockBtn.title = lockedCount === 0
      ? 'No locked folder markers in this template'
      : `Unlock ${lockedCount} folder${lockedCount === 1 ? '' : 's'} (snippets / translations / js / fonts / color-profiles)`;
  }
  const ctx = document.getElementById('file-toolbar-ctx');
  if (state.currentPath) {
    const dir = state.currentPath.includes('/') ? state.currentPath.substring(0, state.currentPath.lastIndexOf('/') + 1) : '/';
    ctx.textContent = 'in: ' + dir;
    ctx.title = 'New files will be created in: ' + dir;
  } else {
    ctx.textContent = '';
    ctx.title = '';
  }
}

function promptNewFile() {
  if (!state.fileHandle) { setStatus('Open a template first.', 'warn'); return; }
  if (state.standalone) { setStatus('Cannot add files to a standalone file — open a .OL-template or .OL-datamapper.', 'warn'); return; }
  // Default location: same dir as current file (handy for adding XMLs into SampleDataFiles/)
  const baseDir = (state.currentPath && state.currentPath.includes('/'))
    ? state.currentPath.substring(0, state.currentPath.lastIndexOf('/') + 1)
    : '';

  // Build a list of every directory currently in the template, so the user
  // can autocomplete against real folders rather than typing them by hand.
  // Honours both '/' and '\\' separators (PlanetPress zips use backslashes).
  const dirSet = new Set();
  for (const path of Object.keys(state.files)) {
    const norm = path.replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    if (i > 0) dirSet.add(norm.slice(0, i + 1));
  }
  const dirs = [...dirSet].sort();
  // A few well-known target folders specific to PlanetPress templates that
  // may not exist yet (e.g. before unlock-folders is run). Surface them
  // anyway so the user can land in the right place.
  const knownDirs = [
    'public/document/snippets/',
    'public/document/translations/',
    'public/document/js/',
    'public/document/fonts/',
    'public/document/color-profiles/',
    'SampleDataFiles/',
  ];
  for (const d of knownDirs) if (!dirSet.has(d)) dirs.push(d);

  // Open the modal and wire the autotype-on-pick binding.
  openNewFileModal({ baseDir, dirs }, ({ dir, name, ext }) => {
    const cleanDir = (dir || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const cleanName = (name || '').trim().replace(/^\/+/, '');
    if (!cleanName) { setStatus('Empty filename.', 'warn'); return; }
    // If the user already included an extension in the name, respect it;
    // otherwise append the picked one.
    const hasExt = /\.[^./\\]+$/.test(cleanName);
    const finalName = hasExt ? cleanName : (ext ? `${cleanName}.${ext}` : cleanName);
    const path = (cleanDir ? (cleanDir.endsWith('/') ? cleanDir : cleanDir + '/') : '') + finalName;
    if (!path) { setStatus('Empty filename.', 'warn'); return; }
    if (state.files[path]) { setStatus('A file with that path already exists.', 'err'); return; }

    const e = extOf(path);
    let initial = '';
    if (e === 'xml') initial = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root>\n</root>\n';
    else if (e === 'json') initial = '{\n}\n';
    else if (e === 'html' || e === 'htm') initial = '<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n</body>\n</html>\n';

    state.files[path] = { content: initial, isText: true, dirty: true, added: true };
    buildTree();
    refreshTreeDirtyMarkers();
    openFile(path);
    setStatus(`Added ${path}. Click Review & Save to write it into the template.`, 'ok');
  });
}

// Generic autotype binding lifted from bindFieldPathAutotype: when the
// directory <input> value matches a key in `mapping`, set the extension
// <select> to the mapped value. Same datalist-driven pattern, used here
// for the +New file dialog so picking "public/document/snippets/" auto-
// fills the .html extension, "SampleDataFiles/" picks .xml, and so on.
function bindAutotypeByMap(srcInput, dstSelect, mapping) {
  if (!srcInput || !dstSelect) return;
  const handler = () => {
    const key = (srcInput.value || '').toLowerCase();
    // Try exact match first; fall back to longest-prefix match so partial
    // typing still hints reasonably.
    let target = mapping[key];
    if (!target) {
      let bestLen = 0;
      for (const k of Object.keys(mapping)) {
        if (key.startsWith(k) && k.length > bestLen) { bestLen = k.length; target = mapping[k]; }
      }
    }
    if (target) {
      // Only override if the user hasn't manually picked something — ie
      // the dropdown is still on its default. This stops the autotype from
      // fighting an explicit choice.
      if (!dstSelect.dataset.userTouched) dstSelect.value = target;
    }
  };
  srcInput.addEventListener('change', handler);
  srcInput.addEventListener('input', handler);
  dstSelect.addEventListener('change', () => { dstSelect.dataset.userTouched = '1'; });
}

// Modal for the +New file dialog. Shows a directory <input>+datalist, a
// filename input, and an extension <select>. Picking a known directory
// auto-fills the extension via bindAutotypeByMap. Returns via callback.
function openNewFileModal({ baseDir, dirs }, onConfirm) {
  // Clean up any prior instance so re-opening works cleanly.
  const existing = document.getElementById('new-file-modal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'new-file-modal';
  wrap.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 500;
    display: flex; align-items: center; justify-content: center;
  `;
  wrap.innerHTML = `
    <div style="background:var(--panel-2);border:1px solid var(--border);border-radius:6px;
                padding:18px 20px;min-width:480px;max-width:90vw;color:var(--text);
                font-family:inherit;font-size:13px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">Add a new file</div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:2;display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Folder</label>
          <input id="nf-dir" list="nf-dir-list" autocomplete="off" spellcheck="false"
                 style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                        border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
          <datalist id="nf-dir-list"></datalist>
        </div>
        <div style="flex:0 0 110px;display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Extension</label>
          <select id="nf-ext"
                  style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                         border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
            <option value="">(none)</option>
            <option value="xml">xml</option>
            <option value="html">html</option>
            <option value="htm">htm</option>
            <option value="json">json</option>
            <option value="css">css</option>
            <option value="js">js</option>
            <option value="md">md</option>
            <option value="txt">txt</option>
          </select>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px;">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Filename</label>
        <input id="nf-name" autocomplete="off" spellcheck="false"
               style="background:var(--bg);color:var(--text);border:1px solid var(--border);
                      border-radius:3px;padding:6px 8px;font-family:monospace;font-size:12px;">
      </div>
      <div style="color:var(--muted);font-size:11px;margin-bottom:12px;">
        Pick a folder from the list (or type a new one). Picking a known folder
        auto-fills a sensible extension.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="nf-cancel" class="ghost" style="background:transparent;color:var(--muted);
                border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;">Cancel</button>
        <button id="nf-ok" style="background:var(--accent);color:white;border:0;
                border-radius:3px;padding:6px 16px;cursor:pointer;">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // Populate the datalist with every known dir + the well-known PlanetPress paths.
  const dl = wrap.querySelector('#nf-dir-list');
  for (const d of dirs) {
    const opt = document.createElement('option');
    opt.value = d;
    dl.appendChild(opt);
  }

  const dirInput = wrap.querySelector('#nf-dir');
  const nameInput = wrap.querySelector('#nf-name');
  const extSelect = wrap.querySelector('#nf-ext');

  // Seed defaults from the currently-open file's directory.
  dirInput.value = baseDir || '';
  nameInput.value = 'new-file';
  extSelect.value = 'xml';

  // Wire the autotype: known PlanetPress folders → sensible extension.
  bindAutotypeByMap(dirInput, extSelect, {
    'public/document/snippets/': 'html',
    'public/document/translations/': 'xml',
    'public/document/js/': 'js',
    'public/document/fonts/': '',
    'public/document/color-profiles/': '',
    'sampledatafiles/': 'xml',
  });

  function close() { wrap.remove(); document.removeEventListener('keydown', escClose, true); }
  function escClose(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', escClose, true);
  wrap.querySelector('#nf-cancel').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#nf-ok').addEventListener('click', () => {
    const dir = dirInput.value.trim();
    const name = nameInput.value.trim();
    const ext = extSelect.value.trim();
    close();
    onConfirm({ dir, name, ext });
  });
  // Enter-to-submit on either input.
  for (const inp of [dirInput, nameInput]) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); wrap.querySelector('#nf-ok').click(); }
    });
  }
  setTimeout(() => nameInput.focus(), 0);
}

function renameFile(oldPath) {
  if (!state.files[oldPath]) return;
  if (state.standalone) { setStatus('Standalone files cannot be renamed from here.', 'warn'); return; }
  const next = prompt('New path for this file:', oldPath);
  if (next == null) return;
  const newPath = next.trim().replace(/^\/+/, '');
  if (!newPath || newPath === oldPath) return;
  if (state.files[newPath]) { setStatus('A file already exists at that path.', 'err'); return; }

  const f = state.files[oldPath];
  // Capture current edited content from monaco (so unsaved edits survive the rename)
  if (state.monacoModels[oldPath]) f.content = state.monacoModels[oldPath].getValue();
  state.files[newPath] = Object.assign({}, f, { dirty: true, renamedFrom: f.renamedFrom || oldPath });
  delete state.files[oldPath];

  // Move the monaco model
  if (state.monacoModels[oldPath]) {
    const oldModel = state.monacoModels[oldPath];
    const newModel = monaco.editor.createModel(oldModel.getValue(), langFor(newPath));
    newModel.onDidChangeContent(() => {
      state.files[newPath].dirty = true;
      refreshTreeDirtyMarkers();
      document.getElementById('btn-save').disabled = false;
    });
    state.monacoModels[newPath] = newModel;
    oldModel.dispose();
    delete state.monacoModels[oldPath];
  }
  if (state.currentPath === oldPath) state.currentPath = newPath;
  buildTree();
  refreshTreeDirtyMarkers();
  if (state.currentPath === newPath) openFile(newPath);
  setStatus(`Renamed to ${newPath}.`, 'ok');
}

function deleteFile(path) {
  if (!state.files[path]) return;
  if (state.standalone) { setStatus('Cannot delete the standalone file (just close it).', 'warn'); return; }
  if (!confirm(`Delete "${path}" from this template?\n\nThe file will be removed when you Review & Save.`)) return;
  if (state.monacoModels[path]) {
    state.monacoModels[path].dispose();
    delete state.monacoModels[path];
  }
  delete state.files[path];

  if (state.currentPath === path) {
    state.currentPath = null;
    document.getElementById('editor').style.display = 'none';
    document.getElementById('editor-tab').style.display = 'none';
    document.getElementById('binary-view').classList.remove('show');
    document.getElementById('btn-save').disabled = true;
  }
  buildTree();
  refreshTreeDirtyMarkers();
  setStatus(`Removed ${path}. Click Review & Save to apply.`, 'ok');
}

// Right-click on a tree file item -> mini context menu
let _ctxMenuEl = null;
function closeCtxMenu() { if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; } }
document.addEventListener('click', closeCtxMenu);

// Generic context-menu builder. Items are [{ label, onClick, danger?, sep? }];
// pass { sep: true } as a divider. Mounts at (x, y), auto-dismisses on
// the next document click (handled by the global `click → closeCtxMenu`
// listener above). Centralised so the Scripts / Sections / Search /
// File-tree menus all share the same look + dismiss semantics.
function openContextMenu(items, x, y) {
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'item' + (it.danger ? ' danger' : '');
    el.textContent = it.label;
    if (it.title) el.title = it.title;
    el.addEventListener('click', () => {
      closeCtxMenu();
      try { it.onClick && it.onClick(); } catch (e) { console.error(e); }
    });
    menu.appendChild(el);
  }
  document.body.appendChild(menu);
  _ctxMenuEl = menu;
  return menu;
}

// Best-effort copy-to-clipboard. Falls back to a transient textarea select
// for non-secure-context environments where navigator.clipboard isn't
// exposed. Used by every "Copy path" menu action.
function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => setStatus(`Copied: ${text}`, 'ok'),
        () => fallback()
      );
    }
  } catch (_) {}
  fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); setStatus(`Copied: ${text}`, 'ok'); }
    catch (_) { setStatus('Copy failed.', 'err'); }
    ta.remove();
  }
}

// Try to switch the tree to Files mode and reveal the row for `path`.
// Defensive about whether setSidebarMode / the tree exist yet.
function revealInTree(path) {
  try { setSidebarMode('files'); } catch (_) {}
  // Scroll the tree row into view if we can find it.
  setTimeout(() => {
    try {
      const el = document.querySelector(`.tree-item.file[data-path="${CSS.escape(path)}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } catch (_) { /* CSS.escape may not exist; ignore */ }
  }, 30);
}

document.addEventListener('contextmenu', e => {
  // File tree row → Open / Rename / Delete (existing behaviour, now via the
  // shared builder).
  const fileItem = e.target.closest && e.target.closest('.tree-item.file');
  if (fileItem) {
    e.preventDefault();
    const path = fileItem.dataset.path;
    if (!path) return;
    openContextMenu([
      { label: 'Open',           onClick: () => openFile(path) },
      { label: 'Open in new tab', onClick: () => {
          // Best-effort: emit the in-memory text into a new browser tab so
          // the user can read/copy without leaving the editor. For binary
          // files we fall back to a notice.
          const f = state.files[path];
          if (!f) return;
          if (f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = path;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[path] ? state.monacoModels[path].getValue() : f.content) || '';
            }
          } else {
            setStatus('Binary file — open in new tab not supported.', 'warn');
          }
        }
      },
      { label: 'Copy path',      onClick: () => copyToClipboard(path) },
      { sep: true },
      { label: 'Rename…',        onClick: () => renameFile(path) },
      { label: 'Delete',         onClick: () => deleteFile(path), danger: true },
    ], e.clientX, e.clientY);
    return;
  }

  // Sections / Masters / Snippets navigator → Open / Open in new tab /
  // Copy path / Reveal in tree. Same pattern as the file tree but without
  // rename / delete (those edit the host file rather than the named entry).
  const navItem = e.target.closest && e.target.closest('.nav-item');
  if (navItem) {
    e.preventDefault();
    const path = (navItem.title || '').trim();
    if (!path) return;
    const resolved = (typeof normalizeNavPath === 'function') ? normalizeNavPath(path) : path;
    openContextMenu([
      { label: 'Open',            onClick: () => openFile(resolved) },
      { label: 'Open in new tab', onClick: () => {
          const f = state.files[resolved];
          if (f && f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = resolved;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[resolved] ? state.monacoModels[resolved].getValue() : f.content) || '';
            }
          } else {
            setStatus('No content for ' + resolved, 'warn');
          }
        }
      },
      { label: 'Copy path',       onClick: () => copyToClipboard(resolved) },
      { sep: true },
      { label: 'Reveal in tree',  onClick: () => revealInTree(resolved) },
    ], e.clientX, e.clientY);
    return;
  }

  // Search results — both the per-file header and individual hit rows.
  // Replace match opens a small prompt; we look up the path from the
  // closest .search-file header ancestor (hits don't carry the path on
  // themselves in the existing renderer, so we walk up).
  const searchHit = e.target.closest && e.target.closest('.search-hit');
  const searchFile = e.target.closest && e.target.closest('.search-file');
  if (searchHit || searchFile) {
    e.preventDefault();
    // Walk up the search-results container to find the most recent .search-file
    // header above this row. The renderer appends file headers in document
    // order followed by their hits, so the previous sibling chain works.
    let path = '';
    if (searchFile) {
      const txt = searchFile.textContent || '';
      const m = /^(.*)\s+\(\d+\)\s*$/.exec(txt);
      path = m ? m[1] : txt.trim();
    } else if (searchHit) {
      let prev = searchHit.previousElementSibling;
      while (prev && !prev.classList.contains('search-file')) prev = prev.previousElementSibling;
      if (prev) {
        const txt = prev.textContent || '';
        const m = /^(.*)\s+\(\d+\)\s*$/.exec(txt);
        path = m ? m[1] : txt.trim();
      }
    }
    if (!path || !state.files[path]) return;
    openContextMenu([
      { label: 'Open',            onClick: () => openFile(path) },
      { label: 'Open in new tab', onClick: () => {
          const f = state.files[path];
          if (f && f.isText) {
            const w = window.open('', '_blank');
            if (w) {
              w.document.title = path;
              w.document.body.style.cssText = 'font-family:monospace;white-space:pre;padding:12px;';
              w.document.body.textContent = (state.monacoModels[path] ? state.monacoModels[path].getValue() : f.content) || '';
            }
          }
        }
      },
      { label: 'Copy path',       onClick: () => copyToClipboard(path) },
      { sep: true },
      { label: 'Replace match in this file…', onClick: () => {
          const q = (document.getElementById('search-input') || {}).value || '';
          if (!q) { setStatus('Search query is empty.', 'warn'); return; }
          const replacement = prompt(`Replace all "${q}" in ${path} with:`, q);
          if (replacement == null) return;
          const f = state.files[path];
          if (!f) return;
          const model = state.monacoModels[path];
          const text = model ? model.getValue() : f.content;
          // Honour the search panel's regex / case / word-boundary modifiers
          // so "Replace match" matches the same hits the user sees.
          const useRegex = (document.getElementById('search-regex') || {}).checked;
          const caseSensitive = (document.getElementById('search-case') || {}).checked;
          const wholeWord = (document.getElementById('search-word') || {}).checked;
          let pattern;
          try {
            let src = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (wholeWord) src = `\\b(?:${src})\\b`;
            pattern = new RegExp(src, caseSensitive ? 'g' : 'gi');
          } catch (err) { setStatus('Bad regex: ' + err.message, 'err'); return; }
          const before = text;
          const updated = before.replace(pattern, replacement);
          if (updated === before) { setStatus('No matches replaced.', 'warn'); return; }
          if (model) {
            const range = model.getFullModelRange();
            model.pushEditOperations([], [{ range, text: updated }], () => null);
          }
          f.content = updated;
          f.dirty = true;
          refreshTreeDirtyMarkers();
          if (typeof runSearch === 'function') runSearch();
          setStatus(`Replaced matches in ${path}. Click Review & Save to apply.`, 'ok');
        }
      },
    ], e.clientX, e.clientY);
    return;
  }
  // No matching selector — fall through. We deliberately do NOT call
  // closeCtxMenu() here: the .script-item contextmenu handler is registered
  // separately and runs in the same event, so closing the menu we open in
  // that handler would be a regression. The global click listener handles
  // dismissal.
});

// Close script form and update toolbar buttons on file open
hookOn('beforeOpenFile', () => {
  document.getElementById('script-form-view').classList.remove('show');
  scriptsState.active = null;
});
hookOn('afterOpenFile', () => {
  updateFileButtons();
});

// Track edits to index.xml so Scripts list always reflects current text
hookOn('afterCommitCurrentEdit', () => {
  if (state.currentPath && SCRIPT_HOST_CANDIDATES.includes(state.currentPath)) {
    refreshScriptsList();
  }
});

// ============================================================
// REZIP — include newly-added files (the original loop only walked
// state.zip's existing entries). Also drives "added" markers in the
// Review modal.
// ============================================================
// Full override of the simple original rezipAndSave — handles added files,
// review modal drive, and standalone mode (original is superseded entirely).
rezipAndSave = async function () {
  if (!state.fileHandle) return;
  commitCurrentEdit(false);

  document.getElementById('btn-rezip').disabled = true;
  try {
    let blob;
    if (state.zip) {
      setStatus('Building zip...');
      const out = new JSZip();
      const seen = new Set();
      state.zip.forEach((path, entry) => {
        if (entry.dir) return;
        const f = state.files[path];
        if (!f) return;
        seen.add(path);
        const date = entry.date || new Date();
        if (f.isText) out.file(path, f.content, { date });
        else out.file(path, f.content, { date, binary: true });
      });
      const now = new Date();
      for (const [path, f] of Object.entries(state.files)) {
        if (seen.has(path)) continue;
        if (f.isText) out.file(path, f.content, { date: now });
        else out.file(path, f.content, { date: now, binary: true });
      }
      blob = await out.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    } else if (state.standalone) {
      const f = state.files[state.fileName];
      blob = new Blob([f.content], { type: 'text/plain' });
    } else {
      return;
    }

    if (state.fileHandle.queryPermission) {
      const perm = await state.fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const req = await state.fileHandle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') {
          setStatus('Write permission denied.', 'err');
          return;
        }
      }
    }
    const writable = await state.fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    for (const f of Object.values(state.files)) { f.dirty = false; f.added = false; }
    if (state.standalone) state.standalone.dirty = false;
    refreshTreeDirtyMarkers();

    const sizeKb = (blob.size / 1024).toFixed(1);
    setStatus(`Saved ${state.fileName} (${sizeKb} KB).`, 'ok');

    if (state.zip) {
      try {
        const file = await state.fileHandle.getFile();
        state.zip = await JSZip.loadAsync(file);
      } catch (_) { /* ignore */ }
    }
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'err');
    console.error(e);
  } finally {
    document.getElementById('btn-rezip').disabled = false;
  }
};

// reviewAndSave carved out to ./review-modal.ts (Phase 8). replaceWith hack removed.
document.getElementById('btn-rezip').disabled = !state.fileHandle;

// Whenever a template is loaded, refresh the scripts list and toolbar
hookOn('afterLoadFromHandle', () => {
  refreshScriptsList();
  updateFileButtons();
  if (typeof renderNavigator === 'function') renderNavigator();
  document.getElementById('btn-rezip').disabled = false;
  // Surface locked-folder status so the user knows the 🔓 Unlock button is live
  if (state.zip && !state.standalone) {
    const locked = (typeof findLockedFolderEntries === 'function') ? findLockedFolderEntries() : [];
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


// ============================================================================
// SCENARIOS, NOTES, RECENT SCRIPTS, MONACO "GO TO SCRIPT", COVERAGE/DIFF, FORM
// (Added: 2026-04-30 — workflow improvements for the docx -> template ->
//  datamapper-scenarios -> render loop. See template-editor-improvement-plan.md)
// ============================================================================

// ---------- SCENARIOS ----------
// A "scenario" is one of the SampleDataFiles/*.xml files inside an .OL-datamapper.
// When a scenario is active, its leaf-element path -> text-content map overrides
// the datamodel's lastValue substitution in the preview, so the same template
// renders against many different test inputs without leaving the editor.
// scenariosState migrated to ./scenarios.ts (Phase 5). Imported above.

// scnPersistKey carved out to ./scenarios.ts (Phase 6).
// parseScenarioXmlToMap carved out to ./scenarios.ts (Phase 6).

// readScenariosFromZip carved out to ./scenarios.ts (Phase 6).
// autoLoadScenariosFromFolder carved out to ./scenarios.ts (Phase 6).
// pickAndLoadScenarios carved out to ./scenarios.ts (Phase 6).
// populateScenarioPicker carved out to ./scenarios.ts (Phase 6).
// activateScenario carved out to ./scenarios.ts (Phase 6).

// Wire scenario picker UI
(function wireScenarios() {
  const sel = document.getElementById('preview-scenario');
  if (sel) sel.addEventListener('change', () => activateScenario(sel.value || null, false));
  const loadBtn = document.getElementById('btn-scenario-load');
  if (loadBtn) loadBtn.addEventListener('click', pickAndLoadScenarios);
  const matrixBtn = document.getElementById('btn-scenario-matrix');
  if (matrixBtn) matrixBtn.addEventListener('click', openCoverageMatrix);
  const diffBtn = document.getElementById('btn-scenario-diff');
  if (diffBtn) diffBtn.addEventListener('click', openScenarioDiff);
  const editBtn = document.getElementById('btn-scenario-edit');
  if (editBtn) editBtn.addEventListener('click', openScenarioFormForActive);
})();

// Refresh scenarios + notes whenever a new template loads
hookOn('afterLoadFromHandle', async () => {
  try {
    if (!scenariosState.list.length) await autoLoadScenariosFromFolder();
    populateScenarioPicker();
  } catch (e) { console.warn('[scenarios] hook failed:', e); }
  try { loadNotesForCurrentTemplate(); } catch (e) { console.warn('[notes]', e); }
});

// ---------- COVERAGE MATRIX ----------
// Modal: table with one row per scenario, one column per Section in index.xml,
// each cell showing whether each conditional script in that section is SHOWN
// or HIDDEN under that scenario. Click a cell to render that combination.
function openCoverageMatrix() {
  if (!scenariosState.list.length) { setStatus('No scenarios loaded.', 'warn'); return; }
  // Need an HTML target. If a section is open, use it; else use the first section in index.xml.
  const sectionPaths = collectSectionHtmlPaths();
  if (!sectionPaths.length) { setStatus('No section HTML found in this template.', 'warn'); return; }

  // Build matrix: rows = scenarios, cols = sections
  const rows = scenariosState.list.map(s => ({ name: s.name, valueByPath: s.valueByPath }));
  // Default scenario: undefined overrides == datamodel sample
  rows.unshift({ name: '(datamodel sample)', valueByPath: null });

  openModal('Scenario coverage matrix', 'Close', closeModal);
  modalEls.action.textContent = 'Close';
  modalEls.cancel.style.display = 'none';
  modalEls.sidebar.innerHTML = '<div id="matrix-help">Click a cell to render that scenario × section into the main preview pane.</div>';
  // Build grid
  const main = modalEls.main;
  main.innerHTML = '';
  const tbl = document.createElement('table');
  tbl.className = 'matrix-grid';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = '<th>Scenario</th>' + sectionPaths.map(p => `<th title="${escapeHtml(p.path)}">${escapeHtml(p.name)}</th>`).join('');
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = r.name;
    th.style.maxWidth = '240px';
    th.style.overflow = 'hidden';
    th.style.textOverflow = 'ellipsis';
    tr.appendChild(th);
    for (const sec of sectionPaths) {
      const td = document.createElement('td');
      td.className = 'matrix-cell';
      const summary = summarizeScenarioForSection(r.valueByPath, sec.path);
      td.innerHTML = summary.html;
      td.title = summary.tip;
      td.addEventListener('click', () => {
        // Set scenario, open the section, ensure preview is open
        const sel = document.getElementById('preview-scenario');
        sel.value = r.valueByPath ? r.name : '';
        activateScenario(r.valueByPath ? r.name : null, false);
        openFile(sec.path);
        if (!previewState.open) openPreview();
        else refreshPreview();
        closeModal();
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  main.appendChild(tbl);
}

// Collect section paths from index.xml's <sections> entries (friendly names).
function collectSectionHtmlPaths() {
  if (typeof parseNavigatorEntries !== 'function') return [];
  const groups = parseNavigatorEntries();
  const out = [];
  for (const sec of groups.sections || []) {
    const p = (typeof normalizeNavPath === 'function') ? normalizeNavPath(sec.location) : sec.location;
    if (state.files[p]) out.push({ name: sec.name, path: p });
  }
  return out;
}

// Build a per-cell label: # of conditional scripts whose result changes under
// this scenario relative to the datamodel sample, plus a #unresolved count.
function summarizeScenarioForSection(overrides, sectionPath) {
  const f = state.files[sectionPath];
  if (!f || !f.isText) return { html: '<span class="badge unres">?</span>', tip: 'no file' };
  const html = state.monacoModels[sectionPath]
    ? state.monacoModels[sectionPath].getValue()
    : f.content;
  // Save current scenario, render this combination once, count states.
  const stash = scenariosState.activeOverrides;
  scenariosState.activeOverrides = overrides;
  let shownCount = 0, hiddenCount = 0;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc && doc.body && typeof applyDatamodelPersonalization === 'function') {
      applyDatamodelPersonalization(doc);
      // Count things that ended up display:none
      doc.body.querySelectorAll('[style]').forEach(el => {
        if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) hiddenCount++;
        else shownCount++;
      });
    }
  } catch (_) { /* ignore */ }
  scenariosState.activeOverrides = stash;
  const tip = `${shownCount} visible block(s), ${hiddenCount} hidden`;
  return {
    html: `<span class="badge shown">${shownCount}</span> <span class="badge hidden">${hiddenCount}</span>`,
    tip,
  };
}

// ---------- SCENARIO DIFF ----------
function openScenarioDiff() {
  if (scenariosState.list.length < 2) { setStatus('Need at least 2 scenarios.', 'warn'); return; }
  // Need a template HTML target — use currently-open html, else the first section.
  let target = state.currentPath && /\.html?$/i.test(state.currentPath) ? state.currentPath : null;
  if (!target) {
    const secs = collectSectionHtmlPaths();
    if (secs.length) target = secs[0].path;
  }
  if (!target) { setStatus('Open an HTML file first.', 'warn'); return; }

  openModal('Scenario diff', 'Close', closeModal);
  modalEls.action.textContent = 'Close';
  modalEls.cancel.style.display = 'none';
  modalEls.sidebar.innerHTML = `<div id="matrix-help">Pick two scenarios, see the rendered output and field-level deltas.</div>`;
  modalEls.main.innerHTML = `
    <div id="scenario-diff-pane">
      <div id="scenario-diff-pickers">
        <span>Left:</span>
        <select id="scn-diff-a"></select>
        <span style="margin-left:18px;">Right:</span>
        <select id="scn-diff-b"></select>
        <span style="margin-left:18px; color:var(--muted);">Target:</span>
        <span style="font-family:monospace;">${escapeHtml(target)}</span>
      </div>
      <div id="scenario-diff-frames">
        <div class="pane">
          <div class="pane-label" id="scn-diff-a-label">left</div>
          <iframe id="scn-diff-a-frame" sandbox="allow-same-origin allow-scripts"></iframe>
        </div>
        <div class="pane">
          <div class="pane-label" id="scn-diff-b-label">right</div>
          <iframe id="scn-diff-b-frame" sandbox="allow-same-origin allow-scripts"></iframe>
        </div>
      </div>
      <div id="scenario-diff-text"><div class="row" style="color:var(--muted); font-style:italic;">Field-level differences appear here once both sides are picked.</div></div>
    </div>
  `;
  const selA = document.getElementById('scn-diff-a');
  const selB = document.getElementById('scn-diff-b');
  for (const s of scenariosState.list) {
    selA.appendChild(new Option(s.name, s.name));
    selB.appendChild(new Option(s.name, s.name));
  }
  selA.value = scenariosState.list[0].name;
  selB.value = scenariosState.list[1].name;
  function rerender() {
    const a = scenariosState.list.find(x => x.name === selA.value);
    const b = scenariosState.list.find(x => x.name === selB.value);
    document.getElementById('scn-diff-a-label').textContent = a ? a.name : '—';
    document.getElementById('scn-diff-b-label').textContent = b ? b.name : '—';
    if (!a || !b) return;
    const tt = state.monacoModels[target] ? state.monacoModels[target].getValue() : state.files[target].content;
    // Render via the existing pipeline by stashing the active overrides
    const stash = scenariosState.activeOverrides;
    scenariosState.activeOverrides = a.valueByPath;
    const ahtml = buildPreviewHtml(target, tt, { withData: true });
    scenariosState.activeOverrides = b.valueByPath;
    const bhtml = buildPreviewHtml(target, tt, { withData: true });
    scenariosState.activeOverrides = stash;
    document.getElementById('scn-diff-a-frame').srcdoc = ahtml;
    document.getElementById('scn-diff-b-frame').srcdoc = bhtml;
    // Field-level diff on the parsed maps
    const out = document.getElementById('scenario-diff-text');
    out.innerHTML = '';
    const allKeys = new Set([...a.valueByPath.keys(), ...b.valueByPath.keys()]);
    const sorted = Array.from(allKeys).sort();
    let diffs = 0;
    for (const k of sorted) {
      const va = a.valueByPath.get(k) || '';
      const vb = b.valueByPath.get(k) || '';
      if (va === vb) continue;
      diffs++;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="field">${escapeHtml(k)}</span> <span class="a">${escapeHtml(va || '(empty)')}</span> → <span class="b">${escapeHtml(vb || '(empty)')}</span>`;
      out.appendChild(row);
    }
    if (!diffs) out.innerHTML = '<div class="row" style="color:var(--muted); font-style:italic;">No field-level differences between these scenarios.</div>';
  }
  selA.addEventListener('change', rerender);
  selB.addEventListener('change', rerender);
  rerender();
}

// ---------- SCENARIO FORM EDITOR ----------
// Generates a form from the open .OL-datamodel; pre-fills with the active
// scenario's values; can apply changes back to the in-memory scenario or
// save as a new XML in SampleDataFiles/.
function openScenarioFormForActive() {
  if (!scenariosState.active) { setStatus('Pick a scenario first.', 'warn'); return; }
  const s = scenariosState.list.find(x => x.name === scenariosState.active);
  if (!s) return;
  openScenarioForm(s);
}

function openScenarioForm(scenario) {
  // Hide other panes
  document.getElementById('editor').style.display = 'none';
  document.getElementById('binary-view').classList.remove('show');
  document.getElementById('script-form-view').classList.remove('show');
  const view = document.getElementById('scenario-form-view');
  view.classList.add('show');
  document.getElementById('editor-tab').style.display = 'none';

  document.getElementById('scn-form-title').textContent = 'Scenario: ' + scenario.name;
  document.getElementById('scn-form-sub').textContent = scenario.path + (scenariosState.source ? '  ·  in ' + scenariosState.source : '');

  // Build a form grouped by the top-level path segment.
  // Source of fields: the active datamodel (so we get types and known structure)
  // augmented with anything present in the scenario but not in the datamodel.
  const dmFields = (scriptsState && scriptsState.datamodelFields) || [];
  const allPaths = new Set();
  for (const f of dmFields) if (f.type !== 'table') allPaths.add(f.path);
  for (const k of scenario.valueByPath.keys()) allPaths.add(k);
  const grouped = new Map();
  for (const p of allPaths) {
    const parts = p.split('.');
    const head = parts.length > 1 ? parts[0] : '(top-level)';
    if (!grouped.has(head)) grouped.set(head, []);
    grouped.get(head).push(p);
  }
  const body = document.getElementById('scn-form-body');
  body.innerHTML = '';
  const inputs = new Map(); // path -> input element
  const sortedHeads = Array.from(grouped.keys()).sort();
  for (const head of sortedHeads) {
    const grp = document.createElement('div');
    grp.className = 'group';
    const gh = document.createElement('div');
    gh.className = 'group-head';
    gh.innerHTML = `<span class="toggle">▾</span><span>${escapeHtml(head)}</span><span style="flex:1;"></span><span style="color:var(--muted);">${grouped.get(head).length} fields</span>`;
    gh.addEventListener('click', () => grp.classList.toggle('collapsed'));
    grp.appendChild(gh);
    const gb = document.createElement('div');
    gb.className = 'group-body';
    for (const p of grouped.get(head).sort()) {
      const row = document.createElement('div');
      row.className = 'field-row';
      const lbl = document.createElement('label');
      lbl.textContent = p;
      row.appendChild(lbl);
      const val = scenario.valueByPath.get(p) || '';
      const input = (val.length > 80 || /\n/.test(val))
        ? document.createElement('textarea')
        : document.createElement('input');
      if (input.tagName === 'INPUT') input.type = 'text';
      input.value = val;
      input.dataset.path = p;
      row.appendChild(input);
      inputs.set(p, input);
      gb.appendChild(row);
    }
    grp.appendChild(gb);
    body.appendChild(grp);
  }

  // Wire actions
  document.getElementById('scn-form-revert').onclick = () => openScenarioForm(scenario);
  document.getElementById('scn-form-close').onclick = closeScenarioForm;
  document.getElementById('scn-form-apply').onclick = () => {
    // Push edits into in-memory scenario (does not write to disk)
    for (const [p, inp] of inputs.entries()) {
      scenario.valueByPath.set(p, inp.value);
    }
    if (scenariosState.active === scenario.name) {
      scenariosState.activeOverrides = scenario.valueByPath;
    }
    closeScenarioForm();
    if (previewState && previewState.open) refreshPreview();
    setStatus('Scenario edits applied (in-memory). Use "Save as new XML…" to persist.', 'ok');
  };
  document.getElementById('scn-form-save-as').onclick = async () => {
    if (!state.dirHandle) { setStatus('Save-as needs a folder open (Open Folder).', 'warn'); return; }
    const name = prompt('Save as XML filename (in the open folder):', scenario.name.replace(/\.xml$/i, '_edited.xml'));
    if (!name) return;
    // Snapshot edits
    for (const [p, inp] of inputs.entries()) scenario.valueByPath.set(p, inp.value);
    const xml = scenarioMapToXml(scenario.valueByPath);
    try {
      const fh = await state.dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([xml], { type: 'application/xml' }));
      await w.close();
      setStatus(`Saved ${name} to folder.`, 'ok');
    } catch (e) { setStatus('Save failed: ' + e.message, 'err'); }
  };
}

function closeScenarioForm() {
  document.getElementById('scenario-form-view').classList.remove('show');
  if (state.currentPath) openFile(state.currentPath);
}

// Serialise a path -> value map back into a scenario-shaped XML.
function scenarioMapToXml(map) {
  // Build a tree from dotted paths
  const root = { children: new Map(), value: null };
  for (const [p, v] of map.entries()) {
    const parts = p.split('.');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map(), value: null });
      node = node.children.get(seg);
      if (i === parts.length - 1) node.value = v;
    }
  }
  function serialize(node, indent) {
    const lines = [];
    for (const [name, child] of node.children) {
      const safe = encodeXmlText(child.value || '');
      if (child.children.size === 0) {
        lines.push(indent + '<' + name + '>' + safe + '</' + name + '>');
      } else {
        lines.push(indent + '<' + name + '>');
        lines.push(serialize(child, indent + '  '));
        lines.push(indent + '</' + name + '>');
      }
    }
    return lines.join('\n');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Application>\n' + serialize(root, '  ') + '\n</Application>\n';
}

// ---------- NOTES SIDECAR ----------
const notesState = {
  text: '',
  dirty: false,
  forTemplate: null, // template fileName the loaded notes belong to
};

function notesSidecarName() {
  if (!state.fileName) return null;
  return state.fileName.replace(/\.[^.]+$/, '') + '.notes.md';
}

async function loadNotesForCurrentTemplate() {
  const ta = document.getElementById('notes-textarea');
  const name = document.getElementById('notes-filename');
  const empty = document.getElementById('notes-empty');
  const saveBtn = document.getElementById('btn-notes-save');
  if (!ta || !state.fileName) {
    if (ta) ta.value = '';
    if (name) name.textContent = '(no template open)';
    if (saveBtn) saveBtn.disabled = true;
    if (empty) empty.style.display = '';
    notesState.text = '';
    notesState.dirty = false;
    notesState.forTemplate = null;
    return;
  }
  const sidecar = notesSidecarName();
  notesState.forTemplate = state.fileName;
  name.textContent = sidecar;
  empty.style.display = 'none';
  saveBtn.disabled = false;
  // Try to read sidecar from the open dirHandle
  let text = '';
  if (state.dirHandle) {
    try {
      const fh = await state.dirHandle.getFileHandle(sidecar);
      const f = await fh.getFile();
      text = await f.text();
    } catch (_) { text = ''; }
  }
  ta.value = text;
  notesState.text = text;
  notesState.dirty = false;
}

async function saveNotes() {
  if (!state.dirHandle) { setStatus('Open a folder to save notes.', 'warn'); return; }
  const sidecar = notesSidecarName();
  if (!sidecar) return;
  const ta = document.getElementById('notes-textarea');
  const text = ta.value;
  try {
    const fh = await state.dirHandle.getFileHandle(sidecar, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([text], { type: 'text/markdown' }));
    await w.close();
    notesState.text = text;
    notesState.dirty = false;
    setStatus(`Saved ${sidecar}.`, 'ok');
  } catch (e) { setStatus('Save notes failed: ' + e.message, 'err'); }
}

(function wireNotes() {
  const ta = document.getElementById('notes-textarea');
  const saveBtn = document.getElementById('btn-notes-save');
  if (ta) ta.addEventListener('input', () => {
    notesState.dirty = ta.value !== notesState.text;
  });
  if (saveBtn) saveBtn.addEventListener('click', saveNotes);
  // Ctrl+S inside the notes textarea saves the notes (instead of committing template edit)
  if (ta) ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveNotes();
    }
  });
  const modeNotesBtn = document.getElementById('mode-notes');
  if (modeNotesBtn) modeNotesBtn.addEventListener('click', () => setSidebarMode('notes'));
})();

// patchSidebarMode IIFE removed — sidebar.ts now handles all modes including 'notes' natively.

// ---------- RECENTLY-EDITED SCRIPTS ----------
const recentScriptsState = {
  list: [],   // [{ name, findText, ts }]
  max: 8,
};
function recentScriptsKey() { return 'cw_recent_scripts:' + (state.fileName || ''); }
function loadRecentScripts() {
  try {
    const raw = localStorage.getItem(recentScriptsKey());
    recentScriptsState.list = raw ? JSON.parse(raw) : [];
  } catch (_) { recentScriptsState.list = []; }
}
function saveRecentScripts() {
  try { localStorage.setItem(recentScriptsKey(), JSON.stringify(recentScriptsState.list)); } catch (_) {}
}
function pushRecentScript(s) {
  if (!s || !s.name) return;
  const entry = { name: s.name, findText: s.findText || '', ts: Date.now() };
  recentScriptsState.list = [entry, ...recentScriptsState.list.filter(x => x.name !== s.name)].slice(0, recentScriptsState.max);
  saveRecentScripts();
}

// Track recently-opened scripts; reload list on template change
hookOn('afterOpenScriptForm', (id) => {
  const s = scriptsState.list.find(x => x.id === id);
  if (s) {
    pushRecentScript(s);
    try { renderScriptsList(); } catch (_) {}
  }
});
hookOn('afterLoadFromHandle', () => {
  loadRecentScripts();
  if (typeof renderScriptsList === 'function') {
    try { renderScriptsList(); } catch (_) {}
  }
});
loadRecentScripts();

// Inject a "Recent" group at the top of the rendered scripts list after
// renderScriptsList runs. Registered as a second afterReparseScripts handler
// so it fires after the first one (which calls renderScriptsList).
hookOn('afterReparseScripts', () => {
  if (!recentScriptsState.list.length) return;
  const list = document.getElementById('scripts-list');
  if (!list) return;
  // Avoid duplicates if the function is re-run quickly
  const existing = list.querySelector('.scripts-group[data-recent="1"]');
  if (existing) existing.remove();
  list.querySelectorAll('.script-item[data-recent="1"]').forEach(el => el.remove());
  const head = document.createElement('div');
  head.className = 'scripts-group';
  head.dataset.recent = '1';
  head.textContent = `Recent  (${recentScriptsState.list.length})`;
  list.insertBefore(head, list.firstChild);
  // Insert items in reverse so the most recent ends up just under the header
  let prev = head;
  for (const r of recentScriptsState.list) {
    const found = scriptsState.list.find(x => x.name === r.name);
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
});

// ---------- MONACO "GO TO SCRIPT" ----------
// Adds an editor action so right-click on an @token@ in HTML/XML offers a
// "Go to script" item. Falls back to "no matching script" if the cursor isn't
// inside a token.
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
        // Find the @token@ that contains the column
        const re = /@[A-Za-z0-9_./\-]+@/g;
        let m, found = null;
        while ((m = re.exec(line)) !== null) {
          const start = m.index + 1; // 1-based column
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
    // Also attach to the script form's source editor so users can navigate from
    // a token they're typing into a control script's source.
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


// ---------- AUTO-OPEN SECTION 1 + PREVIEW ON TEMPLATE LOAD ----------
// When a .OL-template loads, jump straight to the first section's HTML and
// pop open the preview. Skips for files that don't have sections.
hookOn('afterLoadFromHandle', async () => {
  if (state.isDocx) return;
  if (state.standalone) return;
  if (!scriptsState || !scriptsState.hostPath) return;
  let entries;
  try { entries = parseNavigatorEntries(); } catch (_) { return; }
  if (!entries || !entries.sections || !entries.sections.length) return;
  const first = entries.sections[0];
  const target = (typeof normalizeNavPath === 'function')
    ? normalizeNavPath(first.location)
    : first.location;
  if (!state.files[target]) return;
  try {
    openFile(target);
    if (!previewState.open) openPreview();
    else refreshPreview();
  } catch (e) { console.warn('[auto-open] failed:', e); }
});

// ============================================================
// GENERIC OVERLAY-FORM HELPER + PRESET (.OL-jobpreset / .OL-outputpreset) EDITOR
// ------------------------------------------------------------
// Lifts the form-overlay-on-Monaco pattern out of the Scripts feature so
// any "edit this XML file as a form" view can reuse it. Same overlay
// container, same Apply / Revert / Open raw / Close action set.
//
// Concrete editor included: a basic preset editor that scans a preset
// XML's top-level scalar children and exposes them as text inputs. The
// surface is intentionally generic — it's a starting point for richer
// datamodel / sections editors that should slot into the same plumbing.
// Apply uses the standard _raw + offset splice pattern via replaceTagInner
// so whitespace and unknown sibling tags are preserved.
// ============================================================

const overlayFormState = {
  active: null, // { path, originalText, fields: [{ tag, value, isMultiline }] }
};

// Mount an overlay form. `cfg` shape:
//   { path, title, subtitle, fields: [{ tag, label, value, multiline? }],
//     onApply(formValues), onClose() }
// Hides the editor + script/binary/scenario views while shown; restores
// them in closeOverlayForm. The `originalText` is captured so Revert can
// reset every input to its parsed-at-open value.
function openOverlayForm(cfg) {
  if (!cfg || !cfg.fields) return;
  // Hide other "main pane" views
  document.getElementById('editor').style.display = 'none';
  document.getElementById('binary-view').classList.remove('show');
  document.getElementById('script-form-view').classList.remove('show');
  const scnView = document.getElementById('scenario-form-view');
  if (scnView) scnView.classList.remove('show');
  // Hide the editor tab strip — irrelevant for form view
  document.getElementById('editor-tab').style.display = 'none';

  const view = document.getElementById('overlay-form-view');
  view.classList.add('show');
  document.getElementById('of-title').textContent = cfg.title || 'Form view';
  document.getElementById('of-sub').textContent = cfg.subtitle || cfg.path || '';

  const fieldsHost = document.getElementById('of-fields');
  fieldsHost.innerHTML = '';
  if (!cfg.fields.length) {
    fieldsHost.innerHTML = '<div class="of-empty">No editable scalar fields detected. Use "Open raw…" to edit the XML directly.</div>';
  }
  for (const fld of cfg.fields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const lab = document.createElement('label');
    lab.textContent = fld.label || fld.tag;
    row.appendChild(lab);
    let inp;
    if (fld.multiline || (fld.value && /\n/.test(fld.value)) || (fld.value && fld.value.length > 80)) {
      inp = document.createElement('textarea');
      inp.rows = 3;
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
    }
    inp.value = fld.value == null ? '' : fld.value;
    inp.dataset.tag = fld.tag;
    row.appendChild(inp);
    fieldsHost.appendChild(row);
  }

  overlayFormState.active = { path: cfg.path, originalText: cfg.originalText || '', fields: cfg.fields, onApply: cfg.onApply, onClose: cfg.onClose };

  // Wire actions (replaceWith trick to drop any prior listeners cleanly)
  const apply = document.getElementById('of-apply');
  const revert = document.getElementById('of-revert');
  const close = document.getElementById('of-close');
  const openRaw = document.getElementById('of-open-raw');
  apply.replaceWith(apply.cloneNode(true));
  revert.replaceWith(revert.cloneNode(true));
  close.replaceWith(close.cloneNode(true));
  openRaw.replaceWith(openRaw.cloneNode(true));
  document.getElementById('of-apply').addEventListener('click', () => {
    if (!overlayFormState.active || !overlayFormState.active.onApply) return;
    const out = {};
    for (const inp of fieldsHost.querySelectorAll('input,textarea')) {
      out[inp.dataset.tag] = inp.value;
    }
    overlayFormState.active.onApply(out);
  });
  document.getElementById('of-revert').addEventListener('click', () => {
    if (!overlayFormState.active) return;
    for (const fld of overlayFormState.active.fields) {
      const inp = fieldsHost.querySelector(`[data-tag="${CSS.escape(fld.tag)}"]`);
      if (inp) inp.value = fld.value == null ? '' : fld.value;
    }
  });
  document.getElementById('of-close').addEventListener('click', closeOverlayForm);
  document.getElementById('of-open-raw').addEventListener('click', () => {
    const path = overlayFormState.active && overlayFormState.active.path;
    closeOverlayForm();
    if (path && state.files[path]) openFile(path);
  });

  // Ctrl/Cmd+S → Apply (mirrors the script form's binding)
  view.onkeydown = function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      if (!view.classList.contains('show')) return;
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('of-apply').click();
    }
  };
}

function closeOverlayForm() {
  const view = document.getElementById('overlay-form-view');
  if (!view) return;
  view.classList.remove('show');
  view.onkeydown = null;
  const wasActive = overlayFormState.active;
  overlayFormState.active = null;
  if (wasActive && wasActive.onClose) {
    try { wasActive.onClose(); } catch (_) {}
  }
  // Restore whatever the underlying file would normally show.
  if (state.currentPath) openFile(state.currentPath);
}

// Hide the "Open as form" banner. Idempotent.
function hideOverlayBanner() {
  const b = document.getElementById('overlay-form-banner');
  if (b) b.classList.remove('show');
}

// ---------- preset editor ----------
// Detects when a .OL-jobpreset / .OL-outputpreset is opened and shows a
// banner offering to "Open as form". The form scans the preset XML's
// top-level scalar children (text-only elements that aren't structural
// containers) and surfaces each as a text/textarea input. On Apply we
// splice each new value back into the original text using replaceTagInner
// so unknown sibling tags + indentation are preserved.

const PRESET_EXTS = new Set(['ol-jobpreset', 'ol-outputpreset']);

function isPresetPath(path) {
  return PRESET_EXTS.has(extOf(path || ''));
}

// Pull every top-level child element of `root` whose only content is text
// (no nested element children). These are the scalar fields safe to edit
// without re-encoding nested structure.
function extractPresetScalarFields(xmlText) {
  const fields = [];
  let doc;
  try { doc = new DOMParser().parseFromString(xmlText, 'application/xml'); }
  catch (_) { return fields; }
  const root = doc && doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === 'parsererror') return fields;
  for (const child of root.children || []) {
    // Skip elements that have child elements — those are structural and
    // need a richer editor than this generic surface.
    const hasChildElements = Array.from(child.children || []).length > 0;
    if (hasChildElements) continue;
    const tag = child.localName || child.nodeName;
    if (!tag) continue;
    // The decoder/encoder pair already handles entity round-tripping.
    fields.push({
      tag,
      label: tag,
      value: decodeXmlEntities(child.textContent || ''),
      multiline: (child.textContent || '').length > 80,
    });
  }
  return fields;
}

function openPresetOverlay(path) {
  const f = state.files[path];
  if (!f || !f.isText) return;
  const text = state.monacoModels[path] ? state.monacoModels[path].getValue() : (f.content || '');
  const fields = extractPresetScalarFields(text);
  hideOverlayBanner();
  openOverlayForm({
    path,
    title: 'Preset editor — ' + path,
    subtitle: extOf(path).toUpperCase() + ' · top-level scalar fields shown below; nested elements stay untouched.',
    originalText: text,
    fields,
    onApply: (formValues) => {
      // Mutate the live text by splicing each changed scalar back in.
      let updated = text;
      let touched = 0;
      for (const fld of fields) {
        const newVal = formValues[fld.tag];
        if (newVal == null || newVal === fld.value) continue;
        updated = replaceTagInner(updated, fld.tag, encodeXmlText(newVal));
        touched++;
      }
      if (!touched) {
        setStatus('No changes to apply.', 'warn');
        return;
      }
      const model = state.monacoModels[path];
      if (model) {
        const range = model.getFullModelRange();
        model.pushEditOperations([], [{ range, text: updated }], () => null);
      }
      f.content = updated;
      f.dirty = true;
      refreshTreeDirtyMarkers();
      setStatus(`Applied ${touched} field${touched === 1 ? '' : 's'} to ${path}. Click Review & Save to write to disk.`, 'ok');
      // Re-render the form so subsequent changes diff against the new baseline.
      openPresetOverlay(path);
    },
  });
}

// Hook openFile: when a preset file is opened, show the "Open as form"
// banner. Banner stays out of the way for non-preset files.
(function hookPresetBanner() {
  const _orig = openFile;
  openFile = function (path) {
    _orig(path);
    const banner = document.getElementById('overlay-form-banner');
    if (!banner) return;
    if (isPresetPath(path)) {
      const ext = extOf(path).toUpperCase();
      document.getElementById('overlay-form-banner-msg').textContent =
        `${ext} files can be edited as a form (top-level scalar fields).`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  };
  const btn = document.getElementById('overlay-form-banner-open');
  if (btn) {
    btn.addEventListener('click', () => {
      if (state.currentPath && isPresetPath(state.currentPath)) {
        openPresetOverlay(state.currentPath);
      }
    });
  }
})();

// ---------- DEFERRED: form-as-overlay editors for datamodel + sections ----------
// The plumbing above (openOverlayForm + replaceTagInner + the banner hook)
// is reusable. Concrete datamodel-field and sections/masters editors aren't
// shipped yet because their schemas need bespoke parse/serialize logic — a
// generic "scalar tags only" surface (like the preset editor) would lose
// nested <field> attributes and isn't a real win. To add them, replicate
// the openPresetOverlay shape: parse the file, build a fields list,
// implement the splice in onApply. Hook into the banner via a new
// isXxxPath() check + a clause inside hookPresetBanner.

})();

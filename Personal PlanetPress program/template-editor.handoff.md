# PlanetPress Template Editor — Handoff

Brief for whichever AI picks this up next. Read this before touching anything.

## Where we are

The editor used to be a single ~7,394-line `template-editor.html`. It now lives in the Vite project at `template-editor/`, which is the source of truth. The `.html` file is reference-only — keep it for diffing against the modules, don't edit it.

`template-editor.backup-pre-refactor.html` is the pre-refactor restore point. Keep it until Phase 5 (Pages deploy) is live and Kyle's done a few real edits via the bundled output.

**Phase 0 + 1 (completed 2026-05-06).** IIFE wrapper around the original script, `DEFAULT_SCRIPT_INDENT` constant, dead-code removal (no `if (false)` block, no duplicate `reviewAndSave`, no broken `renameFile` fragment), CDN deps pinned with SRI integrity hashes. Smoke-tested by Kyle. The XSS sweep flagged in Phase 1 is still outstanding (~76 `innerHTML` assignments, mostly `escapeHtml`-protected; the riskier sites are inside `buildPreviewHtml` and the iframe sandbox).

**Phase 2 (completed 2026-05-06).** Vite project scaffold at `template-editor/`: `vite-plugin-singlefile`, TypeScript with `strict` + `noUnusedLocals` + `exactOptionalPropertyTypes`, Playwright config, `.github/workflows/ci.yml` and `deploy.yml`, `.gitignore` for client assets and `dist/`.

**Phase 3 (completed 2026-05-07).** All ten target modules carved out of the inline script. Build green at 189.75 kB / 50.92 kB gzip. Smoke-tested twice by Kyle against `M2L-KFI.OL-template` (after the initial state/recents carve, and after the full chain).

**Phase 4 (completed 2026-05-07).** Two parallel tracks.

*Hook system (refactor track).* All 12+ `const _orig = X; X = async function` monkey-patch chains around `loadFromHandle`, `commitCurrentEdit`, `openFile`, `pickAndOpenFolder`, `openScriptForm`, `closeScriptForm` are gone. Replaced by:
- `src/hooks.ts` — lightweight registry: `on(event, fn)`, `emitAsync(event, ...args)` (sequential, awaited — for async call sites), `emit(event, ...args)` (fire-and-forget — for sync call sites).
- Each canonical function now calls `hookEmit`/`hookEmitAsync` at its exit point(s). All former patches are `hookOn(...)` registrations placed at the same positions in `legacy.ts`, so execution order is identical to the old chain.
- Dead `_origRezipForAdds` reference (stored but never called) removed.
- Build unchanged at 190.80 kB / 51.31 kB gzip.

*Tests + fixture track.* 
- `fixtures/synthetic.OL-template` committed (997 bytes): minimal zip with `index.xml` holding three scripts (CustomerName/TEXT, ShowIfActive/CONDITIONAL, PageController/CONTROL) and a tiny `OL-datamodel.OL-datamodel`.
- `fixtures/make-fixture.mjs` — Node.js generator; re-run with `node fixtures/make-fixture.mjs` from `template-editor/`.
- `index.html` gained a hidden `<input type=file data-testid=load-template>` that Playwright uses to bypass the File System Access API user-gesture requirement.
- `legacy.ts` `wireTestFileInput()` wraps the plain `File` in a `{ getFile, name }` handle-shaped object and calls `loadFromHandle` unchanged.
- `tests/smoke.spec.ts` has two real tests: scripts panel renders 3 items; editing a script name applies and re-renders the list.

## Vite project layout (`template-editor/`)

- `index.html` — head + body markup (lifted from the original) + the three CDN script tags (jszip / jsdiff / monaco loader) + `<script type="module" src="/src/main.ts">`. CDN tags stay so the bundled JS sees the same `window` globals the original did.
- `src/main.ts` — `import './styles.css'; import './legacy';`. Nothing else.
- `src/styles.css` — CSS lifted from the original verbatim.
- `src/state.ts` — `EditorState` interface + the shared mutable `state` object.
- `src/hooks.ts` — `on(event, fn)`, `emitAsync(event, ...args)`, `emit(event, ...args)`. Lightweight hook registry added in Phase 4; replaces all `_orig*` monkey-patch chains.
- `src/recents.ts` — pure IndexedDB + formatting helpers (`recentsAdd`, `recentsList`, `recentsRemove`, `recentsClear`, `formatRecentTime`). The menu wiring and `openRecentItem` are still in `legacy.ts`. The former `loadFromHandle` / `pickAndOpenFolder` patches are now `hookOn('afterLoadFromHandle', ...)` / `hookOn('afterPickAndOpenFolder', ...)` registrations in `legacy.ts`.
- `src/monaco-host.ts` — `bootstrapMonaco({ onSave, onReady })` and `registerFieldTokenCompletion(langs, getFields)`. Callers pass deps in; the module imports nothing from `legacy.ts`.
- `src/fs.ts` — extension tables (`TEXT_EXTS`, `LANG_BY_EXT`, `IMAGE_EXTS`, `ZIP_EXTS`), predicates (`extOf` / `langFor` / `isTextPath` / `isImagePath` / `isZipExt`), XML entity codecs, `indentAt`, `replaceTagInner`, `makeMemoCache`, `looksLikeText`, `decodeBytes`. Pure helpers only — handle-driven flows (`pickAndOpenFile`, `loadFromHandle`, `rezipAndSave`) stay in `legacy.ts`.
- `src/tree.ts` — `buildTree`, `renderNode`, `refreshTreeDirtyMarkers`, `escapeHtml`. Wires legacy callbacks via `configureTree({ isLockedFolderMarker, openFile })`.
- `src/editor.ts` — `validateXml` + `formatXml`. The dead `_formatXmlOldRestore` placeholder that lived alongside `formatXml` was dropped — unreachable, referenced never-defined names.
- `src/search.ts` — `appendSearchFile` + `renderSnippet` + `runSearch` (Phase 6 wave 2). Wires legacy callback via `configureSearch({ openFile })`.
- `src/review-modal.ts` — `openModal` / `closeModal` / `renderDiff` (lazy-cached `modalEls` + dismiss handlers wired on first call), plus the pure JSZip helper `zipTextMap`, and the Phase 8 carves `compareTemplates`, `reviewAndSave`, `configureReviewModal`.
- `src/preview.ts` — `ZOOM_STEPS`, `collectUnresolvedTokens` (pure DOM walker), `themeState` (`ThemeState` + `ThemePaletteEntry` / `ThemeFontSlot` / `ThemeNamedStyle` — Phase 5), the four theme orchestrators `getZipText`/`parseDocxTheme`/`renderThemePanel`/`buildThemeCss` (Phase 6 wave 1), the full preview state + helpers (Phase 6 wave 2): `previewState` (`PreviewState` interface), `revokePreviewBlobs`, `scriptByToken`, `jumpToScriptByToken`, `attachTokenJumpHandlers`, `renderTokensStrip`, `renderCssView`, `openPreviewNewTab`, `configurePreviewHelpers`, and the complete preview pipeline (Phase 8): `setPreviewMode`, `stepZoom`, `setZoom`, `applyZoomToFrame`, `applyZoomToFrameEl`, `togglePreview`, `openPreview`, `closePreview`, `refreshPreview`, `buildPreviewHtml`, `applyDatamodelPersonalization`.
- `src/scenarios.ts` — `scenariosState` + `ScenariosState` interface + `Scenario` type (Phase 5), `scnPersistKey` + `parseScenarioXmlToMap` (Phase 6 wave 1), and the full scenario orchestrators (Phase 6 wave 2): `readScenariosFromZip`, `autoLoadScenariosFromFolder`, `pickAndLoadScenarios`, `populateScenarioPicker`, `activateScenario`, `configureScenarios`. Note: `activateScenario` checks if the preview is open via DOM (`preview-pane.classList.contains('show')`) rather than importing `previewState` from `preview.ts`, to avoid a circular import.
- `src/scripts-panel.ts` — `parseScriptsFromXml`, `serializeScriptBack`, `buildNewScriptXml`, `stripCdataKeepingOffsets`, `parseDatamodelFields`, `dmTypeToFormType`, `SCRIPT_HOST_CANDIDATES`, `scriptsState` (Phase 5), `findDatamodelPath`, `isScriptFieldInvalid`, `countScriptUsages`, `refreshDatamodelFields`, `refreshScriptsList` (Phase 6 wave 1), and the full scripts-list UI (Phase 6 wave 2): `renderScriptsList`, `updateBulkBar`, `computeVisibleScripts`, `configureScriptsList`. `refreshScriptsList` emits `'afterReparseScripts'`; legacy.ts registers `hookOn('afterReparseScripts', renderScriptsList)` as the first handler. The recent-scripts injection is a second `hookOn('afterReparseScripts', ...)` handler that runs after the first. Typed: `ParsedScript`, `ScriptForm`, `DatamodelField`, `ScriptKind`. Note: literal `</script>` strings are escaped as `<\/script>` to survive Vite's HTML inlining.
- `src/navigator.ts` (new — Phase 6 wave 2) — `parseNavigatorEntries`, `normalizeNavPath`, `renderNavigator`, `configureNavigator`. Reads `scriptsState.hostPath` (from `scripts-panel.ts`) to locate `index.xml`.
- `src/script-form.ts` (new — Phase 7) — full script form UI and CRUD: `openScriptForm`, `closeScriptForm`, `applyScriptForm`, `toggleScriptEnabled`, `cloneScript`, `moveScript`, `createScript`, `deleteScript`, and all private helpers (`setSelectValue`, `ensureScriptSourceEditor`, `updateFieldMeta`, `updateUsagesPanel`, `bindFieldPathAutotype`, `bindFieldMetaLiveUpdate`, `offerRenameTokenAcrossFiles`, `bulkSetEnabled`, `bulkDelete`). All script-panel controls, form buttons, mode-scripts/mode-nav, and right-click context menu wired via `configureScriptForm({ openFile, setStatus, setSidebarMode, showCtxMenu, closeCtxMenu })`. Imports from `scripts-panel.ts`; no circular imports.
- `src/sidebar.ts` (Phase 8; revised Phase 9) — `setSidebarMode` (handles files/nav/scripts/search/theme/notes). Replaces both the original function and the `patchSidebarMode` monkey-patch IIFE. Imports `refreshScriptsList` / `renderNavigator` / `renderThemePanel` / `loadNotesForCurrentTemplate` directly. Phase 9 dropped the `configureSidebar({ onNotes })` DI seam — sidebar now imports notes directly like the other panels.
- `src/notes.ts` (new — Phase 9) — notes sidecar: `notesState` (`NotesState` interface), `notesSidecarName`, `loadNotesForCurrentTemplate`, `saveNotes`, `configureNotes({ setStatus })`. The former `wireNotes` IIFE (textarea input/keydown listeners, save-button click, `mode-notes` click → `setSidebarMode('notes')`) is folded into `configureNotes`. Imports `setSidebarMode` from `sidebar.ts` (the cycle is fine because both sides only use the imported binding inside runtime functions, not at module top level).
- `src/recent-scripts.ts` (new — Phase 10) — recently-edited scripts strip: `recentScriptsState` (`RecentScript` / `RecentScriptsState` interfaces), `loadRecentScripts`, `saveRecentScripts`, `pushRecentScript`, plus the private `injectRecentGroup` (DOM injection of the "Recent" group) and `configureRecentScripts()` which registers the three hooks (`afterOpenScriptForm` / `afterLoadFromHandle` / `afterReparseScripts`) and seeds the initial list from localStorage. **De-duped:** the old `legacy.ts` had two copies of the recent-group injector wired as separate `afterReparseScripts` handlers — idempotent but wasteful. Now there's one.
- `src/context-menu.ts` (new — Phase 10) — shared mini context-menu used by file tree, scripts panel, search results, and the "+ New script" picker. Exports `closeCtxMenu` and `openContextMenu(items, x, y)` where `items` is an array of `{ label, onClick, danger?, title? }` or `{ sep: true }`. The global `click → closeCtxMenu` auto-dismiss listener is registered at module load. Phase 10 also dropped the `configureScriptForm({ showCtxMenu, closeCtxMenu })` DI seam — `script-form.ts` now imports `openContextMenu` directly and the two custom-menu builds (the "+ New script" picker and the right-click on script items) are expressed declaratively via item arrays instead of literal HTML strings. One less surface for the `</script>` escape gotcha.
- `src/preset-overlay.ts` (new — Phase 11) — generic overlay-form helper + preset (`.OL-jobpreset` / `.OL-outputpreset`) editor. Owns `OverlayField` / `OverlayFormConfig` interfaces, `overlayFormState`, `openOverlayForm` / `closeOverlayForm` / `hideOverlayBanner`, and the preset-specific `isPresetPath` / `extractPresetScalarFields` / `openPresetOverlay`. `configurePresetOverlay({ openFile, setStatus })` registers a `hookOn('afterOpenFile', ...)` to toggle the "Open as form" banner — replacing the legacy `_orig = openFile; openFile = function` monkey-patch IIFE — and wires the banner button. The Apply / Revert / Close / Open-raw buttons still use the `replaceWith(cloneNode)` trick to drop prior listeners, since the form is rebuilt per-open.
- `src/legacy.ts` — `// @ts-nocheck` carve residue. What's left: DOM event wiring, `openFile`, `commitCurrentEdit`, `rezipAndSave`, `loadFromHandle`/`pickAndOpenFolder`, locked-folder unlock, file add/rename/delete, scenario matrix/diff, scenario form, monaco "Go to script" wiring, and `hookOn(...)` registrations. **No more `_orig*` monkey-patch variables, no `patchSidebarMode` IIFE, no notes-sidecar code, no recent-scripts code, no inline context-menu helpers, no preset overlay.** **Edit logic here only as a last resort — prefer landing changes in the relevant module.**

## Build / dev / test

```
cd "Personal PlanetPress program/template-editor"
npm install      # one-off
npm run dev      # Vite dev server (HMR; required if you want File System Access API to work pre-build)
npm run build    # tsc --noEmit + vite build → dist/index.html (~190 kB, fully self-contained)
npm run preview  # serve the built dist/
npm test         # Playwright smoke
```

For a manual smoke test: `npm run build`, open `dist/index.html` in Chrome/Edge, load `M2L-KFI.OL-template`, edit a script, *Review & Save*, reopen, verify round-trip. **Don't** open `template-editor/index.html` directly via `file://` — it references `/src/main.ts` which only the dev server can serve.

CI is gated on `push: branches: [main]` and `pull_request`. Open a PR to trigger it on the feature branch.

## Phase 5 (completed 2026-05-07)

Two parallel tracks.

*State-shell migration.* All three legacy-resident state shells are now exported from their natural modules:
- `scriptsState` → `src/scripts-panel.ts` (`ScriptsState` interface + `makeMemoCache` import from `fs.ts`)
- `scenariosState` → new `src/scenarios.ts` (`ScenariosState` interface, `Scenario` type)
- `themeState` → `src/preview.ts` (`ThemeState` + `ThemePaletteEntry`, `ThemeFontSlot`, `ThemeNamedStyle` interfaces)

`legacy.ts` imports all three (one-liner each); the local `const` declarations are replaced by carve-marker comments. Build unchanged at 190.80 kB / 51.32 kB gzip. The DOM-coupled orchestrators (`refreshScriptsList`, `renderScriptsList`, `openScriptForm`, `applyScenario`, `renderThemePanel`, etc.) still live in `legacy.ts` — their state is now imported from the modules, so moving the orchestrators out is the next phase's work.

*XSS sweep audit (Phase 1 carry-over).* All 10 `innerHTML` sites across the carved modules and all 54 in `legacy.ts` were audited:
- All user-controlled content is either wrapped in `escapeHtml()` or passed through an explicit `escape()` local function before insertion. No unescaped user data found.
- One functional bug fixed: `search.ts` `renderSnippet` was double-escaping match text inside `<mark>` (applying `escapeHtml()` to a string already produced by `escapeHtml(trimmed).replace(...)`). Fixed by removing the redundant inner call — `mm` is already safe as a substring of the escaped string.
- Iframe sandbox (`allow-same-origin allow-scripts`) in the preview is a deliberate design choice, not a vulnerability: the sandboxed content is the user's own locally-opened template. The sandbox still prevents top-level navigation and form submissions.

## Phase 5 (GitHub + Pages deploy)

`git init` is already done. Public repo at `KyleLookingAround/magic-merge-editor`. The deploy workflow at `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to `main`. Pages provides the HTTPS the File System Access API needs. Add the live URL to the README when it's up.

Note: the CI workflow (`ci.yml`) runs `npm test` which runs the Playwright smoke suite against `npm run preview`. The `app boots` test runs unconditionally; the two round-trip tests require `fixtures/synthetic.OL-template` to be present (it is, it's committed).

## Phase 6 (completed) — orchestrator extraction

*First wave (completed 2026-05-07).* Pure-ish helpers and theme orchestrators carved out of `legacy.ts`:
- `preview.ts` gained: `getZipText`, `parseDocxTheme`, `renderThemePanel`, `buildThemeCss`.
- `scripts-panel.ts` gained: `findDatamodelPath`, `isScriptFieldInvalid`, `countScriptUsages`, `refreshDatamodelFields`, `refreshScriptsList` (emits `afterReparseScripts`).
- `scenarios.ts` gained: `scnPersistKey`, `parseScenarioXmlToMap`.
- Build: 190.95 kB / 51.45 kB gzip. `tsc --noEmit` clean.

*Second wave (completed 2026-05-07).* Major DOM orchestrators carved:
- `search.ts` gained: `runSearch`.
- `scripts-panel.ts` gained: `renderScriptsList`, `updateBulkBar`, `computeVisibleScripts`, `configureScriptsList`. The `patchRenderScriptsList` IIFE (which tried to reassign the imported binding) was converted to a second `hookOn('afterReparseScripts', ...)` handler. `jumpToSearch` lives as a private helper inside `scripts-panel.ts`.
- `navigator.ts` (new file): `parseNavigatorEntries`, `normalizeNavPath`, `renderNavigator`, `configureNavigator`.
- `scenarios.ts` gained: `readScenariosFromZip`, `autoLoadScenariosFromFolder`, `pickAndLoadScenarios`, `populateScenarioPicker`, `activateScenario`, `configureScenarios`.
- `preview.ts` gained: `previewState` (`PreviewState` interface), `revokePreviewBlobs`, `scriptByToken`, `jumpToScriptByToken`, `attachTokenJumpHandlers`, `renderTokensStrip`, `renderCssView`, `openPreviewNewTab`, `configurePreviewHelpers`.
- Build: 193.05 kB / 51.98 kB gzip. `tsc --noEmit` clean.

*Still in `legacy.ts` (Phase 7 candidates):* `openScriptForm`/`applyScriptForm`/`closeScriptForm` + form helpers, `createScript`/`deleteScript`/`cloneScript`/`moveScript`/bulk ops, `togglePreview`/`openPreview`/`closePreview`/`refreshPreview`/`buildPreviewHtml`/`applyDatamodelPersonalization`, `setSidebarMode`, `openFile`, `compareTemplates`/`reviewAndSave`, notes, locked-folder unlock, file add/rename/delete, preset overlay.

*Optional follow-ups:* native-dialog → modal replacement, ARIA pass, keyboard help dialog, `buildTree` perf, debounced preview auto-refresh, FLD/IF kind chips, drag-to-reorder, rename-token-everywhere, vendor CDN deps via npm.

## Phase 7 (completed 2026-05-07) — script form + CRUD carve

New file `src/script-form.ts` (~500 lines typed TypeScript). All script form and CRUD orchestrators moved out of `legacy.ts`:
- **Form UI**: `openScriptForm`, `closeScriptForm`, `applyScriptForm`, `setSelectValue`, `ensureScriptSourceEditor`, `updateFieldMeta`, `updateUsagesPanel`, `bindFieldPathAutotype`, `bindFieldMetaLiveUpdate`, `offerRenameTokenAcrossFiles`.
- **CRUD**: `toggleScriptEnabled`, `cloneScript`, `moveScript`, `bulkSetEnabled`, `bulkDelete`, `createScript`, `deleteScript`.
- **Event wiring**: scripts-search/kind-filter/bulk-bar inputs, sf-apply/sf-revert/sf-close/sf-open-raw/sf-delete buttons, btn-script-new picker, btn-script-delete toolbar button, mode-scripts/mode-nav sidebar tabs, right-click contextmenu on script items — all consolidated in `configureScriptForm({ openFile, setStatus, setSidebarMode, showCtxMenu, closeCtxMenu })`. Called from legacy.ts alongside the other `configure*` calls.
- **legacy.ts**: removed ~950 lines, now 3,395 lines (was 4,345). `hookOn` registrations for `afterOpenScriptForm`/`afterCloseScriptForm` toolbar-button sync moved to `configureScriptForm`.
- Build: 192.50 kB / 52.01 kB gzip. `tsc --noEmit` clean.

## Decisions Kyle has already made

- Vite + ES modules, single-file build output (`vite-plugin-singlefile`).
- Public GitHub repo. Source + synthetic fixture only. Real client templates (`M2L-KFI`, `M2L-POA`, `*.docx`, `more2life.OL-datamapper`) are local-only via `.gitignore`.
- License: not yet decided — ask before committing.
- `gh` CLI is now installed on the workstation (was the Phase 5 blocker).

## Conventions and gotchas — READ THESE

- **`</script>` escape still applies.** Vite inlines `src/*.ts` into a `<script type="module">` block in `dist/index.html`. Any literal `</script>` inside a string, comment, or regex in module sources will close the outer tag and break the page. Always write as `<\/script>` — `scripts-panel.ts` already does this.
- **OneDrive bash mount lags behind file-tool writes.** When you `Edit` or `Write` a file in this folder, `bash` may show stale content for several minutes. Use the `Read` tool to verify edits, not `cat`.
- **PlanetPress zips use backslashes in entry names.** `state.files` keys preserve the raw zip path. Most code now handles both separators, but if you add new code that reasons about paths, normalize with `.replace(/\\/g, '/')` first.
- **Primary smoke target: `M2L-KFI.OL-template`** (179 scripts, no CDATA). Also `M2L-POA.OL-template` and bundled `more2life.OL-datamapper`. None of these get committed.
- **The user is Kyle, lead engineer at Finova.** Direct/concise tone, prose over bullets, save outputs to this folder, ask before doing real work if a request is ambiguous, **never overwrite originals without confirming**.
- **Cert revocation issue with curl on this Windows machine.** Schannel rejects HTTPS with `CRYPT_E_NO_REVOCATION_CHECK`. Use Node's `https` module for any URL fetch (e.g. recomputing SRI hashes after a CDN bump).

## Key files in this folder

| File | Status |
|---|---|
| `template-editor/` | **Live source. Edit this.** Vite project; layout listed above. |
| `template-editor.html` | Reference-only. Pre-refactor copy of the editor; keep until Phase 5 is live, then archive. |
| `template-editor.backup-pre-refactor.html` | Pre-refactor restore point. Keep until Phase 5 + a few real edits prove the Vite build is reliable. |
| `template-editor.backup-2026*.html` | Older interim backups (pre-unlock, pre-bugfix, pre-ux-gaps, pre-scenarios). Safe to delete once Phase 5 is live. |
| `template-editor.md` | Feature doc, pre-refactor. Lift relevant sections into `template-editor/README.md` as you touch them. |
| `template-editor.handoff.md` | This file. |
| `M2L-KFI.OL-template`, `M2L-POA.OL-template`, `*.docx`, `more2life.OL-datamapper` | Client assets. Local-only via `.gitignore`. |
| `M2L-KFI.notes.md` | Kyle's notes. Keep, do not commit. |
| `CLAUDE.md` | Kyle's working memory for Claude. Read at session start. |

## Phase 8 (completed 2026-05-07) — preview pipeline, sidebar, review carves

Three parallel carves from `legacy.ts` (~3,395 lines → ~2,690 lines, −705 lines):

- **`src/sidebar.ts`** (new): `setSidebarMode` + `configureSidebar`. Handles all 6 modes: files, nav, scripts, search, theme, notes. Completely replaces the original function and the `patchSidebarMode` IIFE that monkey-patched 'notes' support on top. Imports `refreshScriptsList` / `renderNavigator` / `renderThemePanel` directly.
- **`src/preview.ts`** extended: `setPreviewMode`, `stepZoom`, `setZoom`, `applyZoomToFrame`, `applyZoomToFrameEl`, `togglePreview`, `openPreview`, `closePreview`, `refreshPreview`, `buildPreviewHtml`, `applyDatamodelPersonalization`. `configurePreviewHelpers` drops the injected `buildPreviewHtml` dep (now local); `openPreviewNewTab` calls it directly. Duplicate `revokePreviewBlobs` in legacy.ts removed. Added imports: `extOf` from `fs.ts`, `scenariosState` from `scenarios.ts`.
- **`src/review-modal.ts`** extended: `compareTemplates`, `reviewAndSave`, `configureReviewModal`. `btn-rezip` is now bound directly to `reviewAndSave()` at file top; the old `replaceWith`/`cloneNode` re-bind hack removed.

Build: 191.39 kB / 51.18 kB gzip (slightly smaller than Phase 7 — duplicate removed). `tsc --noEmit` clean.

## Phase 9 (completed 2026-05-07) — notes sidecar carve

New file `src/notes.ts` (~100 lines typed TypeScript). All notes sidecar code lifted out of `legacy.ts`:

- `notesState` (`NotesState` interface: `text` / `dirty` / `forTemplate`).
- `notesSidecarName`, `loadNotesForCurrentTemplate`, `saveNotes`. `setStatus` is the only outside dependency, injected via `configureNotes({ setStatus })`.
- The `wireNotes` IIFE's content (textarea input/keydown, save-button click, `mode-notes` click → `setSidebarMode('notes')`) folded into `configureNotes`, called from `legacy.ts` alongside the other `configure*` calls.
- `sidebar.ts` switched from the DI-seam `configureSidebar({ onNotes })` to importing `loadNotesForCurrentTemplate` directly, matching the pattern already used for `refreshScriptsList` / `renderNavigator` / `renderThemePanel`. `configureSidebar` and `SidebarDeps` deleted.
- `legacy.ts`: 2,671 → 2,596 lines (−75). Build: 191.46 kB / 51.18 kB gzip (essentially flat vs. Phase 8). `tsc --noEmit` clean.
- `loadNotesForCurrentTemplate` is still triggered by the `afterLoadFromHandle` hook registration in `legacy.ts`.

## Phase 10 (completed 2026-05-07) — recent-scripts + context-menu carves

Two carves out of `legacy.ts`, plus a small refactor on the script-form side.

*Recent-scripts strip.* New file `src/recent-scripts.ts` (~105 lines, typed). Owns `recentScriptsState` (with typed `RecentScript`/`RecentScriptsState` interfaces), the localStorage persist helpers (`loadRecentScripts` / `saveRecentScripts` / `pushRecentScript`), and the private DOM injector that places the "Recent" group above the rendered scripts list. `configureRecentScripts()` (called from `legacy.ts` alongside the other `configure*` calls) wires all three `hookOn` registrations (`afterOpenScriptForm` / `afterLoadFromHandle` / `afterReparseScripts`) and seeds the initial list. **De-duped:** the old `legacy.ts` had two copies of the recent-group injector wired as separate `afterReparseScripts` handlers — idempotent (the second one removed and re-inserted what the first added) but wasteful. Now there's one.

*Context-menu helpers.* New file `src/context-menu.ts` (~62 lines, typed). Owns `closeCtxMenu` and `openContextMenu(items, x, y)`. The global `document.click → closeCtxMenu` auto-dismiss listener is registered at module load time. The `configureScriptForm({ showCtxMenu, closeCtxMenu })` DI seam is **gone** — `script-form.ts` now imports `openContextMenu` directly. The two custom menus inside `script-form.ts` (the "+ New script" picker and the right-click on script items) used to build their own `<div class="ctxmenu">` HTML strings; both now express their items as a `CtxMenuItem[]` array passed to `openContextMenu`. One less surface for the `</script>` escape gotcha.

`legacy.ts`: 2,596 → 2,475 lines (−121). `script-form.ts`: 887 → 860 lines (−27). New modules: 167 lines. Build: 189.70 kB / 50.96 kB gzip (down ~1.7 kB on dedup + inline-HTML removal vs Phase 9's 191.46 kB). `tsc --noEmit` clean.

## Phase 11 (completed 2026-05-07) — preset overlay carve

New file `src/preset-overlay.ts` (~256 lines, typed). Lifted out:

- **Generic overlay-form helper:** `OverlayField` + `OverlayFormConfig` interfaces, `overlayFormState`, `openOverlayForm` / `closeOverlayForm` / `hideOverlayBanner`. The Apply / Revert / Close / Open-raw button listeners are still attached fresh on each open via the `replaceWith(cloneNode)` trick (callers expect that). Ctrl/Cmd+S → Apply remains scoped to the overlay-form view's `onkeydown`.
- **Preset (`.OL-jobpreset` / `.OL-outputpreset`) editor:** `isPresetPath`, `extractPresetScalarFields`, `openPresetOverlay`. Apply still uses `replaceTagInner(text, tag, encodeXmlText(newVal))` so unknown sibling tags + indentation round-trip.
- **`afterOpenFile` hook registration** that toggles the "Open as form" banner. Replaces the legacy `(function hookPresetBanner() { const _orig = openFile; openFile = function (path) { _orig(path); … } })()` monkey-patch IIFE.

`configurePresetOverlay({ openFile, setStatus })` is called from `legacy.ts` alongside the other `configure*` calls. `openFile` is injected because it's still legacy-resident; once `openFile` carves out (likely Phase 12+), the DI seam can drop.

`legacy.ts`: 2,475 → 2,250 lines (−225). Build: 189.76 kB / 50.99 kB gzip (essentially flat vs Phase 10). `tsc --noEmit` clean.

## Phase 12 (completed 2026-05-08) — the rest of legacy.ts

Five new/extended modules reduced `legacy.ts` from 2,250 → 473 lines (−1,777 lines). Build green at 186.35 kB / 49.84 kB gzip. `tsc --noEmit` clean.

**New files:**
- `src/status.ts` — `setStatus`. All modules that previously received it via configure-DI can import directly; the DI seams in the existing modules are left as-is for now and still work (they receive the same function).
- `src/file-ops.ts` — `openFile`, `commitCurrentEdit`, `rezipAndSave` (the final override version, with added-files support), `pickAndOpenFile`, `pickAndOpenFolder`, `scanFolderTemplates`, `renderTemplatesList`, `backToFolderList`, `loadFromHandle`, `hasUnsaved`. DOM event listeners for `btn-open`, `btn-open-folder`, `btn-save`, `btn-back`, `btn-rescan`, and `beforeunload` are all registered at module load time. `wireTestFileInput` is also here.
- `src/file-dialogs.ts` — `updateFileButtons`, `unlockTemplateFolders`, `promptNewFile`, `openNewFileModal`, `bindAutotypeByMap`, `renameFile`, `deleteFile`, `copyToClipboard`, `revealInTree`. Also contains the full `contextmenu` event handler (file tree / navigator / search result rows). DOM event wiring for `btn-file-new/rename/delete/unlock` and the `afterOpenFile` hook registration are at module load time.

**Extended files:**
- `src/fs.ts` — `LOCKED_FOLDER_RELATIVE_PATHS`, `LOCKED_FOLDER_PATH_SET`, `isLockedFolderMarker`, `findLockedFolderEntries`. Added `import { state } from './state'` for `findLockedFolderEntries`.
- `src/tree.ts` — dropped `isLockedFolderMarker` from `TreeDeps` / `configureTree`; imports it directly from `fs.ts`. `configureTree` now only needs `{ openFile }`.
- `src/editor.ts` — `formatCurrent` (was legacy-resident; depends on Monaco state + `setStatus`).
- `src/scenarios.ts` — `openScenarioForm`, `openScenarioFormForActive`, `closeScenarioForm`, `scenarioMapToXml`, `openCoverageMatrix`, `collectSectionHtmlPaths`, `summarizeScenarioForSection`, `openScenarioDiff`. `ScenarioDeps` extended with `openFile`. `configureScenarios` now also wires the scenario picker UI (previously the `wireScenarios` IIFE in legacy.ts). Note: this module now imports from `preview.ts` (bidirectional cycle with `preview.ts → scenarios.ts`); safe because all cross-module accesses are inside function bodies, not at module init time.
- `src/recents.ts` — `openRecentItem` + the recents-menu button / dismiss DOM wiring.

**What's still in `legacy.ts` (473 lines):**
- `bootstrapMonaco` call
- All `configure*` calls (wiring cross-module DI seams)
- Sidebar mode button listeners (`mode-files`, `mode-search`, `mode-theme`)
- Keyboard shortcuts (`Ctrl+Shift+F` → search, `Ctrl+Alt+L` → format)
- Search debounce input wiring
- Preview button event listeners (btn-preview, zoom, tabs, CSS copy, tokens-dismiss)
- Preview-pane `wheel` zoom listener
- Theme CSS copy button
- Hook registrations: `afterCommitCurrentEdit`, `afterReparseScripts`, `beforeOpenFile`, `afterLoadFromHandle` (scripts + notes + recents + compare-button + auto-open section 1)
- Monaco "Go to script" action IIFE
- Sidebar resizer IIFE
- Preview-pane resizer IIFE

## Suggested next move

Phase 12 is complete. Build green at 186.35 kB, `tsc --noEmit` clean.

## Phase 13 (completed 2026-05-11) — eliminate legacy.ts, drop all removable DI seams

**`src/legacy.ts` is gone.** All 473 remaining lines were redistributed. Build: 187.96 kB / 50.74 kB gzip. `tsc --noEmit` clean.

**Bug fixed:** `btn-rezip` ("Review & Save") had no click listener — lost during Phase 12. Now wired at module load in `review-modal.ts`.

**DI seam drops** (each module now imports directly from `./status` and/or `./file-ops`):
- `review-modal.ts`: dropped `ReviewModalDeps` entirely (imports `setStatus`, `commitCurrentEdit`, `rezipAndSave` directly).
- `notes.ts`: dropped `NotesDeps`; DOM wiring moved to module-load IIFE.
- `navigator.ts`: dropped `NavigatorDeps` + `configureNavigator`; imports `openFile` + `setStatus` directly.
- `search.ts`: dropped `SearchDeps` + `configureSearch`; imports `openFile` directly; debounce wiring moved to module-load IIFE.
- `preset-overlay.ts`: dropped `PresetOverlayDeps`; DOM wiring + hook moved to module-load IIFE.
- `scripts-panel.ts`: dropped `setStatus` from `ScriptListDeps`.
- `script-form.ts`: dropped `openFile` + `setStatus` from `ScriptFormDeps`; `setSidebarMode` remains (cycle prevention: `sidebar.ts → preview.ts → ...`).
- `scenarios.ts`: dropped `setStatus` + `refreshPreview` from `ScenarioDeps` (both already imported from `./preview`); `openFile` remains (cycle: `file-ops.ts → preview.ts → scenarios.ts`). Scenario picker DOM wiring moved to module-load IIFE; `configureScenarios` now only sets `deps.openFile`.
- `preview.ts`: dropped `setStatus` + `openScriptForm` from `PreviewHelperDeps` (both imported directly); all preview buttons + zoom + CSS copy + wheel zoom wired at module load. `setSidebarMode` remains (cycle: `sidebar.ts → preview.ts`).

**Event wiring moved to modules (at module load):**
- `sidebar.ts`: `mode-files`, `mode-search`, `mode-theme` clicks + `Ctrl+Shift+F`.
- `editor.ts`: `Ctrl+Alt+L` format shortcut.
- `search.ts`: search input debounce.
- `preview.ts`: all preview panel buttons.
- `review-modal.ts`: `btn-rezip`, `btn-compare`.

**New modules:**
- `src/layout.ts`: sidebar + preview-pane drag-resizers.
- `src/monaco-goto.ts`: Monaco "Go to script for @token@" action.

**`main.ts`** is now the bootstrap + configure + cross-section hooks file (~160 lines). Remaining `configure*` calls (kept because of import cycles):
- `configureTree({ openFile })` — `tree.ts` can't import `file-ops.ts` (cycle: `file-ops → tree → file-ops`).
- `configureScriptsList({ openScriptForm, toggleScriptEnabled, moveScript, setSidebarMode })` — all four in modules that import `scripts-panel.ts` (would create cycles).
- `configureScriptForm({ setSidebarMode })` — `sidebar.ts` imports `preview.ts` which imports `scripts-panel.ts` (cycle).
- `configureScenarios({ openFile })` — `file-ops → preview → scenarios` cycle.
- `configurePreviewHelpers({ setSidebarMode })` — `sidebar → preview` cycle.

**Next priorities:**
- **Manual smoke test.** Load `M2L-KFI.OL-template`, full round-trip: edit a script, *Review & Save*, reopen. Also: create/clone/delete a script, context menu on file tree, Notes (Ctrl+S), Recent Scripts strip, scenario picker, coverage matrix, scenario diff, locked-folder unlock, + New file, rename, delete, open folder mode.
- **GitHub Pages deploy.** Merge to `main` and verify Pages deploy completes.

Smoke target after any edit: `npm run build` → open `dist/index.html` in Chrome/Edge → load `M2L-KFI.OL-template` → edit a script → *Review & Save* → reopen → verify round-trip.

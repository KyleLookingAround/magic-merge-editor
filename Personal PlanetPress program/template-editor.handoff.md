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
- `src/search.ts` — `appendSearchFile` + `renderSnippet`. Wires legacy callback via `configureSearch({ openFile })`. The driver (`runSearch`), the sidebar toggle (`setSidebarMode`) and the script-panel jump (`jumpToSearch`) stay in `legacy.ts`.
- `src/review-modal.ts` — `openModal` / `closeModal` / `renderDiff` (lazy-cached `modalEls` + dismiss handlers wired on first call), plus the pure JSZip helper `zipTextMap`. `compareTemplates` and `reviewAndSave` stay in `legacy.ts` (both reach into `commitCurrentEdit` / `loadFromHandle` / monkey-patches).
- `src/preview.ts` — `ZOOM_STEPS`, `collectUnresolvedTokens` (pure DOM walker), and `themeState` (`ThemeState` interface + `ThemePaletteEntry` / `ThemeFontSlot` / `ThemeNamedStyle` — migrated Phase 5). The orchestrators (`togglePreview` / `openPreview` / `closePreview` / `refreshPreview` / `buildPreviewHtml` / `parseDocxTheme` / `renderThemePanel` / `buildThemeCss` / `applyDatamodelPersonalization` / `renderTokensStrip` / `renderCssView` / `attachTokenJumpHandlers`) stay in `legacy.ts` — they depend on the blob-URL cache.
- `src/scenarios.ts` — `scenariosState` + `ScenariosState` interface + `Scenario` type (migrated Phase 5). All scenario orchestrators (`loadScenarios`, `renderScenarioPicker`, `activateScenario`, `openScenarioDiff`, etc.) still live in `legacy.ts`.
- `src/scripts-panel.ts` — `parseScriptsFromXml`, `serializeScriptBack`, `buildNewScriptXml`, `stripCdataKeepingOffsets`, `parseDatamodelFields`, `dmTypeToFormType`, `SCRIPT_HOST_CANDIDATES`, and `scriptsState` (`ScriptsState` interface — migrated Phase 5). Typed: `ParsedScript`, `ScriptForm`, `DatamodelField`, `ScriptKind`. Note: literal `</script>` strings inside this module are escaped as `<\/script>` to survive Vite's HTML inlining.
- `src/legacy.ts` — `// @ts-nocheck` carve residue. The original IIFE is preserved; what's left is DOM event wiring, the heavy DOM-mutating flows (`openFile`, `commitCurrentEdit`, `rezipAndSave`, `refreshScriptsList`, `openScriptForm`, the preview pipeline, scenarios, notes, navigator, locked-folder unlock, file add/rename/delete, preset overlay), and `hookOn(...)` registrations that stitch sections together. **No more `_orig*` monkey-patch variables.** The header comment lists every module + why each remaining orchestrator stayed. **Edit logic here only as a last resort — prefer landing changes in the relevant module.**

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

## Phase 6 (planned) — optional follow-ups

From the original improvement plan + the 2026-05-05 audit: native-dialog → modal replacement, ARIA pass, keyboard help dialog, `buildTree` perf, debounced preview auto-refresh, FLD/IF kind chips, drag-to-reorder, bulk operations, rename-token-everywhere, vendor CDN deps via npm.

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

## Suggested next move

Phase 5 is complete. The three state shells are exported from their modules and the XSS sweep is done. Next priorities:

- **Vite project layout: add `src/scenarios.ts` to the module table** (see below in the "Vite project layout" section — not yet updated here, do it as you work through Phase 6).
- **Move orchestrators into their modules.** Now that `scriptsState` lives in `scripts-panel.ts`, `scenariosState` in `scenarios.ts`, and `themeState` in `preview.ts`, the orchestrators that mutate them (`refreshScriptsList`, `renderScriptsList`, `openScriptForm`, etc.) can move out of `legacy.ts` one at a time. Each move should be followed by a build + smoke test.
- **GitHub Pages deploy.** Push the Phase 5 branch, merge to main, and verify the Pages deploy completes. Add the live URL to the README.

Smoke target after any edit: `npm run build` → open `dist/index.html` in Chrome/Edge → load `M2L-KFI.OL-template` → edit a script → *Review & Save* → reopen → verify round-trip.

# template-editor.html — Handoff

Brief for whichever AI picks this up next. Read this before touching anything.

## Where we are

Source: `template-editor.html` (~7,394 lines, single-file vanilla JS app).
Backup of pre-refactor state: `template-editor.backup-pre-refactor.html` (do not delete; restore point if anything goes wrong).

**Phase 0 + Phase 1 of the refactor plan are done as of 2026-05-06:**

- IIFE wrapper around the whole script (`(function () { 'use strict'; … })()`).
- `DEFAULT_SCRIPT_INDENT = ' '.repeat(16)` constant in place; no more 16-space literals.
- Dead code from earlier patches removed: there is no longer any `if (false)` block, no duplicate `reviewAndSave`, no broken `renameFile` fragment.
- The previously-duplicated `reviewAndSave` is now a single `async function reviewAndSave()` declaration.
- Three CDN deps (jszip 3.10.1, jsdiff 5.1.0, monaco-editor 0.45.0 loader) are pinned **and** carry SRI `integrity` + `crossorigin="anonymous"` attributes. Note: SRI on monaco's loader does not cover the language/editor chunks it fetches dynamically.
- Manually smoke-tested by Kyle: open `M2L-KFI.OL-template`, edit a script, Review & Save, reopen — round-trip works.

What is **not** done yet (still inside the original "Phase 1"):

- **XSS sweep.** ~76 `innerHTML` assignments. Most call `escapeHtml()`. The improvement plan flagged template-literal markup at lines around 4042–4046, 4111–4122, 4764, 4810, 4957, 5351, 5428 (line numbers were stale even before the cleanup; treat as hints, not coordinates). The biggest stake is `buildPreviewHtml` and its iframe sandbox attributes.

## The plan (Phases 2–6) — what comes next

Source: Kyle's "Do this" plan from the 2026-05-06 session. Summary:

**Phase 2 — repo + tooling scaffold (½ day).** New sibling folder `template-editor/`, Vite project, `vite-plugin-singlefile` so `dist/index.html` stays self-contained. Modules under `src/`. `.gitignore` excludes `*.OL-template`, `*.OL-datamapper`, `*.docx`, `*.backup*.html`, `/dist`, `node_modules`. Sibling `fixtures/synthetic.OL-template` (hand-built, safe to commit). Sibling `tests/smoke.spec.ts` (Playwright). `.github/workflows/ci.yml` + `deploy.yml`.

**Phase 3 — modularise (2–3 days).** Carve out modules in this order, smoke-testing against `M2L-KFI.OL-template` after each: `state.js` → `recents.js` → `monaco-host.js` → `fs.js` → `tree.js` → `editor.js` → `search.js` → `review-modal.js` → `preview.js` → `scripts-panel.js`. Hoist inline `style=""` into `styles.css` opportunistically as you touch each module — don't make it a separate phase.

**Phase 3 status (2026-05-07): all ten modules carved, build green at 189.75 kB / 50.92 kB gzip. Smoke-tested twice by Kyle against `M2L-KFI.OL-template` (once after the initial state/recents carve, once after the full chain).**

The Vite project at `template-editor/` is now the source of truth. `template-editor.html` is reference-only — keep it for diffing against the modules until Phase 4 is in.

Layout:

- `index.html` — head + body + the three CDN script tags (jszip / jsdiff / monaco loader) + `<script type="module" src="/src/main.ts">`. CDN tags stay so the bundled JS sees the same `window` globals the original did.
- `src/styles.css` — CSS lifted from the original verbatim.
- `src/main.ts` — `import './styles.css'; import './legacy';`.
- `src/legacy.ts` — `// @ts-nocheck` carve residue. The original IIFE is preserved; what's left is DOM event wiring, the heavy DOM-mutating flows, and the cross-section monkey-patches. Header comment lists every module + why each orchestrator stayed. **Edit logic here only as a last resort — prefer landing changes in the relevant module.**
- `src/state.ts` — `EditorState` interface + the shared mutable `state` object.
- `src/recents.ts` — pure IndexedDB + formatting helpers. The menu wiring, `openRecentItem`, and the `loadFromHandle` / `pickAndOpenFolder` monkey-patches are still in `legacy.ts`.
- `src/monaco-host.ts` — `bootstrapMonaco({ onSave, onReady })` and `registerFieldTokenCompletion(langs, getFields)`. Callers pass deps in; the module imports nothing from `legacy.ts`.
- `src/fs.ts` — extension tables (`TEXT_EXTS`, `LANG_BY_EXT`, `IMAGE_EXTS`, `ZIP_EXTS`), predicates (`extOf` / `langFor` / `isTextPath` / `isImagePath` / `isZipExt`), XML entity codecs, `indentAt`, `replaceTagInner`, `makeMemoCache`, `looksLikeText`, `decodeBytes`. Pure helpers only — handle-driven flows (`pickAndOpenFile`, `loadFromHandle`, `rezipAndSave`) stay in `legacy.ts` because they're wrapped by multiple monkey-patches.
- `src/tree.ts` — `buildTree`, `renderNode`, `refreshTreeDirtyMarkers`, `escapeHtml`. Wires legacy callbacks via `configureTree({ isLockedFolderMarker, openFile })`.
- `src/editor.ts` — `validateXml` + `formatXml`. The dead `_formatXmlOldRestore` placeholder that lived alongside `formatXml` is dropped — it was unreachable and referenced never-defined names.
- `src/search.ts` — `appendSearchFile` + `renderSnippet`. Wires legacy callback via `configureSearch({ openFile })`. The driver (`runSearch`), the sidebar toggle (`setSidebarMode`) and the script-panel jump (`jumpToSearch`) stay in `legacy.ts`.
- `src/review-modal.ts` — `openModal` / `closeModal` / `renderDiff` (lazy-cached `modalEls` + dismiss handlers wired on first call), plus the pure JSZip helper `zipTextMap`. `compareTemplates` and `reviewAndSave` stay in `legacy.ts` (both reach into `commitCurrentEdit` / `loadFromHandle` / monkey-patches).
- `src/preview.ts` — `ZOOM_STEPS` and `collectUnresolvedTokens` (pure DOM walker). The orchestrators (`togglePreview` / `openPreview` / `closePreview` / `refreshPreview` / `buildPreviewHtml` / `parseDocxTheme` / `renderThemePanel` / `buildThemeCss` / `applyDatamodelPersonalization` / `renderTokensStrip` / `renderCssView` / `attachTokenJumpHandlers`) all stay in `legacy.ts` — they depend on legacy-resident state shells (`scriptsState`, `scenariosState`, `themeState`) and the blob-URL cache.
- `src/scripts-panel.ts` — `parseScriptsFromXml`, `serializeScriptBack`, `buildNewScriptXml`, `stripCdataKeepingOffsets`, `parseDatamodelFields`, `dmTypeToFormType`, `SCRIPT_HOST_CANDIDATES`. Typed: `ParsedScript`, `ScriptForm`, `DatamodelField`, `ScriptKind`. Note: literal `</script>` strings inside this module are escaped as `<\/script>` to survive Vite's HTML inlining (CLAUDE.md gotcha).

Phase 4 starting points:

1. Move `scriptsState` / `scenariosState` / `themeState` shells into `scripts-panel.ts` (and a future `scenarios.ts` / a section inside `preview.ts`). That unlocks the preview orchestrators and the script panel renderers.
2. Replace the cross-section monkey-patches around `loadFromHandle`, `commitCurrentEdit`, `openFile`, `pickAndOpenFolder` with a small hook registry (e.g. `hooks.afterLoadFromHandle.add(fn)`). Then the orchestrators can move into modules wholesale.
3. The Phase 1 XSS sweep is still pending — the DOM-rendering modules (`tree`, `search`, `review-modal`, `preview` orchestrators left in legacy) all use `innerHTML` with template literals; audit each one and prefer DOM APIs for any user-controlled content.

**Phase 4 — tests + fixture (1 day).** Synthetic `.OL-template` (one field-text script, one conditional, one control script, tiny datamodel). Playwright smoke test using a hidden `<input type=file>` (File System Access API needs a real user gesture so doesn't work in headless tests). CI runs `tsc --noEmit` + Playwright.

**Phase 5 — GitHub + Pages deploy (½ day).** `git init`, public repo via `gh repo create`. Deploy workflow publishes `dist/` to `gh-pages` on push to `main`. Live URL needs HTTPS for File System Access API — Pages provides this. Add live URL to README.

**Phase 6 — optional follow-ups.** From the original improvement plan + the 2026-05-05 audit: native-dialog → modal replacement, ARIA pass, keyboard help dialog, `buildTree` perf, debounced preview auto-refresh, FLD/IF kind chips, drag-to-reorder, bulk operations, rename-token-everywhere, vendor CDN deps via npm.

## Decisions Kyle has already made

- Vite + ES modules, single-file build output (`vite-plugin-singlefile`).
- Public GitHub repo. Source + synthetic fixture only. Real client templates (`M2L-KFI`, `M2L-POA`, `.docx` files, `more2life.OL-datamapper`) are local-only via `.gitignore`.
- License: not yet decided — ask before committing.
- `gh` CLI is **not installed** on the workstation. Phase 5 will need it.

## Conventions and gotchas — READ THESE

- **The file is `.html`, not `.js`.** Inline JS lives between `<script>` near the top and `</script>` near the end. **Any literal `</script>` in a string, comment, or regex inside that block will close the outer script tag and break everything.** Always escape as `<\/script>`.
- **OneDrive bash mount lags behind file-tool writes.** When you `Edit` or `Write` a file in this folder, `bash` may show stale content for several minutes. Use the `Read` tool to verify edits, not `cat`.
- **PlanetPress zips use backslashes in entry names.** `state.files` keys preserve the raw zip path. Most code now handles both separators, but if you add new code that reasons about paths, normalize with `.replace(/\\/g, '/')` first.
- **Primary smoke target: `M2L-KFI.OL-template`** (179 scripts, no CDATA). Also `M2L-POA.OL-template` and bundled `more2life.OL-datamapper`. None of these get committed.
- **The user is Kyle, lead engineer at Finova.** Direct/concise tone, prose over bullets, save outputs to this folder, ask before doing real work if a request is ambiguous, **never overwrite originals without confirming**.
- **Cert revocation issue with curl on this Windows machine.** Schannel rejects HTTPS with `CRYPT_E_NO_REVOCATION_CHECK`. Use Node's `https` module for any URL fetch (e.g. recomputing SRI hashes after a CDN bump).

## Key files in this folder

| File | Status |
|---|---|
| `template-editor.html` | Live source. Edit this. |
| `template-editor.backup-pre-refactor.html` | Pre-refactor restore point. Keep. |
| `template-editor.backup-2026*.html` | Older interim backups (pre-unlock, pre-bugfix, pre-ux-gaps, pre-scenarios). Safe to delete once Phase 5 is live. |
| `template-editor.md` | Feature doc. Lift relevant sections into the Vite repo's `README.md` during Phase 2. |
| `template-editor.handoff.md` | This file. |
| `M2L-KFI.OL-template`, `M2L-POA.OL-template`, `*.docx`, `more2life.OL-datamapper` | Client assets. Local-only — must end up in the `.gitignore`. |
| `M2L-KFI.notes.md` | Kyle's notes. Keep, do not commit. |
| `CLAUDE.md` | Kyle's working memory for Claude. Read at session start. |

## Suggested next move

Finish the Phase 1 XSS sweep as a read-only audit (no changes — report findings), or skip ahead to Phase 2 scaffold. Either is fine; Kyle's call.

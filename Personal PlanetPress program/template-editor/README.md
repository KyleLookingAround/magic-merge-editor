# PlanetPress Template Editor

Browser-based editor for PlanetPress Connect template archives (`.OL-template`).
Single-file build — open the deployed page or `dist/index.html` locally, no install required.

> **Status:** Phase 11 complete — 18 modules carved out of the original single-file
> `template-editor.html`. The Vite project here is the source of truth; the original
> `.html` is reference-only. See [`../template-editor.handoff.md`](../template-editor.handoff.md)
> for the migration log and next-phase targets.

## Develop

```sh
npm install
npm run dev          # Vite dev server with HMR (required for File System Access API pre-build)
npm run build        # Type-check + single-file production build → dist/index.html
npm run preview      # Serve the built dist/
npm run typecheck    # tsc --noEmit only
npm test             # Playwright smoke tests
npm run test:ui      # Playwright interactive UI
```

Requires **Node 22+**.

Smoke-test by hand: `npm run build`, then open `dist/index.html` in Chrome or Edge.
The build is fully self-contained (CSS + JS inlined via `vite-plugin-singlefile`) and
works from `file://`. **Do not** open the root `index.html` directly — it references
`/src/main.ts` and only works through the dev server.

## Module layout

```
index.html          Vite entry — body markup + 3 CDN <script> tags + module entry
src/
  main.ts           Entry point. Imports styles.css and legacy.ts (side-effect only).
  styles.css        CSS lifted verbatim from the original single-file editor.
  state.ts          Shared mutable EditorState object.
  hooks.ts          Lightweight hook registry — on / emit / emitAsync.
  recents.ts        IndexedDB-backed recent files — add, list, remove, clear.
  monaco-host.ts    Monaco bootstrap + @field@ token autocomplete provider.
  fs.ts             Extension tables, path predicates, XML codecs, decode helpers.
  tree.ts           File-tree rendering (+ escapeHtml).
  editor.ts         validateXml + formatXml.
  search.ts         Cross-file search — runSearch + result rendering helpers.
  review-modal.ts   Review/Save modal + diff view + compareTemplates + reviewAndSave.
  preview.ts        Preview pipeline, theme panel, token substitution, zoom controls.
  scripts-panel.ts  <script> XML parse/serialize/build, scripts-list UI + bulk ops.
  scenarios.ts      Scenario picker + zip readers + activate/persist.
  navigator.ts      Sections navigator panel.
  script-form.ts    Script form UI + CRUD operations + event wiring.
  sidebar.ts        Sidebar mode switcher (files / nav / scripts / search / theme / notes).
  notes.ts          Notes sidecar — .notes.md per template, persisted alongside archive.
  recent-scripts.ts "Recent" group strip injected above the scripts list.
  context-menu.ts   Shared context menu — openContextMenu / closeCtxMenu.
  preset-overlay.ts Generic overlay-form helper + .OL-jobpreset / .OL-outputpreset editor.
  legacy.ts         Carve residue: DOM event wiring, openFile, file add/rename/delete,
                    loadFromHandle / pickAndOpenFolder, locked-folder unlock, scenario
                    form, monaco "Go to script" wiring. // @ts-nocheck.
fixtures/           synthetic.OL-template — committed test fixture (3 scripts + datamodel).
tests/              Playwright smoke tests.
```

Real client templates (`M2L-KFI`, `M2L-POA`, `*.docx`, `*.OL-datamapper`) are
**not** committed — see `.gitignore`.

## Key technical notes

- **Self-contained build.** `vite-plugin-singlefile` inlines all TypeScript and CSS
  into a single `<script type="module">` block in `dist/index.html`. Any literal
  `</script>` inside a string, comment, or regex in module sources will close the
  outer tag and break the page — always escape as `<\/script>`.

- **Hook system.** `src/hooks.ts` provides a lightweight event registry
  (`on` / `emit` / `emitAsync`) that replaces all `const _orig = X; X = function`
  monkey-patch chains from the original codebase. Canonical functions call
  `emit('eventName', ...)` at their exit points; listeners register via `on(...)`.

- **File System Access API.** Read/write requires HTTPS (or `localhost`). The dev
  server satisfies this; `dist/index.html` opened from `file://` satisfies it too.
  GitHub Pages provides HTTPS for the deployed URL.

## Deploy

Push to `main` → GitHub Actions builds `dist/` and publishes it to GitHub Pages.
The live URL is: **[kylelookingaround.github.io/magic-merge-editor](https://kylelookingaround.github.io/magic-merge-editor/)**

CI runs on every push to `main` and on all pull requests: type-check → build → Playwright smoke tests. See [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## License

TBD.

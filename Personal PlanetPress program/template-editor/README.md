# PlanetPress Template Editor

Browser-based editor for PlanetPress Connect template archives (`.OL-template`).
Single-file build — open the deployed page or `dist/index.html` locally and go.

> **Status:** Phase 11 complete — eighteen modules carved out of the original
> single-file `template-editor.html`. The Vite project here is now the source
> of truth; the original is reference-only. See
> `../template-editor.handoff.md` for the migration plan and the next-phase
> targets (file-IO core, locked-folder unlock, scenario form).

## Develop

```sh
npm install
npm run dev          # Vite dev server (HMR; required for File System Access API)
npm run build        # Type-check + single-file production build to dist/
npm run preview      # Serve the built dist/
npm run typecheck    # tsc --noEmit
npm test             # Playwright smoke tests
```

Requires Node 22+.

To smoke-test a build by hand: `npm run build`, then open `dist/index.html` in
Chrome or Edge. The bundled output is fully self-contained (CSS + JS inlined
via `vite-plugin-singlefile`) and works from `file://`, just like the original
`template-editor.html` did. **Do not** open `index.html` in this folder
directly — it references `/src/main.ts`, which only the dev server can serve.

## Layout

```
index.html        Vite entry — body markup + 3 CDN <script> tags + module entry
src/
  main.ts          Entry. Imports styles.css and legacy.ts side-effect-only.
  styles.css       Lifted from the original verbatim.
  state.ts         Shared mutable EditorState
  hooks.ts         Lightweight hook registry (replaces _orig monkey-patches)
  recents.ts       IndexedDB-backed recent files
  monaco-host.ts   Monaco bootstrap + @field@ autocomplete
  fs.ts            Ext tables, predicates, XML codecs, decode helpers
  tree.ts          File-tree rendering (+ escapeHtml)
  editor.ts        validateXml + formatXml
  search.ts        Search-result rendering helpers
  review-modal.ts  Review/Save modal + diff + compareTemplates + reviewAndSave
  preview.ts       Preview pipeline + theme panel + tokens strip + zoom
  scripts-panel.ts <script> XML parse/serialize/build, scripts-list UI
  scenarios.ts     Scenario picker + zip readers + activate/persist
  navigator.ts     Sections navigator panel
  script-form.ts   Script form UI + CRUD (+ event wiring)
  sidebar.ts       Sidebar mode switcher (files/nav/scripts/search/theme/notes)
  notes.ts         Notes sidecar (.notes.md per template)
  recent-scripts.ts "Recent" group strip injected over the scripts list
  context-menu.ts  Shared mini-context-menu (openContextMenu/closeCtxMenu)
  preset-overlay.ts Generic overlay-form helper + preset (.OL-jobpreset/-output) editor
  legacy.ts        Carve residue: DOM event wiring + remaining file-IO/CRUD
                   flows that haven't been carved yet. // @ts-nocheck.
fixtures/          synthetic.OL-template — committed test fixture
tests/             Playwright smoke tests
```

Real client templates (`M2L-KFI`, `M2L-POA`, `*.docx`, `*.OL-datamapper`) are
**not** committed — see `.gitignore`.

## Deploy

GitHub Actions publishes `dist/` to GitHub Pages on push to `main`. The live URL
needs HTTPS for the File System Access API; Pages provides this.

## License

TBD.

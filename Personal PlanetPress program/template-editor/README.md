# PlanetPress Template Editor

Browser-based editor for PlanetPress Connect template archives (`.OL-template`).
Single-file build — open the deployed page or `dist/index.html` locally and go.

> **Status:** Phase 3 complete — all ten target modules carved out of the
> original single-file `template-editor.html`. The Vite project here is now
> the source of truth; the original is reference-only. See
> `../template-editor.handoff.md` for the migration plan and Phase 4 starting
> points.

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
  main.ts         Entry. Imports styles.css and legacy.ts side-effect-only.
  styles.css      Lifted from the original verbatim.
  state.ts        Shared mutable EditorState
  recents.ts      IndexedDB-backed recent files
  monaco-host.ts  Monaco bootstrap + @field@ autocomplete
  fs.ts           Ext tables, predicates, XML codecs, decode helpers
  tree.ts         File-tree rendering (+ escapeHtml)
  editor.ts       validateXml + formatXml
  search.ts       Search-result rendering helpers
  review-modal.ts openModal/closeModal/renderDiff + zipTextMap
  preview.ts      ZOOM_STEPS + collectUnresolvedTokens
  scripts-panel.ts <script> XML parse / serialize / build / datamodel parse
  legacy.ts       Carve residue: DOM event wiring, the heavy DOM-mutating
                  flows, and the cross-section monkey-patches that still need
                  a hook system before they can move out. // @ts-nocheck.
fixtures/         synthetic.OL-template — committed test fixture (Phase 4)
tests/            Playwright smoke tests
```

Real client templates (`M2L-KFI`, `M2L-POA`, `*.docx`, `*.OL-datamapper`) are
**not** committed — see `.gitignore`.

## Deploy

GitHub Actions publishes `dist/` to GitHub Pages on push to `main`. The live URL
needs HTTPS for the File System Access API; Pages provides this.

## License

TBD.

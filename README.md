# PlanetPress Template Editor

Browser-based editor for PlanetPress Connect template archives (`.OL-template`). Open a template directly in Chrome or Edge — no install, no upload, no server — inspect every file inside the zip, edit scripts via structured forms, preview HTML with live data substitution, and write the package back to disk.

**Live editor:** [kylelookingaround.github.io/magic-merge-editor](https://kylelookingaround.github.io/magic-merge-editor/)
_(Chrome or Edge required for File System Access API)_

---

## Features

| Capability | Details |
|---|---|
| Open & save | `.OL-template`, `.OL-datamapper`, `.OL-datamodel`, `.docx` — in place via File System Access API |
| File tree | Browse, add, rename, and delete zip entries without extracting |
| Script editor | Structured form for every `<script>` in `index.xml` — FLD / IF / JS kinds, field-path autocomplete, datamodel type inference, usages panel |
| Preview | iframe preview with CSS/JS inlined from the zip; With Data / Raw / Split / CSS modes |
| Datamodel substitution | `@field@` tokens resolved from `lastValue` sample; conditional show/hide evaluated |
| Compare | Unified diff between any two templates |
| Review & Save | Inspect every change in a diff modal before anything hits disk |
| Sections navigator | Jump to sections, master pages, and snippets by friendly name instead of GUID |
| Cross-file search | Regex / case / whole-word, line context, click to jump |
| Notes sidecar | Per-template `.notes.md` persisted alongside the archive |
| Recent files | IndexedDB-backed history with relative timestamps |
| Word `.docx` support | Read-only; Theme sidebar extracts colour palette, font scheme, and named styles |

## Requirements

- **Chrome or Edge** (any Chromium-based browser). The File System Access API (`showOpenFilePicker`, `showDirectoryPicker`) is not available in Firefox or Safari.
- An internet connection on first load — JSZip, Monaco editor, and jsdiff are pulled from CDN. After caching they work offline.

## Quick start

The source lives in [`Personal PlanetPress program/template-editor/`](./Personal%20PlanetPress%20program/template-editor/) — a Vite + TypeScript project.

```sh
cd "Personal PlanetPress program/template-editor"
npm install
npm run dev        # Vite dev server with HMR at http://localhost:5173
npm run build      # Type-check + single-file production build → dist/index.html
npm test           # Playwright smoke tests
```

Requires **Node 22+**. See [`template-editor/README.md`](./Personal%20PlanetPress%20program/template-editor/README.md) for the full module layout, build notes, and deployment instructions.

## How it works

The Vite build produces a single self-contained `dist/index.html` with all CSS and JS inlined via [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile). That file works from `file://` just like the original single-file editor it was refactored from. The deployed GitHub Pages URL provides the HTTPS context the File System Access API requires for write permissions.

Push to `main` → GitHub Actions builds `dist/` and publishes to GitHub Pages automatically. See [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml).

## Architecture

The editor began as a single ~7,400-line `template-editor.html`. It is being progressively carved into typed ES modules under `src/`, with `legacy.ts` holding what has not yet been moved. Phase 11 of the refactor is complete — 18 modules extracted, build sitting at ~190 kB (51 kB gzip). The detailed migration log, gotchas, and next-phase targets live in [`template-editor.handoff.md`](./Personal%20PlanetPress%20program/template-editor.handoff.md).

## License

TBD.

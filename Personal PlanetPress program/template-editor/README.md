# PlanetPress Template Editor

Browser-based editor for PlanetPress Connect template archives (`.OL-template`).
Single-file build — open the deployed page or `dist/index.html` locally and go.

> **Status:** Phase 2 scaffold. Modules are being carved out of the original
> single-file `template-editor.html` (in the parent folder). See
> `../template-editor.handoff.md` for the migration plan.

## Develop

```sh
npm install
npm run dev          # Vite dev server
npm run build        # Type-check + single-file production build to dist/
npm run preview      # Serve the built dist/
npm run typecheck    # tsc --noEmit
npm test             # Playwright smoke tests
```

Requires Node 22+.

## Layout

```
src/        ES modules (Phase 3 carve-out target)
fixtures/   synthetic.OL-template — committed test fixture (Phase 4)
tests/      Playwright smoke tests
```

Real client templates (`M2L-KFI`, `M2L-POA`, `*.docx`, `*.OL-datamapper`) are
**not** committed — see `.gitignore`.

## Deploy

GitHub Actions publishes `dist/` to GitHub Pages on push to `main`. The live URL
needs HTTPS for the File System Access API; Pages provides this.

## License

TBD.

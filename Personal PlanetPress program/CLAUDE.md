# CLAUDE.md

Working memory for Claude. Read this at the start of each session to get up to speed on who I am, what I'm working on, and how I like to work.

## About me

- **Name:** Kyle
- **Company:** Finova
- **Role:** Lead Engineer

## Active projects

### Personal PlanetPress program — `template-editor/` (Vite project)

Browser tool for editing PlanetPress Connect template archives. The original was a single-file ~7,400-line `template-editor.html`; it has been progressively carved into typed ES modules under `template-editor/src/`. **Phase 11 is complete** — 18 modules extracted, build at ~190 kB / 51 kB gzip. The Vite project is the source of truth; the original `.html` is reference-only.

**Always read `template-editor.handoff.md` first** before doing structural work. It tracks every completed phase, what's still in `legacy.ts` (~2,250 lines), and the gotchas this codebase has accumulated. The pre-refactor feature documentation lives in `template-editor.md`; lift relevant sections into `template-editor/README.md` as you touch them.

Build: `cd "Personal PlanetPress program/template-editor" && npm run build` produces a fully self-contained `dist/index.html` that opens from `file://` like the original. `npm run dev` for HMR while iterating.

Current refactor state: Phase 12 is next. Cleanest targets are (a) **file-IO core** (`openFile` + `commitCurrentEdit` + `rezipAndSave` → `src/file-ops.ts`), (b) **locked-folder unlock** (small, self-contained, folds into `fs.ts` or `src/locked-folder.ts`), and (c) **scenario form** (`openScenarioForm` etc. → `scenarios.ts`).

## Tools & systems

- **PlanetPress / OL Connect Designer.** Editor work happens in Chrome/Edge against `.OL-template`, `.OL-datamapper`, `.OL-datamodel`, and `.docx` files in this folder.
- **Node 22 + npm 10** are installed.
- **Curl on this Windows machine fails HTTPS revocation checks** (`CRYPT_E_NO_REVOCATION_CHECK`). Use Node's `https` module for any URL fetch (e.g. recomputing SRI hashes after a CDN bump).

## Working preferences

- **Tone:** Direct and concise. Skip the filler.
- **Formatting:** Minimal — prose over bullets unless a list genuinely helps.
- **Files:** Save final outputs to this folder.
- **Clarifying questions:** Ask before doing real work if a request is ambiguous; don't assume.
- **Verification:** Double-check work before declaring it done.
- **Risk:** Treat anything externally visible (public repos, GitHub Actions, file deletions) as needing explicit confirmation, even within a "do this" plan.

## Standing instructions

- **Never overwrite originals without confirming.** `.OL-template` files: back them up before substantive edits. `template-editor.html` is reference-only; the Vite build at `template-editor/` is the live source.
- **The bundled output is still HTML, not JS.** Vite inlines `src/*.ts` into a `<script type="module">` block in `dist/index.html`. Any literal `</script>` inside a string, comment, or regex in module sources will close the outer tag and break the page. Always write as `<\/script>` in module sources.
- **OneDrive bash mount lags behind file-tool writes.** After `Edit`/`Write`, verify with the `Read` tool, not `cat`. The lag can be several minutes.
- **PlanetPress zips use backslashes in entry names.** When reasoning about paths in JS, normalize with `.replace(/\\/g, '/')`.
- Smoke target after any edit: `npm run build` then open `dist/index.html`, load `M2L-KFI.OL-template` (179 scripts, no CDATA), edit a script, *Review & Save*, reopen, verify round-trip.

## Notes / scratchpad

_Use this space for anything Claude should remember between sessions but doesn't fit elsewhere._

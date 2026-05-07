# CLAUDE.md

Working memory for Claude. Read this at the start of each session to get up to speed on who I am, what I'm working on, and how I like to work.

## About me

- **Name:** Kyle
- **Company:** Finova
- **Role:** Lead Engineer

## Active projects

### Personal PlanetPress program — `template-editor/` (Vite project)

Browser tool for editing PlanetPress Connect template archives. The original was a single-file ~7,394-line `template-editor.html`; Phase 3 carved its inline JS into ten ES modules under `template-editor/src/`. The Vite project is now the source of truth; the original `.html` is reference-only.

**Always read `template-editor.handoff.md` first** before doing structural work. It tracks what's been carved, what's still in `legacy.ts`, and the gotchas this codebase has accumulated. The feature documentation lives in `template-editor.md` (pre-refactor; lift relevant bits into `template-editor/README.md` as you touch them).

Build: `cd template-editor && npm run build` produces a fully self-contained `dist/index.html` that opens from `file://` like the original. `npm run dev` for HMR while iterating.

Current focus: more2life document templates (`M2L-KFI`, `M2L-POA`); Phase 4 (state-shell migration → hook system → XSS sweep) is the next chunk of refactor work.

## Tools & systems

- **PlanetPress / OL Connect Designer.** Editor work happens in Chrome/Edge against `.OL-template`, `.OL-datamapper`, `.OL-datamodel`, and `.docx` files in this folder.
- **Node 22 + npm 10** and the **`gh` CLI** are installed. Useful one-liners from `template-editor/`: `gh pr create --fill`, `gh pr checks`, `gh run watch`.
- **Curl on this Windows machine fails HTTPS revocation checks** (`CRYPT_E_NO_REVOCATION_CHECK`). Use Node's `https` module for any URL fetch.

## Working preferences

- **Tone:** Direct and concise. Skip the filler.
- **Formatting:** Minimal — prose over bullets unless a list genuinely helps.
- **Files:** Save final outputs to this folder.
- **Clarifying questions:** Ask before doing real work if a request is ambiguous; don't assume.
- **Verification:** Double-check work before declaring it done.
- **Risk:** Treat anything externally visible (public repos, GitHub Actions, file deletions) as needing explicit confirmation, even within a "do this" plan.

## Standing instructions

- **Never overwrite originals without confirming.** `.OL-template` files: back them up before substantive edits. `template-editor.html` is now reference-only; the Vite build at `template-editor/` is the live source. Keep `template-editor.backup-pre-refactor.html` for one more phase of safety.
- **The bundled output is still HTML, not JS.** Vite inlines `src/*.ts` into a `<script type="module">` block in `dist/index.html`. Any literal `</script>` inside a string, comment, or regex in the bundled JS will close the outer tag and break the page. Always write as `<\/script>` in module sources too — `scripts-panel.ts` already does this.
- **OneDrive bash mount lags behind file-tool writes.** After `Edit`/`Write`, verify with the `Read` tool, not `cat`. The lag can be several minutes.
- **PlanetPress zips use backslashes in entry names.** When reasoning about paths in JS, normalize with `.replace(/\\/g, '/')`.
- Smoke target after any edit: `npm run build` then open `dist/index.html`, load `M2L-KFI.OL-template` (179 scripts, no CDATA), edit a script, *Review & Save*, reopen, verify round-trip.

## Notes / scratchpad

_Use this space for anything Claude should remember between sessions but doesn't fit elsewhere._

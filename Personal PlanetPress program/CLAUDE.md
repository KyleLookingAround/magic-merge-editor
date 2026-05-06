# CLAUDE.md

Working memory for Claude. Read this at the start of each session to get up to speed on who I am, what I'm working on, and how I like to work.

## About me

- **Name:** Kyle
- **Company:** Finova
- **Role:** Lead Engineer

## Active projects

### Personal PlanetPress program — `template-editor.html`

A single-file browser tool (~7,394 lines, vanilla JS) for editing PlanetPress Connect template archives. Currently mid-refactor: extracting the inline JS into Vite-built ES modules and deploying to GitHub Pages.

**Always read `template-editor.handoff.md` first** before doing any structural work on the editor. It tracks what's done, what's next, and the gotchas this codebase has accumulated. The feature documentation lives in `template-editor.md`.

Current focus: more2life document templates (`M2L-KFI`, `M2L-POA`).

## Tools & systems

- **PlanetPress / OL Connect Designer.** Editor work happens in Chrome/Edge against `.OL-template`, `.OL-datamapper`, `.OL-datamodel`, and `.docx` files in this folder.
- **Node 22 + npm 10** are installed. **`gh` CLI is not** — needs installing before any GitHub repo work.
- **Curl on this Windows machine fails HTTPS revocation checks** (`CRYPT_E_NO_REVOCATION_CHECK`). Use Node's `https` module for any URL fetch.

## Working preferences

- **Tone:** Direct and concise. Skip the filler.
- **Formatting:** Minimal — prose over bullets unless a list genuinely helps.
- **Files:** Save final outputs to this folder.
- **Clarifying questions:** Ask before doing real work if a request is ambiguous; don't assume.
- **Verification:** Double-check work before declaring it done.
- **Risk:** Treat anything externally visible (public repos, GitHub Actions, file deletions) as needing explicit confirmation, even within a "do this" plan.

## Standing instructions

- **Never overwrite originals without confirming.** `.OL-template` files and `template-editor.html` itself: back them up before substantive edits. The current pre-refactor backup is `template-editor.backup-pre-refactor.html` — keep it until the Vite-built version has handled at least one real edit.
- **The editor file is `.html`, not `.js`.** Any literal `</script>` inside a string, comment, or regex inside its inline `<script>` block will close the outer tag and break the page. Always escape as `<\/script>`.
- **OneDrive bash mount lags behind file-tool writes.** After `Edit`/`Write`, verify with the `Read` tool, not `cat`. The lag can be several minutes.
- **PlanetPress zips use backslashes in entry names.** When reasoning about paths in JS, normalize with `.replace(/\\/g, '/')`.
- Smoke target after any edit: open `M2L-KFI.OL-template` (179 scripts, no CDATA), edit a script, *Review & Save*, reopen, verify round-trip.

## Notes / scratchpad

_Use this space for anything Claude should remember between sessions but doesn't fit elsewhere._

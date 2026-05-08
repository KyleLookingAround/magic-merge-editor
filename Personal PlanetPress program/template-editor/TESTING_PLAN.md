# Testing Plan — PlanetPress Template Editor

## Context

The editor at `Personal PlanetPress program/template-editor/` is a Vite + TypeScript browser tool whose only automated coverage today is `tests/smoke.spec.ts` (3 Playwright tests against the 997-byte `fixtures/synthetic.OL-template`). There are zero unit tests. Eleven refactor phases have carved logic out of `legacy.ts` into 18 ES modules, most of which ship pure helpers with no coverage, and most user-facing flows (round-trip save, script CRUD, scenarios, preview, theme, notes, presets, locked-folder unlock, search/nav, file ops) are exercised only by manual smoke against `M2L-KFI.OL-template`. With Phase 12+ carves coming (file-IO core, scenario form, locked-folder unlock), the priority is closing general coverage gaps now so the next refactor wave doesn't regress silently.

The plan is a three-layer pyramid: **Vitest unit tests** for pure helpers, **expanded Playwright E2E** for flows that the synthetic fixture already supports, and a **committed manual smoke checklist** for everything that requires a real client template (`M2L-KFI`/`M2L-POA`).

---

## Layer 1 — Unit tests (Vitest + happy-dom)

### Setup

- Add devDeps: `vitest`, `happy-dom`.
- `package.json` scripts: add `"test:unit": "vitest run"` and `"test:all": "npm run test:unit && npm test"`. Leave `"test"` as Playwright (CI compatibility).
- New `vitest.config.ts` at project root: `environment: 'happy-dom'`, `include: ['src/**/*.test.ts']`, `globals: true`.
- Co-locate specs next to sources (`src/fs.test.ts`, etc.) — matches Vitest convention and keeps `tests/` Playwright-only.
- `tsconfig.json`: add `"types": ["vitest/globals"]` (or import explicitly per-file).
- `.github/workflows/ci.yml`: insert `npm run test:unit` between `npm run build` and the Playwright step.

### P0 specs (write first — pure data plumbing, highest ROI)

- **`src/fs.test.ts`** — `extOf`, `langFor`, `isTextPath`, `isImagePath`, `isZipExt`; `decodeXmlEntities` ↔ `encodeXmlText` round-trip on the five entities; `indentAt` (spaces, tabs, EOL edges, offset 0); `replaceTagInner` (tag exists / empty / multiple siblings / preserves indent); `makeMemoCache` (get/set/getOrCompute hit-and-miss, invalidate); `looksLikeText` (ZIP magic, PDF magic, null bytes, valid UTF-8, latin1); `decodeBytes` (UTF-8 happy path + latin1 fallback).
- **`src/editor.test.ts`** — `validateXml`: well-formed → `{ok: true}`; malformed → `{ok: false, error}` (truncated to 240 chars); HTML mode allows tag-soup. `formatXml`: idempotent (`format(format(x)) === format(x)`); preserves CDATA, comments, processing instructions byte-for-byte through stash-restore.
- **`src/scripts-panel.test.ts`** — `stripCdataKeepingOffsets` (CDATA replaced with equal-length whitespace, offsets unchanged); `parseScriptsFromXml` against the three-script synthetic `index.xml` (3 entries with correct names/kinds/findText, byte offsets parseable); `serializeScriptBack` round-trip (parse → no-op serialize → input bytes equal); name change splices to the right offset; `buildNewScriptXml` for each kind produces XML that `parseScriptsFromXml` can re-read; `parseDatamodelFields` against the synthetic datamodel returns the two expected fields with types; `dmTypeToFormType` mapping table.

### P1 specs (write second — domain parsers and predicates)

- **`src/scenarios.test.ts`** — `scnPersistKey()` reflects `state.fileName`; `parseScenarioXmlToMap` against multi-leaf XML produces expected map (first-occurrence-wins, suffix indexing).
- **`src/navigator.test.ts`** — `parseNavigatorEntries` extracts masters/sections/snippets from a synthetic `index.xml`; `normalizeNavPath` resolves forward/backward slash variants against a populated `state.files`.
- **`src/preset-overlay.test.ts`** — `isPresetPath` (case-insensitive `.OL-jobpreset` / `.OL-outputpreset`); `extractPresetScalarFields` against a synthetic preset XML.
- **`src/preview.test.ts`** — `collectUnresolvedTokens` against a happy-dom `Document` with mixed `@field@` tokens; skips inside `<script>`/`<style>`; picks up `alt`/`title`/`href`/`src`/`value` attrs.
- **`src/recents.test.ts`** — `formatRecentTime` covers just-now / minutes / hours / days / ISO-fallback.
- **`src/tree.test.ts`** — `escapeHtml` five-entity table; null/undefined coerce to empty.
- **`src/review-modal.test.ts`** — `zipTextMap` against a synthetic JSZip with mixed text/image/zip-magic bytes returns text-only entries.

### Conventions

- Re-use `fixtures/make-fixture.mjs` outputs where shape matters (`parseScriptsFromXml`, `parseDatamodelFields`). Inline small literal strings for everything else.
- For `state`-aware helpers (`scnPersistKey`, `getZipText`), import the shared `state` and reset relevant fields per-test via a small `beforeEach` helper.
- No mocking IndexedDB — leave `recentsAdd/list/remove/clear` for E2E.

---

## Layer 2 — E2E tests (Playwright)

Keep the existing suite. Add specs that exercise the synthetic fixture; defer flows that need a richer fixture to manual until the carve they ride on lands.

### New spec files (priority order)

**P0 — `tests/round-trip.spec.ts`** (the largest gap)
- Edit a script's name → *Review & Save* → confirm modal → reload via the test input → diff is empty, name persisted. Verifies `compareTemplates` + `zipTextMap` + `rezipAndSave` end-to-end.
- Edit then revert → save → reopen → no diff.

**P0 — `tests/script-crud.spec.ts`**
- "+ New script" picker for TEXT / CONDITIONAL / CONTROL → form opens with defaults → fill name + field → Apply → appears in list with correct kind chip.
- Clone an existing script → form pre-populated → Apply → both visible.
- Delete via right-click context menu → confirm → removed.
- Toggle enabled checkbox → re-render → persisted through `serializeScriptBack` after save+reload.
- Move up/down → order persists across reload.
- Bulk-enable and bulk-delete via the bulk bar.

**P1 — `tests/search-and-nav.spec.ts`**
- Search box filters scripts list by name and by source.
- Kind filter narrows to a single kind.
- Sidebar mode switch (files / nav / scripts / search / theme / notes) — each panel renders without errors.
- Navigator: masters/sections/snippets list renders; clicking an entry opens the file.

**P1 — `tests/preview.spec.ts`** (smoke only — full preview coverage stays manual)
- Toggle Preview → iframe renders, no console errors.
- Tokens strip lists `@CustomerName@` and `@IsActive@` (the synthetic fixture's two fields).
- Click a token → form focuses the bound script.
- Zoom +/− applies expected scale.

**P1 — `tests/notes.spec.ts`**
- Notes mode → type → Ctrl/Cmd+S marks clean → reload template → notes persisted.

**P2 — `tests/recent-scripts.spec.ts`**
- Open three scripts in sequence → "Recent" group strip shows them in MRU order.

**P2 — `tests/preset-overlay.spec.ts`** (needs fixture extension)
- Extend `fixtures/make-fixture.mjs` to also emit `synthetic.OL-jobpreset` (small XML with two scalar fields).
- Open preset → "Open as form" banner appears → click → overlay form renders fields → edit → Apply → reopen → values round-tripped via `replaceTagInner`.

### Deferred to manual

Scenarios picker, locked-folder unlock, and file add/rename/delete dialogs all need either a richer fixture or native-dialog handling that Playwright struggles with. Cover via the manual checklist until their respective Phase 12+ carves land.

### Playwright infra

- Add `tests/_helpers.ts` exporting `loadFixture(page, fixturePath)` to centralize the `setInputFiles('input[type=file][data-testid=load-template]', …)` boilerplate already duplicated in `smoke.spec.ts`.
- `playwright.config.ts`: add `expect: { timeout: 5000 }` (faster failures on the OneDrive lag); keep existing CI gates.

---

## Layer 3 — Manual smoke checklist

Commit as `tests/MANUAL_SMOKE.md`. Cross-link from `template-editor/README.md` and the handoff. Run against `M2L-KFI.OL-template` before each merge to `main`.

1. `npm run build` — clean, single-file `dist/index.html` produced.
2. Open `dist/index.html` in Chrome and Edge; no console errors on load.
3. Load `M2L-KFI.OL-template` (179 scripts, no CDATA): tree renders, scripts panel lists 179.
4. Edit a script's name → *Review & Save* → reopen → diff empty, name persisted.
5. Create a new TEXT script bound to a real datamodel field → Apply → preview shows substituted value.
6. Right-click a script → context menu → clone and delete both work.
7. Bulk-disable two scripts → save → reopen → both disabled.
8. Navigator → click a section → file opens.
9. Toggle Preview → no unresolved-tokens regression vs the previous baseline.
10. If `.OL-jobpreset` available: "Open as form" banner → overlay opens → Apply round-trips.
11. Notes mode → type → Ctrl+S → reload template → persisted.
12. Recent files menu shows the just-loaded template.
13. Locked folder (`snippets`) shows the lock marker; Unlock enables file ops.
14. Load `M2L-POA.OL-template` (CDATA-bearing) → edit a script → save → diff clean (covers the CDATA path).

---

## Critical files

| File | Action |
|---|---|
| `Personal PlanetPress program/template-editor/package.json` | Add devDeps `vitest`, `happy-dom`; add `test:unit` and `test:all` scripts. |
| `Personal PlanetPress program/template-editor/vitest.config.ts` | New: happy-dom env, `src/**/*.test.ts` include. |
| `Personal PlanetPress program/template-editor/tsconfig.json` | Add `vitest/globals` to types. |
| `Personal PlanetPress program/template-editor/src/*.test.ts` | New unit specs per P0/P1 above. |
| `Personal PlanetPress program/template-editor/tests/_helpers.ts` | New: shared `loadFixture` helper. |
| `Personal PlanetPress program/template-editor/tests/round-trip.spec.ts` … `preset-overlay.spec.ts` | New E2E specs. |
| `Personal PlanetPress program/template-editor/tests/MANUAL_SMOKE.md` | New: manual checklist. |
| `Personal PlanetPress program/template-editor/fixtures/make-fixture.mjs` | Extend to emit `synthetic.OL-jobpreset`. |
| `.github/workflows/ci.yml` | Insert `npm run test:unit` before the Playwright step. |

## Reuse, don't reinvent

- `fixtures/synthetic.OL-template` + `fixtures/make-fixture.mjs` already exist — extend the generator rather than ship parallel fixtures.
- `tests/smoke.spec.ts` already proves the `data-testid=load-template` hidden-input pattern; copy through `_helpers.ts`.
- `parseScriptsFromXml` / `parseDatamodelFields` are pure functions exported from `src/scripts-panel.ts` — call them directly in unit tests, no DOM bootstrap required.

## Verification

```sh
cd "Personal PlanetPress program/template-editor"
npm install                  # picks up vitest + happy-dom
npm run test:unit            # Vitest, sub-second, no browser
npm test                     # Playwright (existing + new specs)
npm run test:all             # both layers
```

CI runs both layers on PR and push to `main`. The manual checklist runs on the bundled `dist/index.html` against `M2L-KFI.OL-template` before merging to `main`. Sequence the work as: P0 unit → P0 E2E → CI wiring → P1 unit → P1 E2E → manual checklist commit → P2 E2E (preset overlay needs the fixture extension first).

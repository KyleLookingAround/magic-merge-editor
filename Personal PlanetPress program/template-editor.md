# PlanetPress Template Editor

A single-file, browser-based tool for inspecting and editing PlanetPress Connect template archives without going through Connect Designer. Drop in a `.OL-template`, `.OL-datamapper`, or `.OL-datamodel`, edit any text file inside, preview the rendered HTML, and write the package back to disk.

Word `.docx` files are also supported in read-only mode — they open with a sidebar *Theme* view that extracts the doc's colour palette, font scheme, and named styles for use in the matching Connect templates. (An earlier release also offered a rendered *Document* preview via mammoth.js; it was removed because mammoth didn't convert these templates reliably.)

## Requirements

- Chrome or Edge (or any Chromium-based browser). The tool relies on the **File System Access API** to open files in place and overwrite them, which Firefox and Safari don't currently expose.
- An internet connection on first load — JSZip, Monaco, jsdiff, and mammoth.js are pulled from public CDNs. Once cached they'll work offline.

## Getting started

The editor lives at `template-editor.html` in this folder. Double-click it (or right-click → *Open with* → Chrome/Edge) and the editor opens as a regular web page. There's no install step.

There are two ways to start working:

**Single file** — click *Open Template* in the header and pick any `.OL-template`, `.OL-datamapper`, `.OL-datamodel`, or `.docx` from disk. The first save will trigger a browser permission prompt to write back to that file (`.docx` is read-only — see *Word document support* below).

**Whole folder** — click *Open Folder*, point it at the PlanetPress folder, and the sidebar shows every template-shaped file inside (including any `.docx` source documents). Click any entry to load it; the *← Back to folder* button at the top returns you to the list. The refresh arrow on the folder header rescans if files change on disk.

## The editor layout

```
+--------------------------------------------------------------+
| Header  [Open ▼] [Open Folder] [Compare] [Save] [Review]     |
+----------+----------------------+----------------------------+
| Sidebar  | Editor               | Preview (when shown)       |
| - Folder | - File tab + actions | - With Data / Raw / Split  |
| - Tree   | - Monaco editor      | - CSS view (merged)        |
| - Sections | - Script form view | - Unresolved tokens strip  |
| - Scripts|                      |                            |
| - Search |                      |                            |
+----------+----------------------+----------------------------+
```

The sidebar has four modes — *Files* (the tree of everything inside the open zip), *Sections* (a friendly-name navigator for the template's sections, master pages, and snippets), *Scripts* (a list of every `<script>` element parsed out of `index.xml`, with a form-based editor for each), and *Search* (cross-file search results). Toggle between them with the buttons at the top of the sidebar.

The main area shows whichever file you've clicked: text files open in a Monaco editor with syntax highlighting, image files show a thumbnail, and other binary files show a placeholder. Binary entries are left untouched on save.

## Features

### Edit any text file inside a template

Click a file in the tree to open it. Recognized text formats include XML, HTML, JS, CSS, JSON, SVG, plus the PlanetPress-specific extensions (`.OL-datamodel`, `.OL-jobpreset`, `.OL-outputpreset`, `.OL-script`, `.OL-config`). Files with unknown extensions are content-sniffed — UTF-8 decodable with no embedded null bytes counts as text. Anything else is treated as binary and left alone.

Standalone text files (a bare `.OL-datamodel` on disk that isn't inside a zip) work too. The editor detects the missing PK header and falls back to a single-document edit; the save button is relabeled *Save & Overwrite* and writes plain XML back to disk instead of rebuilding a zip.

Edits are tracked per-file. A yellow dot appears next to any file with uncommitted changes, and on the filename in the header. **Ctrl+S** commits the current file's edit into memory (and runs validation — XML is checked for well-formedness, JSON is parsed, HTML gets a soft warning). The edit isn't on disk yet at this point — it's just staged.

### Add, rename, and delete files

The toolbar above the file tree (**+ New / Rename / Delete**) lets you change the contents of the template package itself, not just edit existing files. Right-clicking any file in the tree exposes the same operations via a context menu.

- **+ New** prompts for a path relative to the template root. The default is the directory of whatever file you currently have open, which makes it one click to add an XML to the datamapper's `SampleDataFiles/` folder. New `.xml` / `.json` / `.html` files start with a minimal stub; everything else starts empty.
- **Rename** moves the file in the in-memory tree, preserving any unsaved edits and Monaco history.
- **Delete** drops the file from the package. Nothing hits disk until you click *Review & Save* — the *Review* modal shows added entries with `ADD`, deletions with `DEL`, and modifications with `CHG` so you can confirm exactly what's about to change.

This is especially useful for the datamapper, where you commonly need to add or remove sample input XML files without re-opening the package in Connect Designer.

### Edit scripts via a form view

PlanetPress templates store all of their personalization (`@LenderRegisteredName@`, `@BrokerFeeOnApplicationRefundable@`, `@BrokerFee@`, etc.) plus conditional show/hide rules and any control-script JavaScript inside `<script>` blocks in `index.xml`. A real template has 100+ of these; finding and editing one in a 250 KB single-line XML is painful.

Switch the sidebar to **Scripts** mode and the editor parses every `<script>` block out of `index.xml` and groups them by kind:

- **FLD** — *field text scripts* (Standard `TextScriptModel`). These bind a `@token@` to a data field and are how nearly all simple personalization works.
- **IF** — *conditional scripts* (Standard `ConditionalScriptModel`). These show or hide an HTML region based on a comparison against a data field.
- **JS** — *control scripts*. Free-form JavaScript that runs at merge time.

Click any entry and a structured form opens in the main pane in place of the Monaco XML view, with named fields for everything inside the block:

| Field             | All scripts | Field text | Conditional | Control |
| ----------------- |:-----------:|:----------:|:-----------:|:-------:|
| Name              | yes         | yes        | yes         | yes     |
| Find Text (`@token@`) | yes     | yes        | yes         | yes     |
| Enabled           | yes         | yes        | yes         | yes     |
| Scope, Selector type/text | yes | yes        | yes         | yes     |
| Field path        |             | yes        | yes         |         |
| Field type        |             | yes        | yes         |         |
| Format / Prefix / Suffix / Insert method | | yes |             |         |
| Condition (EQUAL_TO, GREATER_THAN, CONTAINS, …) |    |            | yes         |         |
| Value             |             |            | yes         |         |
| Action (SHOW / HIDE) |          |            | yes         |         |
| Case insensitive / Toggle visibility | |            | yes         |         |
| Source (Monaco JS) | yes        |            |             | yes     |

Hit **Apply to XML** and the script's block in `index.xml` is updated in place, preserving the surrounding whitespace and any fields you didn't touch. The form is non-destructive in two ways: a **Revert** button reloads the form from the XML, and **Open raw XML…** drops you back in the Monaco editor at the script's exact line if you ever need to see what's about to be written.

A search box at the top of the panel filters scripts by name or `@find@` token — type "Broker" and you only see Broker-related scripts.

#### Datamodel-aware field path

The *Field path* input on field-text and conditional scripts is a combo-box, not a free-form input — start typing and it autocompletes against every field in the open template's `.OL-datamodel` (including dotted paths for table fields like `Applicants.FullName`). Picking a known field also auto-fills the *Field type* dropdown. You can still type a path that isn't in the model if you need to.

Beneath the path input, a small inline indicator shows either:

- **✓ string** plus the field's `lastValue` from the datamodel (e.g. *"Aldermore Bank PLC"*) — so you can see at a glance what value will substitute in.
- **✗ Not found in datamodel** in red, when the path doesn't match any field. The same red exclamation badge appears in the script list, so broken references stand out across the whole template.

#### Toggle scripts on/off from the list

Every script row has a small toggle switch on the left. Click it and just the `<enabled>` tag in the XML flips, no form opens. Combined with the filter box this makes "disable every script with `Broker` in the name" a quick, focused operation.

#### Find where a script is used

The script form has a *Usages* section that scans every HTML and XML file in the package for the script's *findText* (`@token@`) and *selectorText* (the CSS selector for conditional scripts), reporting per-file occurrence counts with a per-needle breakdown when both are set. Click any row to jump to the first match in that file. Tells you exactly what would break if you renamed or deleted the script.

### Add, duplicate, and delete scripts

The Scripts panel toolbar exposes **+ New** and **Delete** buttons. Right-clicking any script row exposes Open / Duplicate / Delete.

- **+ New** opens a small dropdown menu with two choices: *Field text script (FLD)* or *Control / JS script (JS)*. Pick one and you're prompted for the name; the new `<script>` block is inserted alongside an existing sibling so it lands inside the correct `<scripts>` container with matching indentation. The form opens immediately so you can fill in the rest. Click anywhere outside the dropdown to dismiss it without creating anything.
- **Duplicate** (right-click → *Duplicate*) clones the entire `<script>` block, suffixes the name and `@token@` with `_copy`, and opens the duplicate in the form so you can rename it. Way faster than New + retyping every field when most new scripts are slight variations of an existing one.
- **Delete** removes the entire `<script>` block from `index.xml`, gobbling the leading whitespace so no blank line is left behind.

All operations are staged in memory — the *Review & Save* dialog shows `index.xml` as `CHG` with the precise diff before anything is written to disk.

### Sections / Master pages / Snippets navigator

The **Sections** mode in the sidebar parses `<masters>`, `<sections>`, and `<snippets>` out of `index.xml` and renders each entry by its friendly name (*"Master page 1"*, *"Section 1"*) instead of the GUID-named HTML files Connect saves on disk. Click any entry to jump straight to the underlying `public/document/section-…html` file. No more guessing which `master-e61bdabd-58c2-4868-a53d-9547bb6cffef.html` is which master page.

The list refreshes whenever you switch templates, so opening another file from the folder list rebuilds the navigator immediately.

### Recent templates

A `▼` button next to *Open Template* opens a dropdown of the last ten templates and folders you've opened, each with a relative timestamp (*"5m ago"*, *"2d ago"*). Click any entry to re-open it without going through the file picker. The list is persisted in IndexedDB across sessions; *Clear recent files* at the bottom wipes it.

The browser's File System Access API doesn't persist write permission across sessions, so you'll see a one-click permission prompt when re-opening a recent file. If a file's been moved or deleted on disk, the editor drops it from the list automatically.

### Format (pretty-print)

The *Format* button on the file's tab pretty-prints the current file. XML, HTML, SVG, and the OL formats are reflowed with a hand-rolled indenter that preserves CDATA blocks, comments, and processing instructions. JSON is reformatted via parse/stringify. The reformat is applied through Monaco's edit API, so **Ctrl+Z** undoes it cleanly.

Keyboard shortcut: **Ctrl+Alt+L**.

### Search across every file

Toggle *Search* in the sidebar (or **Ctrl+Shift+F**). Type a query and matches appear grouped by file with line numbers and surrounding context. Click any result to jump straight to that line in the editor.

Three toggles sit under the input: case-sensitive, regex, and whole-word. Search runs against the live editor content, so you'll find matches in your uncommitted edits — not just what's on disk. Capped at 50 hits per file and 1000 total to keep the UI responsive on large templates.

### Preview HTML with template assets

When an HTML file is open, the *Preview* button on the file tab opens a split iframe to the right of the editor. The previewed page has all of its references rewired against the in-memory zip:

- External `<link rel="stylesheet">` is inlined as a `<style>` block with `url(...)` and `@import` rewritten.
- `<style>` blocks and `style=""` attributes have their `url(...)` references rewritten.
- `<img src>`, `srcset`, `<source>`, `<video>`, `<audio>`, `<iframe>`, `<object>`, and `<embed>` references are rewritten.
- External `<script src>` is inlined.
- Fonts, icons, and any other linked resources are served via blob URLs from the zip.
- Anything outside the zip (http/https/data URIs) is left alone.

PlanetPress zips frequently store entry names with backslashes (e.g. `public\document\css\Header.css`) while the HTML's `href` uses forward slashes. The preview's path resolver handles both, so linked stylesheets, images, and fonts always find their targets regardless of which separator the zip uses.

#### Preview modes

A row of tabs in the preview header lets you flip between four views of the same template:

- **With Data** — the default. `@field@` placeholders are substituted with sample values from the open template's `.OL-datamodel`, and conditional show/hide rules are evaluated. The banner reports how many fields resolved.
- **Raw** — substitution is skipped. `@field@` tokens render literally and conditional scripts don't fire. Tokens are highlighted with a yellow background so they're easy to spot.
- **Split** — both renders side by side, With Data on the left, Raw on the right. Each pane has its own dot-coloured label and both refresh together. Zoom and Ctrl+scroll affect both panes simultaneously. Useful for spot-checking what personalization is actually doing to the layout.
- **CSS** — instead of an iframe, shows the merged CSS that the preview is using: every linked stylesheet inlined plus every `<style>` block, with a per-source separator and a `Copy` button. Useful when investigating "where is this rule coming from."

The chosen mode is remembered per template — switch templates, come back, and the preview reopens in whichever mode you last used for that file.

#### Datamodel substitution (With Data and Split)

If the open template has a `.OL-datamodel`, the preview resolves data placeholders against the datamodel's `lastValue` sample data:

- `@field@` style tokens are replaced inline. `@LenderRegisteredName@` shows up as *"Aldermore Bank PLC"*, not the literal token.
- Any field-text script's prefix/suffix wrapping is honored when substituting.
- Conditional scripts (the `IF`-badged ones) are evaluated against the sample values — `SHOW`/`HIDE` actions actually take effect, so `display:none` is applied to elements that wouldn't be rendered for that data.

If no `.OL-datamodel` is present, tokens render as literal text. Other parts of the template (visual layout, styling, fonts, images) always render correctly regardless of whether the datamodel is available.

#### Unresolved tokens

When a render leaves any `@token@` strings behind — typically because the datamodel sample is missing a value for that field, or the placeholder is typoed — they're collected and listed in a red strip just above the preview. Each token shows up as a chip:

- **Red border** — no script binds this token. Likely a typo in the HTML or a missing datamodel entry.
- **Blue border** — a script binds it but the value didn't resolve. Click the chip to jump straight to that script's form.

The strip can be dismissed with the × at the right; it'll come back on the next refresh if any tokens are still unresolved.

#### Token-to-script jump

In Raw and Split modes, every highlighted `@token@` in the rendered output is clickable. Clicking jumps the sidebar to *Scripts* mode and opens the matching field-text script's form. Same jump from the unresolved-tokens strip's chips.

This closes the loop between "what placeholder am I looking at on the page" and "where is it bound" — no manual searching for the script that owns a token.

#### Preview header controls

- **With Data / Raw / Split / CSS** — switch render mode (described above).
- **− / 100% / +** — page zoom from 25% up to 400%. Click the percentage to snap back to 100%. **Ctrl+scroll** over the preview also zooms. Hidden in CSS mode.
- **↻ Refresh** — re-render from the live editor content.
- **↗ New tab** — open the assembled HTML as a blob URL in a fresh tab. Useful for full-screen preview and DevTools inspection. Opens the same flavor as the active tab.
- **×** — close the pane.

The preview auto-refreshes every time you commit an edit (Ctrl+S). If you have an HTML file rendered and switch to editing its CSS, the next commit will refresh the same HTML preview with the new styles applied.

The pane is resizable — drag the divider between editor and preview to adjust split ratio.

### Word document support (.docx)

Open a `.docx` the same way you'd open any other template — via *Open Template* or by clicking it in the folder list. Because a `.docx` is technically a zip with structured XML inside, the editor unpacks it and shows the same file tree (`word/document.xml`, `word/styles.xml`, `word/theme/theme1.xml`, etc.) so you can browse the underlying parts in Monaco. Word docs are loaded **read-only** — *Rezip & Overwrite* is disabled, because rebuilding a `.docx` through JSZip doesn't preserve the package invariants Word relies on (Content_Types ordering, relationships, embedded media). The reference workflow is "view here, edit in Word."

When the loaded package is a `.docx`:

- **Theme sidebar mode.** The sidebar gets a *Theme* button that parses `word/theme/theme1.xml` and `word/styles.xml` into three groups:
  - *Colour palette* — the 12-slot Office theme (dk1/lt1/dk2/lt2, accent1–6, hyperlink, followed hyperlink) with hex codes and live swatches.
  - *Font scheme* — the heading (`majorFont`) and body (`minorFont`) typefaces.
  - *Named styles* — every paragraph / character / table style defined in the document, with font, size (in points), colour swatch, and bold/italic flags.

  A **Copy as CSS** button serialises the same data as a ready-to-paste CSS block: a `:root { --theme-accent1: #...; --theme-font-heading: "..."; }` block plus a `.style-Heading1 { font-family: ...; }` rule per named style. Drop that into the matching Connect template's stylesheet to keep the on-paper Word source and the Connect output in visual sync.

The *Sections* and *Scripts* sidebar modes are hidden for `.docx` (they're PlanetPress-specific); the *Files* and *Search* modes still work normally so you can poke around the inner XML if you need to. The preview header still shows a *Document* tab for legacy reasons but it now displays a "removed" placeholder rather than rendering the doc.

### Compare two templates

Once a template is open, the *Compare…* button is enabled. Pick a second template and a modal opens listing every file that differs between the two, with unified diffs on the right. Files only present in one template are tagged `ADD` or `DEL`; files that differ in content are tagged `CHG`.

Useful for understanding regional variants — for example diffing `ALD-CertTitle_EW.OL-template` against `ALD-CertTitle_SC.OL-template` to see exactly what changes between the England-Wales and Scotland editions.

### Review & save (diff preview before overwrite)

The *Review & Save* button (formerly *Rezip & Overwrite*) builds a diff of every text file that's been changed and opens a modal with the file list on the left and a unified diff on the right. Click any file to inspect what's about to change. Hitting *Save N files to disk* rebuilds the zip and writes it back to the original `.OL-template` path. Cancel and nothing is written.

Binary files are passed through unchanged on rezip — you can't accidentally corrupt a font, image, or PDF resource by saving.

Entry order and original modification dates are preserved where possible, so the rezipped template stays as close to the original layout as possible.

## Keyboard shortcuts

| Shortcut          | Action                                            |
| ----------------- | ------------------------------------------------- |
| Ctrl+S            | Commit current file's edit (in memory)            |
| Ctrl+Shift+F      | Open cross-file search                            |
| Ctrl+Alt+L        | Format current file (XML / HTML / JSON / SVG)     |
| Ctrl+scroll       | Zoom preview in/out (cursor over preview pane)    |
| Esc               | Close active modal / clear search input           |

The editor itself is Monaco, so all the usual Monaco shortcuts apply (Ctrl+F find-in-file, Ctrl+H replace-in-file, Ctrl+G goto-line, Ctrl+/ comment, multi-cursor with Alt+click, etc).

## File handling rules

- Templates are unzipped in memory. Nothing is written to disk until you click *Review & Save*.
- The original archive is overwritten on save. There's no automatic backup — commit your templates to source control before working on them, or use *Compare…* against a known-good copy if you need to audit.
- Binary files inside the zip (images, fonts, embedded PDFs) are passed through unchanged on rezip.
- The *Open Template* dialog accepts any file because the File System Access API rejects extension filters containing hyphens (`.OL-template` won't pass its validation regex). The tool checks the PK header to confirm it's actually a zip before trying to load it.

## Limitations and known issues

**Connect runtime is not simulated.** The preview renders static HTML against the template's bundled assets. It doesn't execute the template's data mapping, run snippets, or evaluate Connect-specific scripts (control scripts and free-form JS aren't run). Use the preview for visual layout work; use Connect Designer for end-to-end testing.

**Datamodel substitution uses sample values only.** The *With Data* preview substitutes `@field@` tokens using the `lastValue` sample from the `.OL-datamodel`. There's no way to switch records or supply alternate test data — you see one canned render. Tokens whose fields don't exist in the sample appear in the unresolved-tokens strip; switch to *Raw* mode to confirm a token's literal form.

**No automatic backup.** Saving overwrites the original. The diff preview before save is the safety net, not undo.

**Browser support.** Firefox and Safari can open the page but can't write to disk — they don't yet expose `showOpenFilePicker` / `showDirectoryPicker` with write capability. Use Chrome or Edge.

**Large templates.** Files inside templates over a few MB may be sluggish in Monaco. The cross-file search caps at 1000 total matches to stay responsive.

## Tips

- Use *Open Folder* once and the sidebar becomes a project switcher — clicking between templates loads each one in turn without the file picker round-trip.
- Pretty-print first when reading an unfamiliar XML file. PlanetPress often saves XML on a single line; *Format* makes it actually readable.
- *Compare…* is the fastest way to understand a template family. Pick a sibling variant and the modal shows every meaningful difference at once.
- *Open in new tab* on the preview is the easiest way to inspect with DevTools — you get the full Chrome DevTools panel against the rendered template.
- Commit (Ctrl+S) frequently. The yellow dot makes it easy to see at a glance which files have staged changes vs which still have unsaved typing in the editor.
- The **Scripts** sidebar mode is the fastest way to retarget a personalization. To swap which data field drives `@LenderRegisteredName@`, switch to Scripts, type "Lender" in the filter, click the entry, change *Field path*, and *Apply to XML*. No XML hunting, no risk of breaking surrounding tags.
- For conditional scripts (the ones showing as **IF**), the form exposes the *Field*, *Condition*, *Value*, and *Action* directly — the four pieces that determine which HTML block gets shown — so you can flip a SHOW to HIDE or change the comparison value without touching XML.
- For datamapper sample data, open the `.OL-datamapper`, switch to Files mode, click into the `SampleDataFiles/` folder, then **+ New** to add another XML at the same indentation level. The new file appears as `ADD` in the Review modal.
- The script row toggles let you bisect a template fast: disable half the scripts, refresh the preview, and see which half breaks the layout. Clicking each toggle is a single XML edit — no form, no ceremony.
- The red `!` badge in the script list means the script's *Field path* doesn't exist in the datamodel. Filter the list by the field name and you'll see every dependent script that needs updating after a datamodel rename.
- The preview banner reports how many fields resolved. If it says `0 fields resolved`, the open template either has no `.OL-datamodel` or you're previewing something outside the package — handy sanity check.
- *Split* mode is the fastest way to check whether a personalization rule is actually firing — line up an unfamiliar template's With-Data and Raw renders and the diff jumps out visually.
- The unresolved-tokens strip is the quickest path to "what's broken in this template": red-bordered chips usually mean a typo or a renamed datamodel field, blue-bordered chips usually mean a script needs its sample value updated. Click any blue chip to land in that script's form.
- *CSS* mode is the fastest way to find which stylesheet is winning a specificity fight. The merged view shows every rule in the order the browser sees it, with a comment header naming each source file.
- *Find usages* on a script (the *Usages* section in the form) is the fast way to confirm a script is actually wired up. Zero hits + non-empty `findText` is a strong signal that the corresponding `@token@` was renamed in the HTML but the script wasn't updated.
- The **Sections** mode is by far the fastest way to navigate a template you didn't author. The friendly names (`"Master page 1"`, `"Section 1"`) are way more memorable than `master-e61bdabd-58c2-4868-a53d-9547bb6cffef.html`.

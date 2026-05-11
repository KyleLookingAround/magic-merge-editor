// Generic overlay-form helper + preset (.OL-jobpreset / .OL-outputpreset)
// editor. Carved out of legacy.ts in Phase 11.
//
// The overlay form lifts the form-overlay-on-Monaco pattern out of the Scripts
// feature so any "edit this XML file as a form" view can reuse it. Same
// overlay container, same Apply / Revert / Open raw / Close action set.
//
// Concrete editor included: the preset editor that scans a preset XML's
// top-level scalar children and exposes them as text inputs. Apply uses the
// standard `_raw + offset splice` pattern via `replaceTagInner` so whitespace
// and unknown sibling tags are preserved.
//
// Phase 11 also replaced the legacy `_orig = openFile; openFile = function`
// monkey-patch around the preset banner with a `hookOn('afterOpenFile', ...)`
// registration — falling in line with the rest of the codebase.
import { state } from './state';
import { on as hookOn } from './hooks';
import { extOf, decodeXmlEntities, encodeXmlText, replaceTagInner } from './fs';
import { refreshTreeDirtyMarkers } from './tree';
import { openFile } from './file-ops';
import { setStatus } from './status';

export interface OverlayField {
  tag: string;
  label?: string;
  value: string;
  multiline?: boolean;
}

export interface OverlayFormConfig {
  path: string;
  title?: string;
  subtitle?: string;
  originalText?: string;
  fields: OverlayField[];
  onApply?: (values: Record<string, string>) => void;
  onClose?: () => void;
}

interface OverlayFormState {
  active: (OverlayFormConfig & { originalText: string }) | null;
}

const overlayFormState: OverlayFormState = { active: null };


const PRESET_EXTS = new Set(['ol-jobpreset', 'ol-outputpreset']);

export function isPresetPath(path: string | null | undefined): boolean {
  return PRESET_EXTS.has(extOf(path || ''));
}

export function hideOverlayBanner(): void {
  const b = document.getElementById('overlay-form-banner');
  if (b) b.classList.remove('show');
}

export function openOverlayForm(cfg: OverlayFormConfig): void {
  if (!cfg || !cfg.fields) return;

  document.getElementById('editor')!.style.display = 'none';
  document.getElementById('binary-view')!.classList.remove('show');
  document.getElementById('script-form-view')!.classList.remove('show');
  const scnView = document.getElementById('scenario-form-view');
  if (scnView) scnView.classList.remove('show');
  document.getElementById('editor-tab')!.style.display = 'none';

  const view = document.getElementById('overlay-form-view') as HTMLElement;
  view.classList.add('show');
  document.getElementById('of-title')!.textContent = cfg.title || 'Form view';
  document.getElementById('of-sub')!.textContent = cfg.subtitle || cfg.path || '';

  const fieldsHost = document.getElementById('of-fields') as HTMLElement;
  fieldsHost.innerHTML = '';
  if (!cfg.fields.length) {
    fieldsHost.innerHTML = '<div class="of-empty">No editable scalar fields detected. Use "Open raw…" to edit the XML directly.</div>';
  }
  for (const fld of cfg.fields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const lab = document.createElement('label');
    lab.textContent = fld.label || fld.tag;
    row.appendChild(lab);
    let inp: HTMLInputElement | HTMLTextAreaElement;
    if (fld.multiline || (fld.value && /\n/.test(fld.value)) || (fld.value && fld.value.length > 80)) {
      inp = document.createElement('textarea');
      inp.rows = 3;
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
    }
    inp.value = fld.value == null ? '' : fld.value;
    inp.dataset.tag = fld.tag;
    row.appendChild(inp);
    fieldsHost.appendChild(row);
  }

  overlayFormState.active = { ...cfg, originalText: cfg.originalText || '' };

  // Drop any prior listeners by replacing the buttons with fresh clones.
  const apply = document.getElementById('of-apply')!;
  const revert = document.getElementById('of-revert')!;
  const close = document.getElementById('of-close')!;
  const openRaw = document.getElementById('of-open-raw')!;
  apply.replaceWith(apply.cloneNode(true));
  revert.replaceWith(revert.cloneNode(true));
  close.replaceWith(close.cloneNode(true));
  openRaw.replaceWith(openRaw.cloneNode(true));

  document.getElementById('of-apply')!.addEventListener('click', () => {
    if (!overlayFormState.active || !overlayFormState.active.onApply) return;
    const out: Record<string, string> = {};
    for (const inp of fieldsHost.querySelectorAll('input,textarea')) {
      const el = inp as HTMLInputElement | HTMLTextAreaElement;
      out[el.dataset.tag!] = el.value;
    }
    overlayFormState.active.onApply(out);
  });
  document.getElementById('of-revert')!.addEventListener('click', () => {
    if (!overlayFormState.active) return;
    for (const fld of overlayFormState.active.fields) {
      const inp = fieldsHost.querySelector(`[data-tag="${CSS.escape(fld.tag)}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
      if (inp) inp.value = fld.value == null ? '' : fld.value;
    }
  });
  document.getElementById('of-close')!.addEventListener('click', closeOverlayForm);
  document.getElementById('of-open-raw')!.addEventListener('click', () => {
    const path = overlayFormState.active && overlayFormState.active.path;
    closeOverlayForm();
    if (path && state.files[path]) openFile(path);
  });

  // Ctrl/Cmd+S → Apply (mirrors the script form's binding)
  view.onkeydown = function (e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      if (!view.classList.contains('show')) return;
      e.preventDefault();
      e.stopPropagation();
      (document.getElementById('of-apply') as HTMLElement).click();
    }
  };
}

export function closeOverlayForm(): void {
  const view = document.getElementById('overlay-form-view');
  if (!view) return;
  view.classList.remove('show');
  (view as HTMLElement).onkeydown = null;
  const wasActive = overlayFormState.active;
  overlayFormState.active = null;
  if (wasActive && wasActive.onClose) {
    try { wasActive.onClose(); } catch (_) {}
  }
  if (state.currentPath) openFile(state.currentPath);
}

// Pull every top-level child element of `root` whose only content is text
// (no nested element children). These are the scalar fields safe to edit
// without re-encoding nested structure.
export function extractPresetScalarFields(xmlText: string): OverlayField[] {
  const fields: OverlayField[] = [];
  let doc: Document | null = null;
  try { doc = new DOMParser().parseFromString(xmlText, 'application/xml'); }
  catch (_) { return fields; }
  const root = doc && doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === 'parsererror') return fields;
  for (const child of Array.from(root.children || [])) {
    const hasChildElements = Array.from(child.children || []).length > 0;
    if (hasChildElements) continue;
    const tag = child.localName || child.nodeName;
    if (!tag) continue;
    fields.push({
      tag,
      label: tag,
      value: decodeXmlEntities(child.textContent || ''),
      multiline: (child.textContent || '').length > 80,
    });
  }
  return fields;
}

export function openPresetOverlay(path: string): void {
  const f = state.files[path];
  if (!f || !f.isText) return;
  const text = state.monacoModels[path] ? state.monacoModels[path].getValue() : (f.content || '');
  const fields = extractPresetScalarFields(text);
  hideOverlayBanner();
  openOverlayForm({
    path,
    title: 'Preset editor — ' + path,
    subtitle: extOf(path).toUpperCase() + ' · top-level scalar fields shown below; nested elements stay untouched.',
    originalText: text,
    fields,
    onApply: (formValues) => {
      let updated = text;
      let touched = 0;
      for (const fld of fields) {
        const newVal = formValues[fld.tag];
        if (newVal == null || newVal === fld.value) continue;
        updated = replaceTagInner(updated, fld.tag, encodeXmlText(newVal));
        touched++;
      }
      if (!touched) {
        setStatus('No changes to apply.', 'warn');
        return;
      }
      const model = state.monacoModels[path];
      if (model) {
        const range = model.getFullModelRange();
        model.pushEditOperations([], [{ range, text: updated }], () => null);
      }
      f.content = updated;
      f.dirty = true;
      refreshTreeDirtyMarkers();
      setStatus(`Applied ${touched} field${touched === 1 ? '' : 's'} to ${path}. Click Review & Save to write to disk.`, 'ok');
      // Re-render the form so subsequent changes diff against the new baseline.
      openPresetOverlay(path);
    },
  });
}

// Event wiring — runs at module load
// Show the "Open as form" banner whenever a preset file is opened.
hookOn('afterOpenFile', (...args: unknown[]) => {
  const path = args[0] as string;
  const banner = document.getElementById('overlay-form-banner');
  if (!banner) return;
  if (isPresetPath(path)) {
    const ext = extOf(path).toUpperCase();
    document.getElementById('overlay-form-banner-msg')!.textContent =
      `${ext} files can be edited as a form (top-level scalar fields).`;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
});

const _presetBannerBtn = document.getElementById('overlay-form-banner-open');
if (_presetBannerBtn) {
  _presetBannerBtn.addEventListener('click', () => {
    if (state.currentPath && isPresetPath(state.currentPath)) {
      openPresetOverlay(state.currentPath);
    }
  });
}

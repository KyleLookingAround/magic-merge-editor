// Notes sidecar. Carved out of legacy.ts in Phase 9.
// Each template can have a sibling Markdown file (e.g. M2L-KFI.notes.md
// next to M2L-KFI.OL-template) which the editor loads/saves through the
// open directory handle. State + DOM wiring + Ctrl+S handling all live
// here; legacy.ts only triggers a load via the afterLoadFromHandle hook.
import { state } from './state';
import { setSidebarMode } from './sidebar';

export interface NotesState {
  text: string;
  dirty: boolean;
  forTemplate: string | null;
}

export const notesState: NotesState = {
  text: '',
  dirty: false,
  forTemplate: null,
};

export interface NotesDeps {
  setStatus: (msg: string, kind?: string) => void;
}

let deps: NotesDeps = {
  setStatus: () => {},
};

export function notesSidecarName(): string | null {
  if (!state.fileName) return null;
  return state.fileName.replace(/\.[^.]+$/, '') + '.notes.md';
}

export async function loadNotesForCurrentTemplate(): Promise<void> {
  const ta = document.getElementById('notes-textarea') as HTMLTextAreaElement | null;
  const name = document.getElementById('notes-filename');
  const empty = document.getElementById('notes-empty') as HTMLElement | null;
  const saveBtn = document.getElementById('btn-notes-save') as HTMLButtonElement | null;
  if (!ta || !state.fileName) {
    if (ta) ta.value = '';
    if (name) name.textContent = '(no template open)';
    if (saveBtn) saveBtn.disabled = true;
    if (empty) empty.style.display = '';
    notesState.text = '';
    notesState.dirty = false;
    notesState.forTemplate = null;
    return;
  }
  const sidecar = notesSidecarName()!;
  notesState.forTemplate = state.fileName;
  if (name) name.textContent = sidecar;
  if (empty) empty.style.display = 'none';
  if (saveBtn) saveBtn.disabled = false;
  let text = '';
  if (state.dirHandle) {
    try {
      const fh = await state.dirHandle.getFileHandle(sidecar);
      const f = await fh.getFile();
      text = await f.text();
    } catch (_) { text = ''; }
  }
  ta.value = text;
  notesState.text = text;
  notesState.dirty = false;
}

export async function saveNotes(): Promise<void> {
  if (!state.dirHandle) { deps.setStatus('Open a folder to save notes.', 'warn'); return; }
  const sidecar = notesSidecarName();
  if (!sidecar) return;
  const ta = document.getElementById('notes-textarea') as HTMLTextAreaElement | null;
  if (!ta) return;
  const text = ta.value;
  try {
    const fh = await state.dirHandle.getFileHandle(sidecar, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([text], { type: 'text/markdown' }));
    await w.close();
    notesState.text = text;
    notesState.dirty = false;
    deps.setStatus(`Saved ${sidecar}.`, 'ok');
  } catch (e: any) { deps.setStatus('Save notes failed: ' + e.message, 'err'); }
}

export function configureNotes(d: NotesDeps): void {
  deps = d;

  const ta = document.getElementById('notes-textarea') as HTMLTextAreaElement | null;
  const saveBtn = document.getElementById('btn-notes-save');
  if (ta) ta.addEventListener('input', () => {
    notesState.dirty = ta.value !== notesState.text;
  });
  if (saveBtn) saveBtn.addEventListener('click', saveNotes);
  // Ctrl+S inside the notes textarea saves the notes (instead of committing template edit)
  if (ta) ta.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveNotes();
    }
  });
  const modeNotesBtn = document.getElementById('mode-notes');
  if (modeNotesBtn) modeNotesBtn.addEventListener('click', () => setSidebarMode('notes'));
}

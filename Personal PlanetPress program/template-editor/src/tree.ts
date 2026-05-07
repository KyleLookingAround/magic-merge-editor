// File-tree rendering. Carved out of legacy.ts as the fifth Phase 3
// module.
//
// Scope: the DOM rendering of the left-hand file panel (`#tree`),
// dirty-marker refresh, and the small `escapeHtml` util (used widely
// across the file - exporting it here gives every other module one
// canonical implementation).
//
// File add/rename/delete dialogs, the context menu, locked-folder
// unlock and `revealInTree` still live in legacy.ts because they
// call into commitCurrentEdit / openModal / setStatus / openFile,
// none of which have moved out yet.
//
// Cross-module dependencies (`isLockedFolderMarker`, `openFile`) are
// supplied once via `configureTree` to avoid a hard import from this
// module back into legacy.ts.

import { state } from './state';
import { isTextPath, isImagePath } from './fs';

interface FileEntry { content: any; isText: boolean; dirty?: boolean; }

export interface TreeDeps {
  isLockedFolderMarker: (path: string, fileEntry: FileEntry | undefined) => boolean;
  openFile: (path: string) => void;
}

let deps: TreeDeps = {
  isLockedFolderMarker: () => false,
  openFile: () => {},
};

export function configureTree(d: TreeDeps): void { deps = d; }

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
  files: { name: string; path: string }[];
  lockedMarker?: string;
}

// Builds a folder/file tree from the flat path list in state.files and
// renders it into `#tree`. Tree nests properly regardless of whether
// the source archive used '/' or '\' separators in entry names.
// Zero-byte entries whose path matches one of OL Connect's reserved
// "locked" folders (snippets / translations / js / fonts /
// color-profiles) are folder markers, not files: they render as empty
// folders with a 🔒.
export function buildTree(): void {
  const root: TreeNode = { name: '', children: {}, files: [] };
  for (const path of Object.keys(state.files).sort()) {
    const parts = path.split(/[/\\]/);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      node.children[seg] = node.children[seg] || { name: seg, children: {}, files: [] };
      node = node.children[seg];
    }
    const leaf = parts[parts.length - 1];
    if (deps.isLockedFolderMarker(path, state.files[path])) {
      node.children[leaf] = node.children[leaf] || { name: leaf, children: {}, files: [], lockedMarker: path };
      continue;
    }
    node.files.push({ name: leaf, path });
  }
  const treeEl = document.getElementById('tree');
  if (!treeEl) return;
  treeEl.innerHTML = '';
  treeEl.appendChild(renderNode(root));
}

function renderNode(node: TreeNode): DocumentFragment {
  const frag = document.createDocumentFragment();
  // Directories first (alphabetical).
  const dirNames = Object.keys(node.children).sort();
  for (const dirName of dirNames) {
    const child = node.children[dirName];
    const dirEl = document.createElement('div');
    dirEl.className = 'tree-item dir';
    const header = document.createElement('div');
    header.className = 'tree-item';
    const lockBadge = child.lockedMarker
      ? ' <span class="badge" style="background:#5a4a1a;color:#f0c674;font-size:9px;margin-left:4px;padding:0 4px;border-radius:2px;" title="Locked by OL Connect — click 🔓 Unlock in the toolbar">LOCKED</span>'
      : '';
    header.innerHTML = `<span class="icon">▸</span><span class="name">${escapeHtml(dirName)}</span>${lockBadge}`;
    header.style.padding = '0';
    const wrap = document.createElement('div');
    wrap.className = 'children';
    wrap.appendChild(renderNode(node.children[dirName]));
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      wrap.style.display = collapsed ? 'none' : '';
      const icon = header.querySelector('.icon');
      if (icon) icon.textContent = collapsed ? '▸' : '▾';
    });
    // Expand by default.
    const icon = header.querySelector('.icon');
    if (icon) icon.textContent = '▾';
    const block = document.createElement('div');
    block.appendChild(header);
    block.appendChild(wrap);
    frag.appendChild(block);
  }
  // Files.
  const sortedFiles = node.files.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const f of sortedFiles) {
    const item = document.createElement('div');
    item.className = 'tree-item file';
    item.dataset.path = f.path;
    const iconChar = isTextPath(f.path) ? '📄' : (isImagePath(f.path) ? '🖼️' : '🔒');
    item.innerHTML = `<span class="icon">${iconChar}</span><span class="name">${escapeHtml(f.name)}</span>`;
    if (state.files[f.path] && state.files[f.path].dirty) item.classList.add('dirty');
    item.addEventListener('click', () => deps.openFile(f.path));
    frag.appendChild(item);
  }
  return frag;
}

export function refreshTreeDirtyMarkers(): void {
  document.querySelectorAll<HTMLElement>('.tree-item.file').forEach(el => {
    const p = el.dataset.path;
    if (p && state.files[p] && state.files[p].dirty) el.classList.add('dirty');
    else el.classList.remove('dirty');
  });
  const anyDirty = Object.values(state.files).some((f: any) => f.dirty);
  const fname = document.getElementById('filename');
  if (fname) fname.classList.toggle('dirty', anyDirty);
}

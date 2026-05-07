// Shared editor state. Carved out of legacy.ts as the first Phase 3
// module. Every other module reads from / writes to this single
// mutable object - keep it loose and additive; do not deep-freeze.
//
// The original lived inline in template-editor.html as `const state = { ... }`
// inside one big IIFE. Behaviour here is intentionally identical: a
// plain object with the same keys, default values, and mutation surface.

// Loose typing on purpose. Tightening individual fields belongs in
// later phases once the modules that own them are carved out.
export interface EditorState {
  zip: any;                  // JSZip instance (null if editing a standalone XML file)
  standalone: any;           // for standalone non-zip files: { path, isText, content }
  fileHandle: any;           // FileSystemFileHandle for the open file
  fileName: string | null;   // display name
  files: Record<string, any>; // path -> { content (string|Uint8Array), isText, dirty }
  currentPath: string | null;
  editor: any;
  monacoReady: boolean;
  monacoModels: Record<string, any>; // path -> ITextModel

  // folder mode
  dirHandle: any;            // FileSystemDirectoryHandle when a folder is open
  dirName: string | null;
  folderTemplates: any[];    // [{ name, handle }]

  // docx mode
  isDocx: boolean;           // true when the loaded package is a Word .docx
  docxBytes: Uint8Array | null; // original .docx bytes (for mammoth re-render)

  // Other phases attach further fields ad-hoc; index signature keeps
  // the type permissive without forcing every assignment site to cast.
  [key: string]: any;
}

export const state: EditorState = {
  zip: null,
  standalone: null,
  fileHandle: null,
  fileName: null,
  files: {},
  currentPath: null,
  editor: null,
  monacoReady: false,
  monacoModels: {},

  dirHandle: null,
  dirName: null,
  folderTemplates: [],

  isDocx: false,
  docxBytes: null,
};

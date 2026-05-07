// Monaco bootstrap + @field@ autocomplete provider. Carved out of
// legacy.ts as the third Phase 3 module.
//
// Dependencies on other still-legacy code (commitCurrentEdit and
// scriptsState.datamodelFields) are kept at arm's length: callers
// pass them in, so this module imports nothing from legacy.ts.
//
// Globals `require` (AMD loader) and `monaco` come from the CDN
// <script> tags in index.html and are accessed via globalThis.

import { state } from './state';

// Loose-typed handles for the AMD loader and monaco namespace - both
// are CDN-loaded into the global scope before this module runs.
const amdRequire = (globalThis as any).require as {
  config: (cfg: { paths: Record<string, string> }) => void;
  (deps: string[], cb: () => void): void;
};
const monaco = () => (globalThis as any).monaco;

const MONACO_VS_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

export interface BootstrapOptions {
  /** Called when the user hits Ctrl/Cmd+S inside the editor. */
  onSave: () => void;
  /** Called once monaco is ready. Use it to register language features
   *  that depend on dynamic data (e.g. @field@ autocomplete). */
  onReady?: () => void;
}

/** Configure the AMD loader and instantiate the Monaco editor on
 *  the `#editor` element. Mirrors the original bootstrap exactly:
 *  stores the editor instance on `state.editor`, flips
 *  `state.monacoReady`, and re-enables the Save button if a path is
 *  already selected. */
export function bootstrapMonaco(opts: BootstrapOptions): void {
  amdRequire.config({ paths: { vs: MONACO_VS_PATH } });
  amdRequire(['vs/editor/editor.main'], () => {
    const m = monaco();
    state.editor = m.editor.create(document.getElementById('editor'), {
      value: '',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: 'on',
      fontSize: 13,
      scrollBeyondLastLine: false,
    });
    state.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => opts.onSave());
    state.monacoReady = true;
    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement | null;
    if (saveBtn) saveBtn.disabled = !state.currentPath;
    opts.onReady?.();
  });
}

export interface DatamodelField {
  path: string;
  type?: string;
  lastValue?: unknown;
}

/** Provides autocomplete for `@field@` placeholders inside template HTML.
 *  Triggers on `@`, also fires while typing more characters after it.
 *  Selection inserts `path@` so the closing delimiter is added automatically;
 *  if a closing `@` already follows the cursor, the existing one is consumed
 *  instead. Skips occurrences where the `@` is preceded by a word char (that
 *  `@` is almost certainly the closing delimiter of an already-typed token).
 *
 *  `getFields` is a thunk so the provider always reads the latest list -
 *  the original closure read directly from the module-scoped `scriptsState`. */
export function registerFieldTokenCompletion(
  languages: string[],
  getFields: () => DatamodelField[],
): void {
  const m = monaco();
  if (!m) return;
  const TOKEN_RE = /@([A-Za-z0-9_./\-]*)$/;
  const provider = {
    triggerCharacters: ['@'],
    provideCompletionItems(model: any, position: any) {
      const fields = getFields() || [];
      // Drop table-typed entries - those aren't directly substitutable as a token.
      const candidates = fields.filter(f => f && f.type !== 'table');
      if (!candidates.length) return { suggestions: [] };

      const lineText = model.getLineContent(position.lineNumber);
      const before = lineText.slice(0, position.column - 1);
      const tokenMatch = TOKEN_RE.exec(before);
      if (!tokenMatch) return { suggestions: [] };
      const word = tokenMatch[1];
      const atIdx = before.length - word.length - 1; // 0-based line index of `@`
      const prevChar = atIdx > 0 ? lineText.charAt(atIdx - 1) : '';
      if (/[A-Za-z0-9_./\-]/.test(prevChar)) return { suggestions: [] };

      // After-cursor: if there's already a closing `@` immediately following
      // (with optional word chars in between), include those chars in the
      // replace range and skip the auto-added closing `@`.
      const after = lineText.slice(position.column - 1);
      const afterMatch = /^[A-Za-z0-9_./\-]*@/.exec(after);

      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: atIdx + 2, // 1-based column right after the `@`
        endColumn: position.column + (afterMatch ? afterMatch[0].length : 0),
      };

      const truncate = (s: string, n: number) => (s && s.length > n) ? s.slice(0, n) + '…' : (s || '');
      const suggestions = candidates.map(f => {
        const tail = afterMatch ? '' : '@';
        const sample = f.lastValue ? '  =  ' + truncate(String(f.lastValue), 60) : '';
        return {
          label: '@' + f.path + '@',
          insertText: f.path + tail,
          range,
          filterText: f.path,
          sortText: f.path,
          kind: m.languages.CompletionItemKind.Variable,
          detail: (f.type || 'STRING') + sample,
          documentation: f.lastValue
            ? { value: '**Sample value**\n\n```\n' + String(f.lastValue) + '\n```' }
            : undefined,
        };
      });
      return { suggestions };
    },
  };
  for (const lang of languages) {
    m.languages.registerCompletionItemProvider(lang, provider);
  }
}

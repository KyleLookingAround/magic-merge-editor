// Monaco "Go to script for @token@" action.
// Carved out of legacy.ts in Phase 13.

import { state } from './state';
import { scriptsState } from './scripts-panel';
import { setStatus } from './status';
import { jumpToScriptByToken } from './preview';

declare const monaco: any;

const TOKEN_RE = /@[A-Za-z0-9_./\-]+@/g;

function findTokenAtCursor(editor: any): string | null {
  const model = editor.getModel();
  if (!model) return null;
  const pos = editor.getPosition();
  const line = model.getLineContent(pos.lineNumber);
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const start = m.index + 1;
    const end = m.index + m[0].length + 1;
    if (pos.column >= start && pos.column <= end) return m[0];
  }
  return null;
}

(function wireMonacoGotoScript() {
  function tryRegister() {
    if (!state.editor || typeof monaco === 'undefined') {
      setTimeout(tryRegister, 200);
      return;
    }
    state.editor.addAction({
      id: 'cw.goto-script-for-token',
      label: 'Go to script for @token@',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0.5,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyG],
      run(editor: any) {
        const found = findTokenAtCursor(editor);
        if (!found) { setStatus('Place the cursor inside an @token@ first.', 'warn'); return; }
        jumpToScriptByToken(found);
      },
    });
    if (scriptsState && scriptsState.sourceEditor) {
      (scriptsState.sourceEditor as any).addAction({
        id: 'cw.goto-script-for-token-form',
        label: 'Go to script for @token@',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.5,
        run(editor: any) {
          const found = findTokenAtCursor(editor);
          if (found) jumpToScriptByToken(found);
        },
      });
    }
  }
  tryRegister();
})();

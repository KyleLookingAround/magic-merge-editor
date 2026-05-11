// Monaco "Go to script for @token@" action registration.
// Polls until state.editor and monaco are available, then registers
// the action on both the main editor and the script source editor.

import { state } from './state';
import { setStatus } from './status';
import { scriptsState } from './scripts-panel';
import { jumpToScriptByToken } from './preview';

declare const monaco: any;

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
        const model = editor.getModel();
        if (!model) return;
        const pos = editor.getPosition();
        const line = model.getLineContent(pos.lineNumber);
        const re = /@[A-Za-z0-9_./\-]+@/g;
        let m: RegExpExecArray | null, found: string | null = null;
        while ((m = re.exec(line)) !== null) {
          const start = m.index + 1;
          const end = m.index + m[0].length + 1;
          if (pos.column >= start && pos.column <= end) { found = m[0]; break; }
        }
        if (!found) {
          setStatus('Place the cursor inside an @token@ first.', 'warn');
          return;
        }
        if (typeof jumpToScriptByToken === 'function') jumpToScriptByToken(found);
        else setStatus('Scripts panel unavailable in this template.', 'warn');
      },
    });
    if (scriptsState && scriptsState.sourceEditor) {
      (scriptsState.sourceEditor as any).addAction({
        id: 'cw.goto-script-for-token-form',
        label: 'Go to script for @token@',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.5,
        run(editor: any) {
          const model = editor.getModel();
          const pos = editor.getPosition();
          const line = model.getLineContent(pos.lineNumber);
          const re = /@[A-Za-z0-9_./\-]+@/g;
          let m: RegExpExecArray | null, found: string | null = null;
          while ((m = re.exec(line)) !== null) {
            const a = m.index + 1, b = m.index + m[0].length + 1;
            if (pos.column >= a && pos.column <= b) { found = m[0]; break; }
          }
          if (found && typeof jumpToScriptByToken === 'function') jumpToScriptByToken(found);
        },
      });
    }
  }
  tryRegister();
})();

import './styles.css';

// Bootstrap and the two DI seams that cannot be resolved
// without circular imports (tree ↔ file-ops; scripts-panel ↔ script-form).
import { bootstrapMonaco, registerFieldTokenCompletion } from './monaco-host';
import { commitCurrentEdit, openFile } from './file-ops';
import { scriptsState, configureScriptsList } from './scripts-panel';
import { openScriptForm, toggleScriptEnabled, moveScript } from './script-form';
import { configureTree } from './tree';

// Side-effect modules (DOM wiring + hook registrations at load time)
import './layout';
import './monaco-goto';

bootstrapMonaco({
  onSave: () => commitCurrentEdit(true),
  onReady: () => {
    registerFieldTokenCompletion(
      ['html'],
      () => (scriptsState.datamodelFields) || [],
    );
  },
});

configureTree({ openFile: (path: string) => openFile(path) });

configureScriptsList({
  openScriptForm: (id: string) => openScriptForm(id),
  toggleScriptEnabled: (id: string, enabled: boolean) => toggleScriptEnabled(id, enabled),
  moveScript: (fromId: string, toId: string, pos: 'before' | 'after') => moveScript(fromId, toId, pos),
});

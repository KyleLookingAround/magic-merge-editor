// Phase 3 entry point. The full editor logic still lives in legacy.ts
// as a verbatim copy of the original inline <script>. Modules are being
// carved out incrementally in this order:
//   state -> recents -> monaco-host -> fs -> tree -> editor ->
//   search -> review-modal -> preview -> scripts-panel
// Smoke against M2L-KFI.OL-template after each carve.

import './styles.css';
import './legacy';

// Entry point. Phase 3 will carve modules out of template-editor.html in this order:
//   state -> recents -> monaco-host -> fs -> tree -> editor -> search ->
//   review-modal -> preview -> scripts-panel
// Smoke against M2L-KFI.OL-template after each step.

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = 'PlanetPress Template Editor — scaffold';
}

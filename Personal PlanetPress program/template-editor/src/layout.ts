// Sidebar and preview-pane drag-resizers.
// Carved out of legacy.ts in Phase 13.

(function wireSidebarResizer() {
  const sidebar = document.getElementById('sidebar')!;
  const r = document.getElementById('resizer')!;
  let dragging = false;
  r.addEventListener('mousedown', e => { dragging = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const min = 200, max = 700;
    const w = Math.max(min, Math.min(max, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

(function wirePreviewResizer() {
  const r = document.getElementById('preview-resizer')!;
  const pane = document.getElementById('preview-pane')!;
  let dragging = false, startX = 0, startW = 0;
  r.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startW = pane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const newW = Math.max(240, Math.min(window.innerWidth * 0.8, startW + delta));
    pane.style.width = newW + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
})();

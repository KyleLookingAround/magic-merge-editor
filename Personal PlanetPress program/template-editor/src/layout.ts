// Drag-resize handlers for the sidebar and preview pane.
(function initLayout() {
  const sidebar = document.getElementById('sidebar') as HTMLElement;
  const r = document.getElementById('resizer') as HTMLElement;
  let dragging = false;
  r.addEventListener('mousedown', e => { dragging = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const min = 200, max = 700;
    const w = Math.max(min, Math.min(max, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });

  const pr = document.getElementById('preview-resizer') as HTMLElement;
  const pane = document.getElementById('preview-pane') as HTMLElement;
  let pdragging = false, startX = 0, startW = 0;
  pr.addEventListener('mousedown', e => {
    pdragging = true; startX = e.clientX; startW = pane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!pdragging) return;
    const delta = startX - e.clientX;
    const newW = Math.max(240, Math.min(window.innerWidth * 0.8, startW + delta));
    pane.style.width = newW + 'px';
  });
  document.addEventListener('mouseup', () => { pdragging = false; document.body.style.cursor = ''; });
})();

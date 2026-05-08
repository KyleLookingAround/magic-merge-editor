// Status bar helper. Carved out of legacy.ts as part of Phase 12 so
// every module can import setStatus directly instead of receiving it
// via a configure-DI seam.

export function setStatus(msg: string, kind?: string): void {
  const el = document.getElementById('status')!;
  el.textContent = msg || '';
  el.className = kind || '';
  if (msg && kind === 'ok') {
    setTimeout(() => {
      if (el.textContent === msg) { el.textContent = ''; el.className = ''; }
    }, 4000);
  }
}

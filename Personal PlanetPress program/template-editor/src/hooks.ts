// Lightweight hook registry. Replaces the 12+ monkey-patch chains that
// wrapped loadFromHandle / commitCurrentEdit / openFile / etc. in legacy.ts.
//
// Usage:
//   import { on, emit, emitAsync } from './hooks';
//
//   // Register (call-site order = execution order):
//   on('afterLoadFromHandle', async (handle) => { ... });
//
//   // Fire from the canonical function body:
//   await emitAsync('afterLoadFromHandle', handle);  // sequential, awaits each
//   emit('afterOpenFile', path);                      // sync call sites; errors logged

type HookFn = (...args: unknown[]) => void | Promise<void>;

const registry: Record<string, HookFn[]> = {};

export function on(event: string, fn: HookFn): void {
  (registry[event] ??= []).push(fn);
}

/** Sequential async emit — awaits each registered hook in registration order.
 *  Use this from async call sites (loadFromHandle, pickAndOpenFolder). */
export async function emitAsync(event: string, ...args: unknown[]): Promise<void> {
  for (const fn of registry[event] ?? []) {
    await fn(...args);
  }
}

/** Fire-and-forget emit for synchronous call sites.
 *  Hooks may still return Promises; errors are caught and logged. */
export function emit(event: string, ...args: unknown[]): void {
  for (const fn of registry[event] ?? []) {
    const r = fn(...args);
    if (r instanceof Promise) r.catch(e => console.error(`[hooks:${event}]`, e));
  }
}

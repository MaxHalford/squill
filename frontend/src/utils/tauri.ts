/**
 * True when running inside the Tauri desktop app.
 *
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview window before any
 * user scripts run. `withGlobalTauri: true` additionally sets `__TAURI__`.
 * We check both, plus the IPC handler, to be robust across Tauri versions.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_IPC__)
}

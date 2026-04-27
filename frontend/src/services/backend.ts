/**
 * Backend URL — resolved in order:
 * 1. Desktop app injects window.__SQUILL_BACKEND_URL__ via Tauri webview
 * 2. VITE_BACKEND_URL env var (for development / deployment)
 * 3. Default localhost:8000
 */
export const BACKEND_URL: string =
  (window as any).__SQUILL_BACKEND_URL__ ||
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:8000'

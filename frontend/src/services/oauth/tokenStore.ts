/**
 * Local storage for OAuth refresh tokens (desktop-only).
 *
 * Refresh tokens live in IndexedDB (same persistence layer as the rest of
 * the desktop app's state). In Tauri the webview is sandboxed to the app's
 * origin, so IndexedDB is not accessible to arbitrary sites — an acceptable
 * starting point. A future hardening step is moving to the OS keychain via
 * a Tauri plugin.
 */

import { loadItem, saveItem, deleteItem } from '../../utils/storage'

const KEY_PREFIX = 'desktop-oauth-refresh:'

function key(provider: string, identifier: string): string {
  return `${KEY_PREFIX}${provider}:${identifier}`
}

export async function saveRefreshToken(
  provider: string,
  identifier: string,
  refreshToken: string,
): Promise<void> {
  await saveItem(key(provider, identifier), refreshToken)
}

export async function loadRefreshToken(
  provider: string,
  identifier: string,
): Promise<string | null> {
  return (await loadItem<string>(key(provider, identifier))) ?? null
}

export async function deleteRefreshToken(
  provider: string,
  identifier: string,
): Promise<void> {
  await deleteItem(key(provider, identifier))
}

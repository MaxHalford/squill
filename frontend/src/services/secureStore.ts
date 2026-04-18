/**
 * Secure credential storage abstraction.
 *
 * - Desktop (Tauri): OS keychain via Rust `keyring` crate
 *   (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * - Web: Not used — credentials are stored on the Squill backend (encrypted)
 *   and fetched on-demand. This module throws on web to prevent accidental use.
 */

import { isTauri } from '../utils/tauri'

/**
 * Store a secret in the OS keychain. Desktop only.
 */
export async function saveSecret(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('saveSecret is only available in the desktop app')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_secret', { key, value })
}

/**
 * Load a secret from the OS keychain. Desktop only.
 */
export async function loadSecret(key: string): Promise<string | null> {
  if (!isTauri()) {
    throw new Error('loadSecret is only available in the desktop app')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('load_secret', { key })
}

/**
 * Delete a secret from the OS keychain. Desktop only.
 */
export async function deleteSecret(key: string): Promise<void> {
  if (!isTauri()) {
    return // Web: no-op (backend handles deletion via DELETE endpoint)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('delete_secret', { key })
}

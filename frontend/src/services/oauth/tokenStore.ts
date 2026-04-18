/**
 * Secure storage for OAuth refresh tokens (desktop-only).
 *
 * Refresh tokens are stored in the OS keychain via the secureStore abstraction
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 */

import { saveSecret, loadSecret, deleteSecret } from '../secureStore'

function key(provider: string, identifier: string): string {
  return `oauth-refresh:${provider}:${identifier}`
}

export async function saveRefreshToken(
  provider: string,
  identifier: string,
  refreshToken: string,
): Promise<void> {
  await saveSecret(key(provider, identifier), refreshToken)
}

export async function loadRefreshToken(
  provider: string,
  identifier: string,
): Promise<string | null> {
  return loadSecret(key(provider, identifier))
}

export async function deleteRefreshToken(
  provider: string,
  identifier: string,
): Promise<void> {
  await deleteSecret(key(provider, identifier))
}

/**
 * Resolves which Google OAuth client credentials to use for the desktop
 * BigQuery sign-in flow.
 *
 * Resolution order (highest precedence first):
 *   1. Environment variables (SQUILL_GOOGLE_CLIENT_ID / _SECRET) — read by
 *      the Tauri Rust process from std::env. Intended for IT-managed
 *      deployments that provision credentials via config management.
 *   2. User settings (IndexedDB, set via the Settings panel).
 *   3. Bundled defaults (VITE_GOOGLE_DESKTOP_CLIENT_ID / _SECRET, baked into
 *      the build).
 *
 * The `source` field tells callers which tier won, which the settings UI uses
 * to show the user where the active credentials are coming from.
 */

import { isTauri } from '../../utils/tauri'
import { useOAuthSettingsStore } from '../../stores/oauthSettings'

export type OAuthConfigSource = 'env' | 'user' | 'bundled' | 'none'

export interface ResolvedOAuthConfig {
  clientId: string
  clientSecret: string
  source: OAuthConfigSource
}

interface EnvOverrides {
  googleClientId: string | null
  googleClientSecret: string | null
}

const BUNDLED_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ||
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  ''
const BUNDLED_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET || ''

let cachedEnvOverrides: EnvOverrides | null = null

interface RustOAuthEnvOverrides {
  google_client_id: string | null
  google_client_secret: string | null
}

export async function getOAuthEnvOverrides(): Promise<EnvOverrides> {
  if (cachedEnvOverrides) return cachedEnvOverrides
  if (!isTauri()) {
    cachedEnvOverrides = { googleClientId: null, googleClientSecret: null }
    return cachedEnvOverrides
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<RustOAuthEnvOverrides>('get_oauth_env_overrides')
    cachedEnvOverrides = {
      googleClientId: result.google_client_id,
      googleClientSecret: result.google_client_secret,
    }
  } catch (err) {
    console.warn('Failed to read OAuth env overrides:', err)
    cachedEnvOverrides = { googleClientId: null, googleClientSecret: null }
  }
  return cachedEnvOverrides
}

export async function getGoogleOAuthConfig(): Promise<ResolvedOAuthConfig> {
  const env = await getOAuthEnvOverrides()
  if (env.googleClientId && env.googleClientSecret) {
    return {
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      source: 'env',
    }
  }

  const settings = useOAuthSettingsStore()
  await settings.ready
  if (settings.googleClientId && settings.googleClientSecret) {
    return {
      clientId: settings.googleClientId,
      clientSecret: settings.googleClientSecret,
      source: 'user',
    }
  }

  if (BUNDLED_CLIENT_ID && BUNDLED_CLIENT_SECRET) {
    return {
      clientId: BUNDLED_CLIENT_ID,
      clientSecret: BUNDLED_CLIENT_SECRET,
      source: 'bundled',
    }
  }

  return { clientId: '', clientSecret: '', source: 'none' }
}

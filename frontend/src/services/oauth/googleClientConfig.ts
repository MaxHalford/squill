/**
 * Resolves which Google OAuth client credentials to use for BigQuery sign-in.
 *
 * Resolution order (highest precedence first):
 *   1. User settings (IndexedDB, set via Settings → Google OAuth (BigQuery)).
 *   2. Bundled defaults (VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET).
 *
 * The `source` field tells callers which tier won, which the settings UI uses
 * to show the user where the active credentials are coming from.
 */

import { useOAuthSettingsStore } from '../../stores/oauthSettings'

export type OAuthConfigSource = 'user' | 'bundled' | 'none'

export interface ResolvedOAuthConfig {
  clientId: string
  clientSecret: string
  source: OAuthConfigSource
}

const BUNDLED_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const BUNDLED_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || ''

export async function getGoogleOAuthConfig(): Promise<ResolvedOAuthConfig> {
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

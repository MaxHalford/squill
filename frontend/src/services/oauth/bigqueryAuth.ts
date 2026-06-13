/**
 * Client-side BigQuery OAuth via Authorization Code + PKCE (RFC 7636).
 *
 * Runs entirely in the browser — no Squill backend involvement. The refresh
 * token returned by Google is persisted in IndexedDB on the Connection record.
 *
 * Flow:
 *   1. `startBigQueryAuth()` generates a PKCE verifier + S256 challenge,
 *      stores the verifier in sessionStorage keyed by state, and redirects
 *      the browser to Google's auth endpoint.
 *   2. Google redirects to `/oauth/bigquery/callback` with code + state.
 *      `OAuthBigQueryCallback.vue` calls `completeBigQueryAuth()`.
 *   3. `completeBigQueryAuth()` POSTs the code + verifier directly to
 *      Google's token endpoint, fetches the user's email, and returns
 *      tokens for the caller to persist.
 *   4. When the access token expires, `refreshBigQueryAccessToken()` POSTs
 *      the stored refresh_token to Google's token endpoint directly.
 *
 * Google requires `client_secret` for "Web application" OAuth client types
 * even with PKCE. The secret is bundled in the SPA (or user-supplied) and
 * is treated as semi-public — PKCE is the real security boundary.
 */

import { generateCodeVerifier, deriveCodeChallenge, generateState } from './pkce'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export const BIGQUERY_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform.read-only',
]

const VERIFIER_KEY_PREFIX = 'bq-pkce:'

export interface BigQueryAuthTokens {
  email: string
  accessToken: string
  refreshToken: string
  expiresIn: number
}

function redirectUri(): string {
  return `${window.location.origin}/oauth/bigquery/callback`
}

/**
 * Begin the BigQuery OAuth flow. Stores a PKCE verifier in sessionStorage
 * and redirects the browser to Google. Returns nothing — the page navigates.
 */
export async function startBigQueryAuth(clientId: string): Promise<void> {
  if (!clientId) {
    throw new Error('Google OAuth client ID is not configured.')
  }

  const verifier = generateCodeVerifier()
  const challenge = await deriveCodeChallenge(verifier)
  const state = generateState()

  sessionStorage.setItem(VERIFIER_KEY_PREFIX + state, verifier)

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: BIGQUERY_SCOPES.join(' '),
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Complete the BigQuery OAuth flow after Google redirects back to
 * `/oauth/bigquery/callback`. Exchanges the code for tokens against Google's
 * token endpoint and fetches the user's email.
 */
export async function completeBigQueryAuth(
  clientId: string,
  clientSecret: string,
  code: string,
  state: string,
): Promise<BigQueryAuthTokens> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY_PREFIX + state)
  if (!verifier) {
    throw new Error('OAuth state mismatch — please try signing in again.')
  }
  sessionStorage.removeItem(VERIFIER_KEY_PREFIX + state)

  const tokenParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri(),
  }
  if (clientSecret) tokenParams.client_secret = clientSecret

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokenParams),
  })
  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text().catch(() => '')
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${detail}`)
  }
  const tokens = await tokenResponse.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. Try signing in again with consent re-prompted.')
  }

  const userinfoResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userinfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userinfoResponse.status}`)
  }
  const userinfo = await userinfoResponse.json() as { email: string }

  return {
    email: userinfo.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  }
}

/**
 * Exchange a stored refresh token for a fresh access token against Google
 * directly. Throws if the refresh token has been revoked — the caller should
 * discard the connection and prompt for re-auth.
 */
export async function refreshBigQueryAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number; refreshRevoked: boolean }> {
  const refreshParams: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  }
  if (clientSecret) refreshParams.client_secret = clientSecret

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(refreshParams),
  })
  if (!response.ok) {
    const refreshRevoked = response.status === 400 || response.status === 401
    const detail = await response.text().catch(() => '')
    const err = new Error(`Token refresh failed: ${response.status} ${detail}`) as Error & { refreshRevoked: boolean }
    err.refreshRevoked = refreshRevoked
    throw err
  }
  const tokens = await response.json() as { access_token: string; expires_in: number }
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, refreshRevoked: false }
}

/** Best-effort revoke against Google. Safe to call without awaiting. */
export async function revokeBigQueryRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  } catch (err) {
    console.warn('BigQuery token revoke failed (ignored):', err)
  }
}

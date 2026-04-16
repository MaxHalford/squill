/**
 * Desktop Google OAuth 2.0 flow (Installed Application w/ PKCE, RFC 8252).
 *
 * Runs entirely client-side from Tauri — no Squill backend involved.
 *
 * Flow:
 *   1. Generate a PKCE verifier + challenge and a CSRF state.
 *   2. Ask Rust to bind a loopback listener and open the system browser at
 *      Google's auth URL with redirect_uri = http://127.0.0.1:PORT/callback.
 *   3. User signs in and grants scopes in their browser.
 *   4. Google redirects to the loopback URL with ?code=...&state=...
 *   5. Rust returns the code (and the exact redirect_uri) to JS.
 *   6. JS POSTs code + verifier + client_id to Google's token endpoint.
 *   7. JS persists the refresh_token locally; access_token goes in memory.
 *
 * Prerequisite: the Google OAuth client ID (VITE_GOOGLE_CLIENT_ID) must
 * allow the `http://127.0.0.1` redirect URI. Either register a separate
 * "Desktop app" client, or add `http://127.0.0.1` to the existing Web
 * client's authorized redirect URIs.
 */

import { generateCodeVerifier, deriveCodeChallenge, generateState } from './pkce'
import { saveRefreshToken, loadRefreshToken, deleteRefreshToken } from './tokenStore'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
const PROVIDER = 'google'

export interface DesktopGoogleTokens {
  email: string
  accessToken: string
  refreshToken: string
  expiresIn: number
}

async function tauriInvoke<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(name, args)
}

/**
 * Run the interactive OAuth flow. Opens the user's browser, waits for them
 * to sign in, and resolves with tokens. Stores the refresh_token locally
 * and returns everything the caller needs to create a BigQuery connection.
 */
export async function runDesktopGoogleAuth(
  clientId: string,
  clientSecret: string,
  scopes: string[],
): Promise<DesktopGoogleTokens> {
  if (!clientId) {
    throw new Error('Google Desktop OAuth client ID is not configured (VITE_GOOGLE_DESKTOP_CLIENT_ID).')
  }

  const verifier = generateCodeVerifier()
  const challenge = await deriveCodeChallenge(verifier)
  const state = generateState()

  const authUrlTemplate = `${AUTH_ENDPOINT}?` + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: scopes.join(' '),
    // The Rust side replaces this literal placeholder with the URL-encoded
    // loopback redirect_uri once the listener has bound a port.
    redirect_uri: 'REDIRECT_URI_PLACEHOLDER',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  }).toString().replace('REDIRECT_URI_PLACEHOLDER', '{redirect_uri}')

  console.log('[Desktop OAuth] Waiting for browser callback...')
  const callback = await tauriInvoke<{
    code: string
    state: string
    redirect_uri: string
  }>('start_oauth_flow', { authUrlTemplate, timeoutSeconds: 300 })
  console.log('[Desktop OAuth] Callback received, redirect_uri:', callback.redirect_uri)

  if (callback.state !== state) {
    throw new Error('OAuth state mismatch — aborting (possible CSRF).')
  }

  console.log('[Desktop OAuth] Exchanging code for tokens...')
  const tokenParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code: callback.code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: callback.redirect_uri,
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
  console.log('[Desktop OAuth] Token exchange successful, has refresh_token:', !!tokens.refresh_token)

  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. Make sure the OAuth client has prompt=consent and access_type=offline.')
  }

  console.log('[Desktop OAuth] Fetching user info...')
  const userinfoResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userinfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userinfoResponse.status}`)
  }
  const userinfo = await userinfoResponse.json() as { email: string }
  console.log('[Desktop OAuth] Authenticated as:', userinfo.email)

  await saveRefreshToken(PROVIDER, userinfo.email, tokens.refresh_token)

  return {
    email: userinfo.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  }
}

/**
 * Exchange a locally-stored refresh token for a fresh access token.
 * Called when the in-memory access token expires.
 */
export async function refreshDesktopGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  email: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const refreshToken = await loadRefreshToken(PROVIDER, email)
  if (!refreshToken) {
    throw new Error('No stored refresh token — please sign in again.')
  }

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
    const detail = await response.text().catch(() => '')
    // A 400 on refresh typically means the refresh token has been revoked
    // or is otherwise invalid. Discard it so the user is forced to re-auth.
    if (response.status === 400 || response.status === 401) {
      await deleteRefreshToken(PROVIDER, email).catch(() => {})
    }
    throw new Error(`Token refresh failed: ${response.status} ${detail}`)
  }

  const tokens = await response.json() as { access_token: string; expires_in: number }
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in }
}

export async function forgetDesktopGoogleAuth(email: string): Promise<void> {
  await deleteRefreshToken(PROVIDER, email)
}

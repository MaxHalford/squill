/**
 * Google Identity Services token flow for a browser-only BigQuery client.
 *
 * Access tokens are deliberately kept in memory by the connections store.
 * Google remembers the user's grant; subsequent token requests normally show
 * only a short-lived popup and do not repeat the consent screen.
 */

import type { GoogleTokenResponse } from '../../types/google-oauth'

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

export const BIGQUERY_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform.read-only',
]

export interface BigQueryAuthorization {
  email: string
  accessToken: string
  expiresIn: number
}

export type BigQueryAuthorizationPrompt = 'consent' | 'select_account'

let scriptPromise: Promise<void> | null = null
let pendingRequest: Promise<GoogleTokenResponse> | null = null

const OAUTH_RESPONSE_CHANNEL_PREFIX = 'squill-google-oauth-'

export function prepareBigQueryAuth(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Google authorization.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google authorization.'))
    document.head.appendChild(script)
  }).catch((error) => {
    scriptPromise = null
    throw error
  })

  return scriptPromise!
}

async function requestToken(
  clientId: string,
  options: { prompt?: string; hint?: string } = {},
): Promise<GoogleTokenResponse> {
  const normalizedClientId = clientId.trim()
  if (!normalizedClientId) throw new Error('Google OAuth client ID is not configured.')
  if (pendingRequest) return pendingRequest

  const state = crypto.randomUUID()
  const channel = new BroadcastChannel(`${OAUTH_RESPONSE_CHANNEL_PREFIX}${state}`)
  const redirectUri = new URL(`${import.meta.env.BASE_URL}oauth-callback.html`, window.location.origin).toString()
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizationUrl.searchParams.set('client_id', normalizedClientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('response_type', 'token')
  authorizationUrl.searchParams.set('scope', BIGQUERY_SCOPES.join(' '))
  authorizationUrl.searchParams.set('include_granted_scopes', 'true')
  authorizationUrl.searchParams.set('state', state)
  if (options.prompt) authorizationUrl.searchParams.set('prompt', options.prompt)
  if (options.hint) authorizationUrl.searchParams.set('login_hint', options.hint)

  const width = 520
  const height = 700
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)

  const request = new Promise<GoogleTokenResponse>((resolve, reject) => {
    let settled = false
    let closedTimer: number | null = null
    let popupWatcher: number | null = null
    let timeout: number | null = null
    const popup = window.open(
      authorizationUrl,
      `squill-google-oauth-${state}`,
      `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
    )

    const cleanup = () => {
      channel.close()
      if (popupWatcher !== null) window.clearInterval(popupWatcher)
      if (timeout !== null) window.clearTimeout(timeout)
      if (closedTimer !== null) window.clearTimeout(closedTimer)
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    channel.onmessage = (event: MessageEvent<Record<string, string | undefined>>) => {
      const rawResponse = event.data
      if (rawResponse.state !== state || settled) return
      settled = true
      cleanup()
      if (rawResponse.error) {
        reject(new Error(rawResponse.error_description || rawResponse.error))
      } else if (!rawResponse.access_token) {
        reject(new Error('Google did not return an access token.'))
      } else {
        resolve({
          access_token: rawResponse.access_token,
          expires_in: Number(rawResponse.expires_in) || 3600,
          scope: rawResponse.scope,
          state: rawResponse.state,
        })
      }
    }

    if (!popup) {
      fail('The browser blocked the Google sign-in popup. Allow popups for this site, then try again.')
      return
    }

    popupWatcher = window.setInterval(() => {
      if (!popup.closed || settled || closedTimer !== null) return
      // The callback page closes immediately after broadcasting the token. Give
      // that message time to arrive before treating the close as cancellation.
      closedTimer = window.setTimeout(() => {
        fail('Google sign-in closed before authorization finished. Please try again.')
      }, 750)
    }, 200)
    timeout = window.setTimeout(() => {
      popup.close()
      fail('Google authorization timed out. Please try again.')
    }, 120_000)
  })

  pendingRequest = request
  request.finally(() => {
    if (pendingRequest === request) pendingRequest = null
  }).catch(() => undefined)
  return request
}

export async function authorizeBigQuery(
  clientId: string,
  options: { prompt?: BigQueryAuthorizationPrompt; expectedEmail?: string } = {},
): Promise<BigQueryAuthorization> {
  const response = await requestToken(clientId, {
    prompt: options.prompt ?? '',
    hint: options.expectedEmail,
  })

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${response.access_token}` },
  })
  if (!userInfoResponse.ok) throw new Error('Google authorized BigQuery, but account details could not be read.')

  const userInfo = await userInfoResponse.json() as { email?: string }
  if (!userInfo.email) throw new Error('Google did not return an email address.')
  if (options.expectedEmail && userInfo.email.toLowerCase() !== options.expectedEmail.toLowerCase()) {
    throw new Error(`Authorized ${userInfo.email}, but this connection belongs to ${options.expectedEmail}.`)
  }

  return {
    email: userInfo.email,
    accessToken: response.access_token,
    expiresIn: response.expires_in || 3600,
  }
}

export function revokeBigQueryAccessToken(accessToken: string): Promise<void> {
  return new Promise((resolve) => {
    const revoke = window.google?.accounts?.oauth2?.revoke
    if (!revoke) {
      resolve()
      return
    }
    revoke(accessToken, resolve)
  })
}

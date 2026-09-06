/**
 * Google Identity Services token flow for a browser-only BigQuery client.
 *
 * Access tokens are deliberately kept in memory by the connections store.
 * Google remembers the user's grant; subsequent token requests normally show
 * only a short-lived popup and do not repeat the consent screen.
 */

import type { GoogleTokenClient, GoogleTokenResponse } from '../../types/google-oauth'

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
let tokenClient: GoogleTokenClient | null = null
let tokenClientId = ''
let pendingRequest: Promise<GoogleTokenResponse> | null = null
let resolvePending: ((response: GoogleTokenResponse) => void) | null = null
let rejectPending: ((error: Error) => void) | null = null

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

function getTokenClient(clientId: string): GoogleTokenClient {
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error('Google authorization is still loading. Please try again.')

  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId
    tokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: BIGQUERY_SCOPES.join(' '),
      prompt: '',
      callback: (response) => {
        if (response.error) {
          rejectPending?.(new Error(response.error_description || response.error))
        } else {
          resolvePending?.(response)
        }
        pendingRequest = null
        resolvePending = null
        rejectPending = null
      },
      error_callback: (error) => {
        let message = error.message || error.type || 'Google authorization was cancelled.'
        if (error.type === 'popup_closed') {
          message = 'Google sign-in closed before authorization finished. Try again and complete the account or consent step in the popup.'
        } else if (error.type === 'popup_failed_to_open') {
          message = 'The browser blocked the Google sign-in popup. Allow popups for this site, then try again.'
        }
        rejectPending?.(new Error(message))
        pendingRequest = null
        resolvePending = null
        rejectPending = null
      },
    })
  }

  return tokenClient
}

async function requestToken(
  clientId: string,
  options: { prompt?: string; hint?: string } = {},
): Promise<GoogleTokenResponse> {
  if (!clientId) throw new Error('Google OAuth client ID is not configured.')
  await prepareBigQueryAuth()
  if (pendingRequest) return pendingRequest

  const client = getTokenClient(clientId)
  pendingRequest = new Promise((resolve, reject) => {
    resolvePending = resolve
    rejectPending = reject
    client.requestAccessToken({
      prompt: options.prompt ?? '',
      login_hint: options.hint,
    })
  })
  return pendingRequest
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

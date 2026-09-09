export interface GoogleTokenResponse {
  access_token: string
  error?: string
  error_description?: string
  expires_in?: number
  scope?: string
  state?: string
}

export interface GoogleUserInfo {
  email: string
  name: string
  photo?: string
  picture?: string
}

export interface GoogleTokenClient {
  requestAccessToken: (config?: { prompt?: string; login_hint?: string }) => void
}

export interface GoogleOAuthError {
  type: string
  message?: string
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            prompt?: string
            callback: (response: GoogleTokenResponse) => void
            error_callback?: (error: GoogleOAuthError) => void
            state?: string
          }) => GoogleTokenClient
          revoke: (token: string, callback: () => void) => void
        }
      }
    }
  }
}

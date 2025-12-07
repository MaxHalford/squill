export interface GoogleTokenResponse {
  access_token: string
  error?: string
  expires_in?: number
  state?: string
}

export interface GoogleUserInfo {
  email: string
  name: string
  photo?: string
  picture?: string
}

export interface GoogleTokenClient {
  requestAccessToken: () => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
            state?: string
          }) => GoogleTokenClient
          revoke: (token: string, callback: () => void) => void
        }
      }
    }
  }
}

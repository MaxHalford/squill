/**
 * OAuth PKCE (Proof Key for Code Exchange) helpers.
 *
 * See https://datatracker.ietf.org/doc/html/rfc7636 — PKCE replaces the
 * client_secret for public clients (like desktop apps) by tying the
 * authorization code to a randomly generated verifier the client proves
 * knowledge of at token exchange time.
 */

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Random URL-safe string, 43 chars after base64url encoding — within RFC 7636's 43–128 range. */
export function generateCodeVerifier(): string {
  return randomBase64Url(32)
}

/** S256 code challenge = base64url(SHA-256(verifier)). */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToBase64Url(new Uint8Array(digest))
}

/** Random CSRF token for the OAuth `state` parameter. */
export function generateState(): string {
  return randomBase64Url(16)
}

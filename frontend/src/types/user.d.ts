/**
 * Subscription plan types
 */
export type PlanType = 'free' | 'pro'

/**
 * User account identified by email from OAuth provider
 */
export interface User {
  id: string
  email: string
  plan: PlanType
  isVip: boolean
}

/**
 * Response from auth callback endpoint
 */
export interface AuthCallbackResponse {
  access_token: string
  expires_in: number
  user: User
}

/**
 * Response from user profile endpoint
 */
export interface UserProfileResponse {
  id: string
  email: string
  plan: string
  is_vip: boolean
}

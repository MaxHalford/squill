/**
 * Subscription plan types
 */
export type PlanType = 'free' | 'pro'

/**
 * OAuth provider used for authentication
 */
export type AuthProvider = 'google' | 'github'

/**
 * User account identified by email from OAuth provider
 */
export interface User {
  id: string
  email: string
  plan: PlanType
  isVip: boolean
  planExpiresAt: string | null
  subscriptionCancelAtPeriodEnd: boolean
  authProvider?: AuthProvider
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
  plan_expires_at: string | null
  subscription_cancel_at_period_end: boolean
}

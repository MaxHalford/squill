import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { User } from '../types/user'
import { createCheckoutSession, openPolarCheckout } from '../services/billing'
import { UserSchema } from '../utils/storageSchemas'
import { loadItem, saveItem, deleteItem } from '../utils/storage'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || ''
const OAUTH_STATE_KEY = 'squill-oauth-state'

// Generate cryptographically secure random state for CSRF protection
const generateOAuthState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

export const useUserStore = defineStore('user', () => {
  // State — starts empty, hydrated from IDB
  const user = ref<User | null>(null)
  const sessionToken = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const isLoggedIn = computed(() => user.value !== null && sessionToken.value !== null)
  const email = computed(() => user.value?.email ?? null)
  const isPro = computed(() => user.value?.plan === 'pro' || user.value?.isVip === true)

  // ---- Persistence ----

  const loadState = async () => {
    try {
      const [userData, token] = await Promise.all([
        loadItem<User>('user'),
        loadItem<string>('session-token'),
      ])
      if (userData) {
        const result = UserSchema.safeParse(userData)
        if (result.success) user.value = result.data
      }
      if (token) sessionToken.value = token
    } catch (err) {
      console.error('Failed to load user state:', err)
    }
  }

  const ready = loadState()

  // Auto-save on changes
  watch(user, (u) => {
    if (u) saveItem('user', u).catch(console.error)
    else deleteItem('user').catch(console.error)
  }, { deep: true })

  watch(sessionToken, (t) => {
    if (t) saveItem('session-token', t).catch(console.error)
    else deleteItem('session-token').catch(console.error)
  })

  // Auto-fetch profile after hydration to sync plan status from backend
  ready.then(() => {
    if (sessionToken.value) {
      fetchProfile().catch(err => {
        console.error('Failed to fetch profile on init:', err)
      })
    }
  })

  // ---- Actions ----

  /**
   * Get authorization headers for API calls
   */
  const getAuthHeaders = (): Record<string, string> => {
    if (!sessionToken.value) {
      return {}
    }
    return {
      'Authorization': `Bearer ${sessionToken.value}`,
    }
  }

  /**
   * Set user and session token after OAuth callback.
   * For Pro/VIP users, also triggers connection sync from backend.
   */
  const setUser = async (userData: User, token?: string) => {
    user.value = userData
    if (token) {
      sessionToken.value = token
    }
    error.value = null

    // For Pro/VIP users, sync connections from backend
    if (userData.plan === 'pro' || userData.isVip) {
      try {
        const { useConnectionsStore } = await import('./connections')
        const connectionsStore = useConnectionsStore()
        await connectionsStore.syncFromBackend()
      } catch (err) {
        console.warn('Failed to sync connections on login:', err)
      }
    }
  }

  /**
   * Fetch user profile from backend
   */
  const fetchProfile = async (): Promise<User | null> => {
    if (!sessionToken.value) {
      return null
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${BACKEND_URL}/user/me`, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired, clear local state
          user.value = null
          sessionToken.value = null
          return null
        }
        throw new Error('Failed to fetch profile')
      }

      const data = await response.json()
      user.value = {
        id: data.id,
        email: data.email,
        plan: data.plan as 'free' | 'pro',
        isVip: data.is_vip ?? false,
        planExpiresAt: data.plan_expires_at ?? null,
        subscriptionCancelAtPeriodEnd: data.subscription_cancel_at_period_end ?? false,
      }

      return user.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to fetch profile:', err)
      return null
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Log out the current user
   */
  const logout = async () => {
    if (!user.value?.email) {
      user.value = null
      sessionToken.value = null
      return
    }

    isLoading.value = true

    try {
      // Notify backend (best effort)
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.value.email }),
      })
    } catch (err) {
      console.error('Failed to notify backend of logout:', err)
    } finally {
      // Clear local state regardless of backend response
      user.value = null
      sessionToken.value = null
      isLoading.value = false
    }
  }

  /**
   * Login with Google OAuth (email scope only).
   * This implements incremental authorization - only email permission is requested.
   * BigQuery permissions are requested separately when adding a BigQuery connection.
   *
   * @param chainBigQuery - If true, after login completes, automatically start BigQuery OAuth
   */
  const loginWithGoogle = async (chainBigQuery: boolean = false): Promise<void> => {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your .env file')
    }

    // Generate and store state for CSRF protection
    // Format: {csrf_token}:{flow_type} or {csrf_token}:{flow_type}:{chain_action}
    const csrfToken = generateOAuthState()
    const flowType = chainBigQuery ? 'login:then-bigquery' : 'login'
    const state = `${csrfToken}:${flowType}`
    sessionStorage.setItem(OAUTH_STATE_KEY, state)

    // Build OAuth URL - only request email scope for login
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/userinfo.email',
      access_type: 'online',  // No refresh token needed for login-only
      state
    })

    // Redirect to Google OAuth
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  /**
   * Login with GitHub OAuth.
   * Uses standard redirect flow (no JS SDK).
   */
  const loginWithGitHub = async (): Promise<void> => {
    if (!GITHUB_CLIENT_ID) {
      throw new Error('GitHub Client ID not configured. Please set VITE_GITHUB_CLIENT_ID in your .env file')
    }

    const csrfToken = generateOAuthState()
    const state = `${csrfToken}:github-login`
    sessionStorage.setItem(OAUTH_STATE_KEY, state)

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      scope: 'user:email',
      state,
    })

    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  /**
   * Delete user account and all associated data
   */
  const deleteAccount = async (): Promise<boolean> => {
    if (!sessionToken.value) {
      return false
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${BACKEND_URL}/user/me`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
        },
      })

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      // Clear local state
      user.value = null
      sessionToken.value = null
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to delete account:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Clear error state
   */
  const clearError = () => {
    error.value = null
  }

  /**
   * Open Polar checkout overlay for Pro subscription
   */
  const upgradeToProCheckout = async (): Promise<void> => {
    if (!sessionToken.value) {
      throw new Error('Must be logged in to upgrade')
    }

    isLoading.value = true
    error.value = null

    try {
      // Create checkout session via backend
      const session = await createCheckoutSession(sessionToken.value)

      // Open Polar embedded checkout (handles redirect on success)
      await openPolarCheckout(session.checkout_url)
    } catch (err) {
      // User closed checkout is not an error to display
      if (err instanceof Error && err.message === 'Checkout was closed') {
        return
      }
      error.value = err instanceof Error ? err.message : 'Failed to start checkout'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Cancel the current Pro subscription
   */
  const cancelSubscription = async (): Promise<void> => {
    if (!sessionToken.value) {
      throw new Error('Must be logged in to cancel subscription')
    }

    const response = await fetch(`${BACKEND_URL}/billing/cancel-subscription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken.value}`,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to cancel subscription')
    }

    // Optimistically update local state (webhook will also update backend)
    if (user.value) {
      user.value = { ...user.value, subscriptionCancelAtPeriodEnd: true }
    }
  }

  /**
   * Resubscribe by uncanceling a pending cancellation
   */
  const resubscribeAction = async (): Promise<void> => {
    if (!sessionToken.value) {
      throw new Error('Must be logged in to resubscribe')
    }

    const { resubscribe } = await import('../services/billing')
    await resubscribe(sessionToken.value)

    // Optimistically update local state (webhook will also update backend)
    if (user.value) {
      user.value = { ...user.value, subscriptionCancelAtPeriodEnd: false }
    }
  }

  return {
    ready,
    // State
    user,
    sessionToken,
    isLoading,
    error,

    // Computed
    isLoggedIn,
    email,
    isPro,

    // Actions
    setUser,
    getAuthHeaders,
    fetchProfile,
    logout,
    loginWithGoogle,
    loginWithGitHub,
    deleteAccount,
    clearError,
    upgradeToProCheckout,
    cancelSubscription,
    resubscribeAction,
  }
})

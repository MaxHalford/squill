import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { User } from '../types/user'
import { getCheckoutSettings, initializePaddle, openPaddleCheckout } from '../services/billing'
import { UserSchema } from '../utils/storageSchemas'

const STORAGE_KEY = 'squill-user'
const SESSION_TOKEN_KEY = 'squill-session-token'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const OAUTH_STATE_KEY = 'squill-oauth-state'

// Generate cryptographically secure random state for CSRF protection
const generateOAuthState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Load user from localStorage with validation
 */
const loadUser = (): User | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return null

    const parsed = JSON.parse(saved)
    const result = UserSchema.safeParse(parsed)

    if (result.success) {
      return result.data
    }

    console.warn('Invalid user data in localStorage:', result.error.issues)
    return null
  } catch (err) {
    console.error('Failed to load user:', err)
    return null
  }
}

/**
 * Save user to localStorage
 */
const saveUser = (user: User | null): void => {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (err) {
    console.error('Failed to save user:', err)
  }
}

/**
 * Load session token from localStorage
 */
const loadSessionToken = (): string | null => {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

/**
 * Save session token to localStorage
 */
const saveSessionToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token)
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY)
    }
  } catch (err) {
    console.error('Failed to save session token:', err)
  }
}

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref<User | null>(loadUser())
  const sessionToken = ref<string | null>(loadSessionToken())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const isLoggedIn = computed(() => user.value !== null && sessionToken.value !== null)
  const email = computed(() => user.value?.email ?? null)
  const isPro = computed(() => user.value?.plan === 'pro' || user.value?.isVip === true)

  // Watch for changes and auto-save
  watch(user, (newUser) => {
    saveUser(newUser)
  }, { deep: true })

  watch(sessionToken, (newToken) => {
    saveSessionToken(newToken)
  })

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
        // Don't throw - localStorage connections still work
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
   * Open Paddle checkout overlay for Pro subscription
   */
  const upgradeToProCheckout = async (): Promise<void> => {
    if (!sessionToken.value) {
      throw new Error('Must be logged in to upgrade')
    }

    isLoading.value = true
    error.value = null

    try {
      // Get checkout settings from backend (now authenticated)
      const settings = await getCheckoutSettings(sessionToken.value)

      // Initialize Paddle with correct environment
      initializePaddle(settings.environment as 'sandbox' | 'production')

      // Open Paddle checkout overlay
      const successUrl = `${window.location.origin}/account?checkout=success`
      openPaddleCheckout(settings.price_id, settings.customer_email, successUrl)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to start checkout'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Auto-fetch profile on store creation to sync plan status from backend
  if (sessionToken.value) {
    fetchProfile().catch((err) => {
      console.error('Failed to fetch profile on init:', err)
    })
  }

  return {
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
    deleteAccount,
    clearError,
    upgradeToProCheckout,
  }
})

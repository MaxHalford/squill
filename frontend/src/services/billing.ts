const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Paddle.js types
declare global {
  interface Window {
    Paddle?: {
      Environment: {
        set: (env: 'sandbox' | 'production') => void
      }
      Checkout: {
        open: (options: PaddleCheckoutOptions) => void
      }
      Initialized: boolean
    }
  }
}

interface PaddleCheckoutOptions {
  items: Array<{ priceId: string; quantity: number }>
  customer?: { email: string }
  customData?: Record<string, string>
  successUrl?: string
  settings?: {
    displayMode?: 'overlay' | 'inline'
    theme?: 'light' | 'dark'
  }
}

export interface CheckoutSettingsResponse {
  price_id: string
  environment: string
  customer_email: string
}

let paddleInitialized = false

/**
 * Initialize Paddle.js with the correct environment
 */
export function initializePaddle(environment: 'sandbox' | 'production'): void {
  if (paddleInitialized || !window.Paddle) {
    return
  }

  window.Paddle.Environment.set(environment)
  paddleInitialized = true
}

/**
 * Get checkout settings from backend (requires authentication)
 */
export async function getCheckoutSettings(sessionToken: string): Promise<CheckoutSettingsResponse> {
  const response = await fetch(`${BACKEND_URL}/billing/checkout-settings`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Failed to get checkout settings')
  }

  return response.json()
}

/**
 * Open Paddle checkout overlay
 */
export function openPaddleCheckout(
  priceId: string,
  email: string,
  successUrl: string
): void {
  if (!window.Paddle) {
    throw new Error('Paddle.js not loaded')
  }

  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: { email },
    successUrl,
    settings: {
      displayMode: 'overlay',
      theme: 'light',
    },
  })
}

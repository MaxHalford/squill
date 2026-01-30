import { PolarEmbedCheckout } from '@polar-sh/checkout/embed'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

export interface CheckoutSessionResponse {
  checkout_url: string
}

/**
 * Create a checkout session via the backend
 */
export async function createCheckoutSession(sessionToken: string): Promise<CheckoutSessionResponse> {
  const response = await fetch(`${BACKEND_URL}/billing/checkout-session`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Failed to create checkout session')
  }

  return response.json()
}

/**
 * Open Polar embedded checkout
 */
export async function openPolarCheckout(checkoutUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    PolarEmbedCheckout.create(checkoutUrl, {
      theme: 'light',
    }).then((checkout) => {
      checkout.addEventListener('success', (event) => {
        checkout.close()
        if (event.detail.redirect && event.detail.successURL) {
          window.location.href = event.detail.successURL
        }
        resolve()
      })

      checkout.addEventListener('close', () => {
        reject(new Error('Checkout was closed'))
      })
    }).catch(reject)
  })
}

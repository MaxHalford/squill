<template>
  <div class="page-container">
    <div class="page-content">
      <div class="page-header">
        <button class="back-button" @click="goBack">← Back</button>
        <button v-if="userStore.isLoggedIn" class="sign-out-button" @click="handleSignOut">
          Sign out
        </button>
      </div>

      <!-- Not logged in state -->
      <div v-if="!userStore.isLoggedIn" class="not-logged-in">
        <h1>Account</h1>
        <p>You're not signed in. Sign in to access account features.</p>
        <button class="sign-in-button" @click="handleSignIn">
          Sign in with Google
        </button>
      </div>

      <!-- Logged in state -->
      <div v-else class="account-sections">
        <h1>Account</h1>

        <!-- Profile Section -->
        <section class="account-section">
          <h2>Profile</h2>
          <div class="profile-card">
            <div class="profile-avatar">
              <div class="avatar-placeholder">
                {{ emailInitial }}
              </div>
            </div>
            <div class="profile-info">
              <div class="profile-email">{{ userStore.user?.email }}</div>
              <div class="profile-provider">
                Signed in with Google
              </div>
            </div>
          </div>
        </section>

        <!-- Plan Section -->
        <section class="account-section">
          <h2>Plan</h2>

          <!-- Success message after checkout -->
          <div v-if="checkoutStatus === 'success'" class="success-banner">
            Welcome to Squill Pro! Your subscription is now active.
          </div>

          <div class="plan-card">
            <div class="plan-status">
              <span class="plan-badge" :class="badgeClass">
                {{ planLabel }}
              </span>
            </div>

            <!-- VIP users -->
            <template v-if="userStore.user?.isVip">
              <p class="plan-description">
                You have lifetime Pro access. Enjoy all Pro features forever.
              </p>

              <!-- VIP without subscription -->
              <button
                v-if="userStore.user?.plan !== 'pro'"
                class="support-button"
                :disabled="isUpgrading"
                @click="handleUpgrade"
              >
                {{ isUpgrading ? 'Loading...' : 'Support Squill with a subscription' }}
              </button>

              <!-- VIP with active subscription -->
              <template v-else-if="!userStore.user?.subscriptionCancelAtPeriodEnd">
                <p class="subscription-info">
                  Thank you for your support! Renews on <strong>{{ formatDate(userStore.user?.planExpiresAt) }}</strong>
                </p>
                <button
                  class="cancel-button"
                  :disabled="isCanceling"
                  @click="handleCancelSubscription"
                >
                  {{ isCanceling ? 'Canceling...' : 'Cancel subscription' }}
                </button>
              </template>

              <!-- VIP with canceled subscription -->
              <template v-else>
                <p class="subscription-info">
                  Your support subscription ends on <strong>{{ formatDate(userStore.user?.planExpiresAt) }}</strong>
                </p>
                <button
                  class="support-button"
                  :disabled="isUpgrading"
                  @click="handleResubscribe"
                >
                  {{ isUpgrading ? 'Loading...' : 'Resubscribe' }}
                </button>
              </template>
            </template>

            <!-- Pro subscribers (active, will renew) -->
            <template v-else-if="userStore.user?.plan === 'pro' && !userStore.user?.subscriptionCancelAtPeriodEnd">
              <p class="plan-description">
                You have access to all Pro features including cloud sync and advanced integrations.
              </p>
              <p class="subscription-info">
                Renews on <strong>{{ formatDate(userStore.user?.planExpiresAt) }}</strong>
              </p>
              <button
                class="cancel-button"
                :disabled="isCanceling"
                @click="handleCancelSubscription"
              >
                {{ isCanceling ? 'Canceling...' : 'Cancel subscription' }}
              </button>
            </template>

            <!-- Pro subscribers (canceled, access until period end) -->
            <template v-else-if="userStore.user?.plan === 'pro' && userStore.user?.subscriptionCancelAtPeriodEnd">
              <p class="plan-description warning">
                Your subscription is canceled. You'll keep Pro access until <strong>{{ formatDate(userStore.user?.planExpiresAt) }}</strong>.
              </p>
              <button
                class="upgrade-button"
                :disabled="isUpgrading"
                @click="handleResubscribe"
              >
                {{ isUpgrading ? 'Loading...' : 'Resubscribe' }}
              </button>
            </template>

            <!-- Free users -->
            <template v-else>
              <p class="plan-description">
                You are on the free plan. Upgrade to Pro for cloud sync, team features, and more.
              </p>
              <button
                class="upgrade-button"
                :disabled="isUpgrading"
                @click="handleUpgrade"
              >
                {{ isUpgrading ? 'Loading...' : 'Upgrade to Pro' }}
              </button>
            </template>
          </div>
        </section>

        <!-- Settings Section -->
        <section class="account-section">
          <h2>Settings</h2>
          <div class="settings-card">
            <p>Application settings are available in the menu bar while using the app.</p>
            <button class="settings-link" @click="goToApp">
              Open app →
            </button>
          </div>
        </section>

        <!-- Danger Zone -->
        <section class="account-section danger-zone">
          <h2>Danger zone</h2>
          <div class="danger-card">
            <p>Permanently delete your account and all associated data. This action cannot be undone.</p>
            <button
              class="delete-button"
              @click="handleDeleteAccount"
              :disabled="isDeleting"
            >
              {{ isDeleting ? 'Deleting...' : 'Delete account' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '../stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const isDeleting = ref(false)
const isUpgrading = ref(false)
const isCanceling = ref(false)
const checkoutStatus = ref<'success' | 'cancelled' | null>(null)

// Handle checkout return
onMounted(async () => {
  const checkout = route.query.checkout as string
  if (checkout === 'success') {
    checkoutStatus.value = 'success'
    await userStore.fetchProfile()
    router.replace({ path: '/account' })
  } else if (checkout === 'cancelled') {
    checkoutStatus.value = 'cancelled'
    router.replace({ path: '/account' })
  }
})

const goBack = () => {
  router.push('/app')
}

const goToApp = () => {
  router.push('/app')
}

const handleSignIn = async () => {
  // Use login-only flow - only requests email permission (incremental auth)
  await userStore.loginWithGoogle()
}

const handleSignOut = async () => {
  await userStore.logout()
  router.push('/')
}

const handleUpgrade = async () => {
  isUpgrading.value = true
  try {
    await userStore.upgradeToProCheckout()
  } catch {
    alert('Failed to start checkout. Please try again.')
  } finally {
    isUpgrading.value = false
  }
}

const handleResubscribe = async () => {
  isUpgrading.value = true
  try {
    await userStore.resubscribeAction()
  } catch {
    alert('Failed to resubscribe. Please try again.')
  } finally {
    isUpgrading.value = false
  }
}

const handleCancelSubscription = async () => {
  const confirmed = window.confirm(
    'Are you sure you want to cancel your Pro subscription? You will keep access until the end of your billing period.'
  )

  if (!confirmed) return

  isCanceling.value = true
  try {
    await userStore.cancelSubscription()
  } catch {
    alert('Failed to cancel subscription. Please try again.')
  } finally {
    isCanceling.value = false
  }
}

const handleDeleteAccount = async () => {
  const confirmed = window.confirm(
    'Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.'
  )

  if (!confirmed) return

  isDeleting.value = true
  const success = await userStore.deleteAccount()
  isDeleting.value = false

  if (success) {
    // Clear all local data
    localStorage.clear()
    router.push('/')
  } else {
    alert('Failed to delete account. Please try again.')
  }
}

const emailInitial = computed(() => {
  const email = userStore.user?.email || '?'
  return email.charAt(0).toUpperCase()
})

const planLabel = computed(() => {
  if (userStore.user?.isVip) return 'VIP'
  if (userStore.user?.plan === 'pro') return 'Pro'
  return 'Free'
})

const badgeClass = computed(() => {
  if (userStore.user?.isVip) return 'vip'
  if (userStore.user?.plan === 'pro') return 'pro'
  return 'free'
})

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'N/A'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  background: var(--surface-secondary, #f5f5f5);
  padding: var(--space-6, 2rem);
}

.page-content {
  max-width: 600px;
  margin: 0 auto;
  background: var(--surface-primary, white);
  border: 2px solid var(--border-primary, black);
  padding: var(--space-6, 2rem);
  box-shadow: var(--shadow-md, 6px 6px 0 0 rgba(0, 0, 0, 0.15));
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4, 1rem);
}

.back-button {
  background: transparent;
  border: 1.5px solid var(--border-primary, black);
  color: var(--text-primary, black);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.1s ease;
}

.back-button:hover {
  background: var(--surface-secondary, #f5f5f5);
}

.sign-out-button {
  background: transparent;
  border: 1.5px solid var(--border-primary, black);
  color: var(--text-primary, black);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.1s ease;
}

.sign-out-button:hover {
  background: var(--surface-secondary, #f5f5f5);
}

h1 {
  font-size: var(--font-size-heading, 1.5rem);
  margin-bottom: var(--space-6, 2rem);
  color: var(--text-primary, black);
  border-bottom: 2px solid var(--border-primary, black);
  padding-bottom: var(--space-2, 0.5rem);
}

/* Not logged in state */
.not-logged-in {
  text-align: center;
  padding: var(--space-6, 2rem) 0;
}

.not-logged-in p {
  color: var(--text-secondary, #666);
  margin-bottom: var(--space-4, 1rem);
}

.sign-in-button {
  background: var(--surface-inverse, black);
  color: var(--text-inverse, white);
  border: 2px solid var(--border-primary, black);
  padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
  font-size: 14px;
  cursor: pointer;
  box-shadow: var(--shadow-sm, 4px 4px 0 0 rgba(0, 0, 0, 0.15));
  transition: all 0.1s ease;
}

.sign-in-button:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-md);
}

.sign-in-button:active {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-sm);
}

/* Account sections */
.account-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 2rem);
}

.account-section h2 {
  font-size: var(--font-size-body-lg, 1rem);
  margin-bottom: var(--space-3, 0.75rem);
  color: var(--text-primary, black);
}

/* Profile Card */
.profile-card {
  display: flex;
  align-items: center;
  gap: var(--space-4, 1rem);
  padding: var(--space-4, 1rem);
  border: 1.5px solid var(--border-secondary, #ddd);
  background: var(--surface-secondary, #f9f9f9);
}

.profile-avatar {
  flex-shrink: 0;
}

.avatar-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid var(--border-primary, black);
  background: var(--surface-inverse, black);
  color: var(--text-inverse, white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: bold;
}

.profile-info {
  flex: 1;
}

.profile-email {
  font-weight: 600;
  font-size: var(--font-size-body, 0.875rem);
  color: var(--text-primary, black);
}

.profile-provider {
  color: var(--text-tertiary, #999);
  font-size: var(--font-size-caption, 0.75rem);
  margin-top: 4px;
}

/* Plan Card */
.plan-card {
  padding: var(--space-4, 1rem);
  border: 1.5px solid var(--border-secondary, #ddd);
  background: var(--surface-secondary, #f9f9f9);
}

.plan-status {
  margin-bottom: var(--space-3, 0.75rem);
}

.plan-badge {
  display: inline-block;
  padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
  font-size: var(--font-size-caption, 0.75rem);
  font-weight: 600;
  text-transform: uppercase;
  border: 1.5px solid var(--border-primary, black);
}

.plan-badge.free {
  background: var(--surface-primary, white);
  color: var(--text-primary, black);
}

.plan-badge.pro {
  background: var(--color-accent, #42b883);
  color: white;
  border-color: var(--color-accent, #42b883);
}

.plan-badge.vip {
  background: linear-gradient(135deg, #d4a017 0%, #ffdf6c 25%, #d4a017 50%, #b8860b 100%);
  color: #1a0a00;
  border: 2px solid #8b6914;
  box-shadow:
    0 0 8px rgba(212, 160, 23, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  text-shadow: 0 1px 0 rgba(255, 223, 108, 0.5);
  font-weight: 700;
  letter-spacing: 0.1em;
  animation: vip-shimmer 3s ease-in-out infinite;
}

@keyframes vip-shimmer {
  0%, 100% {
    box-shadow:
      0 0 8px rgba(212, 160, 23, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.4),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  }
  50% {
    box-shadow:
      0 0 16px rgba(255, 215, 0, 0.8),
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  }
}

.plan-description {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-body, 0.875rem);
  margin-bottom: var(--space-3, 0.75rem);
  line-height: 1.5;
}

.plan-description.warning {
  color: var(--color-warning, #e65100);
}

.subscription-info {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-body, 0.875rem);
  margin-bottom: var(--space-4, 1rem);
}

.subscription-info strong {
  color: var(--text-primary, black);
}

.success-banner {
  background: var(--color-success-bg);
  border: 1.5px solid var(--color-success);
  padding: var(--space-3, 0.75rem);
  margin-bottom: var(--space-4, 1rem);
  color: var(--color-success);
  font-size: var(--font-size-body, 0.875rem);
}

.upgrade-button {
  background: var(--surface-inverse, black);
  color: var(--text-inverse, white);
  border: 2px solid var(--border-primary, black);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.upgrade-button:hover:not(:disabled) {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-md);
}

.upgrade-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.support-button {
  background: transparent;
  color: var(--text-secondary, #666);
  border: 1.5px dashed var(--border-secondary, #ccc);
  padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.support-button:hover:not(:disabled) {
  border-color: var(--color-accent, #42b883);
  color: var(--color-accent, #42b883);
  border-style: solid;
}

.support-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cancel-button {
  background: transparent;
  color: var(--text-secondary, #666);
  border: 1.5px solid var(--border-secondary, #ddd);
  padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.cancel-button:hover:not(:disabled) {
  border-color: var(--color-error, #c62828);
  color: var(--color-error, #c62828);
}

.cancel-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.manage-info {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-body, 0.875rem);
  margin: 0;
}

/* Settings Card */
.settings-card {
  padding: var(--space-4, 1rem);
  border: 1.5px solid var(--border-secondary, #ddd);
  background: var(--surface-secondary, #f9f9f9);
}

.settings-card p {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-body, 0.875rem);
  margin-bottom: var(--space-3, 0.75rem);
}

.settings-link {
  background: transparent;
  border: 1.5px solid var(--border-primary, black);
  color: var(--text-primary, black);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.settings-link:hover {
  background: var(--surface-secondary, #f5f5f5);
}

/* Danger Zone */
.danger-zone h2 {
  color: var(--color-error, #c62828);
}

.danger-card {
  padding: var(--space-4, 1rem);
  border: 1.5px solid var(--color-error, #c62828);
  background: var(--color-error-bg);
}

.danger-card p {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-body, 0.875rem);
  margin-bottom: var(--space-4, 1rem);
  line-height: 1.5;
}

.delete-button {
  background: var(--color-error, #c62828);
  color: white;
  border: none;
  padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.delete-button:hover:not(:disabled) {
  filter: brightness(0.85);
}

.delete-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

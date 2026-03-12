<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useUserStore } from '../stores/user'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

const canvasStore = useCanvasStore()
const userStore = useUserStore()

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

interface ShareLink {
  id: string
  share_token: string
  permission: 'read' | 'write'
  created_at: string
  expires_at: string | null
}

const shares = ref<ShareLink[]>([])
const isLoading = ref(false)
const creating = ref<'read' | 'write' | null>(null)
const copiedToken = ref<string | null>(null)
const error = ref<string | null>(null)

const canvasId = computed(() => canvasStore.activeCanvasId)
const readShare = computed(() => shares.value.find(s => s.permission === 'read') ?? null)
const writeShare = computed(() => shares.value.find(s => s.permission === 'write') ?? null)

const shareUrl = (token: string) =>
  `${window.location.origin}${window.location.pathname}?share=${token}`

const loadShares = async () => {
  if (!canvasId.value || !userStore.sessionToken) return
  isLoading.value = true
  error.value = null
  try {
    const res = await fetch(`${BACKEND_URL}/canvas/${canvasId.value}/shares`, {
      headers: { Authorization: `Bearer ${userStore.sessionToken}` },
    })
    if (!res.ok) throw new Error('Failed to load shares')
    const data = await res.json()
    shares.value = data.shares
  } catch {
    error.value = 'Could not load share links.'
  } finally {
    isLoading.value = false
  }
}

const createShare = async (permission: 'read' | 'write') => {
  if (!canvasId.value || !userStore.sessionToken) return
  creating.value = permission
  error.value = null
  try {
    const res = await fetch(`${BACKEND_URL}/canvas/${canvasId.value}/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userStore.sessionToken}`,
      },
      body: JSON.stringify({ permission }),
    })
    if (!res.ok) throw new Error('Failed to create share link')
    const share = await res.json()
    shares.value.push(share)
    canvasStore.setCanvasShared(canvasId.value!, true)
    copyToClipboard(share.share_token)
  } catch {
    error.value = 'Could not create share link.'
  } finally {
    creating.value = null
  }
}

const revokeShare = async (token: string) => {
  if (!userStore.sessionToken) return
  try {
    const res = await fetch(`${BACKEND_URL}/share/${token}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userStore.sessionToken}` },
    })
    if (!res.ok) throw new Error('Failed to revoke share')
    shares.value = shares.value.filter(s => s.share_token !== token)
    if (shares.value.length === 0) canvasStore.setCanvasShared(canvasId.value!, false)
  } catch {
    error.value = 'Could not revoke share link.'
  }
}

const copyToClipboard = async (token: string) => {
  try {
    await navigator.clipboard.writeText(shareUrl(token))
    copiedToken.value = token
    setTimeout(() => { copiedToken.value = null }, 2000)
  } catch {
    // ignore
  }
}

watch(() => props.show, (val) => { if (val) loadShares() })
onMounted(loadShares)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        @click.self="emit('close')"
      >
        <div class="share-modal">
          <!-- Header — same black bar as box windows -->
          <div class="share-header">
            <span class="share-title">Share Canvas</span>
            <button class="share-close" aria-label="Close" @click="emit('close')">✕</button>
          </div>

          <!-- Body -->
          <div class="share-body">
            <div v-if="error" class="share-error">{{ error }}</div>

            <div v-if="isLoading" class="share-status">Loading…</div>
            <template v-else>
              <!-- View-only row -->
              <div class="share-row">
                <div class="share-row-label">
                  <span class="share-type-tag">VIEW ONLY</span>
                  <span class="share-row-desc">Anyone with the link can view</span>
                </div>
                <div class="share-row-action">
                  <template v-if="readShare">
                    <span class="share-token">…{{ readShare.share_token.slice(-8) }}</span>
                    <button class="share-btn" @click="copyToClipboard(readShare.share_token)">
                      {{ copiedToken === readShare.share_token ? 'Copied!' : 'Copy' }}
                    </button>
                    <button class="share-btn share-btn--danger" @click="revokeShare(readShare.share_token)">
                      Revoke
                    </button>
                  </template>
                  <button
                    v-else
                    class="share-btn share-btn--primary"
                    :disabled="creating === 'read'"
                    @click="createShare('read')"
                  >
                    {{ creating === 'read' ? 'Creating…' : 'Generate link' }}
                  </button>
                </div>
              </div>

              <div class="share-divider" />

              <!-- Edit row -->
              <div class="share-row">
                <div class="share-row-label">
                  <span class="share-type-tag share-type-tag--write">CAN EDIT</span>
                  <span class="share-row-desc">Login required to edit</span>
                </div>
                <div class="share-row-action">
                  <template v-if="writeShare">
                    <span class="share-token">…{{ writeShare.share_token.slice(-8) }}</span>
                    <button class="share-btn" @click="copyToClipboard(writeShare.share_token)">
                      {{ copiedToken === writeShare.share_token ? 'Copied!' : 'Copy' }}
                    </button>
                    <button class="share-btn share-btn--danger" @click="revokeShare(writeShare.share_token)">
                      Revoke
                    </button>
                  </template>
                  <button
                    v-else
                    class="share-btn share-btn--primary"
                    :disabled="creating === 'write'"
                    @click="createShare('write')"
                  >
                    {{ creating === 'write' ? 'Creating…' : 'Generate link' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.share-modal {
  background: var(--surface-primary);
  border: 2px solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  width: 460px;
  max-width: calc(100vw - 32px);
}

/* Same black bar as box window headers */
.share-header {
  background: var(--surface-inverse);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 2px solid var(--border-primary);
}

.share-title {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.share-close {
  background: none;
  border: none;
  color: var(--text-inverse);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  opacity: 0.7;
  line-height: 1;
}

.share-close:hover {
  opacity: 1;
}

.share-body {
  padding: var(--space-4);
}

.share-error {
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  color: var(--color-error);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  margin-bottom: var(--space-3);
}

.share-status {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  padding: var(--space-2) 0;
}

.share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
}

.share-divider {
  border: none;
  border-top: 1px solid var(--border-secondary);
}

.share-row-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.share-type-tag {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-primary);
}

.share-type-tag--write {
  color: var(--color-accent);
}

.share-row-desc {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.share-row-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.share-token {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.share-btn {
  border: 1px solid var(--border-primary);
  background: var(--surface-primary);
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.share-btn:hover:not(:disabled) {
  background: var(--surface-secondary);
}

.share-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.share-btn--primary {
  background: var(--surface-inverse);
  color: var(--text-inverse);
  border-color: var(--border-primary);
}

.share-btn--primary:hover:not(:disabled) {
  opacity: 0.85;
}

.share-btn--danger {
  color: var(--color-error);
  border-color: var(--color-error);
}

.share-btn--danger:hover {
  background: var(--color-error-bg);
}
</style>

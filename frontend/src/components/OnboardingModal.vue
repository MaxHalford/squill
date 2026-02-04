<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue'
import { DATABASE_INFO } from '../types/database'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  selectBigquery: []
  selectDuckdb: []
  selectCsv: []
  selectPostgres: []
  selectSnowflake: []
}>()

// Prevent body scroll when modal is open
watch(() => props.show, (isShowing) => {
  if (isShowing) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

// Close on Escape key
const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        @click.self="emit('close')"
      >
        <div class="onboarding-modal">
          <!-- Header -->
          <div class="modal-header">
            <h1 id="onboarding-title">Welcome to Squill</h1>
            <p class="modal-subtitle">Choose how you'd like to get started</p>
          </div>

          <!-- Options Grid -->
          <div class="options-grid">
            <!-- BigQuery Card -->
            <button
              class="option-card"
              aria-label="Connect to BigQuery cloud data warehouse"
              @click="emit('selectBigquery')"
            >
              <img
                :src="DATABASE_INFO.bigquery.logo"
                :alt="DATABASE_INFO.bigquery.name"
                class="option-icon"
              />
              <h2>{{ DATABASE_INFO.bigquery.name }}</h2>
              <p>{{ DATABASE_INFO.bigquery.shortDescription }}</p>
              <span class="option-badge">{{ DATABASE_INFO.bigquery.badge }}</span>
            </button>

            <!-- DuckDB Card -->
            <button
              class="option-card"
              aria-label="Use DuckDB local database"
              @click="emit('selectDuckdb')"
            >
              <img
                :src="DATABASE_INFO.duckdb.logo"
                :alt="DATABASE_INFO.duckdb.name"
                class="option-icon"
              />
              <h2>{{ DATABASE_INFO.duckdb.name }}</h2>
              <p>{{ DATABASE_INFO.duckdb.shortDescription }}</p>
              <span class="option-badge">{{ DATABASE_INFO.duckdb.badge }}</span>
            </button>

            <!-- CSV Card -->
            <button
              class="option-card"
              aria-label="Import CSV files"
              @click="emit('selectCsv')"
            >
              <img
                src="https://www.iconpacks.net/icons/2/free-csv-icon-1471-thumb.png"
                alt="CSV"
                class="option-icon"
              />
              <h2>Import CSV</h2>
              <p>Drag & drop CSV files or click to upload directly</p>
              <span class="option-badge">Quick start</span>
            </button>

            <!-- Snowflake Card -->
            <button
              class="option-card"
              aria-label="Connect to Snowflake"
              @click="emit('selectSnowflake')"
            >
              <img
                :src="DATABASE_INFO.snowflake.logo"
                :alt="DATABASE_INFO.snowflake.name"
                class="option-icon"
              />
              <h2>{{ DATABASE_INFO.snowflake.name }}</h2>
              <p>{{ DATABASE_INFO.snowflake.shortDescription }}</p>
              <span class="option-badge">{{ DATABASE_INFO.snowflake.badge }}</span>
            </button>

            <!-- PostgreSQL Card -->
            <button
              class="option-card"
              aria-label="Connect to PostgreSQL database"
              @click="emit('selectPostgres')"
            >
              <img
                :src="DATABASE_INFO.postgres.logo"
                :alt="DATABASE_INFO.postgres.name"
                class="option-icon"
              />
              <h2>{{ DATABASE_INFO.postgres.name }}</h2>
              <p>{{ DATABASE_INFO.postgres.shortDescription }}</p>
              <span class="option-badge">{{ DATABASE_INFO.postgres.badge }}</span>
            </button>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <button class="skip-button" @click="emit('close')">
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Uses global .modal-overlay from style.css */

.onboarding-modal {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 800px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: var(--space-6);
  border-radius: var(--border-radius-md);
}

.modal-header {
  text-align: center;
  margin-bottom: var(--space-6);
}

.modal-header h1 {
  font-size: var(--font-size-heading);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--space-2) 0;
}

.modal-subtitle {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  margin: 0;
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.option-card {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-md);
  padding: var(--space-5);
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.option-card:hover {
  background: var(--surface-secondary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--color-accent) 40%, var(--border-primary));
}

.option-card:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

.option-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.option-icon {
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-2);
  object-fit: contain;
}

.option-icon-disabled {
  filter: grayscale(100%);
  opacity: 0.5;
}

.option-card-disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.option-card-disabled:hover {
  background: var(--surface-primary);
  box-shadow: none;
  transform: none;
  border-color: var(--border-primary);
}

.option-badge-soon {
  color: var(--text-secondary);
  background: var(--surface-secondary);
}

.option-card h2 {
  font-size: var(--font-size-body-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.option-card p {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
  margin: 0;
  flex: 1;
}

.option-badge {
  font-size: var(--font-size-caption);
  color: var(--color-accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--border-radius-sm);
  margin-top: var(--space-2);
}

.modal-footer {
  text-align: center;
  padding-top: var(--space-4);
  border-top: var(--border-width-thin) solid var(--border-secondary);
}

.skip-button {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
  padding: var(--space-2) var(--space-3);
  transition: color 0.2s;
}

.skip-button:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

.skip-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--border-radius-sm);
}

/* Transition animations */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-active .onboarding-modal,
.modal-fade-leave-active .onboarding-modal {
  transition: transform 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .onboarding-modal {
  transform: scale(0.95);
}

.modal-fade-leave-to .onboarding-modal {
  transform: scale(0.95);
}
</style>

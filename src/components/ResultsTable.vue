<script setup>
import { ref, computed } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()

const props = defineProps({
  results: { type: Array, default: null },
  error: { type: String, default: null }
})

const currentPage = ref(1)
const pageSize = ref(10)

const columns = computed(() => {
  if (!props.results || props.results.length === 0) return []
  return Object.keys(props.results[0])
})

const totalPages = computed(() => {
  if (!props.results) return 0
  return Math.ceil(props.results.length / pageSize.value)
})

const paginatedData = computed(() => {
  if (!props.results) return []
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return props.results.slice(start, end)
})

const nextPage = (e) => {
  e.stopPropagation()
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}

const prevPage = (e) => {
  e.stopPropagation()
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

// Reset to page 1 when results change
const resetPagination = () => {
  currentPage.value = 1
}

defineExpose({
  resetPagination
})
</script>

<template>
  <div class="results-section">
    <div v-if="error" class="error-banner" @click.stop>
      {{ error }}
    </div>
    <div class="results-header">
      <span class="results-title">Results{{ results ? ` (${results.length} rows)` : '' }}</span>
      <div class="pagination" v-if="results && results.length > 0">
        <button
          @click="prevPage"
          :disabled="currentPage === 1"
          class="pagination-btn"
        >
          ←
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button
          @click="nextPage"
          :disabled="currentPage === totalPages"
          class="pagination-btn"
        >
          →
        </button>
      </div>
    </div>
    <div class="table-container" @click.stop>
      <table v-if="results && results.length > 0" class="results-table" :style="{ fontFamily: settingsStore.tableFont }">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in paginatedData" :key="`row-${currentPage}-${index}`">
            <td v-for="column in columns" :key="column">{{ row[column] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="results && results.length === 0" class="empty-state">
        No results found
      </div>
    </div>
  </div>
</template>

<style scoped>
.results-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e2227;
}

.error-banner {
  padding: 10px 12px;
  background: #3f1f1f;
  border-bottom: 1px solid #7f1d1d;
  color: #fca5a5;
  font-size: 12px;
  flex-shrink: 0;
}

.results-header {
  padding: 8px 12px;
  background: #21252b;
  border-bottom: 1px solid #181a1f;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.results-title {
  color: #abb2bf;
  font-size: 12px;
  font-weight: 500;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-btn {
  background: #2c313a;
  color: #abb2bf;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: #3e4451;
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  color: #abb2bf;
  font-size: 12px;
  min-width: 50px;
  text-align: center;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: default;
  position: relative;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 12px;
  color: #abb2bf;
}

.results-table thead {
  position: sticky;
  top: 0;
  background: #282c34;
  z-index: 2;
}

.results-table thead tr {
  display: table-row;
}

.results-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 2px solid #181a1f;
  white-space: nowrap;
  background: #282c34;
  position: sticky;
  top: 0;
}

.results-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #181a1f;
  white-space: nowrap;
}

.results-table tbody tr:hover {
  background: #2c313a;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #5c6370;
  font-size: 14px;
}
</style>

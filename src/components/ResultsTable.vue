<script setup>
import { ref, computed } from 'vue'

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
    <div v-if="error" class="error-banner">
      {{ error }}
    </div>
    <div class="table-container">
      <table
        v-if="results && results.length > 0"
        class="results-table"
      >
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
    <div v-if="results && results.length > 0" class="results-footer">
      <span class="results-title">Results ({{ results.length }} rows)</span>
      <div class="pagination">
        <button
          @click.stop="prevPage"
          :disabled="currentPage === 1"
          class="pagination-btn"
        >
          ←
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button
          @click.stop="nextPage"
          :disabled="currentPage === totalPages"
          class="pagination-btn"
        >
          →
        </button>
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
  background: white;
}

.error-banner {
  padding: 10px 12px;
  background: #ffebee;
  border-bottom: 1px solid #c62828;
  color: #c62828;
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
}

.results-footer {
  padding: 8px 12px;
  background: white;
  border-top: 1px solid black;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.results-title {
  color: black;
  font-size: 12px;
  font-weight: bold;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-btn {
  background: white;
  color: black;
  border: 1px solid black;
  padding: 4px 8px;
  border-radius: 0;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  transition: none;
}

.pagination-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  background: #e0e0e0;
}

.page-info {
  color: black;
  font-size: 12px;
  font-weight: bold;
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
  font-family: var(--font-results);
  color: black;
}

.results-table thead {
  position: sticky;
  top: 0;
  background: white;
  z-index: 2;
}

.results-table thead tr {
  display: table-row;
}

.results-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: bold;
  border-bottom: 1px solid black;
  white-space: nowrap;
  background: white;
  position: sticky;
  top: 0;
}

.results-table td {
  padding: 8px 12px;
  white-space: nowrap;
}

.results-table tbody tr:nth-child(even) {
  background: #f5f5f5;
}

.results-table tbody tr:nth-child(odd) {
  background: white;
}

.results-table tbody tr:hover {
  background: #e8e8e8;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import BaseBox from './BaseBox.vue'

const props = defineProps({
  boxId: { type: Number, required: true },
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  initialWidth: { type: Number, default: 400 },
  initialHeight: { type: Number, default: 500 },
  initialZIndex: { type: Number, default: 1 },
  isSelected: { type: Boolean, default: false },
  initialRowData: { type: String, default: '{}' }, // JSON string
  initialName: { type: String, default: 'Row Detail' }
})

const emit = defineEmits([
  'select', 'update:position', 'update:size',
  'delete', 'maximize', 'update:name'
])

// Parse row data from JSON string (supports both old format and new format with columnTypes)
const parsedData = computed(() => {
  try {
    const parsed = JSON.parse(props.initialRowData)
    // Check if it's the new format with rowData and columnTypes
    if (parsed.rowData && typeof parsed.rowData === 'object') {
      return {
        rowData: parsed.rowData,
        columnTypes: parsed.columnTypes || {}
      }
    }
    // Old format - just row data directly
    return {
      rowData: parsed,
      columnTypes: {}
    }
  } catch (e) {
    return { rowData: {}, columnTypes: {} }
  }
})

const rowData = computed(() => parsedData.value.rowData)
const columnTypes = computed(() => parsedData.value.columnTypes)

// Get field entries for iteration
const fields = computed(() => {
  return Object.entries(rowData.value)
})

// Format value for display (handle null, undefined, etc.)
const formatValue = (value: any): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
</script>

<template>
  <BaseBox
    :box-id="boxId"
    :initial-x="initialX"
    :initial-y="initialY"
    :initial-width="initialWidth"
    :initial-height="initialHeight"
    :initial-z-index="initialZIndex"
    :is-selected="isSelected"
    :initial-name="initialName"
    @select="emit('select', $event)"
    @update:position="emit('update:position', $event)"
    @update:size="emit('update:size', $event)"
    @delete="emit('delete')"
    @maximize="emit('maximize')"
    @update:name="emit('update:name', $event)"
  >
    <div class="detail-content">
      <div
        v-for="[field, value] in fields"
        :key="field"
        class="detail-field"
      >
        <div class="field-header">
          <span class="field-label">{{ field }}</span>
          <span v-if="columnTypes[field]" class="field-type">{{ columnTypes[field] }}</span>
        </div>
        <div class="field-value" :class="{ 'null-value': value === null }">{{ formatValue(value) }}</div>
      </div>
      <div v-if="fields.length === 0" class="empty-state">
        No data available
      </div>
    </div>
  </BaseBox>
</template>

<style scoped>
.detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  padding: var(--space-3);
  background: var(--surface-primary);
}

.detail-field {
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-secondary);
  border-radius: var(--border-radius-sm);
  transition: background 0.15s ease;
}

.detail-field:hover {
  background: var(--surface-primary);
}

.field-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.field-label {
  font-size: var(--font-size-caption);
  font-weight: bold;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: text;
  cursor: text;
}

.field-label::selection {
  background: var(--color-selection);
}

.field-type {
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--text-tertiary);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
}

.field-value {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  word-wrap: break-word;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}

.field-value::selection {
  background: var(--color-selection);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.null-value {
  color: var(--text-tertiary);
}
</style>

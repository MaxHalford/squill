<script setup lang="ts">
import { ref, computed } from 'vue'
import type {
  PivotConfig,
  PivotField,
  AvailableColumn,
  DateGranularity,
  MetricAggregation,
} from '../types/pivot'
import {
  METRICS_BY_TYPE,
  DATE_GRANULARITIES,
} from '../types/pivot'

const props = defineProps<{
  config: PivotConfig
  availableColumns: AvailableColumn[]
  decimals: number | null
  heatmap: boolean
}>()

const emit = defineEmits<{
  'update:config': [config: PivotConfig]
  'update:decimals': [decimals: number | null]
  'update:heatmap': [heatmap: boolean]
  'run': []
}>()

// Dropdown visibility
const showRowFieldDropdown = ref(false)
const showColumnFieldDropdown = ref(false)
const showMetricFieldDropdown = ref(false)

// Columns not yet used in row fields
const availableRowColumns = computed(() => {
  const usedNames = new Set(props.config.rowFields.map(f => f.name))
  if (props.config.columnField) usedNames.add(props.config.columnField.name)
  return props.availableColumns.filter(c => !usedNames.has(c.name))
})

// Columns available for column field
const availableColumnColumns = computed(() => {
  const usedNames = new Set(props.config.rowFields.map(f => f.name))
  return props.availableColumns.filter(c => !usedNames.has(c.name))
})

// Available metrics depend on the metric field's type
const metricField = computed(() => {
  const m = props.config.metrics[0]
  if (!m || m.field === '*') return null
  return props.availableColumns.find(c => c.name === m.field) || null
})

const availableMetrics = computed(() => {
  const tc = metricField.value?.typeCategory || 'text'
  return METRICS_BY_TYPE[tc] || METRICS_BY_TYPE.text!
})

const availableMetricColumns = computed(() => props.availableColumns)

const isCountMetric = computed(() => props.config.metrics[0]?.aggregation === 'count')

const updateConfig = (partial: Partial<PivotConfig>) => {
  emit('update:config', { ...props.config, ...partial })
}

// Row field actions
const addRowField = (col: AvailableColumn) => {
  const field: PivotField = {
    name: col.name,
    type: col.type,
    typeCategory: col.typeCategory,
    dateGranularity: col.typeCategory === 'date' ? 'month' : undefined,
  }
  updateConfig({ rowFields: [...props.config.rowFields, field] })
  showRowFieldDropdown.value = false
}

const removeRowField = (index: number) => {
  const fields = [...props.config.rowFields]
  fields.splice(index, 1)
  updateConfig({ rowFields: fields })
}

const updateRowFieldGranularity = (index: number, granularity: DateGranularity) => {
  const fields = [...props.config.rowFields]
  fields[index] = { ...fields[index], dateGranularity: granularity }
  updateConfig({ rowFields: fields })
}

// Column field actions
const setColumnField = (col: AvailableColumn | null) => {
  if (!col) {
    updateConfig({ columnField: null })
  } else {
    const field: PivotField = {
      name: col.name,
      type: col.type,
      typeCategory: col.typeCategory,
      dateGranularity: col.typeCategory === 'date' ? 'month' : undefined,
    }
    updateConfig({ columnField: field })
  }
  showColumnFieldDropdown.value = false
}

const updateColumnFieldGranularity = (granularity: DateGranularity) => {
  if (!props.config.columnField) return
  updateConfig({ columnField: { ...props.config.columnField, dateGranularity: granularity } })
}

// Metric actions
const setMetricField = (col: AvailableColumn) => {
  const defaultAgg = col.typeCategory === 'number' ? 'sum' : 'count'
  updateConfig({ metrics: [{ field: col.name, aggregation: defaultAgg as MetricAggregation }] })
  showMetricFieldDropdown.value = false
}

const setMetricAggregation = (agg: MetricAggregation) => {
  const m = props.config.metrics[0]
  if (!m) return
  updateConfig({ metrics: [{ ...m, aggregation: agg }] })
}

const updateDecimals = (e: Event) => {
  const val = (e.target as HTMLInputElement).value
  if (val === '') {
    emit('update:decimals', null)
  } else {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 0 && n <= 10) emit('update:decimals', n)
  }
}

// Close dropdowns on outside click
const closeAllDropdowns = () => {
  showRowFieldDropdown.value = false
  showColumnFieldDropdown.value = false
  showMetricFieldDropdown.value = false
}
</script>

<template>
  <div
    class="pivot-config"
    @click.self="closeAllDropdowns"
  >
    <!-- ROWS section -->
    <span class="config-label">ROWS</span>
    <span
      v-for="(field, i) in config.rowFields"
      :key="field.name"
      class="field-chip"
    >
      <button
        class="chip-remove"
        @click.stop="removeRowField(i)"
      >
        &times;
      </button>
      <span class="chip-name">{{ field.name }}</span>
      <select
        v-if="field.typeCategory === 'date'"
        class="granularity-select"
        :value="field.dateGranularity || 'month'"
        @change="updateRowFieldGranularity(i, ($event.target as HTMLSelectElement).value as DateGranularity)"
        @click.stop
      >
        <option
          v-for="g in DATE_GRANULARITIES"
          :key="g.value"
          :value="g.value"
        >
          {{ g.label }}
        </option>
      </select>
    </span>
    <div
      v-if="availableRowColumns.length > 0"
      class="add-field-wrapper"
    >
      <button
        class="add-field-btn"
        @click.stop="showRowFieldDropdown = !showRowFieldDropdown; showColumnFieldDropdown = false; showMetricFieldDropdown = false"
      >
        +
      </button>
      <div
        v-if="showRowFieldDropdown"
        class="field-dropdown"
      >
        <button
          v-for="col in availableRowColumns"
          :key="col.name"
          class="dropdown-item"
          @click.stop="addRowField(col)"
        >
          <span class="dropdown-col-name">{{ col.name }}</span>
          <span class="dropdown-col-type">{{ col.typeCategory }}</span>
        </button>
      </div>
    </div>

    <span class="config-sep" />

    <!-- COLUMNS section -->
    <span class="config-label">COLUMNS</span>
    <span
      v-if="config.columnField"
      class="field-chip"
    >
      <button
        class="chip-remove"
        @click.stop="setColumnField(null)"
      >
        &times;
      </button>
      <span class="chip-name">{{ config.columnField.name }}</span>
      <select
        v-if="config.columnField.typeCategory === 'date'"
        class="granularity-select"
        :value="config.columnField.dateGranularity || 'month'"
        @change="updateColumnFieldGranularity(($event.target as HTMLSelectElement).value as DateGranularity)"
        @click.stop
      >
        <option
          v-for="g in DATE_GRANULARITIES"
          :key="g.value"
          :value="g.value"
        >
          {{ g.label }}
        </option>
      </select>
    </span>
    <div
      v-if="!config.columnField"
      class="add-field-wrapper"
    >
      <button
        class="add-field-btn"
        @click.stop="showColumnFieldDropdown = !showColumnFieldDropdown; showRowFieldDropdown = false; showMetricFieldDropdown = false"
      >
        +
      </button>
      <div
        v-if="showColumnFieldDropdown"
        class="field-dropdown"
      >
        <button
          v-for="col in availableColumnColumns"
          :key="col.name"
          class="dropdown-item"
          @click.stop="setColumnField(col)"
        >
          <span class="dropdown-col-name">{{ col.name }}</span>
          <span class="dropdown-col-type">{{ col.typeCategory }}</span>
        </button>
      </div>
    </div>

    <span class="config-sep" />

    <!-- METRIC section -->
    <span class="config-label">METRIC</span>
    <span
      v-if="config.metrics.length > 0"
      class="field-chip metric-chip"
    >
      <div class="add-field-wrapper">
        <button
          class="chip-name metric-name-btn"
          @click.stop="showMetricFieldDropdown = !showMetricFieldDropdown; showRowFieldDropdown = false; showColumnFieldDropdown = false"
        >
          {{ config.metrics[0].field === '*' ? 'count(*)' : config.metrics[0].field }}
        </button>
        <div
          v-if="showMetricFieldDropdown"
          class="field-dropdown"
        >
          <button
            v-for="col in availableMetricColumns"
            :key="col.name"
            class="dropdown-item"
            @click.stop="setMetricField(col)"
          >
            <span class="dropdown-col-name">{{ col.name }}</span>
            <span class="dropdown-col-type">{{ col.typeCategory }}</span>
          </button>
        </div>
      </div>
      <select
        class="agg-select"
        :value="config.metrics[0].aggregation"
        @change="setMetricAggregation(($event.target as HTMLSelectElement).value as MetricAggregation)"
        @click.stop
      >
        <option
          v-for="m in availableMetrics"
          :key="m.value"
          :value="m.value"
        >
          {{ m.label }}
        </option>
      </select>
    </span>

    <!-- Actions (pushed right) -->
    <div class="config-actions">
      <button
        class="run-btn"
        @click="emit('run')"
      >
        Run
      </button>
      <label class="toggle-label">
        <span class="toggle-text">Heatmap</span>
        <button
          class="toggle-track"
          :class="{ active: heatmap }"
          @click.prevent="emit('update:heatmap', !heatmap)"
        >
          <span class="toggle-thumb" />
        </button>
      </label>
      <label
        class="decimals-label"
        :class="{ disabled: isCountMetric }"
      >
        <span class="toggle-text">Decimals</span>
        <input
          class="decimals-input"
          type="number"
          min="0"
          max="10"
          :value="decimals ?? ''"
          placeholder="auto"
          :disabled="isCountMetric"
          @input="updateDecimals"
        >
      </label>
    </div>
  </div>
</template>

<style scoped>
.pivot-config {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  background: var(--surface-secondary);
  flex-shrink: 0;
  position: relative;
  z-index: 2; /* Stay above scrolling table content */
}

.config-label {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 19px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-secondary);
  flex-shrink: 0;
  user-select: none;
}

.config-sep {
  width: 1px;
  height: 13px;
  background: var(--border-secondary);
  flex-shrink: 0;
}

.field-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 19px;
  padding: 0 6px 0 3px;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-secondary);
  font-size: 10px;
  line-height: normal;
  font-family: var(--font-family-mono);
  color: var(--text-primary);
}

/* Remove right padding when a select is the last element */
.field-chip:has(.granularity-select:last-child) {
  padding-right: 0;
}

.chip-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-chip {
  padding: 0;
  gap: 0;
}

.metric-name-btn {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  font-family: var(--font-family-mono);
  font-size: 10px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0 4px;
  height: 100%;
}

.metric-name-btn:hover {
  background: var(--surface-secondary);
}

.granularity-select,
.agg-select {
  height: 17px;
  font-size: 9px;
  font-family: var(--font-family-mono);
  background: var(--surface-secondary);
  border: none;
  border-left: var(--border-width-thin) solid var(--border-secondary);
  color: var(--text-primary);
  padding: 0 12px 0 3px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 2px center;
}

.granularity-select {
  padding-right: 6px;
}

.chip-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.chip-remove:hover {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.add-field-wrapper {
  position: relative;
}

.add-field-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  padding: 0;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  transition: background 0.1s, color 0.1s;
}

.add-field-btn:hover {
  background: var(--text-secondary);
  color: var(--surface-primary);
}

.field-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  z-index: 100;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--surface-primary);
  border: var(--border-width) solid var(--border-primary);
  box-shadow: var(--shadow-md);
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  background: none;
  border: none;
  border-bottom: var(--border-width-thin) solid var(--border-secondary);
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  text-align: left;
  cursor: pointer;
  transition: background 0.08s;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: var(--surface-secondary);
}

.dropdown-col-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-col-type {
  font-size: 9px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  flex-shrink: 0;
}

/* Actions */
.config-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.run-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 19px;
  padding: 0 var(--space-2);
  background: var(--color-header-bg);
  border: none;
  color: var(--color-header-text);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.run-btn:hover {
  filter: brightness(1.2);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.toggle-track {
  position: relative;
  width: 24px;
  height: 12px;
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-secondary);
  padding: 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.toggle-track.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.toggle-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 8px;
  height: 8px;
  background: var(--text-tertiary);
  transition: left 0.15s, background 0.15s;
}

.toggle-track.active .toggle-thumb {
  left: 13px;
  background: white;
}

.toggle-text {
  font-size: 9px;
  font-family: var(--font-family-mono);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.decimals-label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.decimals-input {
  width: 36px;
  height: 17px;
  font-size: 9px;
  font-family: var(--font-family-mono);
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-secondary);
  color: var(--text-primary);
  padding: 0 3px;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
}

.decimals-input::-webkit-inner-spin-button,
.decimals-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.decimals-input:focus {
  border-color: var(--color-accent);
}

.decimals-label.disabled,
.toggle-label.disabled {
  opacity: 0.35;
  pointer-events: none;
}
</style>

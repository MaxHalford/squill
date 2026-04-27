<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { calculateBoundingBox } from '../utils/geometry'

const canvasStore = useCanvasStore()

// FPS counter — samples frames and updates display every 500ms
const fps = ref(0)
const frameTime = ref(0)
let frameCount = 0
let lastFpsTime = performance.now()
let fpsRafId: number | null = null

const measureFrame = (now: number) => {
  frameCount++
  const elapsed = now - lastFpsTime
  if (elapsed >= 500) {
    fps.value = Math.round((frameCount * 1000) / elapsed)
    frameTime.value = Math.round(elapsed / frameCount * 10) / 10
    frameCount = 0
    lastFpsTime = now
  }
  fpsRafId = requestAnimationFrame(measureFrame)
}

onMounted(() => { fpsRafId = requestAnimationFrame(measureFrame) })
onUnmounted(() => { if (fpsRafId !== null) cancelAnimationFrame(fpsRafId) })

defineProps<{
  zoom: number
  visibleBoxCount?: number
}>()

const emit = defineEmits<{
  'show-whats-new': [sinceDate: string]
}>()

const whatsNewDate = ref('')

const boxCount = computed(() => canvasStore.boxes.length)
const sqlBoxCount = computed(() => canvasStore.boxes.filter(b => b.type === 'sql').length)

const SAMPLE_QUERIES = [
  `SELECT i as id, 'user_' || i as name, 'user' || i || '@example.com' as email, (random() * 100)::int as age, random() > 0.5 as active FROM generate_series(1, 500) t(i)`,
  `SELECT i as id, (random() * 1000)::decimal(10,2) as amount, ['pending','shipped','delivered','returned'][1 + (random() * 3)::int] as status, DATE '2024-01-01' + (random() * 365)::int as order_date FROM generate_series(1, 200) t(i)`,
  `SELECT DATE '2024-01-01' + (i % 365)::int as date, (random() * 10000)::decimal(10,2) as revenue, (random() * 5000)::decimal(10,2) as cost, ['North','South','East','West'][1 + (random() * 3)::int] as region FROM generate_series(1, 365) t(i)`,
  `SELECT i as sensor_id, NOW()::TIMESTAMP - INTERVAL (random() * 86400) SECOND as timestamp, (random() * 50 + 10)::decimal(5,2) as temperature, (random() * 100)::decimal(5,2) as humidity FROM generate_series(1, 1000) t(i)`,
  `WITH categories AS (SELECT unnest(['Electronics','Books','Clothing','Food','Toys']) as name) SELECT row_number() OVER () as id, name as category, (random() * 500 + 10)::decimal(10,2) as price, (random() * 100)::int as stock FROM categories, generate_series(1, 50) t(i)`,
  `SELECT i as id, 'Product ' || i as name, (random() * 200 + 5)::decimal(10,2) as price, (random() * 200)::int as quantity, ['A','B','C','D'][1 + (random() * 3)::int] as warehouse FROM generate_series(1, 300) t(i)`,
  `SELECT DATE_TRUNC('month', DATE '2023-01-01' + (i * 3)::int) as month, ['Marketing','Engineering','Sales','Support'][1 + (random() * 3)::int] as dept, (random() * 50000 + 10000)::decimal(10,2) as spend FROM generate_series(0, 100) t(i)`,
  `SELECT i as id, chr(65 + (random() * 25)::int) || chr(65 + (random() * 25)::int) || '-' || (1000 + (random() * 8999)::int)::text as code, random() > 0.3 as passed, (random() * 120)::decimal(5,1) as duration_sec FROM generate_series(1, 400) t(i)`,
  `SELECT (random() * 180 - 90)::decimal(8,5) as lat, (random() * 360 - 180)::decimal(8,5) as lon, (random() * 1000)::int as elevation_m, ['city','town','village'][1 + (random() * 2)::int] as type FROM generate_series(1, 150) t(i)`,
  `SELECT i as user_id, '/page/' || ['home','about','pricing','docs','blog'][1 + (random() * 4)::int] as path, (random() * 30)::decimal(5,2) as load_time_s, ['Chrome','Firefox','Safari','Edge'][1 + (random() * 3)::int] as browser, NOW()::TIMESTAMP - INTERVAL (random() * 604800) SECOND as visited_at FROM generate_series(1, 600) t(i)`,
  `SELECT i as txn_id, 'ACC-' || (1000 + (random() * 999)::int) as account, (random() * 5000 - 1000)::decimal(10,2) as amount, ['debit','credit'][1 + (random() * 1)::int] as type, DATE '2024-06-01' + (random() * 180)::int as date FROM generate_series(1, 800) t(i)`,
  `SELECT ['ERROR','WARN','INFO','DEBUG'][1 + (random() * 3)::int] as level, 'svc-' || ['api','web','worker','cron'][1 + (random() * 3)::int] as service, 'msg_' || (random() * 9999)::int as message, NOW()::TIMESTAMP - INTERVAL (random() * 3600) SECOND as ts FROM generate_series(1, 250) t(i)`,
]

const GRID_COLS = 10
const GRID_SPACING_X = 660
const GRID_SPACING_Y = 560
const JITTER = 40

const spawn100 = () => {
  for (let i = 0; i < 100; i++) {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    const x = col * GRID_SPACING_X + (Math.random() - 0.5) * JITTER
    const y = row * GRID_SPACING_Y + (Math.random() - 0.5) * JITTER
    const boxId = canvasStore.addBox('sql', { x, y })
    const query = SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)]
    canvasStore.updateBoxQuery(boxId, query)
  }
}

const clearAll = () => {
  canvasStore.clearAll()
}

const boundingBox = computed(() => {
  const bb = calculateBoundingBox(canvasStore.boxes)
  if (!bb) return null
  return { width: Math.round(bb.maxX - bb.minX), height: Math.round(bb.maxY - bb.minY) }
})
</script>

<template>
  <div class="debug-panel">
    <div class="debug-header">
      debug
    </div>
    <div class="debug-stats">
      <div class="debug-row">
        <span class="debug-label">boxes</span>
        <span class="debug-value">{{ boxCount }}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">sql</span>
        <span class="debug-value">{{ sqlBoxCount }}</span>
      </div>
      <div
        v-if="visibleBoxCount !== undefined"
        class="debug-row"
      >
        <span class="debug-label">visible</span>
        <span class="debug-value">{{ visibleBoxCount }}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">zoom</span>
        <span class="debug-value">{{ zoom.toFixed(2) }}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">fps</span>
        <span class="debug-value" :class="{ 'fps-warn': fps < 30, 'fps-bad': fps < 15 }">{{ fps }} <span class="debug-label">({{ frameTime }}ms)</span></span>
      </div>
      <div
        v-if="boundingBox"
        class="debug-row"
      >
        <span class="debug-label">spread</span>
        <span class="debug-value">{{ boundingBox.width }}x{{ boundingBox.height }}</span>
      </div>
    </div>
    <div class="debug-actions">
      <button @click="spawn100">
        +100 sql
      </button>
      <button
        :disabled="boxCount === 0"
        @click="clearAll"
      >
        clear all
      </button>
      <div class="debug-whats-new">
        <input
          v-model="whatsNewDate"
          type="date"
        >
        <button @click="emit('show-whats-new', whatsNewDate)">
          what's new
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-panel {
  position: fixed;
  bottom: 12px;
  left: 12px;
  z-index: 9999;
  background: var(--surface-primary);
  border: 2px solid var(--border-primary);
  box-shadow: 4px 4px 0 var(--border-primary);
  font-family: var(--font-family-mono);
  font-size: 11px;
  min-width: 160px;
  user-select: none;
  opacity: 0.85;
  transition: opacity 0.15s;
}

.debug-panel:hover {
  opacity: 1;
}

.debug-header {
  padding: 3px 8px;
  background: var(--border-primary);
  color: var(--surface-primary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.debug-stats {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.debug-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.debug-label {
  color: var(--text-tertiary);
}

.debug-value {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.debug-value.fps-warn {
  color: #e6a700;
}

.debug-value.fps-bad {
  color: #dc3545;
}

.debug-actions {
  padding: 4px 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.debug-actions button {
  padding: 3px 8px;
  background: var(--surface-primary);
  border: 1px solid var(--border-secondary);
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.debug-actions button:hover:not(:disabled) {
  background: var(--table-row-hover-bg);
  color: var(--text-primary);
  border-color: var(--border-primary);
}

.debug-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.debug-whats-new {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.debug-whats-new input[type="date"] {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  background: var(--surface-primary);
  border: 1px solid var(--border-secondary);
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  font-size: 10px;
}
</style>

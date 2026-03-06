<script setup lang="ts">
import type { PlanNode } from '../utils/planParser'
import { formatExecutionTime, formatRowCountCompact } from '../utils/formatUtils'

const props = defineProps<{
  node: PlanNode
  medals: Map<PlanNode, number>
  selectedNodeId: number | null
}>()

const emit = defineEmits<{
  'select-node': [node: PlanNode]
}>()


const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${units[i]}`
}

const formatCost = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (n < 1 && n > 0) return n.toFixed(2)
  return String(Math.round(n))
}

const costClass = (node: PlanNode): string => {
  const rank = props.medals.get(node)
  if (rank === 1) return 'cost-hot'
  if (rank === 2) return 'cost-warm'
  if (rank === 3) return 'cost-mild'
  return ''
}

const timingLabel = (node: PlanNode): string => {
  if (node.durationMs !== undefined) return formatExecutionTime(node.durationMs)
  if (node.cost !== undefined) return `cost ${formatCost(node.cost)}`
  return ''
}

const onNodeClick = (e: MouseEvent) => {
  e.stopPropagation()
  emit('select-node', props.node)
}
</script>

<template>
  <span class="tf-nc">
    <div
      class="plan-node"
      :class="{ selected: selectedNodeId === node.id }"
      @pointerdown.stop
      @click="onNodeClick"
    >
      <div class="node-operator">{{ node.operator }}</div>
      <div
        v-if="node.table"
        class="node-table"
      >
        {{ node.table }}
      </div>
      <div
        v-if="node.rows !== undefined || timingLabel(node) || node.shuffleBytes"
        class="node-stats"
      >
        <span v-if="node.rows !== undefined">{{ formatRowCountCompact(node.rows) }}</span>
        <span
          v-if="node.rows !== undefined && timingLabel(node)"
          class="stat-sep"
        />
        <span
          v-if="timingLabel(node)"
          :class="costClass(node)"
        >{{ timingLabel(node) }}</span>
        <template v-if="node.shuffleBytes">
          <span
            v-if="timingLabel(node) || node.rows !== undefined"
            class="stat-sep"
          />
          <span>{{ formatBytes(node.shuffleBytes) }}</span>
        </template>
      </div>
    </div>
  </span>
  <ul v-if="node.children.length > 0">
    <li
      v-for="(child, i) in node.children"
      :key="i"
    >
      <PlanTreeNode
        :node="child"
        :medals="medals"
        :selected-node-id="selectedNodeId"
        @select-node="emit('select-node', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.plan-node {
  min-width: 100px;
  max-width: 200px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-secondary);
  box-shadow: var(--shadow-small);
  font-family: var(--font-family-mono);
  text-align: left;
  cursor: pointer;
}

.plan-node:hover {
  border-color: var(--text-secondary);
}

.plan-node.selected,
.plan-node.selected:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-medium);
}

.node-operator {
  font-size: var(--font-size-body-sm);
  font-weight: bold;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-family-mono);
}

.node-table {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
  font-family: var(--font-family-mono);
}

.node-stats {
  display: flex;
  align-items: center;
  margin-top: var(--space-1);
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-family: var(--font-family-mono);
}

.stat-sep {
  display: inline-block;
  width: 3px;
  height: 3px;
  background: var(--text-secondary);
  margin: 0 var(--space-1);
  flex-shrink: 0;
}

.cost-hot {
  color: var(--color-error);
  font-weight: bold;
}

.cost-warm {
  color: #e67700;
  font-weight: bold;
}

.cost-mild {
  color: #ca8a04;
}
</style>

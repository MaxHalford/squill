<script setup lang="ts">
import { computed } from 'vue'
import 'treeflex/dist/css/treeflex.css'
import { type PlanNode, rankNodesByCost } from '../utils/planParser'
import PlanTreeNode from './PlanTreeNode.vue'

const props = defineProps<{
  root: PlanNode
  selectedNodeId: number | null
}>()

const emit = defineEmits<{
  'select-node': [node: PlanNode]
}>()

const medals = computed(() => rankNodesByCost(props.root))
</script>

<template>
  <div class="tf-tree plan-tree">
    <ul>
      <li>
        <PlanTreeNode
          :node="root"
          :medals="medals"
          :selected-node-id="selectedNodeId"
          @select-node="emit('select-node', $event)"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* Override ALL treeflex connector lines to match node border style */
.plan-tree :deep(li::before),
.plan-tree :deep(li::after) {
  border-color: var(--border-secondary) !important;
  border-width: var(--border-width-thick) !important;
}

/* Horizontal connector between siblings */
.plan-tree :deep(li li::before) {
  border-top-color: var(--border-secondary) !important;
  border-top-width: var(--border-width-thick) !important;
}

/* Vertical connectors from parent to children line */
.plan-tree :deep(.tf-nc::before),
.plan-tree :deep(.tf-nc::after) {
  border-left-color: var(--border-secondary) !important;
  border-left-width: var(--border-width-thick) !important;
}

.plan-tree :deep(.tf-nc) {
  border: none;
  border-radius: 0;
  padding: 0;
  display: inline-block;
}
</style>

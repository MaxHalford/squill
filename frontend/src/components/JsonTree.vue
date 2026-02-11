<script setup lang="ts">
import { ref, watch, computed } from 'vue'

export interface Props {
  data: unknown
  defaultExpandDepth?: number
  // Internal props for recursion
  path?: string
  depth?: number
  expandedPaths?: Set<string>
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpandDepth: 1,
  path: '',
  depth: 0,
  expandedPaths: undefined
})

// Root component manages expanded state
const isRoot = props.depth === 0
const internalExpandedPaths = ref<Set<string>>(new Set())
const expandedPaths = isRoot ? internalExpandedPaths : ref(props.expandedPaths!)

// Get type of value
const getType = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

// Check if value is expandable (object or array)
const isExpandable = (value: unknown): boolean => {
  return value !== null && typeof value === 'object'
}

// Get preview text for collapsed items (includes brackets)
const getPreview = (value: unknown): string => {
  if (Array.isArray(value)) {
    const len = value.length
    return len === 0 ? '[]' : `[${len} item${len !== 1 ? 's' : ''}]`
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value)
    return keys.length === 0 ? '{}' : `{${keys.length} key${keys.length !== 1 ? 's' : ''}}`
  }
  return ''
}

// Get opening bracket
const getOpenBracket = (value: unknown): string => {
  return Array.isArray(value) ? '[' : '{'
}

// Get closing bracket
const getCloseBracket = (value: unknown): string => {
  return Array.isArray(value) ? ']' : '}'
}

// Get entries for object/array
const getEntries = (value: unknown): [string, unknown][] => {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item])
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
  }
  return []
}

// Check if path is expanded
const isExpanded = (path: string): boolean => {
  return expandedPaths.value.has(path)
}

// Toggle expansion
const toggle = (path: string) => {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path)
  } else {
    expandedPaths.value.add(path)
  }
}

// Handle keyboard events
const handleKeydown = (event: KeyboardEvent, path: string) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggle(path)
  }
}

// Build full path for a key
const buildPath = (key: string): string => {
  return props.path ? `${props.path}.${key}` : key
}

// Initialize expanded paths based on defaultExpandDepth
const initializeExpanded = (value: unknown, path: string, depth: number) => {
  if (depth >= props.defaultExpandDepth) return
  if (!isExpandable(value)) return

  expandedPaths.value.add(path)

  const entries = getEntries(value)
  for (const [key] of entries) {
    const childPath = path ? `${path}.${key}` : key
    const childValue = Array.isArray(value) ? value[Number(key)] : (value as Record<string, unknown>)[key]
    initializeExpanded(childValue, childPath, depth + 1)
  }
}

// Initialize on mount and when data changes (only for root)
if (isRoot) {
  watch(() => props.data, () => {
    expandedPaths.value.clear()
    initializeExpanded(props.data, '', 0)
  }, { immediate: true })
}

// Format primitive value for display
const formatPrimitive = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

// Check if array/object is empty
const isEmpty = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
  return false
}

// Current path for this node
const currentPath = props.path || ''
const isCurrentExpanded = computed(() => isExpanded(currentPath))
</script>

<template>
  <div :class="['json-tree', { 'json-tree-root': isRoot }]">
    <!-- Expandable value (object/array) -->
    <template v-if="isExpandable(data)">
      <!-- Empty object/array - no toggle needed -->
      <template v-if="isEmpty(data)">
        <span class="json-bracket">{{ Array.isArray(data) ? '[]' : '{}' }}</span>
      </template>

      <!-- Non-empty expandable -->
      <template v-else>
        <!-- Collapsed state: chevron + preview -->
        <span
          v-if="!isCurrentExpanded"
          class="json-toggle"
          role="button"
          tabindex="0"
          aria-expanded="false"
          @click="toggle(currentPath)"
          @keydown="handleKeydown($event, currentPath)"
        >
          <span class="json-chevron">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
            ><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </span>
          <span class="json-preview">{{ getPreview(data) }}</span>
        </span>

        <!-- Expanded state: chevron + bracket + children + closing bracket -->
        <template v-else>
          <span
            class="json-toggle"
            role="button"
            tabindex="0"
            aria-expanded="true"
            @click="toggle(currentPath)"
            @keydown="handleKeydown($event, currentPath)"
          >
            <span class="json-chevron expanded">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
              ><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
            </span>
            <span class="json-bracket">{{ getOpenBracket(data) }}</span>
          </span>

          <div class="json-children">
            <div
              v-for="[key, value] in getEntries(data)"
              :key="key"
              class="json-entry"
            >
              <!-- Key/Index -->
              <span
                v-if="!Array.isArray(data)"
                class="json-key"
              >"{{ key }}"</span>
              <span
                v-else
                class="json-index"
              >{{ key }}</span>
              <span class="json-colon">: </span>

              <!-- Nested expandable value -->
              <template v-if="isExpandable(value)">
                <JsonTree
                  :data="value"
                  :default-expand-depth="defaultExpandDepth"
                  :path="buildPath(key)"
                  :depth="depth + 1"
                  :expanded-paths="expandedPaths"
                />
              </template>

              <!-- Primitive value -->
              <template v-else>
                <span :class="'json-' + getType(value)">{{ formatPrimitive(value) }}</span>
              </template>
            </div>
          </div>

          <span class="json-bracket">{{ getCloseBracket(data) }}</span>
        </template>
      </template>
    </template>

    <!-- Primitive value (root level only) -->
    <template v-else>
      <span :class="'json-' + getType(data)">{{ formatPrimitive(data) }}</span>
    </template>
  </div>
</template>

<script lang="ts">
export default {
  name: 'JsonTree'
}
</script>

<style scoped>
.json-tree {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  line-height: 1.6;
  display: inline;
}

.json-tree-root {
  display: block;
}

.json-children {
  padding-left: 16px;
  border-left: 1px solid var(--border-tertiary);
  margin-left: 6px;
}

.json-entry {
  margin: 1px 0;
}

.json-key {
  color: var(--syntax-property);
}

.json-index {
  color: var(--syntax-number);
}

.json-colon {
  color: var(--syntax-punctuation);
}

.json-string {
  color: var(--syntax-string);
}

.json-number {
  color: var(--syntax-number);
}

.json-boolean {
  color: var(--syntax-keyword);
}

.json-null {
  color: var(--syntax-comment);
  font-style: italic;
}

.json-bracket {
  color: var(--syntax-punctuation);
}

.json-toggle {
  cursor: pointer;
  user-select: none;
  display: inline;
}

.json-toggle:hover .json-chevron {
  color: var(--text-primary);
}

.json-toggle:focus {
  outline: none;
}

.json-toggle:focus-visible .json-chevron {
  color: var(--color-accent);
}

.json-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  vertical-align: middle;
  margin-right: 1px;
  transition: color 0.1s ease;
}

.json-chevron svg {
  width: 14px;
  height: 14px;
  transition: transform 0.15s ease;
}

.json-chevron.expanded svg {
  transform: rotate(90deg);
}

.json-preview {
  color: var(--text-secondary);
}
</style>

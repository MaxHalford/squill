<template>
  <div class="page-container">
    <div class="page-content">
      <button class="back-button" @click="goBack">← Back</button>
      <div class="markdown-content" v-html="htmlContent"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'

const router = useRouter()

const goBack = () => {
  router.push('/')
}

const markdownContent = `
# Privacy Policy

**Last Updated: ${new Date().toLocaleDateString()}**

## Introduction

Welcome to Squill. This privacy policy explains how we collect, use, and protect your information when you use our application.

## Data Collection

Squill is a client-side application that runs entirely in your browser. We do not collect, transmit, or store any of your personal data on external servers.

### What We Don't Collect

- Personal identification information
- Query data or SQL statements
- Database contents or schema information
- Usage analytics or telemetrics

### Local Storage

All data is stored locally in your browser using:
- **LocalStorage**: For application settings and preferences
- **IndexedDB**: For DuckDB database files and query results

This data never leaves your device and remains under your complete control.

## Third-Party Services

### DuckDB WebAssembly

Squill uses DuckDB WebAssembly, which runs entirely in your browser. No data is sent to external servers.

### Optional Integrations

If you choose to connect to external data sources (like BigQuery), data may be transmitted directly between your browser and those services. Please refer to their respective privacy policies:

- [Google BigQuery Privacy Policy](https://policies.google.com/privacy)

## Data Security

Since Squill operates entirely client-side:
- Your data is protected by your browser's security mechanisms
- We recommend using HTTPS when accessing Squill
- Regular browser updates help maintain security

## Your Rights

You have complete control over your data:
- **Access**: All data is accessible through browser developer tools
- **Delete**: Clear browser data to remove all Squill information
- **Export**: Use browser export features or Squill's built-in functionality

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted on this page with an updated "Last Updated" date.

## Contact

For questions about this privacy policy, please [open an issue on GitHub](https://github.com/your-repo/squill/issues).
`

const htmlContent = computed(() => {
  return marked(markdownContent)
})
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  background: var(--surface-secondary, #f5f5f5);
  padding: var(--space-6, 2rem);
}

.page-content {
  max-width: 800px;
  margin: 0 auto;
  background: var(--surface-primary, white);
  border: 1px solid var(--border-primary, #e0e0e0);
  border-radius: var(--radius-lg, 8px);
  padding: var(--space-6, 2rem);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.back-button {
  background: transparent;
  border: 1px solid var(--border-primary, #e0e0e0);
  color: var(--text-primary, #333);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 4px);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: var(--space-4, 1rem);
  transition: all 0.2s ease;
}

.back-button:hover {
  background: var(--surface-secondary, #f5f5f5);
  border-color: var(--border-hover, #999);
}

.markdown-content {
  color: var(--text-primary, #333);
  line-height: 1.6;
}

.markdown-content :deep(h1) {
  font-size: 2rem;
  margin-bottom: var(--space-4, 1rem);
  color: var(--text-primary, #333);
  border-bottom: 2px solid var(--border-primary, #e0e0e0);
  padding-bottom: var(--space-2, 0.5rem);
}

.markdown-content :deep(h2) {
  font-size: 1.5rem;
  margin-top: var(--space-6, 2rem);
  margin-bottom: var(--space-3, 0.75rem);
  color: var(--text-primary, #333);
}

.markdown-content :deep(h3) {
  font-size: 1.25rem;
  margin-top: var(--space-4, 1rem);
  margin-bottom: var(--space-2, 0.5rem);
  color: var(--text-secondary, #666);
}

.markdown-content :deep(p) {
  margin-bottom: var(--space-3, 0.75rem);
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: var(--space-3, 0.75rem);
  padding-left: var(--space-5, 1.5rem);
}

.markdown-content :deep(li) {
  margin-bottom: var(--space-2, 0.5rem);
}

.markdown-content :deep(a) {
  color: var(--accent-primary, #007bff);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(strong) {
  font-weight: 600;
  color: var(--text-primary, #333);
}

.markdown-content :deep(code) {
  background: var(--surface-secondary, #f5f5f5);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--surface-secondary, #f5f5f5);
  padding: var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 4px);
  overflow-x: auto;
  margin-bottom: var(--space-3, 0.75rem);
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--border-primary, #e0e0e0);
  padding-left: var(--space-3, 0.75rem);
  margin-left: 0;
  color: var(--text-secondary, #666);
}
</style>

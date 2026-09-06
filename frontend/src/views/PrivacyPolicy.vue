<template>
  <div class="page-container">
    <div class="page-content">
      <button
        class="back-button"
        @click="goBack"
      >
        ← Back
      </button>
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="markdown-content"
        v-html="htmlContent"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { renderMarkdown } from '../utils/markdown'

const router = useRouter()

const goBack = () => {
  router.push('/')
}

const markdownContent = `
# Privacy Policy

**Last Updated: September 6, 2026**

## Summary

Squill is a static, local-first BigQuery client. Squill has no application backend, no user accounts, no subscriptions, no advertising, and no analytics. Your queries, settings, canvas data, connection metadata, and cached results are stored by your browser on your device.

## Google authorization

          When you connect to BigQuery, Squill uses Google Identity Services in your browser. Google issues a short-lived access token directly to the page.

- Access tokens are kept in memory and are not written to browser storage.
- Squill stores the Google account email and selected Google Cloud project locally so you can recognize and reuse a connection.
- Squill does not receive or store your Google password.
- There is no Squill server to receive your token, queries, or results.
- You can revoke Squill's access from your Google Account permissions at any time.

Squill requests read-only Google scopes needed to identify the selected account, discover accessible projects, inspect BigQuery metadata, and run BigQuery queries. It does not request BigQuery write access. Google's handling of this information is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

## Query execution

A BigQuery query is sent directly from your browser to the Google BigQuery API only when you explicitly run it. Squill does not automatically execute downstream queries. BigQuery usage and charges, if any, are governed by your Google Cloud project and Google Cloud terms.

Query results are copied into an in-browser DuckDB WebAssembly database so Squill can display and work with them locally. DuckDB runs on your device.

## Local storage

Squill uses IndexedDB and browser storage for canvas documents, query history, settings, non-secret connection metadata, schema caches, and query-result caches. This data remains on the device and browser profile where it was created. Clearing Squill's site data removes it.

Because Squill has no backend, it cannot recover, synchronize, or remotely delete local data for you.

## Network requests

The app may contact:

- Google Identity Services and Google OAuth endpoints for authorization
- Google Cloud Resource Manager to list accessible projects
- Google BigQuery APIs for metadata and queries
- Static asset hosts required by the in-browser SQL tooling
- GitHub Pages to load the application itself

Squill does not send this data to an operator-controlled application server.

## Contact and changes

Material changes will be published on this page. For questions or security reports, [open an issue on GitHub](https://github.com/MaxHalford/squill/issues).
`
const htmlContent = computed(() => {
  return renderMarkdown(markdownContent)
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
  border: 1px solid var(--border-primary);
  padding: var(--space-6, 2rem);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.back-button {
  background: transparent;
  border: 1px solid var(--border-primary);
  color: var(--text-primary, #333);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: var(--space-4, 1rem);
  transition: all 0.2s ease;
}

.back-button:hover {
  background: var(--surface-secondary, #f5f5f5);
  border-color: var(--border-primary);
}

.markdown-content {
  color: var(--text-primary, #333);
  line-height: 1.6;
}

.markdown-content :deep(h1) {
  font-size: 2rem;
  margin-bottom: var(--space-4, 1rem);
  color: var(--text-primary, #333);
  border-bottom: 2px solid var(--border-primary);
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
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--surface-secondary, #f5f5f5);
  padding: var(--space-3, 0.75rem);
  overflow-x: auto;
  margin-bottom: var(--space-3, 0.75rem);
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--border-primary);
  padding-left: var(--space-3, 0.75rem);
  margin-left: 0;
  color: var(--text-secondary, #666);
}
</style>

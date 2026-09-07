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
# Terms of Service

**Last Updated: September 7, 2026**

## The application

Squill is an open-source, static, browser-based SQL canvas. It stores application data locally and sends explicitly requested BigQuery and optional OpenAI requests directly from your browser to those providers. No Squill account or paid subscription is provided.

## Your responsibility

You are responsible for:

- using only Google Cloud projects and data you are authorized to access;
- reviewing every query before running it;
- understanding the BigQuery usage and cost associated with a query;
- protecting access to your browser profile and device;
- protecting any OpenAI API key you choose to store locally and controlling its project permissions and spending limits;
- complying with Google Cloud's terms and your organization's policies; and
- maintaining backups of any local Squill data you need to preserve.

Squill requests read-only Google OAuth scopes and does not automatically execute downstream queries. A query is submitted only following an explicit run action, but read queries can still consume BigQuery resources and incur charges.

## Google services

BigQuery authorization and API requests are provided by Google and are subject to [Google Cloud terms](https://cloud.google.com/terms). Google may expire or revoke access tokens, require renewed consent, limit API access, or change its services independently of Squill.

## Optional OpenAI service

If you configure the line fixer, requests and charges are made against your OpenAI account and are subject to [OpenAI's terms](https://openai.com/policies/terms-of-use/). Squill stores the key unencrypted in your browser's IndexedDB and cannot recover, rotate, or protect it from someone who controls your device, browser profile, or code running on the page.

## Local data

Canvas documents, settings, query history, connection metadata, and cached results may be stored in your browser. There is no server-side backup or recovery service. Clearing site data, changing browser profiles, or losing the device may permanently remove this information.

## Availability and warranty

Squill is provided as-is and without warranties of availability, fitness, correctness, security, or non-infringement, to the extent permitted by law. The application may change or stop working because of browser, Google API, GitHub Pages, or other dependency changes.

## Liability

To the maximum extent permitted by law, the project maintainers are not liable for query charges, data loss, unauthorized access, business interruption, lost profits, or indirect or consequential damages arising from use of Squill.

## Open source

Squill's source code and license are available at [github.com/MaxHalford/squill](https://github.com/MaxHalford/squill). The repository license governs copying and modification of the source code; these terms govern use of the hosted application.

## Changes and contact

Changes will be published on this page. Continued use after a change means you accept the updated terms. For questions, [open an issue on GitHub](https://github.com/MaxHalford/squill/issues).
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

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-primary);
  margin: var(--space-6, 2rem) 0;
}
</style>

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
# Terms of Service

**Last Updated: ${new Date().toLocaleDateString()}**

## Acceptance of Terms

By accessing and using Squill, you accept and agree to be bound by the terms and conditions of this agreement.

## Description of Service

Squill is a web-based SQL editor and data exploration tool that runs entirely in your browser. The service allows you to:

- Execute SQL queries using DuckDB WebAssembly
- Create and manage database connections
- Visualize query results
- Import and export data

## Client-Side Application

Squill is a client-side application. All processing occurs in your browser, and we do not operate servers that store your data.

## Use License

Permission is granted to use Squill for personal and commercial purposes, subject to the following restrictions:

### You May

- Use Squill for any lawful purpose
- Connect to your own databases and data sources
- Share query results and visualizations

### You May Not

- Use Squill for any illegal activities
- Attempt to reverse engineer or modify the application's source code (unless open source)
- Use Squill to access unauthorized data sources
- Circumvent any security features

## User Responsibilities

You are responsible for:

- **Data Security**: Protecting your database credentials and access tokens
- **Compliance**: Ensuring your use complies with applicable laws and regulations
- **Third-Party Services**: Managing your relationships with any external services you connect to
- **Browser Security**: Maintaining up-to-date browser software

## Data and Privacy

Please refer to our [Privacy Policy](/privacy-policy) for information about how we handle your data.

### Your Data

- All data processing occurs in your browser
- You retain full ownership of your data
- We do not access, store, or transmit your queries or results

## Third-Party Services

If you connect Squill to third-party services (e.g., BigQuery, PostgreSQL), your use of those services is subject to their respective terms of service:

- [Google Cloud Terms of Service](https://cloud.google.com/terms)
- Other database providers' terms as applicable

## Disclaimer of Warranties

Squill is provided "AS IS" without warranty of any kind. We make no warranties that:

- The service will be uninterrupted or error-free
- Defects will be corrected
- The service is free from viruses or harmful components
- Results obtained will be accurate or reliable

## Limitation of Liability

To the maximum extent permitted by law, we shall not be liable for any:

- Indirect, incidental, or consequential damages
- Data loss or corruption
- Business interruption
- Lost profits or revenue

## Browser Compatibility

Squill requires a modern browser with support for:

- WebAssembly
- IndexedDB
- ES6+ JavaScript features

We recommend using the latest version of Chrome, Firefox, Safari, or Edge.

## Changes to Service

We reserve the right to:

- Modify or discontinue the service at any time
- Update these terms with notice on this page
- Change features or functionality

Continued use after changes constitutes acceptance of modified terms.

## Open Source

If Squill is open source, the source code is available under the license specified in the repository. Contributions and modifications are subject to that license.

## Termination

You may stop using Squill at any time. We may terminate or suspend access if you violate these terms.

## Governing Law

These terms shall be governed by the laws of the jurisdiction in which the service operator is located.

## Contact

For questions about these terms, please [open an issue on GitHub](https://github.com/your-repo/squill/issues).

---

By using Squill, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
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

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-primary, #e0e0e0);
  margin: var(--space-6, 2rem) 0;
}
</style>

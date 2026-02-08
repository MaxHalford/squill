<template>
  <div class="page-container">
    <div class="page-content">
      <button
        class="back-button"
        @click="goBack"
      >
        ← Back
      </button>
      <div
        class="markdown-content"
        v-html="htmlContent"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { useHead } from '@unhead/vue'

const router = useRouter()

// SEO Meta Tags
useHead({
  title: 'Terms of Service - Squill',
  meta: [
    {
      name: 'description',
      content: 'Read the Terms of Service for Squill, the browser-based SQL editor. Understand your rights and responsibilities when using our service.'
    },
    { property: 'og:title', content: 'Terms of Service - Squill' },
    { property: 'og:description', content: 'Terms of Service for Squill, the browser-based SQL editor.' },
    { property: 'og:url', content: 'https://squill.dev/terms-of-service' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:title', content: 'Terms of Service - Squill' },
    { name: 'twitter:description', content: 'Terms of Service for Squill, the browser-based SQL editor.' },
  ],
  link: [
    { rel: 'canonical', href: 'https://squill.dev/terms-of-service' }
  ]
})

const goBack = () => {
  router.push('/')
}

const markdownContent = `
# Terms of Service

**Last Updated: ${new Date().toLocaleDateString()}**

## Acceptance of terms

By accessing and using Squill, you accept and agree to be bound by the terms and conditions of this agreement.

## Description of service

Squill is a web-based SQL editor and data exploration tool. The service allows you to:

- Execute SQL queries using DuckDB WebAssembly (client-side)
- Connect to external databases (BigQuery, PostgreSQL)
- Visualize and explore query results
- Import and analyze CSV files
- Use AI-powered SQL assistance (Pro feature)

## How Squill works

Squill operates in two modes:

- **Client-side processing**: DuckDB queries and CSV file analysis run entirely in your browser. No data is transmitted to our servers.
- **Server-assisted features**: Database connections (BigQuery, PostgreSQL) and AI features require server-side processing. Your credentials are stored encrypted on our servers.

## User accounts

An account is required to:
- Connect to external databases (BigQuery, PostgreSQL)
- Store database credentials securely
- Access Squill Pro features

You do not need an account to use DuckDB or analyze CSV files locally.

## Squill Pro

Squill Pro is a paid subscription (8€/month) that includes:
- **Hex remover**: Get AI-powered suggestions to fix broken queries
- Additional features as they become available

Pro features may involve transmitting data to third-party services (e.g., OpenAI for AI features). See our [Privacy Policy](/privacy-policy) for details.

## Use license

Permission is granted to use Squill for personal and commercial purposes, subject to the following restrictions:

### You may

- Use Squill for any lawful purpose
- Connect to databases you are authorized to access
- Share query results and visualizations
- Self-host the open source version

### You may not

- Use Squill for any illegal activities
- Access databases without proper authorization
- Circumvent any security features
- Abuse the service in ways that impact other users

## User responsibilities

You are responsible for:

- **Credentials**: Keeping your database credentials secure
- **Authorization**: Ensuring you have permission to access connected databases
- **Compliance**: Following applicable laws and your organization's policies
- **Third-party terms**: Complying with terms of external services you connect to
- **Account security**: Maintaining the security of your Squill account

## Data and privacy

Please refer to our [Privacy Policy](/privacy-policy) for detailed information about:
- What data we collect and store
- How AI features process your queries
- Third-party services we use
- Your data rights

### Your data

- You retain full ownership of your data
- Local data (DuckDB, CSV) stays in your browser
- Database credentials are encrypted at rest
- AI features transmit queries to OpenAI (Pro only)

## Third-party services

Squill integrates with the following services:

- **OpenAI**: Powers the Hex remover (Pro). Subject to [OpenAI's terms](https://openai.com/terms).
- **Google Cloud**: For BigQuery connections. Subject to [Google Cloud terms](https://cloud.google.com/terms).
- **Paddle**: Processes Pro subscriptions. Subject to [Paddle's terms](https://www.paddle.com/legal/terms).

## Payments and subscriptions

- Pro subscriptions are billed monthly through Paddle
- You may cancel at any time; access continues until the end of the billing period
- Refunds are handled according to our [Refund Policy](/refund-policy)
- Prices may change with notice

## Disclaimer of warranties

Squill is provided "AS IS" without warranty of any kind. We make no warranties that:

- The service will be uninterrupted or error-free
- Defects will be corrected
- AI suggestions will be accurate or appropriate
- The service is free from security vulnerabilities

## Limitation of liability

To the maximum extent permitted by law, we shall not be liable for any:

- Indirect, incidental, or consequential damages
- Data loss or corruption
- Business interruption
- Lost profits or revenue
- Damages from AI-suggested fixes

## Browser compatibility

Squill requires a modern browser with support for:

- WebAssembly
- IndexedDB
- ES6+ JavaScript features

We recommend using the latest version of Chrome, Firefox, Safari, or Edge.

## Changes to service

We reserve the right to:

- Modify or discontinue features at any time
- Update these terms with notice on this page
- Change pricing with advance notice
- Modify Pro features

Continued use after changes constitutes acceptance of modified terms.

## Open source

Squill is open source under the AGPL license. The source code is available at [github.com/MaxHalford/squill](https://github.com/MaxHalford/squill).

## Termination

- You may delete your account at any time
- We may terminate accounts that violate these terms
- Upon termination, your stored credentials are deleted

## Governing law

These terms shall be governed by the laws of the jurisdiction in which the service operator is located.

## Contact

For questions about these terms, please [open an issue on GitHub](https://github.com/MaxHalford/squill/issues).

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

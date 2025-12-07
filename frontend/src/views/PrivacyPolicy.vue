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
import { useHead } from '@unhead/vue'

const router = useRouter()

// SEO Meta Tags
useHead({
  title: 'Privacy Policy - Squill',
  meta: [
    {
      name: 'description',
      content: 'Learn how Squill protects your data. Our privacy policy explains what data we collect, how we use it, and your rights regarding your information.'
    },
    { property: 'og:title', content: 'Privacy Policy - Squill' },
    { property: 'og:description', content: 'Learn how Squill protects your data and your privacy rights.' },
    { property: 'og:url', content: 'https://squill.dev/privacy-policy' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:title', content: 'Privacy Policy - Squill' },
    { name: 'twitter:description', content: 'Learn how Squill protects your data and your privacy rights.' },
  ],
  link: [
    { rel: 'canonical', href: 'https://squill.dev/privacy-policy' }
  ]
})

const goBack = () => {
  router.push('/')
}

const markdownContent = `
# Privacy Policy

**Last Updated: ${new Date().toLocaleDateString()}**

## Introduction

Welcome to Squill. This privacy policy explains how we collect, use, and protect your information when you use our application.

## How Squill works

Squill offers both client-side and server-assisted features:

- **Free tier (DuckDB, CSV files)**: Runs entirely in your browser. No data is transmitted to our servers.
- **Database connections (BigQuery, PostgreSQL)**: Require server-side processing and credential storage.
- **Squill Pro features (AI SQL fixer)**: Transmit query data to third-party AI providers.

## Data we collect

### Account information

When you create an account, we collect and store:
- **Email address**: Used for authentication and account identification
- **Login timestamps**: To track account activity
- **Subscription status**: To manage your plan (free or Pro)

### Database credentials

When you connect to external databases, we store:
- **BigQuery**: Encrypted OAuth refresh tokens
- **PostgreSQL**: Encrypted connection details (host, port, database name, username, password)

All credentials are encrypted at rest using industry-standard encryption.

### AI feature data (Squill Pro)

When you use the AI SQL fixer, the following data is sent to our AI provider (OpenAI):
- Your SQL query
- The error message
- Database schema context (table and column names)
- Sample queries (if provided)
- Database type (BigQuery, PostgreSQL, DuckDB)

This data is used solely to generate fix suggestions and is subject to [OpenAI's privacy policy](https://openai.com/privacy).

### Local browser storage

For all users, data is stored locally in your browser:
- **LocalStorage**: Application settings and preferences
- **IndexedDB**: DuckDB database files and query results

This local data never leaves your device unless you use server-assisted features.

## Data we don't collect

- Query results or database contents (except as described above for AI features)
- Usage analytics or telemetry (this may change with future Pro features)
- Payment card details (handled by our payment processor)

## Third-party services

### OpenAI (AI SQL fixer - Pro)

Query data is sent to OpenAI for AI-powered fix suggestions. See [OpenAI's privacy policy](https://openai.com/privacy).

### Paddle (payments)

Subscription payments are processed by Paddle. We do not store your payment card details. See [Paddle's privacy policy](https://www.paddle.com/legal/privacy).

### Google BigQuery

If you connect to BigQuery, queries are executed via Google's APIs. See [Google's privacy policy](https://policies.google.com/privacy).

### PostgreSQL providers

PostgreSQL queries are routed through our backend to your database server. We do not store query results.

### DuckDB WebAssembly

DuckDB runs entirely in your browser. No data is sent to external servers for DuckDB queries.

## Data security

- All credentials are encrypted at rest
- All data in transit uses HTTPS/TLS encryption
- We follow security best practices for credential storage
- Your local browser data is protected by your browser's security mechanisms

## Data retention

- **Account data**: Retained until you delete your account
- **Database credentials**: Retained until you remove the connection or delete your account
- **AI query data**: Not retained by Squill; subject to OpenAI's data retention policies
- **Local browser data**: Retained until you clear your browser data

## Your rights

- **Access**: Request a copy of your stored data
- **Delete**: Delete your account and all associated data
- **Disconnect**: Remove database connections at any time
- **Local data**: Clear browser data to remove all local Squill information

## Changes to this policy

We may update this privacy policy from time to time. Changes will be posted on this page with an updated "Last Updated" date.

## Contact

For questions about this privacy policy, please [open an issue on GitHub](https://github.com/MaxHalford/squill/issues).
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

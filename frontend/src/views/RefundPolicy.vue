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
  title: 'Refund Policy - Squill',
  meta: [
    {
      name: 'description',
      content: 'Squill Pro refund policy. Learn about subscription cancellation, refund eligibility, and how to request a refund for your Squill Pro subscription.'
    },
    { property: 'og:title', content: 'Refund Policy - Squill' },
    { property: 'og:description', content: 'Refund policy for Squill Pro subscriptions.' },
    { property: 'og:url', content: 'https://squill.dev/refund-policy' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:title', content: 'Refund Policy - Squill' },
    { name: 'twitter:description', content: 'Refund policy for Squill Pro subscriptions.' },
  ],
  link: [
    { rel: 'canonical', href: 'https://squill.dev/refund-policy' }
  ]
})

const goBack = () => {
  router.push('/')
}

const markdownContent = `
# Refund Policy

**Last Updated: ${new Date().toLocaleDateString()}**

## Overview

Squill Pro is a subscription service billed monthly at 8€/month. We want you to be satisfied with your purchase. This policy explains how refunds work.

## Subscription cancellation

You can cancel your Squill Pro subscription at any time:

- **No questions asked**: Cancel directly from your account settings
- **Access continues**: You retain Pro features until the end of your current billing period
- **No partial refunds**: We do not provide prorated refunds for unused time within a billing period

## Refund eligibility

We offer refunds in the following situations:

### Eligible for refund

- **First-time subscribers**: If you're unsatisfied within the first 7 days of your initial subscription, contact us for a full refund
- **Technical issues**: If a technical problem on our end prevents you from using Pro features you paid for
- **Duplicate charges**: If you were accidentally charged multiple times
- **Billing errors**: If you were charged after cancellation or at an incorrect amount

### Not eligible for refund

- Subscriptions older than 7 days (except for technical issues)
- Change of mind after the 7-day period
- Unused features or partial month usage
- Temporary service interruptions
- Dissatisfaction with AI-generated suggestions (AI output quality varies)

## How to request a refund

To request a refund:

1. Email us or [open an issue on GitHub](https://github.com/MaxHalford/squill/issues) with:
   - Your account email
   - Date of purchase
   - Reason for refund request
2. We'll review your request within 3 business days
3. Approved refunds are processed through Paddle within 5-10 business days

## Payment processor

All payments are processed by Paddle. Refunds are subject to Paddle's processing policies. The refund will be credited to your original payment method.

For payment disputes, you may also contact Paddle directly through their support channels.

## Free tier

The free tier of Squill (DuckDB, CSV analysis) requires no payment and is not subject to this refund policy.

## Changes to this policy

We may update this refund policy from time to time. Changes will be posted on this page with an updated "Last Updated" date.

## Contact

For refund requests or questions about this policy, please [open an issue on GitHub](https://github.com/MaxHalford/squill/issues).
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

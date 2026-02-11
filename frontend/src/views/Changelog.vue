<template>
  <div class="page-container">
    <div class="page-content">
      <button
        class="back-button"
        @click="goBack"
      >
        ← Back
      </button>

      <h1>Changelog</h1>

      <div class="changelog-list">
        <article
          v-for="entry in changelog"
          :id="entry.date"
          :key="entry.date"
          class="changelog-entry"
        >
          <time class="entry-date">{{ formatDate(entry.date) }}</time>
          <div
            class="entry-content markdown-content"
            v-html="renderMarkdown(entry.content)"
          />
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { useHead } from '@unhead/vue'
import { changelog } from '../data/changelog'

const router = useRouter()

useHead({
  title: 'Changelog - Squill',
  meta: [
    { name: 'description', content: 'See what\'s new in Squill. Latest features, improvements, and bug fixes.' },
    { property: 'og:title', content: 'Changelog - Squill' },
    { property: 'og:description', content: 'See what\'s new in Squill. Latest features, improvements, and bug fixes.' },
    { property: 'og:url', content: 'https://squill.dev/changelog' },
    { property: 'og:type', content: 'website' },
  ],
  link: [
    { rel: 'canonical', href: 'https://squill.dev/changelog' }
  ]
})

const goBack = () => {
  // Use router.back() so browser restores scroll position on the landing page
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const renderMarkdown = (content: string): string => {
  return marked(content) as string
}
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

h1 {
  font-size: 2rem;
  margin-bottom: var(--space-6, 2rem);
  color: var(--text-primary, #333);
  border-bottom: 2px solid var(--border-primary);
  padding-bottom: var(--space-2, 0.5rem);
}

.changelog-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-8, 2rem);
}

.changelog-entry {
  padding-bottom: var(--space-6, 2rem);
  border-bottom: 1px solid var(--border-secondary);
}

.changelog-entry:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.entry-date {
  display: block;
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-body-sm, 12px);
  font-weight: 600;
  color: var(--text-primary, #333);
  letter-spacing: 0.05em;
  margin-bottom: var(--space-3, 0.75rem);
}

.entry-content {
  color: var(--text-primary, #333);
  line-height: 1.6;
}

.markdown-content :deep(h2) {
  font-size: 1.25rem;
  margin-top: var(--space-4, 1rem);
  margin-bottom: var(--space-2, 0.5rem);
  color: var(--text-primary, #333);
}

.markdown-content :deep(h2:first-child) {
  margin-top: 0;
}

.markdown-content :deep(p) {
  margin-bottom: var(--space-3, 0.75rem);
  color: var(--text-secondary, #666);
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: var(--space-3, 0.75rem);
  padding-left: var(--space-5, 1.5rem);
  color: var(--text-secondary, #666);
}

.markdown-content :deep(li) {
  margin-bottom: var(--space-1, 0.25rem);
}

.markdown-content :deep(a) {
  color: var(--accent-primary, #007bff);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(code) {
  background: var(--surface-secondary, #f5f5f5);
  padding: 2px 6px;
  font-family: var(--font-family-mono, monospace);
  font-size: 0.9em;
}
</style>

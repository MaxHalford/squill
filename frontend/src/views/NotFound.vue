<template>
  <div class="not-found-page">
    <div class="not-found-content">
      <img
        src="@/assets/birds/where.svg"
        class="bird-illustration"
        alt="Birds looking around"
      >
      <h1>404</h1>
      <p>Page not found</p>
      <button
        class="btn-primary"
        @click="goHome"
      >
        Go home
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'

const router = useRouter()

// SEO Meta Tags - noindex for 404 pages
useHead({
  title: 'Page Not Found - Squill',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'description', content: 'The page you are looking for could not be found.' },
  ]
})

const goHome = () => {
  router.push('/')
}
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(
    circle,
    var(--canvas-dot-color) var(--canvas-dot-size),
    transparent var(--canvas-dot-size)
  );
  background-size: var(--canvas-dot-spacing) var(--canvas-dot-spacing);
}

.not-found-content {
  text-align: center;
  padding: var(--space-6);
  background: rgba(212, 212, 212, 0.85);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 400px;
}

.bird-illustration {
  width: 400px;
  height: auto;
  margin-bottom: var(--space-4);
}

h1 {
  font-family: var(--font-family-mono);
  font-size: 64px;
  font-weight: 700;
  margin: 0 0 var(--space-2) 0;
  color: var(--text-primary);
}

p {
  font-size: var(--font-size-body-lg);
  margin: 0 0 var(--space-4) 0;
  color: var(--text-secondary);
}

.btn-primary {
  display: inline-block;
  padding: var(--space-3) var(--space-6);
  background: var(--surface-inverse);
  color: var(--text-inverse);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-none);
  box-shadow: var(--shadow-md);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body);
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}

.btn-primary:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
}

.btn-primary:active {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-sm);
}
</style>

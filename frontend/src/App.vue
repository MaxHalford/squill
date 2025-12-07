<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from './stores/settings'

const settingsStore = useSettingsStore()
const route = useRoute()

// Apply theme class to document
// Landing page always uses light mode
const applyTheme = () => {
  const isLandingPage = route.path === '/'
  const theme = isLandingPage ? 'light' : settingsStore.resolvedTheme
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
}

// Handle system theme change
const handleSystemThemeChange = () => {
  if (settingsStore.themePreference === 'system') {
    applyTheme()
  }
}

// Media query for system theme detection
let mediaQuery: MediaQueryList | null = null

onMounted(() => {
  // Apply initial theme (in case flash prevention script missed something)
  applyTheme()

  // Listen for system preference changes
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', handleSystemThemeChange)
})

onUnmounted(() => {
  mediaQuery?.removeEventListener('change', handleSystemThemeChange)
})

// Watch for theme preference changes
watch(() => settingsStore.themePreference, () => {
  applyTheme()
})

// Watch for route changes (landing page always uses light mode)
watch(() => route.path, () => {
  applyTheme()
})
</script>

<template>
  <div class="app">
    <router-view />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

.app {
  width: 100%;
  height: 100vh;
}
</style>

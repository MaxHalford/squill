<script setup lang="ts">
import { watch, onMounted } from 'vue'
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

// Apply accent color as CSS variable override
const applyAccentColor = () => {
  document.documentElement.style.setProperty('--color-accent', settingsStore.accentColor)
}

onMounted(() => {
  applyTheme()
  applyAccentColor()
})

// Watch resolved theme (reacts to both preference changes and OS theme changes)
watch(() => settingsStore.resolvedTheme, () => {
  applyTheme()
})

// Watch for route changes (landing page always uses light mode)
watch(() => route.path, () => {
  applyTheme()
})

// Watch for accent color changes
watch(() => settingsStore.accentColor, () => {
  applyAccentColor()
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

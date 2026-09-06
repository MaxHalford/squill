<script setup lang="ts">
import { watch, onMounted } from 'vue'
import { useSettingsStore } from './stores/settings'
import DialogHost from './components/DialogHost.vue'
import ToastHost from './components/ToastHost.vue'

const settingsStore = useSettingsStore()
// Apply theme class to document
const applyTheme = () => {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(settingsStore.resolvedTheme)
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

// Watch for accent color changes
watch(() => settingsStore.accentColor, () => {
  applyAccentColor()
})
</script>

<template>
  <div class="app">
    <router-view />
    <DialogHost />
    <ToastHost />
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

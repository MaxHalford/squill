import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm}'],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024
      },
      manifest: false
    })
  ],
  ssgOptions: {
    script: 'async' as const,
    formatting: 'minify' as const,
    includedRoutes: () => ['/', '/privacy-policy', '/terms-of-service', '/refund-policy'],
  },
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  worker: {
    format: 'es' as const
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
}))

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
      injectRegister: 'script-defer',
      workbox: {
        // Precache DuckDB WASM files for instant loading
        // These are hashed by Vite, so they're safe to precache
        globPatterns: [
          'assets/duckdb-*.wasm',
          'assets/duckdb-*worker*.js'
        ],
        // Increase max file size for WASM (~35MB)
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        // Disable navigation fallback since we only cache DuckDB files
        navigateFallback: null
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

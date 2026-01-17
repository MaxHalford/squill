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
        // Don't precache any files
        globPatterns: [],
        // Only cache DuckDB WASM and worker files at runtime
        runtimeCaching: [
          {
            urlPattern: /duckdb.*\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'duckdb-wasm',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /duckdb.*worker.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'duckdb-worker',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
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

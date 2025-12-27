import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue()],
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

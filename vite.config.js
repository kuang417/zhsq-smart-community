import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const ROOT = process.cwd()

export default defineConfig({
  root: resolve(ROOT, 'web'),
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(ROOT, 'web/src') }
  },
  server: {
    port: 5182,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8081', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8081', changeOrigin: true }
    }
  },
  build: {
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:8001',
      '/health': process.env.VITE_PROXY_TARGET || 'http://localhost:8001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
    env: {
      VITE_FACE_ENGINE: 'mock',
    },
  },
})

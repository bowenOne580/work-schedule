import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: process.env.ALLOWED_HOSTS?.split(',').map(s => s.trim()) || undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:8998',
      },
    },
  },
})

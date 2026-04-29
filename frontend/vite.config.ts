import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['todo.wbwone1.cn'],
    proxy: {
      '/api': {
        target: 'http://localhost:8998',
      },
    },
  },
})

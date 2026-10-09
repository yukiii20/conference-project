import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Overridable so a second Vite instance (e.g. for E2E tests against a
// second backend on another port) doesn't proxy into the real dev backend.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/files': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills(),
  ],
  server: {
    allowedHosts: true,
    port: 5173,
  },
  resolve: {
    alias: {
      '@': '/home/user/app/src',
    },
  },
})

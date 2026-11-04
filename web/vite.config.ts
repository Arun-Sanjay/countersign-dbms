import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Modes: `vite` (development) reads .env.local -> local Supabase stack;
//        `vite --mode remote` reads .env.remote -> the cloud project (publishable key only).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { port: 5173, strictPort: false },
  build: {
    chunkSizeWarningLimit: 900,
  },
})

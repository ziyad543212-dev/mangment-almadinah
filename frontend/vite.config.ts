import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Absolute paths on Vercel so nested routes (e.g. /trips/1) load assets correctly
  base: process.env.VERCEL ? '/' : './',
})

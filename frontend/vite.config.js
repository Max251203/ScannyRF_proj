import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Собираем в стандартную папку 'dist' внутри 'frontend'
    outDir: 'dist',
    emptyOutDir: true,
  },
})
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Оставляем относительные пути!
  build: {
    outDir: '../backend/static', // Собираем снова в backend/static
    emptyOutDir: true,
  },
})
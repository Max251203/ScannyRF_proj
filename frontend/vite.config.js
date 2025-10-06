import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // --- НАЧАЛО ИСПРАВЛЛЕНИЯ ---
  base: '/static/', // <-- Указываем, что все пути к ассетам должны начинаться с /static/
  // --- КОНЕЦ ИСПРАВЛЕНИЯ ---
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
    // Указываем, чтобы манифест тоже генерировался для WhiteNoise
    manifest: true, 
  },
})
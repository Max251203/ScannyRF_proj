import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // --- НАЧАЛО ИСПРАВЛЕНИЯ ---
  base: './', // <-- ДОБАВИТЬ ЭТУ СТРОКУ
  // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

  build: {
    outDir: '../backend/static', // Вернем этот путь, он проще
    emptyOutDir: true,
  },
})
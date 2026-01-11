import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // В dev приложение живёт по корню '/', в prod-билде ассеты — под /static/
  base: command === 'build' ? '/static/' : '/',
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
    manifest: true,
  },
}))
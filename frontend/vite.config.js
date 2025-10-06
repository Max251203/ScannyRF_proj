// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [react()],
// })
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // ----- ДОБАВИТЬ БЛОК build -----
  build: {
    // Папка для сборки относительно frontend/
    outDir: '../backend/static',
    // Очищать папку перед сборкой
    emptyOutDir: true,
  },
  // -----------------------------
})
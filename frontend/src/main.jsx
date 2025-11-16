import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/main.css'
import { AuthAPI } from './api'
import { prewarmPdfAndFabric } from './utils/scriptLoader'

// Подогреваем pdf.js (с workerSrc) и fabric ДО монтирования приложения,
// затем тихо восстанавливаем сессию, и только потом рендерим React.
;(async () => {
  try {
    await prewarmPdfAndFabric()
  } catch {}
  try {
    await AuthAPI.bootstrap()
  } catch {}
  ReactDOM.createRoot(document.getElementById('root')).render(
    <HashRouter>
      <App />
    </HashRouter>
  )
})()
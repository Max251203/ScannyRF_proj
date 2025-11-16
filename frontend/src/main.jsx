import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/main.css'
import { AuthAPI } from './api'

// Монтируем приложение сразу (без "прогрева" библиотек)
ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
)

// Тихое восстановление сессии в фоне (без блокировки UI)
try { AuthAPI.bootstrap().catch(()=>{}) } catch {}

// Слушатель межвкладочного обновления токенов (опционально)
window.addEventListener('storage', (e) => {
  if (e.key === 'access' || e.key === 'refresh') {
    // другая вкладка обновила токены — текущая вкладка их прочитает при следующем запросе
  }
})
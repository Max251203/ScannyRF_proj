import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/main.css'
import { AuthAPI } from './api'

// Глобально восстанавливаем сессию при загрузке приложения.
// Если есть refresh — тихо получаем новый access и профиль.
// Это даёт "обычное" поведение: вернулся на сайт — уже авторизован.
AuthAPI.bootstrap().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <HashRouter>
      <App />
    </HashRouter>
  )
})
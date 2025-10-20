import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Обёртка для роутов, требующих авторизации.
 * Если токена нет — отправляем на главную и просим авторизоваться.
 * После успешного входа вернёмся на изначальный путь.
 */
export default function RequireAuth({ children }) {
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => {
    const hasAccess = !!localStorage.getItem('access')
    if (!hasAccess) {
      nav('/', { replace: true, state: { redirectTo: loc.pathname } })
    }
  }, [nav, loc.pathname])
  return children
}
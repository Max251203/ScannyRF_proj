import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Обёртка для роутов, требующих авторизации.
 * Если токена нет — отправляем на главную и просим авторизоваться.
 * Также реагируем на выход из учётной записи во время нахождения на защищённой странице.
 */
export default function RequireAuth({ children }) {
  const nav = useNavigate()
  const loc = useLocation()

  // Первичная проверка при монтировании/смене пути
  useEffect(() => {
    const hasAccess = !!localStorage.getItem('access')
    if (!hasAccess) {
      nav('/', { replace: true, state: { redirectTo: loc.pathname } })
    }
  }, [nav, loc.pathname])

  // Реакция на события выхода/истечения токена
  useEffect(() => {
    const onUser = (e) => {
      const user = e.detail
      if (!user) {
        nav('/', { replace: true })
      }
    }
    const onStorage = () => {
      const hasAccess = !!localStorage.getItem('access')
      if (!hasAccess) nav('/', { replace: true })
    }
    window.addEventListener('user:update', onUser)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('user:update', onUser)
      window.removeEventListener('storage', onStorage)
    }
  }, [nav])

  return children
}
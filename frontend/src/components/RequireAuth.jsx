import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthAPI } from '../api'

/**
 * Роут-гарда для страниц, требующих авторизации.
 * Делает "нормальное" поведение:
 * - если есть access — пропускаем сразу
 * - если access нет, но есть refresh — пробуем тихо восстановить сессию (bootstrap)
 * - если восстановить не удалось — уводим на главную и просим авторизоваться
 * - при разлогине (user:update с null) — уводим на главную
 */
export default function RequireAuth({ children }) {
  const nav = useNavigate()
  const loc = useLocation()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      // Уже авторизован — пускаем
      if (localStorage.getItem('access')) {
        setChecking(false)
        return
      }

      // Пытаемся восстановить сессию по refresh
      if (localStorage.getItem('refresh')) {
        try {
          await AuthAPI.bootstrap()
        } catch {
          // игнор
        }
      }

      if (cancelled) return

      // Если access так и не появился — отправляем на главную с редиректом назад
      if (!localStorage.getItem('access')) {
        setChecking(false)
        nav('/', { replace: true, state: { redirectTo: loc.pathname } })
      } else {
        setChecking(false)
      }
    }

    check()
    // Перепроверяем при смене пути (например, пользователь зашёл напрямую)
  }, [loc.pathname, nav])

  // Реакция на выход: если где-то очистили токены — выходим с защищённой страницы
  useEffect(() => {
    const onUser = (e) => {
      const u = e.detail
      if (!u) {
        nav('/', { replace: true })
      }
    }
    window.addEventListener('user:update', onUser)
    return () => window.removeEventListener('user:update', onUser)
  }, [nav])

  if (checking) return null
  return children
}
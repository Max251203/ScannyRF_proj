import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/images/logo-round.png'
import AuthModal from './AuthModal.jsx'
import { AuthAPI } from '../api'
import logoutIcon from '../assets/icons/logout.png'
import avatarDefault from '../assets/images/avatar-default.png'
import burgerIcon from '../assets/icons/burger.png'

function buildPlanBadge(billing, nowTs = Date.now()) {
  if (!billing) return ''

  const sub = billing.subscription || null

  if (sub?.plan === 'month' || sub?.plan === 'year') {
    const expTs = Date.parse(sub.expires_at || '')
    if (expTs && expTs > nowTs) {
      return sub.plan === 'month' ? 'мес.' : 'год'
    }
  }

  if (sub?.plan === 'single' && Number(sub.downloads_left || 0) > 0) {
    return 'один док.'
  }

  const total = Number(billing.free_total || 0)
  let left = Number(billing.free_left ?? Math.max(0, total - Number(billing.free_used || 0)))

  const resetTs = Date.parse(billing.reset_at || '')
  if (resetTs && nowTs >= resetTs) {
    left = total
  }

  return `беспл.: ${left} из ${total}`
}

export default function Header() {
  const nav = useNavigate()
  const loc = useLocation()

  const [authOpen, setAuthOpen] = useState(false)
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('user')
    return u ? JSON.parse(u) : null
  })
  const [billing, setBilling] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const redirectRef = useRef(null)

  const refreshBilling = useCallback(async () => {
    if (!localStorage.getItem('access')) {
      setBilling(null)
      return null
    }
    try {
      const st = await AuthAPI.getBillingStatus()
      setBilling(st || null)
      return st || null
    } catch {
      return null
    }
  }, [])

  // Открываем авторизацию, если попали на защищённый роут
  useEffect(() => {
    const need = loc.state && loc.state.redirectTo
    const authed = !!localStorage.getItem('access')
    if (need && !authed) {
      redirectRef.current = loc.state.redirectTo
      setAuthOpen(true)
      nav('.', { replace: true, state: null })
    }
  }, [loc.state, nav])

  // Восстановление профиля
  useEffect(() => {
    const t = localStorage.getItem('access')
    if (t && !user) {
      AuthAPI.me().then(u => setUser(u)).catch(() => {})
    }
  }, [user])

  // Слушаем обновление пользователя
  useEffect(() => {
    const h = async (e) => {
      const nextUser = e.detail || null
      setUser(nextUser)
      if (nextUser && localStorage.getItem('access')) {
        try { await refreshBilling() } catch {}
      } else {
        setBilling(null)
      }
    }
    window.addEventListener('user:update', h)
    return () => window.removeEventListener('user:update', h)
  }, [refreshBilling])

  // Слушаем обновление биллинга
  useEffect(() => {
    const h = (e) => {
      setBilling(e.detail || null)
    }
    window.addEventListener('billing:update', h)
    return () => window.removeEventListener('billing:update', h)
  }, [])

  // Первичная загрузка тарифа
  useEffect(() => {
    if (user && localStorage.getItem('access')) {
      refreshBilling().catch(() => {})
    } else {
      setBilling(null)
    }
  }, [user, refreshBilling])

  // Периодический авто-рефреш тарифа
  useEffect(() => {
    if (!user || !localStorage.getItem('access')) return
    const id = setInterval(() => {
      refreshBilling().catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [user, refreshBilling])

  // Локальный "тик", чтобы бейдж сам переоценивался по времени без перезагрузки
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { setMenuOpen(false) }, [loc.pathname])
  useEffect(() => { document.body.style.overflow = menuOpen ? 'hidden' : '' }, [menuOpen])

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const goToSection = (id) => (e) => {
    e.preventDefault()
    if (loc.pathname !== '/') nav('/', { state: { scrollTo: id } })
    else scrollTo(id)
  }

  const closeAndNav = (to) => () => { setMenuOpen(false); nav(to) }

  const logout = () => {
    AuthAPI.logout()
    setUser(null)
    setBilling(null)
    if (loc.pathname.startsWith('/profile') || loc.pathname.startsWith('/editor')) {
      nav('/', { replace: true })
    }
  }

  const label = (user?.username && user.username.trim())
    ? user.username.trim()
    : (user?.email || 'Профиль')

  const avatarSrc = user?.avatar_url || avatarDefault

  const tariffBadge = useMemo(() => buildPlanBadge(billing, clock), [billing, clock])

  const onAuthSuccess = (u) => {
    setUser(u)
    const to = redirectRef.current
    redirectRef.current = null
    if (to) {
      nav(to, { replace: true })
    } else {
      setAuthOpen(false)
    }
  }

  return (
    <header className="site-header" id="top">
      <div className="container header-inner">
        <a className="logo-wrap" href="/" onClick={(e) => { e.preventDefault(); setMenuOpen(false); nav('/') }}>
          <img src={logo} alt="" /><span>СКАННИ.РФ</span>
        </a>

        <nav className={`nav ${menuOpen ? 'open' : ''}`}>
          <button className="nav-close" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}>✕</button>

          <Link to="/editor" onClick={closeAndNav('/editor')}>
            Начать работу
          </Link>

          <a href="#how-it-works" onClick={goToSection('how-it-works')}>Простой процесс</a>
          <a href="#examples" onClick={goToSection('examples')}>Какой результат</a>
          <a href="#pricing" onClick={goToSection('pricing')}>Цены</a>
          <Link to="/calculators" onClick={closeAndNav('/calculators')}>Калькуляторы</Link>
          <Link to="/help" onClick={closeAndNav('/help')}>Помощь</Link>
        </nav>

        {menuOpen && <div className="nav-dim show" onClick={() => setMenuOpen(false)} />}

        <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="burger-btn" aria-label="Меню" onClick={() => setMenuOpen(s => !s)} title="Меню">
            <img src={burgerIcon} alt="" />
          </button>

          {!user ? (
            <button className="link-btn" onClick={() => setAuthOpen(true)}>Вход</button>
          ) : (
            <div className="user-box">
              <button className="user-chip accent" onClick={() => { setMenuOpen(false); nav('/profile') }} title="Личный кабинет">
                <div className="chip-avatar"><img alt="" src={avatarSrc} /></div>
                <div className="chip-meta">
                  <div className="chip-label accent">{label}</div>
                  {tariffBadge ? <div className="chip-plan-badge">{tariffBadge}</div> : null}
                </div>
              </button>
              <button className="icon-btn" onClick={logout} title="Выход">
                <img src={logoutIcon} alt="Выход" />
              </button>
            </div>
          )}
        </div>
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={onAuthSuccess} />
    </header>
  )
}
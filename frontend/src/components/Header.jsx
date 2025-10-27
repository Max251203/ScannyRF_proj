import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/images/logo-round.png'
import AuthModal from './AuthModal.jsx'
import { AuthAPI } from '../api'
import logoutIcon from '../assets/icons/logout.png'
import avatarDefault from '../assets/images/avatar-default.png'
import burgerIcon from '../assets/icons/burger.png'

export default function Header() {
  const nav = useNavigate()
  const loc = useLocation()

  const [authOpen, setAuthOpen] = useState(false)
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const redirectRef = useRef(null)

  // Открываем авторизацию, если попали с RequireAuth
  useEffect(() => {
    const need = loc.state && loc.state.redirectTo
    const authed = !!localStorage.getItem('access')
    if (need && !authed) {
      redirectRef.current = loc.state.redirectTo
      setAuthOpen(true)
      nav('.', { replace: true, state: null })
    }
  }, [loc.state, nav])

  // Восстановление профиля при наличии access
  useEffect(() => {
    const t = localStorage.getItem('access')
    if (t && !user) {
      AuthAPI.me().then(u => setUser(u)).catch(()=>{})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Слушаем обновления профиля
  useEffect(() => {
    const h = (e) => setUser(e.detail)
    window.addEventListener('user:update', h)
    return () => window.removeEventListener('user:update', h)
  }, [])

  useEffect(() => { setMenuOpen(false) }, [loc.pathname])
  useEffect(() => { document.body.style.overflow = menuOpen ? 'hidden' : '' }, [menuOpen])

  const scrollTo = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const goToSection = (id) => (e) => {
    e.preventDefault()
    if (loc.pathname !== '/') nav('/', { state: { scrollTo: id } })
    else scrollTo(id)
  }

  const closeAndNav = (to) => () => { setMenuOpen(false); nav(to) }

  const logout = () => {
    AuthAPI.logout()
    setUser(null)
    // Если выходим на странице редактора или профиля — уходим на главную
    if (loc.pathname.startsWith('/profile') || loc.pathname.startsWith('/editor')) {
      nav('/', { replace: true })
    }
  }

  const label = (user?.username && user.username.trim()) ? user.username.trim() : (user?.email || 'Профиль')
  const avatarSrc = user?.avatar_url || avatarDefault

  const onAuthSuccess = (u) => {
    setUser(u)
    const to = redirectRef.current || '/editor'
    redirectRef.current = null
    nav(to, { replace: true })
  }

  return (
    <header className="site-header" id="top">
      <div className="container header-inner">
        <a className="logo-wrap" href="/#/" onClick={(e)=>{e.preventDefault(); setMenuOpen(false); nav('/') }}>
          <img src={logo} alt="" /><span>СКАННИ.РФ</span>
        </a>

        <nav className={`nav ${menuOpen?'open':''}`}>
          <button className="nav-close" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}>✕</button>
          <a href="#how-it-works" onClick={goToSection('how-it-works')}>Простой процесс</a>
          <a href="#examples" onClick={goToSection('examples')}>Какой результат</a>
          <a href="#pricing" onClick={goToSection('pricing')}>Цены</a>
          <Link to="/calculators" onClick={closeAndNav('/calculators')}>Калькуляторы</Link>
          <Link to="/help" onClick={closeAndNav('/help')}>Помощь</Link>
        </nav>

        {menuOpen && <div className="nav-dim show" onClick={()=>setMenuOpen(false)} />}

        <div className="actions" style={{display:'flex',alignItems:'center',gap:10}}>
          <button className="burger-btn" aria-label="Меню" onClick={()=>setMenuOpen(s=>!s)} title="Меню">
            <img src={burgerIcon} alt="" />
          </button>

          {!user ? (
            <button className="link-btn" onClick={()=>setAuthOpen(true)}>Вход</button>
          ) : (
            <div className="user-box">
              <button className="user-chip accent" onClick={()=>{ setMenuOpen(false); nav('/profile') }} title="Личный кабинет">
                <div className="chip-avatar"><img alt="" src={avatarSrc}/></div>
                <div className="chip-label accent">{label}</div>
              </button>
              <button className="icon-btn" onClick={logout} title="Выход">
                <img src={logoutIcon} alt="Выход"/>
              </button>
            </div>
          )}
        </div>
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={onAuthSuccess} />
    </header>
  )
}
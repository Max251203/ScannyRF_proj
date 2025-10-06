import { Link, useLocation, useNavigate } from 'react-router-dom'

export default function Footer() {
  const nav = useNavigate()
  const loc = useLocation()

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const goToSection = (id) => (e) => {
    e.preventDefault()
    if (loc.pathname !== '/') nav('/', { state: { scrollTo: id } })
    else scrollTo(id)
  }

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="brand-title">Сканни.рф</div>
            <div className="brand-sub">Идеальный результат без лишних движений.</div>
          </div>

          <nav className="footer-nav">
            <a href="#how-it-works" onClick={goToSection('how-it-works')}>Простой процесс</a>
            <a href="#examples" onClick={goToSection('examples')}>Какой результат</a>
            <a href="#pricing" onClick={goToSection('pricing')}>Цены</a>
            <Link to="/calculators">Калькуляторы</Link>
            <Link to="/help">Помощь</Link>
            <Link to="/terms">Условия пользования</Link>
            <Link to="/privacy">Политика конфиденциальности</Link>
          </nav>
        </div>

        <div className="copy">© Сканни.рф, 2025</div>
      </div>
    </footer>
  )
}
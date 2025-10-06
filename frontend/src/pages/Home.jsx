import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import heroImg from '../assets/images/hero-mascot.png'
import HowItWorks from '../sections/HowItWorks.jsx'
import Examples from '../sections/Examples.jsx'
import Pricing from '../sections/Pricing.jsx'
import f1 from '../assets/images/feature-1.png'
import f2 from '../assets/images/feature-2.png'
import f3 from '../assets/images/feature-3.png'
import p1 from '../assets/images/pocket-1.png'
import p2 from '../assets/images/pocket-2.png'
import p3 from '../assets/images/pocket-3.png'

export default function Home() {
  const loc = useLocation()
  const nav = useNavigate()
  const [activePocket, setActivePocket] = useState(0)

  useEffect(() => {
    const id = loc.state && loc.state.scrollTo
    if (id) {
      setTimeout(() => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        nav('.', { replace: true, state: null })
      }, 0)
    }
  }, [loc.state, nav])

  const pocketData = [
    { title: 'Телефон, планшет, компьютер — без разницы', desc: 'Открой в браузере и работай с документами: подписи и печати доступны отовсюду.', img: p1 },
    { title: 'Надёжное хранилище печатей', desc: 'Загрузите один раз — дальше всё хранится безопасно и открывается в любое время.', img: p2 },
    { title: 'Не храним ваши документы', desc: 'Для безопасности удаляем любой подписанный документ через 24 часа — без следов.', img: p3 },
  ]

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-text">
            <h1>Подпиши и поставь печать на любой документ мгновенно</h1>
            <p>Никаких принтеров, сложных программ и ожидания. Доступно бесплатно</p>
            <a className="btn" href="/#/editor" onClick={(e) => e.preventDefault() || (location.hash = '#/editor')}>Добавить документ</a>
          </div>
          <div className="art">
            <img src={heroImg} alt="Сканни маскот" />
          </div>
        </div>
      </section>

      <HowItWorks />
      <Examples />

      <section className="section features">
        <div className="container">
          <h2>Проще простого</h2>
          <div className="features-row">
            <div className="feature"><img className="feature-pic" src={f1} alt="" /><h3>Чистая подпись и печать</h3><p className="lead">Загрузи снимок с телефона, а сервис аккуратно удалит фон без потери качества и оттенков.</p></div>
            <div className="feature"><img className="feature-pic" src={f2} alt="" /><h3>Пропорции под контролем</h3><p className="lead">Печать автоматически принимает стандартный диаметр, подпись — регулируй и вращай в пару кликов.</p></div>
            <div className="feature"><img className="feature-pic" src={f3} alt="" /><h3>Собери всё в один файл</h3><p className="lead">Подойдут DOCX, JPG/PNG и PDF. Переставляй, удаляй, добавляй — потом скачай одним PDF.</p></div>
          </div>
        </div>
      </section>

      <section className="section pocket">
        <div className="container pocket-grid">
          <div className="pocket-list">
            <h2>Все подписи и печати — всегда под рукой</h2>
            <ul className="num-list">
              {pocketData.map((it, i) => (
                <li key={i} className={i === activePocket ? 'active' : ''}>
                  <button className="num-item" onClick={() => setActivePocket(i)}>
                    <span className="badge-num">{i + 1}</span>
                    <span className="title">{it.title}</span>
                  </button>
                  <div className="num-desc" aria-hidden={i !== activePocket}>
                    {it.desc}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="pocket-illu">
            <img key={activePocket} className="fade-in" src={pocketData[activePocket].img} alt="" />
          </div>
        </div>
      </section>

      <Pricing />
    </>
  )
}
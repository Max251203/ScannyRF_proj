import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthAPI } from '../api'

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('ru-RU')
}

export default function Pricing() {
  const [prices, setPrices] = useState({ single: 99, month: 399, year: 3999 })

  useEffect(() => {
    let cancelled = false

    // 1) Инициализируем цены публичным запросом (для всех)
    AuthAPI.getPublicPrices()
      .then(p => { if (!cancelled) setPrices(p) })
      .catch(() => {})

    // 2) Если пользователь авторизован и где-то меняются цены админом,
    //    бэкенд вернёт новые значения в /billing/status/ и мы получим их
    //    через единое событие billing:update
    const onBill = (e) => {
      const st = e.detail || {}
      if ('price_single' in st) {
        setPrices({
          single: Number(st.price_single || 0),
          month: Number(st.price_month || 0),
          year: Number(st.price_year || 0),
        })
      }
    }
    window.addEventListener('billing:update', onBill)

    return () => {
      cancelled = true
      window.removeEventListener('billing:update', onBill)
    }
  }, [])

  return (
    <section className="section pricing" id="pricing">
      <div className="container">
        <h2>Гибко и выгодно</h2>
        <p className="lead">Начни с бесплатного тарифа, а дальше выбирай: поштучно или безлимит — в любой момент.</p>
        <div className="price-grid">
          <div className="card price">
            <img className="price-pic" src={plan1} alt="" />
            <div className="title">Один документ</div>
            <div className="val">{fmt(prices.single)} ₽</div>
            <div className="price-actions"><Link className="btn btn-lite" to="/editor">Попробовать</Link></div>
          </div>
          <div className="card price">
            <img className="price-pic" src={plan2} alt="" />
            <div className="title">Без ограничений</div>
            <div className="val">{fmt(prices.month)} ₽/мес</div>
            <div className="price-actions"><Link className="btn btn-lite" to="/editor">Попробовать</Link></div>
          </div>
          <div className="card price">
            <img className="price-pic" src={plan3} alt="" />
            <div className="title">Без ограничений PRO</div>
            <div className="val">{fmt(prices.year)} ₽/год</div>
            <div className="price-actions"><Link className="btn btn-lite" to="/editor">Попробовать</Link></div>
          </div>
        </div>
      </div>
    </section>
  )
}
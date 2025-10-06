import { Link } from 'react-router-dom'
import plan1 from '../assets/images/plan-1.png'
import plan2 from '../assets/images/plan-2.png'
import plan3 from '../assets/images/plan-3.png'

export default function Pricing() {
  return (
    <section className="section pricing" id="pricing">
      <div className="container">
        <h2>Гибко и выгодно</h2>
        <p className="lead">Начни с бесплатного тарифа, а дальше выбирай: поштучно или безлимит — в любой момент.</p>
        <div className="price-grid">
          <div className="card price">
            <img className="price-pic" src={plan1} alt="" />
            <div className="title">Один документ</div>
            <div className="val">99 ₽</div>
            <div className="price-actions">
              <Link className="btn btn-lite" to="/editor">Попробовать</Link>
            </div>
          </div>
          <div className="card price">
            <img className="price-pic" src={plan2} alt="" />
            <div className="title">Без ограничений</div>
            <div className="val">199 ₽/мес</div>
            <div className="price-actions">
              <Link className="btn btn-lite" to="/editor">Попробовать</Link>
            </div>
          </div>
          <div className="card price">
            <img className="price-pic" src={plan3} alt="" />
            <div className="title">Без ограничений PRO</div>
            <div className="val">1999 ₽/год</div>
            <div className="price-actions">
              <Link className="btn btn-lite" to="/editor">Попробовать</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
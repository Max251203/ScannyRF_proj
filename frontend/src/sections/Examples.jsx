import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import d1 from '../assets/images/doc-1.png'
import d2 from '../assets/images/doc-2.png'
import d3 from '../assets/images/doc-3.png'
import d4 from '../assets/images/doc-4.png'
import d5 from '../assets/images/doc-5.png'
import d6 from '../assets/images/doc-6.png'

const DOCS = [
  { id: 0, title: 'Счёт',          img: d1 },
  { id: 1, title: 'Акт',           img: d2 },
  { id: 2, title: 'Договор',       img: d3 },
  { id: 3, title: 'Накладная',     img: d4 },
  { id: 4, title: 'Справка',       img: d5 },
  { id: 5, title: 'Счёт‑фактура',  img: d6 },
]

// скорость как в текущем варианте
const AUTO_SPEED_DEG_PER_SEC = 10
const TURN_SPEED = 90
const TURN_SPEED_FAST = 160

// базовые размеры (десктоп), далее масштабируем относительно .ellipse-inner
const BASE_CARD_W = 240
const BASE_CARD_H = 160
const BASE_RADIUS  = 300
const BASE_WRAP_W  = 1100

function shortestDelta(fromDeg, toDeg) {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180
}

export default function Examples() {
  const [spin, setSpin] = useState(0)
  const [auto, setAuto] = useState(true)
  const [viewer, setViewer] = useState(null)
  const [viewerKey, setViewerKey] = useState(0)

  const [cardW, setCardW] = useState(BASE_CARD_W)
  const [cardH, setCardH] = useState(BASE_CARD_H)
  const [radius, setRadius] = useState(BASE_RADIUS)

  const wrapRef = useRef(null)
  const autoRef = useRef(auto)
  const spinRef = useRef(spin)
  const rafRef = useRef(0)
  const lastRef = useRef(0)

  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { spinRef.current = spin }, [spin])

  // геометрия и вписывание по ширине
  useEffect(() => {
    const recalc = () => {
      const inner = wrapRef.current?.querySelector('.ellipse-inner')
      const w = (inner?.clientWidth || wrapRef.current?.clientWidth || window.innerWidth)

      const sBase = Math.max(0.55, Math.min(1.2, w / BASE_WRAP_W))
      let cw = Math.round(BASE_CARD_W * sBase)
      let ch = Math.round(BASE_CARD_H * sBase)
      let r  = Math.round(BASE_RADIUS  * sBase)

      if (w < 720) r = Math.round(r * 0.9)
      if (w < 560) r = Math.round(r * 0.8)
      if (w < 440) r = Math.round(r * 0.72)

      const margin = Math.max(12, Math.min(32, Math.round(w * 0.035)))
      const avail = w - margin * 2
      const total = cw + 2 * r
      if (total > avail) {
        const shrink = avail / total
        const shrinkCards  = shrink
        const shrinkRadius = Math.min(1, shrink * 0.95)
        cw = Math.max(140, Math.round(cw * shrinkCards))
        ch = Math.max(92,  Math.round(ch * shrinkCards))
        r  = Math.max(90,  Math.round(r  * shrinkRadius))
      }

      setCardW(cw)
      setCardH(ch)
      setRadius(r)
    }

    recalc()
    const ro = new ResizeObserver(recalc)
    if (wrapRef.current) ro.observe(wrapRef.current)
    const onRes = () => recalc()
    window.addEventListener('resize', onRes)
    return () => { try { ro.disconnect() } catch {} window.removeEventListener('resize', onRes) }
  }, [])

  // автоповорот
  useEffect(() => {
    const tick = (t) => {
      if (!lastRef.current) lastRef.current = t
      const dt = (t - lastRef.current) / 1000
      lastRef.current = t
      if (autoRef.current && viewer === null) setSpin(s => s + AUTO_SPEED_DEG_PER_SEC * dt)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [viewer])

  // блокируем прокрутку страницы, пока открыт просмотрщик
  useEffect(() => {
    if (viewer === null) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    const prevent = (e) => { e.preventDefault() }
    window.addEventListener('wheel', prevent, { passive:false })
    window.addEventListener('touchmove', prevent, { passive:false })
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
      window.removeEventListener('wheel', prevent)
      window.removeEventListener('touchmove', prevent)
    }
  }, [viewer])

  const step = useMemo(() => 360 / DOCS.length, [])

  const animateTo = (target, onDone, fast=false) => {
    const startAngle = spinRef.current
    const distAbs = Math.abs(target - startAngle)
    const speed = fast ? TURN_SPEED_FAST : TURN_SPEED
    const ease = (p)=>1-Math.pow(1-p,2.6)
    let start=0
    const frame=(t)=>{
      if(!start) start=t
      const p = Math.min(1, (t-start)/(distAbs/speed*1000 || 1))
      const ang = startAngle + (target-startAngle)*ease(p)
      setSpin(ang)
      if(p<1) requestAnimationFrame(frame); else { setSpin(target); onDone && onDone() }
    }
    requestAnimationFrame(frame)
  }

  const rotateToIndexNearest = (i, cb, fast=false) => {
    setAuto(false)
    const cur = spinRef.current
    const nominal = -i*step
    const d = shortestDelta(cur, nominal)
    const target = cur + d
    animateTo(target, cb, fast)
  }

  const openViewer = (i) => {
    rotateToIndexNearest(i, () => { setViewer(i); setViewerKey(k=>k+1) }, true)
  }
  const closeViewer = () => { setViewer(null); setAuto(true) }
  const prev = () => setViewer(i => { const n=(i-1+DOCS.length)%DOCS.length; rotateToIndexNearest(n, ()=>{setViewer(n);setViewerKey(k=>k+1)}, true); return i })
  const next = () => setViewer(i => { const n=(i+1)%DOCS.length; rotateToIndexNearest(n, ()=>{setViewer(n);setViewerKey(k=>k+1)}, true); return i })

  return (
    <section className="section examples" id="examples">
      <div className="container" ref={wrapRef}>
        <div className="ellipse">
          <div className="ellipse-inner">
            <h3 className="ellipse-title">Просто подпиши документ на Сканни.рф</h3>
            <p className="ellipse-sub">Документы из сервиса выглядят как настоящие сканы с печатью и подписью. Загляни в примеры и убедись сам.</p>
            <div className="ellipse-cta">
              <Link to="/editor" className="btn btn-white">Добавить документ</Link>
            </div>

            <div className="carousel3d" style={{ overflow:'visible' }}>
              <div className="stage" style={{ width: cardW, height: cardH }}>
                {DOCS.map((d, i) => {
                  const angle = i * step + spin
                  return (
                    <button
                      key={d.id}
                      className="card3d"
                      style={{ width: cardW, height: cardH, transform:`rotateY(${angle}deg) translateZ(${radius}px) rotateY(${-angle}deg)` }}
                      onClick={() => openViewer(i)}
                      title={d.title}
                    >
                      <div className="doc-mini">
                        <div className="doc-title">{d.title}</div>
                        <img className="doc-img" src={d.img} alt="" />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {viewer !== null && (
        <div className="viewer" role="dialog" aria-modal="true">
          <button className="viewer-close" onClick={closeViewer} aria-label="Закрыть">×</button>
          <button className="viewer-nav prev" onClick={prev} aria-label="Предыдущий" style={{ zIndex:1001 }}>‹</button>
          <div key={viewerKey} className="viewer-card pop-in" style={{ zIndex:1000 }}>
            <div className="doc-full">
              <div className="doc-title">{DOCS[viewer].title}</div>
              <img className="doc-img" src={DOCS[viewer].img} alt="" />
            </div>
          </div>
          <button className="viewer-nav next" onClick={next} aria-label="Следующий" style={{ zIndex:1001 }}>›</button>
        </div>
      )}
    </section>
  )
}
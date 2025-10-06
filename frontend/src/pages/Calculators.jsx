import { useEffect, useState } from 'react'
import tile from '../assets/images/tile.png'
import { AuthAPI } from '../api'

export default function Calculators() {
  const [selected, setSelected] = useState(null) // 'nds' | 'peni' | null

  const selectCalc = (key) => {
    setSelected(key)
    setTimeout(() => {
      const el = document.getElementById(key)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  return (
    <div className="calc-page">
      <div className="container">
        <h1 className="page-title">Калькуляторы</h1>

        <div className="calc-tiles">
          <button className="tile" onClick={() => selectCalc('nds')}>
            <img src={tile} alt="" />
            <span>Калькулятор НДС</span>
          </button>
          <button className="tile" onClick={() => selectCalc('peni')}>
            <img src={tile} alt="" />
            <span>Калькулятор пеней</span>
          </button>
        </div>
      </div>

      {selected === 'nds' && (
        <section className="section" id="nds">
          <div className="container">
            <h2 className="calc-title">Калькулятор НДС</h2>
            <NdsCalculator />
            <NdsDoc />
          </div>
        </section>
      )}

      {selected === 'peni' && (
        <section className="section" id="peni">
          <div className="container">
            <h2 className="calc-title">Калькулятор пеней</h2>
            <PeniCalculator />
            <PeniDoc />
          </div>
        </section>
      )}
    </div>
  )
}

/* ===================== Калькулятор НДС ===================== */

function NdsCalculator(){
  const [mode, setMode] = useState('add')        // add = Начислить НДС, extract = Выделить НДС
  const [rate, setRate] = useState(20)           // 20/10/7/5
  const [rub, setRub] = useState('')
  const [kop, setKop] = useState('')
  const [res, setRes] = useState(null)

  const calc = () => {
    const amount = parseAmount(rub, kop)
    const r = Number(rate)
    let net=0, gross=0, vat=0

    if (mode === 'add') {
      net   = round2(amount)
      gross = round2(amount * (100 + r) / 100)
      vat   = round2(gross - net)
    } else {
      gross = round2(amount)
      vat   = round2(gross * r / (100 + r))
      net   = round2(gross - vat)
    }
    setRes({
      net, gross, vat,
      wordsVat: rublesToWords(vat),
      wordsNet: rublesToWords(net),
      wordsGross: rublesToWords(gross)
    })
  }

  return (
    <div className="calc-box">
      <p className="hint">Наш калькулятор НДС помогает быстро и точно рассчитывать налог на добавленную стоимость для любых сумм.</p>
      <hr />
      <form className="calc-form" onSubmit={(e)=>{e.preventDefault(); calc()}}>
        <div className="row">
          <div className="col">
            <div className="group-title">Выберите действие:</div>
            <label><input type="radio" name="nds-mode" checked={mode==='add'} onChange={()=>setMode('add')} /> Начислить НДС</label>
            <label><input type="radio" name="nds-mode" checked={mode==='extract'} onChange={()=>setMode('extract')} /> Выделить НДС</label>
          </div>

          <div className="col">
            <div className="group-title">Цена</div>
            <div className="money">
              <input type="text" inputMode="numeric" placeholder="руб."
                     value={rub} onChange={(e)=>setRub(e.target.value.replace(/[^\d]/g,''))}/>
              <input type="text" inputMode="numeric" placeholder="коп."
                     value={kop} onChange={(e)=>setKop(limitKop(e.target.value))}/>
            </div>
          </div>

          <div className="col" style={{flexBasis:'100%'}}>
            <div className="group-title">Ставка НДС:</div>
            <label><input type="radio" name="nds-rate" checked={rate===20} onChange={()=>setRate(20)} /> 20% <span className="lead">(основная ставка для большинства товаров и услуг)</span></label>
            <label><input type="radio" name="nds-rate" checked={rate===10} onChange={()=>setRate(10)} /> 10% <span className="lead">(пониженная ставка для некоторых социально значимых категорий)</span></label>
            <label><input type="radio" name="nds-rate" checked={rate===7}  onChange={()=>setRate(7)}  /> 7%  <span className="lead">(для УСН с доходами 250–450 млн руб.)</span></label>
            <label><input type="radio" name="nds-rate" checked={rate===5}  onChange={()=>setRate(5)}  /> 5%  <span className="lead">(для УСН с доходами 60–250 млн руб.)</span></label>
          </div>
        </div>

        <div className="submit">
          <button type="submit" className="btn" onClick={(e)=>{e.preventDefault(); calc()}}>ВЫЧИСЛИТЬ</button>
        </div>
      </form>

      {res && (
        <>
          <hr className="nds-sep" />
          <div className="nds-result">
            <div className="nds-row">
              <div className="nds-label">Сумма без НДС</div>
              <div className="nds-val">{fmt(res.net)} <span className="rur">₽</span></div>
              <div className="nds-words">{res.wordsNet}</div>
            </div>

            <div className="nds-row">
              <div className="nds-label">НДС {rate}%</div>
              <div className="nds-val">{fmt(res.vat)} <span className="rur">₽</span></div>
              <div className="nds-words">{res.wordsVat}</div>
            </div>

            <div className="nds-row">
              <div className="nds-label">Всего</div>
              <div className="nds-val">{fmt(res.gross)} <span className="rur">₽</span></div>
              <div className="nds-words">{res.wordsGross}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NdsDoc(){
  return (
    <div className="calc-doc">
      <h3>Как пользоваться онлайн-калькулятором НДС</h3>
      <p>Онлайн-калькулятор НДС — удобный инструмент, который поможет быстро рассчитать сумму налога.</p>
      <p>Чтобы произвести расчет:</p>
      <ul>
        <li>Выберите ставку НДС — 20%, 10%, 7% или 5%.</li>
        <li>Выберите, что нужно рассчитать — выделить НДС или начислить НДС.</li>
        <li>Укажите стоимость товара / услуги — введите сумму в поле «Цена».</li>
        <li>Получите результат расчета в числовом виде и прописью.</li>
      </ul>
      <h3>Расчет НДС</h3>
      <p>Рассчитать НДС можно с помощью нашего онлайн-калькулятора или применив специальные формулы.</p>
      <h4>Как выделить НДС из суммы</h4>
      <p><b>НДС = Сумма × Ставка НДС / (Ставка НДС + 100)</b></p>
      <h4>Как начислить НДС</h4>
      <p><b>Сумма с НДС = Сумма × (Ставка НДС + 100) / 100</b></p>
    </div>
  )
}

/* ===================== Калькулятор пеней ===================== */

function PeniCalculator(){
  const [mode, setMode] = useState('tax')    // 'tax' | 'salary' | 'utilities'
  const [entity, setEntity] = useState('org')// 'org' | 'person' (для режима tax)
  const [rub, setRub] = useState('')
  const [kop, setKop] = useState('')
  const [due, setDue] = useState('')         // YYYY-MM-DD
  const [pay, setPay] = useState('')
  const [keyRate, setKeyRate] = useState(16)
  const [rateDate, setRateDate] = useState('')
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    // берем с backend, чтобы не упираться в CORS
    fetch(AuthAPI.getApiBase() + '/utils/key-rate/')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j && (j.keyRate || j.key_rate)) {
          const k = Number(j.keyRate ?? j.key_rate)
          setKeyRate(isNaN(k) ? 16 : k)
          setRateDate(j.date || j.updated_at || '')
        }
      })
      .catch(()=>{})
  }, [])

  const calc = () => {
    setErr('')
    const amount = parseAmount(rub, kop)
    if (!amount || !due || !pay) { setRows(null); setTotal(null); return }

    const dueDt = parseYmd(due)
    const payDt = parseYmd(pay)

    if (payDt < dueDt) {
      setRows(null)
      setTotal(null)
      setErr('Срок оплаты не может быть меньше установленного')
      return
    }

    if (payDt.getTime() === dueDt.getTime()) {
      // 0 дней просрочки — показываем таблицу с итогами 0
      setRows([])
      setTotal({ days: 0, peni: 0, rateDate })
      return
    }

    const start = addDays(dueDt, 1) // со дня, следующего за сроком уплаты
    const end   = payDt             // по день уплаты включительно

    const days = daysInclusive(start, end)
    const rate = Number(keyRate) // %
    const list = []

    if (mode === 'tax') {
      if (entity === 'person') {
        list.push(segment(start, end, days, rate, '1/300', 300, amount))
      } else {
        const split = Math.min(days, 30)
        const s1e = addDays(start, split - 1)
        list.push(segment(start, s1e, split, rate, '1/300', 300, amount))
        if (days > 30) {
          const s2s = addDays(s1e, 1)
          const s2d = days - 30
          const s2e = addDays(s2s, s2d - 1)
          list.push(segment(s2s, s2e, s2d, rate, '1/150', 150, amount))
        }
      }
    } else if (mode === 'salary') {
      list.push(segment(start, end, days, rate, '1/150', 150, amount))
    } else {
      // ЖКУ: 1-30 — 0; 31-90 — 1/300; 91+ — 1/130
      if (days <= 30) {
        list.push(segment(start, end, days, rate, '0', 0, amount))
      } else if (days <= 90) {
        const s1e = addDays(start, 30 - 1)
        list.push(segment(start, s1e, 30, rate, '0', 0, amount))
        const s2s = addDays(s1e, 1)
        const s2d = days - 30
        const s2e = addDays(s2s, s2d - 1)
        list.push(segment(s2s, s2e, s2d, rate, '1/300', 300, amount))
      } else {
        const s1e = addDays(start, 30 - 1)
        list.push(segment(start, s1e, 30, rate, '0', 0, amount))
        const s2s = addDays(s1e, 1)
        const s2e = addDays(s2s, 60 - 1)
        list.push(segment(s2s, s2e, 60, rate, '1/300', 300, amount))
        const s3s = addDays(s2e, 1)
        const s3d = days - 90
        const s3e = addDays(s3s, s3d - 1)
        list.push(segment(s3s, s3e, s3d, rate, '1/130', 130, amount))
      }
    }

    const totalDays = list.reduce((s,r)=>s+r.days,0)
    const totalPeni = round2(list.reduce((s,r)=>s+r.sum,0))
    setRows(list)
    setTotal({ days: totalDays, peni: totalPeni, rateDate })
  }

  return (
    <div className="calc-box">
      <p className="hint">Калькулятор позволяет рассчитать пени по налогам (сборам, взносам), по невыплаченной вовремя заработной плате и пени за несвоевременную оплату коммунальных услуг.</p>
      <hr />

      <form className="calc-form" onSubmit={(e)=>{e.preventDefault(); calc()}}>
        <div className="row">
          <div className="col">
            <div className="group-title">Выберите тип налога / взноса:</div>
            <select value={mode} onChange={e=>setMode(e.target.value)}>
              <option value="tax">Расчёт пени по налогам, сборам и страховым взносам</option>
              <option value="salary">Расчёт компенсации за несвоевременную выплату заработной платы</option>
              <option value="utilities">Расчёт пени за несвоевременную оплату коммунальных услуг</option>
            </select>

            {mode === 'tax' && (
              <>
                <div className="group-title" style={{marginTop:12}}>Выберите тип лица:</div>
                <label><input type="radio" name="peni-entity" checked={entity==='org'} onChange={()=>setEntity('org')} /> Юридическое лицо</label>
                <label><input type="radio" name="peni-entity" checked={entity==='person'} onChange={()=>setEntity('person')} /> Физическое лицо</label>
              </>
            )}
          </div>

          <div className="col">
            <div className="group-title">Сумма задолженности</div>
            <div className="money">
              <input type="text" inputMode="numeric" placeholder="руб."
                     value={rub} onChange={(e)=>setRub(e.target.value.replace(/[^\d]/g,''))}/>
              <input type="text" inputMode="numeric" placeholder="коп."
                     value={kop} onChange={(e)=>setKop(limitKop(e.target.value))}/>
            </div>
          </div>

          <div className="col">
            <div className="group-title">Установленный срок уплаты:</div>
            <input type="date" value={due} onChange={e=>setDue(e.target.value)} />
          </div>
          <div className="col">
            <div className="group-title">Дата погашения задолженности:</div>
            <input type="date" value={pay} onChange={e=>setPay(e.target.value)} />
          </div>
        </div>

        <div className="submit">
          <button type="submit" className="btn" onClick={(e)=>{e.preventDefault(); calc()}}>ВЫЧИСЛИТЬ</button>
          {err && <div className="form-error">{err}</div>}
        </div>
      </form>

      {rows !== null && total && (
        <>
          <hr />
          <div className="calc-table">
            <table>
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Количество календарных дней</th>
                  <th>Ключевая ставка, %</th>
                  <th>Сумма начисленных пеней, ₽</th>
                  <th>Коэффициент ставки за день</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx)=>(
                  <tr key={idx}>
                    <td>{r.period}</td>
                    <td className="t-num">{r.days}</td>
                    <td className="t-num">{r.rate.toFixed(2)}</td>
                    <td className="t-num">{fmt(r.sum)}</td>
                    <td>{r.coeff}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Итого</td>
                  <td className="t-num">{total.days}</td>
                  <td></td>
                  <td className="t-num">{fmt(total.peni)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {total.rateDate && (
            <div className="lead" style={{marginTop:8}}>
              Ставка актуальна на {new Date(total.rateDate).toLocaleDateString('ru-RU')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ===================== Текстовые блоки ===================== */

function PeniDoc(){
  return (
    <div className="calc-doc">
      <h3>Как использовать онлайн-калькулятор пеней</h3>
      <p>Использование калькулятора предельно простое:</p>
      <ul>
        <li>Выберите тип налога / взноса.</li>
        <li>Для налогов/сборов/взносов укажите юридическое или физическое лицо.</li>
        <li>Укажите сумму задолженности.</li>
        <li>Выберите дату, не позднее которой должен был быть уплачен налог.</li>
        <li>Введите дату фактической уплаты налога или дату, на которую необходимо рассчитать пени.</li>
        <li>Нажмите кнопку «Рассчитать» — калькулятор определит дни просрочки и сумму пеней по ключевой ставке ЦБ РФ.</li>
      </ul>

      <h3>Расчет пеней по налогам, сборам и страховым взносам</h3>
      <p>Пени: <b>Сумма × Дни × Ставка ЦБ / 300</b>. Для юрлиц с 31‑го дня: <b>Сумма × 30 × Ставка / 300 + Сумма × (Дни − 30) × Ставка / 150</b>.</p>

      <h3>Расчет пеней по невыплаченной вовремя заработной плате</h3>
      <p><b>Пени = Сумма × Дни × Ставка ЦБ / 150</b></p>

      <h3>Расчет пеней по неуплаченным коммунальным услугам</h3>
      <ul>
        <li>1–30 дней — 0;</li>
        <li>31–90 — 1/300 ключевой ставки;</li>
        <li>91+ — 1/130 ключевой ставки.</li>
      </ul>
    </div>
  )
}

/* ===================== helpers ===================== */

function round2(x){ return Math.round((x + Number.EPSILON)*100)/100 }
function fmt(v){ return (v ?? 0).toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2}) }
function parseAmount(rub, kop){
  const r = parseInt((rub||'').replace(/[^\d]/g,'')) || 0
  let k = parseInt((kop||'').replace(/[^\d]/g,'')) || 0
  if (k>99) k=99
  return r + k/100
}
function limitKop(s){ s = (s||'').replace(/[^\d]/g,''); if(s.length>2) s=s.slice(0,2); return s }

const msDay = 86400000
function parseYmd(s){ const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)) }
function addDays(dt, n){ return new Date(dt.getTime() + n*msDay) }
function daysInclusive(a,b){ return Math.max(0, Math.floor((b - a)/msDay) + 1) }
function ddmmyyyy(dt){
  const d = String(dt.getUTCDate()).padStart(2,'0')
  const m = String(dt.getUTCMonth()+1).padStart(2,'0')
  const y = dt.getUTCFullYear()
  return `${d}.${m}.${y}`
}

function segment(start, end, days, rate, coeffText, denom, amount){
  const sum = denom>0 ? round2(amount * (rate/100) * (days/denom)) : 0
  return {
    period: `${ddmmyyyy(start)} - ${ddmmyyyy(end)}`,
    days,
    rate,
    coeff: coeffText,
    sum
  }
}

/* прописью */
function rublesToWords(amount){
  amount = round2(amount)
  let rub = Math.floor(amount + 1e-9)
  let kop = Math.round((amount - rub)*100)
  if (kop === 100){ rub += 1; kop = 0 }

  const rubWords = intToWords(rub, 'm')
  const kopWords = intToWords(kop, 'f')
  const rubForm = morph(rub, 'рубль','рубля','рублей')
  const kopForm = morph(kop, 'копейка','копейки','копеек')
  const rubPart = (rub===0 ? 'ноль' : rubWords).trim() + ' ' + rubForm
  const kopPart = (kop===0 ? 'ноль' : kopWords).trim() + ' ' + kopForm
  return `${rubPart} ${kopPart}`
}
function morph(n, f1,f2,f5){
  n = Math.abs(n)%100; const n1 = n%10
  if(n>10 && n<20) return f5
  if(n1>1 && n1<5) return f2
  if(n1===1) return f1
  return f5
}
function intToWords(n, gender='m'){
  if (n===0) return ''
  const onesM = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять']
  const onesF = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять']
  const ones = gender==='f' ? onesF : onesM
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать']
  const tens = ['','десять','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто']
  const hund = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот']
  const units = [
    ['','',''],
    ['тысяча','тысячи','тысяч'],
    ['миллион','миллиона','миллионов'],
    ['миллиард','миллиарда','миллиардов'],
  ]
  const parts = []
  let u = 0
  while(n>0){
    const tri = n%1000
    if(tri){
      const triWords = triToWords(tri, u===1?'f':'m', onesM, onesF, tens, teens, hund)
      const unit = units[u]
      const unitWord = u>0 ? ' ' + morph(tri, unit[0],unit[1],unit[2]) : ''
      parts.unshift((triWords + unitWord).trim())
    }
    n = Math.floor(n/1000); u++
  }
  return parts.join(' ').trim()
}
function triToWords(num, genForUnits, onesM, onesF, tens, teens, hund){
  const ones = genForUnits==='f' ? onesF : onesM
  const h = Math.floor(num/100)
  const t = Math.floor((num%100)/10)
  const o = num%10
  const out = []
  if(h) out.push(hund[h])
  if(t>1){ out.push(tens[t]); if(o) out.push(ones[o]) }
  else if(t===1){ out.push(teens[o]) }
  else{ if(o) out.push(ones[o]) }
  return out.join(' ')
}
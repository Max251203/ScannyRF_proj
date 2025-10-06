import img1 from '../assets/images/how-1.png'
import img2 from '../assets/images/how-2.png'
import img3 from '../assets/images/how-3.png'

function StepRow({ n, title, text, img, reverse }) {
  return (
    <div className={`step-row ${reverse ? 'reverse' : ''}`}>
      <div className="step-illu">
        <img src={img} alt="" />
      </div>
      <div className="step-text">
        <div className="badge">{n}</div>
        <h3>{title}</h3>
        <p className="lead">{text}</p>
      </div>
    </div>
  )
}

export default function HowItWorks() {
  return (
    <section className="section how" id="how-it-works">
      <div className="container">
        <h2>Подпись и печать в пару кликов: без принтера, без фотошопа и без лишней суеты.</h2>

        <div className="how-rows">
          <StepRow
            n={1}
            title="Загружай документ"
            text="PDF, Word, Excel, скан или фото — убери лишние страницы и добавь нужные за пару секунд."
            img={img1}
            reverse={false}
          />
          <StepRow
            n={2}
            title="Поставь подпись и печать"
            text="Подойдёт даже снимок с камеры. Загрузи фото — сервис сам очистит фон и сохранит все детали и оттенки."
            img={img2}
            reverse={false}
          />
          <StepRow
            n={3}
            title="Скачай PDF или JPG"
            text="Готово!"
            img={img3}
            reverse={false}
          />
        </div>
      </div>
    </section>
  )
}
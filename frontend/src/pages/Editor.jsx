// frontend/src/pages/Editor.jsx

import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensurePDFJS,
  ensureHtml2Canvas,
  ensureMammothCDN,
  ensureSheetJS,
  ensureJSZip,
  ensureScripts
} from '../utils/scriptLoader'
import { CustomCanvasEngine } from '../utils/customCanvasEngine'
import CropModal from '../components/CropModal.jsx'
import ProgressOverlay from '../components/ProgressOverlay.jsx'

import icMore from '../assets/icons/kebab.png'
import icText from '../assets/icons/text.png'
import icSign from '../assets/icons/sign-upload.png'
import icAddPage from '../assets/icons/page-add.png'
import icRotate from '../assets/icons/rotate.png'
import icDelete from '../assets/icons/delete.png'
import icUndo from '../assets/icons/undo.png'
import icJpgFree from '../assets/icons/dl-jpg-free.png'
import icPdfFree from '../assets/icons/dl-pdf-free.png'
import icJpgPaid from '../assets/icons/dl-jpg-paid.png'
import icPdfPaid from '../assets/icons/dl-pdf-paid.png'
import icDownload from '../assets/icons/download.png'
import icPlus from '../assets/icons/plus.png'
import icPrev from '../assets/icons/prev.png'
import icDocAdd from '../assets/icons/doc-add.svg'
import icLibrary from '../assets/icons/library.png'
import icClose from '../assets/icons/x-close.svg'

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial', 'Times New Roman', 'Ermilov', 'Segoe UI', 'Roboto', 'Georgia']
const PDF_RENDER_SCALE = 3.0
const RASTER_RENDER_SCALE = 3.0

// Линейный коэффициент, совпадает с движком (без дополнительных отступов)
const LH_FACTOR = 1

function randDocId () { return String(Math.floor(1e15 + Math.random() * 9e15)) }
function genDefaultName () {
  const a = Math.floor(Math.random() * 1e6)
  const b = Math.floor(Math.random() * 1e6)
  return `${a}-${b}`
}
function sanitizeName (s) {
  s = (s || '').normalize('NFKC')
  s = s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '')
  return s.slice(0, 64) || genDefaultName()
}
function setDraftHint (flag) {
  try { localStorage.setItem('has_draft', flag ? '1' : '0') } catch {}
}

/**
 * Замер прямоугольника текста через скрытый DOM-элемент.
 * ВАЖНО:
 *  - высоту считаем по количеству строк (учитываем завершающий \n),
 *    чтобы не "терять" пустую последнюю строку;
 *  - ширину берём из реального DOM-замера браузера;
 *  - добавляем минимальные «подушки» по краям, чтобы рамка не подрезала буквы.
 */
function measureTextBoxDom (text, fontFamily, fontSize, fontWeight, fontStyle) {
  const size = fontSize || 48

  // SSR / тесты без DOM — возвращаем приближённые размеры с маленьким запасом
  if (typeof document === 'undefined') {
    const padY = Math.max(2, Math.round(size * 0.1))
    const padX = Math.max(1, Math.round(size * 0.04))
    const baseH = size * LH_FACTOR
    const baseW = size * 2
    return {
      width: baseW + padX * 2,
      height: baseH + padY * 2
    }
  }

  let el = measureTextBoxDom._el
  if (!el) {
    el = document.createElement('div')
    measureTextBoxDom._el = el
    el.style.position = 'fixed'
    el.style.left = '-99999px'
    el.style.top = '-99999px'
    el.style.whiteSpace = 'pre'
    el.style.margin = '0'
    el.style.padding = '0'
    el.style.border = '0'
    el.style.outline = 'none'
    el.style.lineHeight = String(LH_FACTOR)
    el.style.visibility = 'hidden'
    document.body.appendChild(el)
  }

  el.style.fontFamily = fontFamily || 'Arial'
  el.style.fontSize = `${size}px`
  el.style.fontWeight = fontWeight || 'normal'
  el.style.fontStyle = fontStyle || 'normal'
  el.textContent = text || ''

  const rect = el.getBoundingClientRect()

  // Кол-во строк с учётом завершающего перевода строки
  const str = text || ''
  let lines = str.split('\n')
  if (str.endsWith('\n')) {
    lines = [...lines, '']
  }
  const lineCount = Math.max(1, lines.length)

  const baseLineHeight = size * LH_FACTOR
  const baseWidth = rect.width || size * 2
  const logicalHeight = lineCount * baseLineHeight
  const baseHeight = Math.max(rect.height || baseLineHeight, logicalHeight)

  // Небольшие симметричные «подушки», чтобы рамка не подрезала хвосты
  // и последнюю букву справа, но визуально оставалась максимально плотной.
  const padY = Math.max(2, Math.round(size * 0.1))   // ~10% от fontSize, минимум 2px
  const padX = Math.max(1, Math.round(size * 0.04))  // ~4% от fontSize, минимум 1px

  return {
    width: baseWidth + padX * 2,
    height: baseHeight + padY * 2
  }
}

async function ensurePDFLib () {
  if (window.PDFLib) return window.PDFLib
  await ensureScripts(['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'])
  if (!window.PDFLib) throw new Error('Не удалось загрузить pdf-lib')
  return window.PDFLib
}

function isDrawableForExport (img) {
  if (!img) return false
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true
  return false
}

function readAsDataURL (file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}
function loadImageEl (src) {
  return new Promise((res, rej) => {
    if (!src) { rej(new Error('empty src')); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

// Построение стиля HTML-слоя текста (и просмотр, и редактирование)
function buildTextOverlayStyle (rc, ov, canvasEl, editable = false) {
  if (!rc || !ov) return null

  let offX = 0
  let offY = 0
  if (canvasEl) {
    offX = canvasEl.offsetLeft || 0
    offY = canvasEl.offsetTop || 0
  }

  // Округляем к целым пикселям, чтобы текст и каретка не попадали "между пикселями"
  const leftPx = Math.round((rc.cx || 0) + offX)
  const topPx = Math.round((rc.cy || 0) + offY)

  const screenW = Math.max(1, Math.round(Number(rc.w || ov.w || 40)))
  const screenH = Math.max(1, Math.round(Number(rc.h || ov.h || 30)))
  const fontSizePx = Math.max(6, Number(rc.fontSize || ov.data?.fontSize || 48))
  const fontSize = Math.round(fontSizePx)
  const angleDeg = (rc.angleRad || 0) * 180 / Math.PI

  const d = ov.data || {}

  const base = {
    position: 'absolute',
    left: `${leftPx}px`,
    top: `${topPx}px`,
    width: `${screenW}px`,
    height: `${screenH}px`,

    transform: `translate3d(-50%, -50%, 0) rotate(${angleDeg}deg)`,
    transformOrigin: 'center center',
    willChange: 'transform',
    backfaceVisibility: 'hidden',

    fontFamily: d.fontFamily || 'Arial',
    fontSize: `${fontSize}px`,
    fontWeight: d.fontWeight || 'bold',
    fontStyle: d.fontStyle || 'normal',
    color: d.fill || '#000000',

    textAlign: d.textAlign || 'left',

    border: 'none',
    margin: '0',
    padding: '0',
    resize: 'none',
    outline: 'none',
    background: 'transparent',

    lineHeight: String(LH_FACTOR),
    letterSpacing: 'normal',

    whiteSpace: 'pre',
    overflow: 'hidden', // как было у тебя — без лишних скроллов

    display: 'block',
    boxSizing: 'border-box',

    WebkitFontSmoothing: 'antialiased',
    textRendering: 'geometricPrecision'
  }

  if (editable) {
    return {
      ...base,
      caretColor: '#ff1744',
      touchAction: 'none',
      userSelect: 'none',
      pointerEvents: 'auto',
      zIndex: 80
    }
  }

  return {
    ...base,
    caretColor: 'transparent',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: 40
  }
}

async function renderDOCXToCanvas (file) {
  await ensureMammothCDN(); await ensureHtml2Canvas()
  const ab = await file.arrayBuffer()
  const res = await window.mammoth.convertToHtml({ arrayBuffer: ab })
  const holder = document.createElement('div')
  Object.assign(holder.style, {
    position: 'fixed', left: '-9999px', top: '-9999px',
    width: '1100px', padding: '40px', background: '#fff',
    fontSize: '16px', lineHeight: '1.5'
  })
  holder.innerHTML = res.value || '<div/>'
  document.body.appendChild(holder)
  const canvas = await window.html2canvas(holder, {
    backgroundColor: '#fff',
    scale: RASTER_RENDER_SCALE,
    logging: false
  })
  document.body.removeChild(holder)
  return canvas
}
async function renderXLSXToCanvas (file) {
  await ensureSheetJS(); await ensureHtml2Canvas()
  const ab = await file.arrayBuffer()
  const wb = window.XLSX.read(ab, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const html = window.XLSX.utils.sheet_to_html(wb.Sheets[sheetName])
  const holder = document.createElement('div')
  Object.assign(holder.style, {
    position: 'fixed', left: '-9999px', top: '-9999px',
    width: '1200px', padding: '20px', background: '#fff'
  })
  holder.innerHTML = html
  document.body.appendChild(holder)
  const canvas = await window.html2canvas(holder, {
    backgroundColor: '#fff',
    scale: RASTER_RENDER_SCALE,
    logging: false
  })
  document.body.removeChild(holder)
  return canvas
}
function sliceCanvasToPages (canvas) {
  const out = []
  const totalH = canvas.height
  const pagePx = Math.floor(canvas.width * 1.414)
  for (let y = 0; y < totalH; y += pagePx) {
    const sliceH = Math.min(pagePx, totalH - y)
    const tmp = document.createElement('canvas')
    const tctx = tmp.getContext('2d', { willReadFrequently: true })
    tmp.width = canvas.width; tmp.height = sliceH
    try { tctx.textBaseline = 'alphabetic' } catch {}
    tctx.fillStyle = '#fff'
    tctx.fillRect(0, 0, tmp.width, tmp.height)
    tctx.drawImage(canvas, 0, 0, canvas.width, sliceH, 0, 0, tmp.width, tmp.height)
    out.push(tmp.toDataURL('image/png'))
  }
  return out
}
async function renderPDFPageToCanvas (pdf, pageNum, scale) {
  const p = await pdf.getPage(pageNum)
  const vp = p.getViewport({ scale: Math.max(2, scale) })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true })
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  ctx.imageSmoothingEnabled = true
  try { ctx.imageSmoothingQuality = 'high'; ctx.textBaseline = 'alphabetic' } catch {}
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await p.render({ canvasContext: ctx, viewport: vp }).promise
  return canvas
}

function renderPageOffscreen (page, scaleMul = 2) {
  const rot = page.rotation || 0
  const docW = page.docWidth || 1000
  const docH = page.docHeight || 1414

  let pageW, pageH
  if (rot === 0) {
    pageW = docW
    pageH = docH
  } else {
    if (docW > 0) {
      pageH = docH
      pageW = (docH * docH) / docW
    } else {
      pageH = docH
      pageW = docH
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(pageW * scaleMul)
  canvas.height = Math.round(pageH * scaleMul)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.scale(scaleMul, scaleMul)

  const docCx = docW / 2
  const docCy = docH / 2
  const pLeft = docCx - pageW / 2
  const pTop = docCy - pageH / 2
  ctx.translate(-pLeft, -pTop)

  if (isDrawableForExport(page.bgImage)) {
    ctx.imageSmoothingEnabled = true
    try { ctx.imageSmoothingQuality = 'high' } catch {}
    ctx.drawImage(page.bgImage, 0, 0, docW, docH)
  }

  const overlays = page.overlays || []
  for (const ov of overlays) {
    ctx.save()
    ctx.translate(ov.cx, ov.cy)
    ctx.rotate(ov.angleRad || 0)

    const sx = ov.type === 'text' ? 1 : (ov.scaleX || 1)
    const sy = ov.type === 'text' ? 1 : (ov.scaleY || 1)
    ctx.scale(sx, sy)

    const w = ov.w
    const h = ov.h
    const halfW = w / 2
    const halfH = h / 2

    if (ov.type === 'image' && isDrawableForExport(ov.data?.image)) {
      ctx.drawImage(ov.data.image, -halfW, -halfH, w, h)
    } else if (ov.type === 'text') {
      const d = ov.data || {}
      ctx.fillStyle = d.fill || '#000000'
      const fontWeight = d.fontWeight || 'bold'
      const fontStyle = d.fontStyle || 'normal'
      const fontSize = Math.max(6, d.fontSize || 48)
      const fontFamily = d.fontFamily || 'Arial'
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`

      const align = d.textAlign || 'left'
      ctx.textAlign = align
      ctx.textBaseline = 'top'

      let xPos = 0
      if (align === 'left') xPos = -halfW
      else if (align === 'right') xPos = halfW
      else if (align === 'center') xPos = 0

      const text = d.text || ''
      const lines = text.split('\n')

      const lh = fontSize * LH_FACTOR
      const totalH = lines.length * lh
      let startY = -totalH / 2

      for (const line of lines) {
        ctx.fillText(line, xPos, startY)
        startY += lh
      }
    }
    ctx.restore()
  }

  return canvas
}

function b64ToU8 (b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export default function Editor () {
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState([])

  const pagesRef = useRef(pages)
  const curRef = useRef(0)
  const docIdRef = useRef(docId)
  const fileNameRef = useRef(fileName)

  const [cur, setCur] = useState(0)
  const hasDoc = pages.length > 0
  const canPrev = hasDoc && cur > 0
  const canNext = hasDoc && cur < pages.length - 1

  const engineRef = useRef(null)

  const internalUpdateRef = useRef(false)

  const [signLib, setSignLib] = useState([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [font, setFont] = useState('Arial')
  const [fontSize, setFontSize] = useState(48)
  const [bold, setBold] = useState(true)
  const [italic, setItalic] = useState(false)
  const [color, setColor] = useState('#000000')

  const [menuOpen, setMenuOpen] = useState(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const [payOpen, setPayOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropKind, setCropKind] = useState('signature')
  const [cropThresh, setCropThresh] = useState(40)

  const [plan, setPlan] = useState('month')
  const [promo, setPromo] = useState('')
  const [promoError, setPromoError] = useState('')
  const [prices, setPrices] = useState({ single: 0, month: 0, year: 0 })
  const [promoPercent, setPromoPercent] = useState(0)
  const [billing, setBilling] = useState(null)
  const isAuthed = !!localStorage.getItem('access')

  const [undoStack, setUndoStack] = useState([])
  const canUndo = undoStack.length > 0
  const [banner, setBanner] = useState('')
  const [libOpen, setLibOpen] = useState(false)

  const [progress, setProgress] = useState({
    active: false,
    mode: null,
    label: '',
    val: 0,
    max: 0,
    suffix: ''
  })

  const canvasRef = useRef(null)
  const canvasWrapRef = useRef(null)
  const [docRect, setDocRect] = useState(null)

  const [textEdit, setTextEdit] = useState(null)
  const [textEditValue, setTextEditValue] = useState('')
  const textAreaRef = useRef(null)
  const textEditRef = useRef(textEdit)
  const lastGoodTextRef = useRef('')
  const limitErrorAtRef = useRef(0)

  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const sheetActionsRef = useRef(null)
  const sheetAddRef = useRef(null)
  const sheetDownloadRef = useRef(null)

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches)
  const isMobileRef = useRef(isMobile)

  const saveTimerRef = useRef(0)
  const dragFromTextareaRef = useRef({ active: false, started: false, pointerId: null, startX: 0, startY: 0 })

  useEffect(() => { pagesRef.current = pages }, [pages])
  useEffect(() => { curRef.current = cur }, [cur])
  useEffect(() => { docIdRef.current = docId }, [docId])
  useEffect(() => { fileNameRef.current = fileName }, [fileName])
  useEffect(() => { textEditRef.current = textEdit }, [textEdit])
  useEffect(() => { isMobileRef.current = isMobile }, [isMobile])

  const setPagesSync = useCallback((nextPages) => {
    pagesRef.current = nextPages
    setPages(nextPages)
  }, [])

  function showBanner (text, timeout = 1800) {
    setBanner(text)
    window.clearTimeout(showBanner._t)
    showBanner._t = window.setTimeout(() => setBanner(''), timeout)
  }

  // вместо простого showLimitWarning() — умеем различать ситуации
  function showLimitWarning (kind = 'text') {
    const now = Date.now()
    if (now - limitErrorAtRef.current < 1200) return
    limitErrorAtRef.current = now

    const msg = kind === 'rotate'
      ? 'Объект выходит за границы документа'
      : 'Текст выходит за границы документа'

    toast(msg, 'error')
  }

  const closeMenus = useCallback(() => setMenuOpen(null), [])
  const toggleMenu = useCallback((name) => {
    setMenuOpen(prev => (prev === name ? null : name))
  }, [])

  const scheduleSaveDraft = useCallback(() => {
    if (!isAuthed) return
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      const snap = buildDraftSnapshot()
      if (!snap) return
      try {
        await AuthAPI.saveDraft(snap)
        setDraftHint(true)
      } catch {}
    }, 400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed])

  const scheduleSaveDraftRef = useRef(scheduleSaveDraft)
  useEffect(() => { scheduleSaveDraftRef.current = scheduleSaveDraft }, [scheduleSaveDraft])

  function buildDraftSnapshot () {
    if (!pagesRef.current.length) return null
    let cid = docIdRef.current
    if (!cid) {
      cid = randDocId()
      setDocId(cid)
    }
    const name = sanitizeName(fileNameRef.current || genDefaultName())
    const pagesData = pagesRef.current.map(p => {
      const overlays = (p.overlays || []).map(ov => {
        const d = ov.data || {}
        const base = {
          id: ov.id,
          type: ov.type,
          cx: ov.cx,
          cy: ov.cy,
          w: ov.w,
          h: ov.h,
          scaleX: ov.type === 'text' ? 1 : (ov.scaleX || 1),
          scaleY: ov.type === 'text' ? 1 : (ov.scaleY || 1),
          angleRad: ov.angleRad || 0
        }
        if (ov.type === 'image') {
          return { ...base, data: { src: d.src || null } }
        }
        if (ov.type === 'text') {
          return {
            ...base,
            data: {
              text: d.text || '',
              fontSize: Math.max(6, Number(d.fontSize || 48)),
              fontFamily: d.fontFamily || 'Arial',
              fontWeight: d.fontWeight || 'bold',
              fontStyle: d.fontStyle || 'normal',
              fill: d.fill || '#000000',
              textAlign: d.textAlign || 'left'
            }
          }
        }
        return { ...base, data: {} }
      })

      let bgSrc = p.bgSrc || null
      if (!bgSrc && p.bgImage && p.bgImage.toDataURL) {
        try { bgSrc = p.bgImage.toDataURL('image/png') } catch {}
      }

      return {
        id: p.id,
        docWidth: p.docWidth,
        docHeight: p.docHeight,
        rotation: p.rotation || 0,
        bg_src: bgSrc,
        overlays
      }
    })

    return { client_id: cid, name, pages: pagesData }
  }

  useEffect(() => {
    document.body.classList.add('no-footer')
    document.documentElement.classList.add('no-footer')
    return () => {
      document.body.classList.remove('no-footer')
      document.documentElement.classList.remove('no-footer')
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const on = () => setIsMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const onUser = async () => {
      if (localStorage.getItem('access')) {
        try {
          const st = await AuthAPI.getBillingStatus()
          setBilling(st)
          if (st && ('price_single' in st)) {
            setPrices({
              single: Number(st.price_single || 0),
              month: Number(st.price_month || 0),
              year: Number(st.price_year || 0)
            })
          }
        } catch {}
      } else {
        setBilling(null)
      }
    }
    window.addEventListener('user:update', onUser)
    return () => window.removeEventListener('user:update', onUser)
  }, [])

  const forceLayoutSync = useCallback(() => {
    const engine = engineRef.current
    const wrap = canvasWrapRef.current
    if (!engine || !wrap) return

    let tries = 0
    const run = () => {
      tries += 1
      const rect = wrap.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) {
        if (tries < 8) requestAnimationFrame(run)
        return
      }

      engine.resize(rect.width, rect.height)

      const page = pagesRef.current[curRef.current]
      if (page) {
        engine.setDocument({
          docWidth: page.docWidth,
          docHeight: page.docHeight,
          backgroundImage: page.bgImage,
          overlays: page.overlays || [],
          rotation: page.rotation || 0
        })

        const te = textEditRef.current
        if (te?.overlayId) {
          engine.activeId = te.overlayId
          engine.setEditingOverlayId(te.overlayId)
        } else {
          engine.setEditingOverlayId(null)
        }

        setDocRect(engine.getDocumentScreenRect())

        if (te?.overlayId) {
          const b = engine.getOverlayScreenBoundsById(te.overlayId)
          const ov = (page.overlays || []).find(o => o.id === te.overlayId)
          if (b && ov) {
            setTextEdit(prev => (prev && prev.overlayId === te.overlayId
              ? {
                  ...prev,
                  rectCanvas: b,
                  docW: ov.w,
                  docH: ov.h,
                  fontSize: ov.data?.fontSize
                }
              : prev))
          }
        }
      } else {
        setDocRect(engine.getDocumentScreenRect())
      }
    }

    requestAnimationFrame(() => requestAnimationFrame(run))
  }, [])

  const forceLayoutSyncRef = useRef(forceLayoutSync)
  useEffect(() => { forceLayoutSyncRef.current = forceLayoutSync }, [forceLayoutSync])

  useEffect(() => {
    closeMenus()
    forceLayoutSync()
  }, [isMobile, closeMenus, forceLayoutSync])

  const finishTextEditing = useCallback(() => {
    const current = textEditRef.current
    const engine = engineRef.current

    if (!current || !engine) {
      setTextEdit(null)
      setPanelOpen(false)
      if (engine) engine.setEditingOverlayId(null)
      return
    }

    const pagesArr = pagesRef.current
    const pIdx = curRef.current
    const page = pagesArr[pIdx]
    if (!page) {
      engine.setEditingOverlayId(null)
      setTextEdit(null)
      setPanelOpen(false)
      return
    }

    const overlays = page.overlays || []
    const idx = overlays.findIndex(o => o.id === current.overlayId)
    if (idx >= 0) {
      const ov = overlays[idx]
      const txt = (ov.data?.text || '').trim()
      if (!txt) {
        const newOvs = overlays.filter(o => o.id !== current.overlayId)
        engine.setOverlays(newOvs)

        internalUpdateRef.current = true
        const newPages = [...pagesArr]
        newPages[pIdx] = { ...page, overlays: newOvs }
        setPagesSync(newPages)
      }
    }

    engine.setEditingOverlayId(null)
    setTextEdit(null)
    setPanelOpen(false)
  }, [setPagesSync])

  useEffect(() => {
    if (textEditRef.current) finishTextEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur])

  useEffect(() => {
    if (!hasDoc || !canvasRef.current) return
    if (engineRef.current) return

    const engine = new CustomCanvasEngine(canvasRef.current, {
      viewMargin: isMobileRef.current ? 0 : 24,
      onLimit: (kind) => showLimitWarning(kind), // <- новая строка

      onBeforeOverlayChange: (snapshot) => {
        const pageIndex = curRef.current
        const snapSafe = (snapshot || []).map(o => ({ ...o, data: { ...(o.data || {}) } }))
        setUndoStack(stk => [...stk, { type: 'page', pageIndex, overlays: snapSafe }])
      },

      onOverlayChange: (ov) => {
        if (!ov) return

        if (ov.id === engineRef.current?.activeId && ov.type === 'text') {
          const d = ov.data || {}
          setFontSize(Math.max(6, Number(d.fontSize || 48)))
          setFont(d.fontFamily || 'Arial')
          setBold(d.fontWeight === 'bold' || d.fontWeight === 700)
          setItalic(d.fontStyle === 'italic')
          setColor(d.fill || '#000000')
        }

        internalUpdateRef.current = true
        setPages(prev => {
          const pageIndex = curRef.current
          const copy = [...prev]
          const page = copy[pageIndex]
          if (!page) return prev
          const idx = (page.overlays || []).findIndex(o => o.id === ov.id)
          const newOverlays = [...(page.overlays || [])]
          if (idx >= 0) newOverlays[idx] = ov
          else newOverlays.push(ov)
          copy[pageIndex] = { ...page, overlays: newOverlays }
          pagesRef.current = copy
          return copy
        })

        const te = textEditRef.current
        if (te && te.overlayId === ov.id && engineRef.current) {
          const bounds = engineRef.current.getOverlayScreenBoundsById(ov.id)
          if (bounds) {
            setTextEdit(prev => (prev && prev.overlayId === ov.id ? {
              ...prev,
              rectCanvas: bounds,
              docW: ov.w,
              docH: ov.h,
              fontSize: ov.data?.fontSize
            } : prev))
          }
        }
      },

      onInteractionEnd: () => {
        scheduleSaveDraftRef.current?.()
      },

      onOverlayDelete: (id) => {
        internalUpdateRef.current = true
        setPages(prev => {
          const pageIndex = curRef.current
          const copy = [...prev]
          const page = copy[pageIndex]
          if (!page) return prev
          copy[pageIndex] = {
            ...page,
            overlays: (page.overlays || []).filter(o => o.id !== id)
          }
          pagesRef.current = copy
          return copy
        })
        scheduleSaveDraftRef.current?.()
      },

      onSelectionChange: (ov) => {
        const current = textEditRef.current
        if (current && (!ov || ov.id !== current.overlayId)) {
          finishTextEditing()
        }

        if (ov && ov.type === 'text') {
          const d = ov.data || {}
          setFont(d.fontFamily || 'Arial')
          setFontSize(Math.max(6, Number(d.fontSize || 48)))
          setBold(d.fontWeight === 'bold' || d.fontWeight === 700)
          setItalic(d.fontStyle === 'italic')
          setColor(d.fill || '#000000')
        }
      },

      onTextEditRequest: (ov, bounds) => {
        const current = textEditRef.current
        const d = ov.data || {}

        if (current && current.overlayId === ov.id) return
        if (current && current.overlayId !== ov.id) finishTextEditing()

        if (engineRef.current) {
          engineRef.current.activeId = ov.id
          engineRef.current.setEditingOverlayId(ov.id)
        }

        const initialText = d.text || ''
        lastGoodTextRef.current = initialText
        limitErrorAtRef.current = 0
        setTextEditValue(initialText)

        setTextEdit({
          overlayId: ov.id,
          rectCanvas: bounds,
          docW: ov.w,
          docH: ov.h,
          fontFamily: d.fontFamily || 'Arial',
          fontSize: d.fontSize || 48,
          fontWeight: d.fontWeight || 'bold',
          fontStyle: d.fontStyle || 'normal',
          fill: d.fill || '#000000',
          textAlign: d.textAlign || 'left'
        })
        setPanelOpen(true)
      },

      onBlankClick: () => {
        finishTextEditing()
      }
    })

    engine.setMode(isMobileRef.current)
    engine.setViewMargin(isMobileRef.current ? 0 : 24)
    engineRef.current = engine

    const handleResize = () => {
      forceLayoutSyncRef.current?.()
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    const ro = new ResizeObserver(handleResize)
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current)

    return () => {
      try { ro.disconnect() } catch {}
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
      try { engineRef.current && engineRef.current.destroy() } catch {}
      engineRef.current = null
    }
  }, [hasDoc, finishTextEditing])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setMode(isMobile)
    engine.setViewMargin(isMobile ? 0 : 24)
    forceLayoutSync()
  }, [isMobile, forceLayoutSync])

  useEffect(() => {
    if (textEdit && textAreaRef.current) {
      const ta = textAreaRef.current
      const len = (textEditValue || '').length
      requestAnimationFrame(() => {
        ta.focus()
        try { ta.setSelectionRange(len, len) } catch {}
      })
    }
  }, [textEdit, textEditValue])

  const prevCurForSyncRef = useRef(0)
  useEffect(() => {
    const curChanged = prevCurForSyncRef.current !== cur
    prevCurForSyncRef.current = cur

    if (internalUpdateRef.current && !curChanged) {
      internalUpdateRef.current = false
      return
    }
    internalUpdateRef.current = false

    const page = pages[cur]
    const engine = engineRef.current
    if (!page || !engine) {
      setDocRect(null)
      return
    }

    engine.setDocument({
      docWidth: page.docWidth,
      docHeight: page.docHeight,
      backgroundImage: page.bgImage,
      overlays: page.overlays || [],
      rotation: page.rotation || 0
    })

    const te = textEditRef.current
    if (te?.overlayId) {
      engine.activeId = te.overlayId
      engine.setEditingOverlayId(te.overlayId)
    } else {
      engine.setEditingOverlayId(null)
    }

    setDocRect(engine.getDocumentScreenRect())

    if (te?.overlayId) {
      const b = engine.getOverlayScreenBoundsById(te.overlayId)
      const ov = (page.overlays || []).find(o => o.id === te.overlayId)
      if (b && ov) {
        setTextEdit(prev => (prev && prev.overlayId === te.overlayId
          ? {
              ...prev,
              rectCanvas: b,
              docW: ov.w,
              docH: ov.h,
              fontSize: ov.data?.fontSize
            }
          : prev))
      }
    }
  }, [pages, cur])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (textEdit?.overlayId) {
      engine.activeId = textEdit.overlayId
      engine.setEditingOverlayId(textEdit.overlayId)
    } else {
      engine.setEditingOverlayId(null)
    }
    forceLayoutSyncRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit?.overlayId])

  async function loadLibrary () {
    if (!isAuthed) { setSignLib([]); return }
    try {
      const list = await AuthAPI.listSigns()
      setSignLib(Array.isArray(list) ? list : [])
    } catch { setSignLib([]) }
  }
  useEffect(() => { if (isAuthed) loadLibrary() }, [isAuthed])

  useEffect(() => {
    if (!isAuthed) return

    ;(async () => {
      let srv
      try { srv = await AuthAPI.getDraft() } catch { return }
      if (!srv || !srv.exists || !srv.data || !Array.isArray(srv.data.pages) || !srv.data.pages.length) {
        setDraftHint(false)
        return
      }

      const data = srv.data
      const pagesData = Array.isArray(data.pages) ? data.pages : []
      const total = pagesData.length

      setProgress({
        active: true,
        mode: 'restore',
        label: 'Восстановление документа',
        val: 0,
        max: total,
        suffix: 'стр.'
      })

      const restored = []
      let idx = 0

      for (const pg of pagesData) {
        let img = null
        let bgSrc = null
        let docWidth = 1000
        let docHeight = 1414
        let rotation = 0

        if (pg.docWidth) {
          docWidth = pg.docWidth
          docHeight = pg.docHeight
          rotation = pg.rotation || 0
          if (pg.bg_src) {
            try { img = await loadImageEl(pg.bg_src); bgSrc = pg.bg_src } catch {}
          }
        } else {
          rotation = pg.landscape ? 90 : 0
          if (pg.type === 'pdf' && pg.bytes_b64) {
            try {
              await ensurePDFJS()
              // eslint-disable-next-line no-undef
              const pdf = await pdfjsLib.getDocument({ data: b64ToU8(pg.bytes_b64) }).promise
              const cv = await renderPDFPageToCanvas(pdf, (pg.index || 0) + 1, PDF_RENDER_SCALE)
              img = cv
              bgSrc = cv.toDataURL('image/png')
              docWidth = cv.width
              docHeight = cv.height
            } catch {}
          } else if ((pg.type === 'image' || pg.type === 'raster') && pg.src) {
            try {
              img = await loadImageEl(pg.src)
              bgSrc = pg.src
              docWidth = pg.doc_w || pg.w || img.naturalWidth || img.width || 1000
              docHeight = pg.doc_h || pg.h || img.naturalHeight || img.height || 1414
            } catch {}
          }
        }

        const overlays = []
        for (const ov of (pg.overlays || [])) {
          const base = {
            id: ov.id || `ov_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            type: ov.type || 'image',
            cx: ov.cx ?? 0,
            cy: ov.cy ?? 0,
            w: ov.w || 200,
            h: ov.h || 100,
            scaleX: ov.type === 'text' ? 1 : (ov.scaleX ?? 1),
            scaleY: ov.type === 'text' ? 1 : (ov.scaleY ?? 1),
            angleRad: ov.angleRad ?? 0,
            data: {}
          }

          if (ov.type === 'text' || ov.t === 'tb') {
            base.type = 'text'
            const d = ov.data || {}
            base.scaleX = 1
            base.scaleY = 1
            base.data = {
              text: d.text || ov.text || '',
              fontSize: Math.max(6, Number(d.fontSize || ov.fontSize || 48)),
              fontFamily: d.fontFamily || ov.fontFamily || 'Arial',
              fontWeight: d.fontWeight || ov.fontWeight || 'bold',
              fontStyle: d.fontStyle || ov.fontStyle || 'normal',
              fill: d.fill || ov.fill || '#000000',
              textAlign: d.textAlign || ov.textAlign || 'left'
            }
          } else if (ov.type === 'image' || ov.t === 'im') {
            base.type = 'image'
            const src = ov.data?.src || ov.src
            base.data = { src }
            if (src) {
              try { base.data.image = await loadImageEl(src) } catch {}
            }
          }

          overlays.push(base)
        }

        restored.push({
          id: pg.id || `p_${Date.now()}_${Math.random().toString(36).slice(2)}_${idx}`,
          docWidth,
          docHeight,
          bgImage: img,
          bgSrc,
          overlays,
          rotation
        })

        idx++
        setProgress(p => ({ ...p, val: idx }))
      }

      setPagesSync(restored)
      if (restored.length) setCur(0)
      setDraftHint(true)
      setDocId(data.client_id || randDocId())
      setFileName((data.name || '').trim() || genDefaultName())

      setProgress(p => ({ ...p, active: false }))
      showBanner('Восстановлен последний документ')

      forceLayoutSyncRef.current?.()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed])

  useEffect(() => {
    const onUnload = () => {
      if (!isAuthed) return
      const snap = buildDraftSnapshot()
      if (!snap) return
      AuthAPI.saveDraftOnUnload(snap)
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [isAuthed])

  function pickDocument () {
    docFileRef.current?.click()
  }

  async function onPickDocument (e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    await handleFiles(files)
  }

  async function estimateUnits (files) {
    let total = 0
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (['jpg', 'jpeg', 'png'].includes(ext)) total += 1
      else if (ext === 'pdf') {
        try {
          await ensurePDFJS()
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise
          total += pdf.numPages || 1
        } catch { total += 1 }
      } else if (['docx', 'doc', 'xls', 'xlsx'].includes(ext)) {
        total += 2
      } else {
        total += 1
      }
    }
    return Math.max(1, total)
  }

  async function handleFiles (files) {
    try {
      const totalUnits = await estimateUnits(files)
      setProgress({
        active: true,
        mode: 'upload',
        label: 'Загрузка документа',
        val: 0,
        max: totalUnits,
        suffix: 'стр.'
      })

      let curDocId = docIdRef.current
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId) }

      let doneUnits = 0
      let addedPages = 0
      const newPages = [...pagesRef.current]

      const tick = (n = 1) => {
        doneUnits += n
        setProgress(p => ({ ...p, val: doneUnits }))
      }

      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (!fileNameRef.current) {
          setFileName(sanitizeName(f.name.replace(/\.[^.]+$/, '')))
        }

        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          const url = await readAsDataURL(f)
          const img = await loadImageEl(url)
          newPages.push({
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            docWidth: img.width || img.naturalWidth,
            docHeight: img.height || img.naturalHeight,
            bgImage: img,
            bgSrc: url,
            overlays: [],
            rotation: 0
          })
          addedPages++; tick(1)
        } else if (ext === 'pdf') {
          await ensurePDFJS()
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise
          const num = pdf.numPages
          for (let i = 1; i <= num; i++) {
            const cv = await renderPDFPageToCanvas(pdf, i, PDF_RENDER_SCALE)
            const url = cv.toDataURL('image/png')
            newPages.push({
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}_${i}`,
              docWidth: cv.width,
              docHeight: cv.height,
              bgImage: cv,
              bgSrc: url,
              overlays: [],
              rotation: 0
            })
            addedPages++; tick(1)
          }
        } else if (['docx', 'doc'].includes(ext)) {
          const big = await renderDOCXToCanvas(f)
          const slices = sliceCanvasToPages(big)
          for (const url of slices) {
            const img = await loadImageEl(url)
            newPages.push({
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              docWidth: img.width || img.naturalWidth,
              docHeight: img.height || img.naturalHeight,
              bgImage: img,
              bgSrc: url,
              overlays: [],
              rotation: 0
            })
            addedPages++
          }
          tick(2)
        } else if (['xls', 'xlsx'].includes(ext)) {
          const big = await renderXLSXToCanvas(f)
          const slices = sliceCanvasToPages(big)
          for (const url of slices) {
            const img = await loadImageEl(url)
            newPages.push({
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              docWidth: img.width || img.naturalWidth,
              docHeight: img.height || img.naturalHeight,
              bgImage: img,
              bgSrc: url,
              overlays: [],
              rotation: 0
            })
            addedPages++
          }
          tick(2)
        } else {
          toast(`Формат не поддерживается: ${ext}`, 'error')
          tick(1)
        }
      }

      setPagesSync(newPages)
      if (!hasDoc && newPages.length) setCur(0)
      scheduleSaveDraftRef.current?.()

      if (isAuthed && addedPages > 0) {
        try {
          const nm = sanitizeName(fileNameRef.current || genDefaultName())
          await AuthAPI.recordUpload(curDocId, nm, addedPages)
        } catch {}
      }

      toast('Страницы добавлены', 'success')
      forceLayoutSyncRef.current?.()
    } catch (e) {
      console.error(e)
      toast(e.message || 'Ошибка загрузки файлов', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  async function deletePageAt (idx) {
    if (!pagesRef.current.length) return
    if (pagesRef.current.length <= 1) {
      if (!window.confirm('Удалить весь документ?')) return
      setPagesSync([])
      setCur(0)
      setFileName('')
      setUndoStack([])
      try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
      try { await AuthAPI.clearDraft() } catch {}
      setDraftHint(false)
      toast('Документ удалён', 'success')
      return
    }
    if (!window.confirm('Удалить текущую страницу?')) return
    if (textEditRef.current) finishTextEditing()

    const nextPages = pagesRef.current.filter((_, i) => i !== idx)
    setPagesSync(nextPages)
    setCur(i => Math.max(0, idx - 1))
    scheduleSaveDraftRef.current?.()
    toast('Страница удалена', 'success')
    forceLayoutSyncRef.current?.()
  }

  async function addText () {
    const page = pagesRef.current[cur]
    if (!page) { toast('Сначала добавьте страницу', 'error'); return }
    if (!engineRef.current) return

    const initText = 'Вставьте текст'
    const fontSizeLocal = 48
    const metrics = measureTextBoxDom(initText, 'Arial', fontSizeLocal, 'bold', 'normal')

    engineRef.current.addTextOverlay(initText, {
      fontFamily: 'Arial',
      fontSize: fontSizeLocal,
      fontWeight: 'bold',
      fill: '#000000',
      textAlign: 'left',
      width: metrics.width,
      height: metrics.height
    })
    scheduleSaveDraftRef.current?.()
  }

  const fitOverlayToPage = useCallback((ov, page) => {
    const engine = engineRef.current
    if (!engine || !ov || !page) return ov

    const bounds = engine.getOverlayDocBoundsForPage
      ? engine.getOverlayDocBoundsForPage(ov, page.docWidth || 1000, page.docHeight || 1414, page.rotation || 0)
      : null

    const bw = bounds ? Math.max(1e-6, bounds.w) : Math.max(1e-6, ov.w)
    const bh = bounds ? Math.max(1e-6, bounds.h) : Math.max(1e-6, ov.h)

    const { pageW, pageH } = engine.computePageSize(page.docWidth || 1000, page.docHeight || 1414, page.rotation || 0)
    const maxW = (pageW || page.docWidth || 1000) - 4
    const maxH = (pageH || page.docHeight || 1414) - 4

    const factor = Math.min(maxW / bw, maxH / bh, 1)

    if (factor >= 1) return ov

    if (ov.type === 'text') {
      const d = { ...(ov.data || {}) }
      const fs0 = Number(d.fontSize || 48)
      const fs1 = Math.max(6, Number(fs0 * factor))
      const real = fs0 ? (fs1 / fs0) : factor
      return {
        ...ov,
        w: Math.max(1, Number(ov.w || 1) * real),
        h: Math.max(1, Number(ov.h || 1) * real),
        scaleX: 1,
        scaleY: 1,
        data: { ...d, fontSize: fs1 }
      }
    }

    return {
      ...ov,
      scaleX: (ov.scaleX || 1) * factor,
      scaleY: (ov.scaleY || 1) * factor
    }
  }, [])

  const applyPanel = useCallback((overrides = {}) => {
    const pageIndex = curRef.current
    const page = pagesRef.current[pageIndex]
    if (!page || !engineRef.current) return false

    const activeId = engineRef.current.activeId
    if (!activeId) return false

    const overlays = page.overlays || []
    const idx = overlays.findIndex(o => o.id === activeId)
    if (idx < 0) return false

    const oldOv = overlays[idx]
    if (oldOv.type !== 'text') return false

    const newFontFamily = overrides.font ?? font
    const rawSize = overrides.fontSize ?? fontSize
    const newFontSize = Math.max(6, Number(rawSize))
    const useBold = overrides.bold ?? bold
    const useItalic = overrides.italic ?? italic
    const newColor = overrides.color ?? color

    const newFontWeight = useBold ? 'bold' : 'normal'
    const newFontStyle = useItalic ? 'italic' : 'normal'

    const d = oldOv.data || {}
    const text = d.text || ''

    const metrics = measureTextBoxDom(text, newFontFamily, newFontSize, newFontWeight, newFontStyle)

    const newOv = {
      ...oldOv,
      w: Math.max(20, metrics.width),
      h: metrics.height,
      scaleX: 1,
      scaleY: 1,
      data: {
        ...d,
        fontFamily: newFontFamily,
        fontSize: newFontSize,
        fontWeight: newFontWeight,
        fontStyle: newFontStyle,
        fill: newColor
      }
    }

    const bounded = engineRef.current.clampOverlayToPage(newOv, page.docWidth || 1000, page.docHeight || 1414, page.rotation || 0)
    if (!bounded.ok) {
      showLimitWarning('text')
      return false
    }

    engineRef.current.setOverlays(overlays.map(o => (o.id === activeId ? bounded.overlay : o)))
    const newBounds = engineRef.current.getOverlayScreenBoundsById(activeId)

    internalUpdateRef.current = true
    setPages(prev => {
      const copy = [...prev]
      const p = copy[pageIndex]
      if (!p) return prev
      const nextOvs = [...(p.overlays || [])]
      const matchIdx = nextOvs.findIndex(o => o.id === activeId)
      if (matchIdx >= 0) nextOvs[matchIdx] = bounded.overlay
      copy[pageIndex] = { ...p, overlays: nextOvs }
      pagesRef.current = copy
      return copy
    })

    if (textEditRef.current && textEditRef.current.overlayId === activeId) {
      setTextEdit(prev => {
        if (!prev || prev.overlayId !== activeId) return prev
        return {
          ...prev,
          rectCanvas: newBounds,
          docW: bounded.overlay.w,
          docH: bounded.overlay.h,
          fontFamily: newFontFamily,
          fontSize: newFontSize,
          fontWeight: newFontWeight,
          fontStyle: newFontStyle,
          fill: newColor,
          textAlign: d.textAlign || 'left'
        }
      })
    }

    scheduleSaveDraftRef.current?.()
    return true
  }, [font, fontSize, bold, italic, color, fitOverlayToPage])

  async function rotatePage () {
    const page = pagesRef.current[cur]
    const engine = engineRef.current
    if (!page || !engine) return

    const newRot = page.rotation === 90 ? 0 : 90

    engine.setPageRotation(newRot, isMobileRef.current)
    setDocRect(engine.getDocumentScreenRect())

    internalUpdateRef.current = true
    setPages(prev => {
      const copy = [...prev]
      const p = copy[cur]
      if (!p) return prev
      copy[cur] = { ...p, rotation: newRot }
      pagesRef.current = copy
      return copy
    })

    scheduleSaveDraftRef.current?.()

    forceLayoutSyncRef.current?.()
  }

  function placeFromLib (url) {
    const page = pagesRef.current[cur]
    if (!page) { toast('Сначала добавьте страницу', 'error'); return }
    if (!engineRef.current) return
    loadImageEl(url).then(img => {
      engineRef.current.addImageOverlay(img, { src: url })
      scheduleSaveDraftRef.current?.()
      forceLayoutSyncRef.current?.()
    }).catch(e => {
      console.error(e)
      toast('Не удалось загрузить изображение', 'error')
    })
  }

  function onCanvasDrop (e) {
    e.preventDefault()
    const dt = e.dataTransfer
    if (!dt) return
    const types = Array.from(dt.types || [])
    if (types.includes('application/x-sign-url')) {
      const url = dt.getData('application/x-sign-url')
      if (url && url !== 'add') placeFromLib(url)
      return
    }
    const fs = Array.from(dt.files || [])
    if (fs.length) handleFiles(fs)
  }

  function undoLast () {
    if (!undoStack.length) return
    const last = undoStack[undoStack.length - 1]
    setUndoStack(stk => stk.slice(0, -1))

    const cloneOvs = (arr) => (arr || []).map(o => ({ ...o, data: { ...(o.data || {}) } }))

    internalUpdateRef.current = true
    setPages(prev => {
      const copy = [...prev]
      if (last.type === 'page') {
        const p = copy[last.pageIndex]
        if (!p) return prev
        const nextOvs = cloneOvs(last.overlays)
        copy[last.pageIndex] = { ...p, overlays: nextOvs }
        if (engineRef.current && last.pageIndex === curRef.current) {
          engineRef.current.setOverlays(nextOvs)
        }
      } else if (last.type === 'multi') {
        for (const ch of (last.pages || [])) {
          const p = copy[ch.pageIndex]
          if (!p) continue
          const nextOvs = cloneOvs(ch.overlays)
          copy[ch.pageIndex] = { ...p, overlays: nextOvs }
          if (engineRef.current && ch.pageIndex === curRef.current) {
            engineRef.current.setOverlays(nextOvs)
          }
        }
      }
      pagesRef.current = copy
      return copy
    })

    scheduleSaveDraftRef.current?.()
    forceLayoutSyncRef.current?.()
  }

  function applyToAllPages () {
    const pagesArr = pagesRef.current
    const currentPage = pagesArr[cur]
    const engine = engineRef.current
    if (!currentPage || !engine) return

    const activeId = engine.activeId
    const src = (currentPage.overlays || []).find(o => o.id === activeId)
    if (!src) {
      toast('Выберите объект на странице', 'error')
      return
    }

    const snapshotAll = pagesArr.map((p, idx) => ({
      pageIndex: idx,
      overlays: (p.overlays || []).map(o => ({ ...o, data: { ...(o.data || {}) } }))
    }))
    setUndoStack(stk => [...stk, { type: 'multi', pages: snapshotAll }])

    const srcW = currentPage.docWidth || 1
    const srcH = currentPage.docHeight || 1

    const newPages = pagesArr.map((page, idx) => {
      if (idx === cur) return page

      const dstW = page.docWidth || srcW
      const dstH = page.docHeight || srcH

      const relX = src.cx / srcW
      const relY = src.cy / srcH

      let newOv = {
        ...src,
        id: `${src.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        cx: relX * dstW,
        cy: relY * dstH,
        data: { ...(src.data || {}) }
      }

      if (newOv.type === 'text') {
        newOv.scaleX = 1
        newOv.scaleY = 1
        newOv.data.fontSize = Math.max(6, Number(newOv.data?.fontSize || 48))
      }

      newOv = fitOverlayToPage(newOv, page)

      const cl = engine.clampOverlayToPage(
        newOv,
        page.docWidth || 1000,
        page.docHeight || 1414,
        page.rotation || 0
      )
      if (cl?.overlay) newOv = cl.overlay

      return {
        ...page,
        overlays: [...(page.overlays || []), newOv]
      }
    })

    setPagesSync(newPages)
    scheduleSaveDraftRef.current?.()
    toast('Объект добавлен на все страницы', 'success')
    forceLayoutSyncRef.current?.()
  }

  async function applyPromo () {
    try {
      if (!promo) { setPromoPercent(0); setPromoError(''); return }
      const res = await AuthAPI.validatePromo(promo)
      const percent = Number(res?.percent || 0)
      if (percent > 0) {
        setPromoPercent(percent)
        setPromoError('')
      } else {
        setPromoPercent(0)
        setPromoError('Промокод не найден')
      }
    } catch (e) {
      setPromoPercent(0)
      setPromoError(e.message || 'Ошибка промокода')
    }
  }

  async function startPurchase () {
    try {
      const r = await AuthAPI.startPurchase(plan, promo || '')
      if (r?.url) {
        window.open(r.url, '_blank')
        setPayOpen(false)
      } else toast('Не удалось сформировать оплату', 'error')
    } catch (e) {
      toast(e.message || 'Ошибка оплаты', 'error')
    }
  }

  function baseName () {
    const nm = (fileNameRef.current || '').trim()
    if (!nm) { toast('Введите название файла при скачивании', 'error'); return null }
    return sanitizeName(nm)
  }

  async function exportJPG () {
    try {
      if (!pagesRef.current.length) return
      const bn = baseName()
      if (!bn) return
      const count = pagesRef.current.length
      if ((billing?.free_left ?? 0) < count) { setPlan('single'); setPayOpen(true); return }

      setProgress({
        active: true,
        mode: 'export',
        label: 'Подготовка JPG',
        val: 0,
        max: count,
        suffix: 'стр.'
      })

      await ensureJSZip()
      // eslint-disable-next-line no-undef
      const zip = new JSZip()

      for (let i = 0; i < pagesRef.current.length; i++) {
        const p = pagesRef.current[i]
        const off = renderPageOffscreen(p, 2)
        const blob = await new Promise(r => off.toBlob(r, 'image/jpeg', 0.95))
        zip.file(`${bn}-p${i + 1}.jpg`, blob)
        setProgress(pr => ({ ...pr, val: i + 1 }))
        await new Promise(r => requestAnimationFrame(r))
      }

      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })

      setProgress({
        active: true,
        mode: 'export',
        label: 'Скачивание JPG',
        val: 1,
        max: 1,
        suffix: ''
      })

      const a = document.createElement('a')
      const href = URL.createObjectURL(out)
      a.href = href
      a.download = `${bn}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1500)

      try { AuthAPI.recordDownload('jpg', pagesRef.current.length, bn, 'free').catch(() => {}) } catch {}
      toast(`Скачано страниц: ${pagesRef.current.length}`, 'success')
    } catch (e) {
      console.error(e)
      toast(e.message || 'Не удалось выгрузить JPG', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  async function exportPDF () {
    try {
      if (!pagesRef.current.length) return
      const bn = baseName()
      if (!bn) return
      const count = pagesRef.current.length
      if ((billing?.free_left ?? 0) < count) { setPlan('single'); setPayOpen(true); return }

      setProgress({
        active: true,
        mode: 'export',
        label: 'Подготовка PDF',
        val: 0,
        max: count,
        suffix: 'стр.'
      })

      const PDFLib = await ensurePDFLib()
      const pdfDoc = await PDFLib.PDFDocument.create()

      for (let i = 0; i < pagesRef.current.length; i++) {
        const p = pagesRef.current[i]
        const off = renderPageOffscreen(p, 2)
        const blob = await new Promise(r => off.toBlob(r, 'image/jpeg', 0.95))
        const buf = await blob.arrayBuffer()
        const img = await pdfDoc.embedJpg(buf)
        const page = pdfDoc.addPage([img.width, img.height])
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })

        setProgress(pr => ({ ...pr, val: i + 1 }))
        await new Promise(r => requestAnimationFrame(r))
      }

      const pdfBytes = await pdfDoc.save()

      setProgress({
        active: true,
        mode: 'export',
        label: 'Скачивание PDF',
        val: 1,
        max: 1,
        suffix: ''
      })

      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const a = document.createElement('a')
      const href = URL.createObjectURL(blob)
      a.href = href
      a.download = `${bn}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1500)

      try { AuthAPI.recordDownload('pdf', pagesRef.current.length, bn, 'free').catch(() => {}) } catch {}
      toast(`Скачан PDF (${pagesRef.current.length} стр.)`, 'success')
    } catch (e) {
      console.error(e)
      toast(e.message || 'Не удалось выгрузить PDF', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable
      if (isTyping) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const page = pagesRef.current[curRef.current]
        if (!page || !engineRef.current) return
        const activeId = engineRef.current.activeId
        if (!activeId) return

        e.preventDefault()

        const snapshot = (page.overlays || []).map(o => ({ ...o, data: { ...(o.data || {}) } }))
        setUndoStack(stk => [...stk, { type: 'page', pageIndex: curRef.current, overlays: snapshot }])

        const newOvs = (page.overlays || []).filter(o => o.id !== activeId)
        engineRef.current.setOverlays(newOvs)

        internalUpdateRef.current = true
        setPages(prev => {
          const copy = [...prev]
          const p = copy[curRef.current]
          if (!p) return prev
          copy[curRef.current] = { ...p, overlays: newOvs }
          pagesRef.current = copy
          return copy
        })

        scheduleSaveDraftRef.current?.()
        forceLayoutSyncRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onRenameChange = (e) => { setFileName(sanitizeName(e.target.value)) }

  const [pgText, setPgText] = useState('1')
  useEffect(() => { setPgText(String(pagesRef.current.length ? (cur + 1) : 0)) }, [cur, pages.length])

  const onPagerGo = (v) => {
    if (!pagesRef.current.length) return
    const n = Math.max(1, Math.min(pagesRef.current.length, Number(v) || 1))
    setCur(n - 1)
  }

  const hasActiveOverlay = (() => {
    const page = pagesRef.current[cur]
    if (!page || !engineRef.current) return false
    const id = engineRef.current.activeId
    return !!id && (page.overlays || []).some(o => o.id === id)
  })()

  function handleTextChange (value) {
    const te = textEditRef.current
    const id = te?.overlayId
    const engine = engineRef.current
    if (!id || !engine) {
      setTextEditValue(value)
      return
    }

    const pagesSnap = pagesRef.current
    const pageIndex = curRef.current
    const page = pagesSnap[pageIndex]
    if (!page) {
      setTextEditValue(value)
      return
    }

    const prevOverlays = page.overlays || []
    const targetIndex = prevOverlays.findIndex(o => o.id === id)
    if (targetIndex < 0) {
      setTextEditValue(value)
      return
    }

    const targetOv = { ...prevOverlays[targetIndex], data: { ...(prevOverlays[targetIndex].data || {}) } }
    targetOv.type = 'text'
    targetOv.scaleX = 1
    targetOv.scaleY = 1

    const d = targetOv.data
    const fontSizeLocal = Math.max(6, Number(d.fontSize || 48))
    const fontFamily = d.fontFamily || 'Arial'
    const fontWeight = d.fontWeight || 'bold'
    const fontStyle = d.fontStyle || 'normal'
    const text = value || ''

    const metrics = measureTextBoxDom(text, fontFamily, fontSizeLocal, fontWeight, fontStyle)

    targetOv.w = Math.max(20, metrics.width)
    targetOv.h = metrics.height
    targetOv.data.text = text
    targetOv.data.fontSize = fontSizeLocal

    const cl = engine.clampOverlayToPage(targetOv, page.docWidth || 1000, page.docHeight || 1414, page.rotation || 0)
    if (!cl.ok) {
      showLimitWarning('text')
      setTextEditValue(lastGoodTextRef.current)
      return
    }

    lastGoodTextRef.current = text
    setTextEditValue(text)

    const newOverlays = [...prevOverlays]
    newOverlays[targetIndex] = cl.overlay

    engine.setOverlays(newOverlays)
    const bounds = engine.getOverlayScreenBoundsById(id)

    internalUpdateRef.current = true
    const newPages = [...pagesSnap]
    newPages[pageIndex] = { ...page, overlays: newOverlays }
    setPagesSync(newPages)

    if (bounds) {
      setTextEdit(prev => (prev && prev.overlayId === id
        ? { ...prev, rectCanvas: bounds, docW: cl.overlay.w, docH: cl.overlay.h }
        : prev))
    }

    scheduleSaveDraftRef.current?.()
  }

  useEffect(() => {
    const ta = textAreaRef.current
    if (!ta || !textEdit) return

    const drag = dragFromTextareaRef.current
    const THRESH2 = 4 * 4

    const onDown = (e) => {
      drag.active = true
      drag.started = false
      drag.pointerId = e.pointerId
      drag.startX = e.clientX
      drag.startY = e.clientY
    }

    const onMove = (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const d2 = dx * dx + dy * dy
      if (!drag.started && d2 > THRESH2) {
        drag.started = true
        if (engineRef.current) {
          const fakeDown = {
            clientX: drag.startX,
            clientY: drag.startY,
            pointerId: drag.pointerId,
            button: 0,
            preventDefault () {}
          }
          engineRef.current.handleExternalPointerDown(fakeDown)
        }
      }
      if (drag.started) e.preventDefault()
    }

    const onUp = (e) => {
      if (e.pointerId !== drag.pointerId) return
      drag.active = false
      drag.started = false
      drag.pointerId = null
    }

    ta.addEventListener('pointerdown', onDown)
    ta.addEventListener('pointermove', onMove)
    ta.addEventListener('pointerup', onUp)
    ta.addEventListener('pointercancel', onUp)

    return () => {
      ta.removeEventListener('pointerdown', onDown)
      ta.removeEventListener('pointermove', onMove)
      ta.removeEventListener('pointerup', onUp)
      ta.removeEventListener('pointercancel', onUp)
    }
  }, [textEdit])

  const textEditorStyle = (() => {
    if (!textEdit || !canvasRef.current || !engineRef.current) return null
    const pageIndex = curRef.current
    const page = pagesRef.current[pageIndex]
    if (!page) return null
    const ov = (page.overlays || []).find(o => o.id === textEdit.overlayId)
    if (!ov) return null
    const rc = engineRef.current.getOverlayScreenBoundsById(ov.id) || textEdit.rectCanvas
    if (!rc) return null
    return buildTextOverlayStyle(rc, ov, canvasRef.current, true)
  })()

  const onTopMenuClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8 + window.scrollY, left: r.left + window.scrollX })
    toggleMenu('actions')
  }

  const pageForRender = hasDoc ? pages[cur] : null
  const engineForRender = engineRef.current

  return (
    <div className="doc-editor page" style={{ paddingTop: 0 }}>
      <ProgressOverlay
        open={progress.active}
        label={progress.label}
        val={progress.val}
        max={progress.max}
        suffix={progress.suffix}
      />

      {menuOpen && (
        <div className="ed-dim" onClick={closeMenus} />
      )}

      {banner && <div className="ed-banner">{banner}</div>}

      {!panelOpen ? (
        <div className="ed-top">
          <button className="ed-menu-btn mobile-only" aria-label="Меню действий" onClick={onTopMenuClick}>
            <img src={icMore} alt="" style={{ width: 18, height: 18 }} />
          </button>
          <button className="ed-menu-btn mobile-only" aria-label="Библиотека" onClick={() => setLibOpen(true)} title="Библиотека">
            <img src={icLibrary} alt="" style={{ width: 18, height: 18 }} />
          </button>
          <div className="ed-namebar" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <input
              className="ed-filename"
              placeholder="Название файла при скачивании"
              value={fileName}
              onChange={onRenameChange}
              style={{ margin: '0 auto' }}
            />
          </div>
          <div style={{ width: 36 }} className="desktop-only" />
        </div>
      ) : (
        <div className="ed-top">
          <div className="ed-toolbar" style={{ margin: '0 auto' }}>
            <select
              value={font}
              onChange={e => {
                const v = e.target.value
                if (applyPanel({ font: v })) setFont(v)
              }}
            >
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>

            <div className="sep" />

            <button
              onClick={() => {
                setFontSize(s => {
                  const nf = Math.max(6, s - 1)
                  return applyPanel({ fontSize: nf }) ? nf : s
                })
              }}
            >
              −
            </button>
            <span className="val">{fontSize}</span>
            <button
              onClick={() => {
                setFontSize(s => {
                  const nf = s + 1
                  return applyPanel({ fontSize: nf }) ? nf : s
                })
              }}
            >
              +
            </button>

            <div className="sep" />

            <input
              type="color"
              value={color}
              onChange={e => {
                const v = e.target.value
                if (applyPanel({ color: v })) setColor(v)
              }}
              title="Цвет текста"
            />

            <button
              className={bold ? 'toggled' : ''}
              onClick={() => {
                setBold(b => {
                  const nv = !b
                  return applyPanel({ bold: nv }) ? nv : b
                })
              }}
            >
              <b>B</b>
            </button>

            <button
              className={italic ? 'toggled' : ''}
              onClick={() => {
                setItalic(i => {
                  const nv = !i
                  return applyPanel({ italic: nv }) ? nv : i
                })
              }}
            >
              <i>I</i>
            </button>
          </div>
        </div>
      )}

      <div className="ed-body">
        <aside className="ed-left">
          <div className="ed-tools">
            <button className={`ed-tool ${pagesRef.current.length ? '' : 'disabled'}`} onClick={addText}>
              <img className="ico" src={icText} alt="" /><span>Добавить текст</span>
            </button>
            <button className="ed-tool" onClick={() => signFileRef.current?.click()}>
              <img className="ico" src={icSign} alt="" /><span>Загрузить подпись</span>
            </button>
          </div>

          <div className="ed-sign-list">
            <div
              className="thumb add"
              draggable
              onDragStart={(e) => { try { e.dataTransfer.setData('application/x-sign-url', 'add') } catch {} }}
              onClick={() => signFileRef.current?.click()}
            >
              <img src={icPlus} alt="+" style={{ width: 22, height: 22, opacity: 0.6 }} />
            </div>

            {signLib.map(item => (
              <div
                key={item.id}
                className="thumb"
                draggable
                onDragStart={(e) => { try { e.dataTransfer.setData('application/x-sign-url', item.url) } catch {} }}
              >
                {item.url && (
                  <img
                    src={item.url}
                    alt=""
                    onClick={() => placeFromLib(item.url)}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                  />
                )}

                <button
                  className="thumb-x x-btn x-btn--small"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm('Удалить элемент из библиотеки?')) return
                    try {
                      await (item.is_default && item.gid ? AuthAPI.hideDefaultSign(item.gid) : AuthAPI.deleteSign(item.id))
                      await loadLibrary()
                      toast('Удалено', 'success')
                    } catch (err) { toast(err.message || 'Не удалось удалить', 'error') }
                  }}
                >
                  <img src={icClose} alt="Удалить" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="ed-center">
          <div
            className="ed-canvas-wrap"
            ref={canvasWrapRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onCanvasDrop}
            style={{ position: 'relative', touchAction: 'none' }}
          >
            {hasDoc && (
              <>
                <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

                {/* Текстовые HTML-слои (просмотр) */}
                {engineForRender && pageForRender && (pageForRender.overlays || []).filter(ov => ov.type === 'text').map(ov => {
                  if (textEdit && textEdit.overlayId === ov.id) return null
                  const rc = engineForRender.getOverlayScreenBoundsById(ov.id)
                  if (!rc) return null
                  const style = buildTextOverlayStyle(rc, ov, canvasRef.current, false)
                  if (!style) return null
                  const text = ov.data?.text || ''
                  return (
                    <div
                      key={ov.id}
                      style={style}
                    >
                      {text}
                    </div>
                  )
                })}

                {docRect && (
                  <button
                    className="ed-page-x desktop-only x-btn x-btn--medium"
                    title="Удалить эту страницу"
                    style={{
                      position: 'absolute',
                      left: docRect.x + docRect.width,
                      top: docRect.y + 8
                    }}
                    onClick={() => deletePageAt(cur)}
                  >
                    <img src={icClose} alt="Удалить страницу" />
                  </button>
                )}

                {textEdit && textEditorStyle && (
                  <textarea
                    ref={textAreaRef}
                    style={textEditorStyle}
                    value={textEditValue}
                    onChange={e => handleTextChange(e.target.value)}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                )}
              </>
            )}

            {!hasDoc && (
              <div className="ed-dropzone" onClick={pickDocument}>
                <img src={icDocAdd} alt="" style={{ width: 140, height: 'auto', opacity: 0.9 }} />
                <div className="dz-title">Загрузите документы</div>
                <div className="dz-sub">Можно перетащить их в это поле</div>
                <div className="dz-types">JPG, JPEG, PNG, PDF, DOC, DOCX, XLS, XLSX</div>
              </div>
            )}
          </div>
        </section>

        <aside className="ed-right">
          <div className="ed-actions">
            <button
              className={`ed-action ${pagesRef.current.length ? '' : 'disabled'}`}
              onClick={async () => {
                if (!pagesRef.current.length) return
                if (!window.confirm('Удалить весь документ?')) return
                if (textEditRef.current) finishTextEditing()
                setPagesSync([]); setCur(0); setFileName(''); setUndoStack([])
                try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
                try { await AuthAPI.clearDraft() } catch {}
                setDraftHint(false)
                toast('Документ удалён', 'success')
                forceLayoutSyncRef.current?.()
              }}
            >
              <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Удалить документ
            </button>

            <button className={`ed-action ${canUndo ? '' : 'disabled'}`} onClick={undoLast}>
              <img src={icUndo} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Отменить
            </button>

            <button className={`ed-action ${pagesRef.current.length ? '' : 'disabled'}`} onClick={rotatePage}>
              <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Повернуть страницу
            </button>

            <button className={`ed-action ${hasActiveOverlay ? '' : 'disabled'}`} onClick={applyToAllPages}>
              <img src={icAddPage} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />На все страницы
            </button>
          </div>

          <div className="ed-download">
            <div className="ed-dl-title">Скачать бесплатно:</div>
            <div className="ed-dl-row">
              <button className={`btn btn-lite ${(!pagesRef.current.length) ? 'disabled' : ''}`} onClick={exportJPG}>
                <img src={icJpgFree} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />JPG
              </button>
              <button className={`btn btn-lite ${(!pagesRef.current.length) ? 'disabled' : ''}`} onClick={exportPDF}>
                <img src={icPdfFree} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />PDF
              </button>
            </div>

            <div className="ed-dl-title" style={{ marginTop: 10 }}>Купить:</div>
            <div className="ed-dl-row ed-dl-row-paid">
              <button className={`btn ${(!pagesRef.current.length) ? 'disabled' : ''}`} onClick={() => { if (pagesRef.current.length) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icJpgPaid} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />JPG
              </button>
              <button className={`btn ${(!pagesRef.current.length) ? 'disabled' : ''}`} onClick={() => { if (pagesRef.current.length) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icPdfPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />PDF
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="ed-bottom">
        <button
          className="fab fab-add mobile-only"
          onClick={() => { if (pagesRef.current.length) toggleMenu('add'); else pickDocument() }}
          title="Добавить"
        >
          <img src={icPlus} alt="+" />
        </button>

        <UnifiedPager
          total={pages.length}
          current={cur}
          pgText={pgText}
          setPgText={setPgText}
          onGo={onPagerGo}
          onPrev={() => setCur(i => Math.max(0, i - 1))}
          onNext={() => { if (canNext) setCur(i => Math.min(pages.length - 1, i + 1)); else pickDocument() }}
          canPrev={canPrev}
          canNext={canNext}
          hasDoc={!!pagesRef.current.length}
          onAdd={pickDocument}
        />

        <button
          className="fab fab-dl mobile-only"
          onClick={() => { if (!pagesRef.current.length) return; toggleMenu('download') }}
          title="Скачать"
        >
          <img src={icDownload} alt="↓" />
        </button>
      </div>

      {menuOpen === 'actions' && (
        <div
          className="ed-sheet"
          ref={sheetActionsRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, maxWidth: '96vw', minWidth: 240 }}
        >
          <button className={pagesRef.current.length ? '' : 'disabled'} onClick={() => { closeMenus(); rotatePage() }}>
            <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Повернуть страницу
          </button>

          <button className={(pagesRef.current.length && pagesRef.current.length > 1) ? '' : 'disabled'} onClick={async () => { closeMenus(); await deletePageAt(cur) }}>
            <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Удалить страницу
          </button>

          <button className={hasActiveOverlay ? '' : 'disabled'} onClick={() => { closeMenus(); applyToAllPages() }}>
            <img src={icAddPage} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />На все страницы
          </button>

          <button
            className={pagesRef.current.length ? '' : 'disabled'}
            onClick={async () => {
              closeMenus()
              if (!pagesRef.current.length) return
              if (!window.confirm('Удалить весь документ?')) return
              if (textEditRef.current) finishTextEditing()
              setPagesSync([]); setCur(0); setFileName(''); setUndoStack([])
              try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
              try { await AuthAPI.clearDraft() } catch {}
              setDraftHint(false)
              toast('Документ удалён', 'success')
              forceLayoutSyncRef.current?.()
            }}
          >
            <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Удалить документ
          </button>
        </div>
      )}

      {menuOpen === 'add' && (
        <div className="ed-sheet bottom-left" ref={sheetAddRef}>
          <button className={pagesRef.current.length ? '' : 'disabled'} onClick={() => { closeMenus(); addText() }}>
            <img src={icText} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить текст
          </button>
          <button onClick={() => { closeMenus(); signFileRef.current?.click() }}>
            <img src={icSign} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить подпись/печать
          </button>
          <button onClick={() => { closeMenus(); pickDocument() }}>
            <img src={icPlus} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить документ/страницу
          </button>
        </div>
      )}

      {menuOpen === 'download' && (
        <div className="ed-sheet bottom-right" ref={sheetDownloadRef} style={{ padding: 6 }}>
          <button
            className={`btn ${pagesRef.current.length ? '' : 'disabled'}`}
            style={{ padding: '10px 14px' }}
            onClick={() => {
              if (pagesRef.current.length) {
                closeMenus()
                setPlan('single')
                setPayOpen(true)
              }
            }}
          >
            <img src={icJpgPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить JPG
          </button>

          <button
            className={`btn ${pagesRef.current.length ? '' : 'disabled'}`}
            style={{ padding: '10px 14px' }}
            onClick={() => {
              if (pagesRef.current.length) {
                closeMenus()
                setPlan('single')
                setPayOpen(true)
              }
            }}
          >
            <img src={icPdfPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить PDF
          </button>

          <button
            className={`btn btn-lite ${pagesRef.current.length ? '' : 'disabled'}`}
            style={{ padding: '10px 14px' }}
            onClick={() => {
              if (pagesRef.current.length) {
                closeMenus()
                exportJPG()
              }
            }}
          >
            <img src={icJpgFree} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Скачать бесплатно JPG
          </button>

          <button
            className={`btn btn-lite ${pagesRef.current.length ? '' : 'disabled'}`}
            style={{ padding: '10px 14px' }}
            onClick={() => {
              if (pagesRef.current.length) {
                closeMenus()
                exportPDF()
              }
            }}
          >
            <img src={icPdfFree} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Скачать бесплатно PDF
          </button>
        </div>
      )}

      {payOpen && (
        <div className="modal-overlay" onClick={() => setPayOpen(false)}>
          <div className="modal pay-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setPayOpen(false)}>×</button>
            <h3 className="modal-title">Чтобы выгрузить документ придётся немного заплатить</h3>

            <div className="pay-grid">
              <button className={`pay-card ${plan === 'single' ? 'active' : ''}`} onClick={() => setPlan('single')} type="button">
                <img className="pay-ill" src={plan1} alt="" />
                <div className="pay-price">{prices.single} ₽</div>
                <div className="pay-sub">один (этот) документ</div>
              </button>
              <button className={`pay-card ${plan === 'month' ? 'active' : ''}`} onClick={() => setPlan('month')} type="button">
                <img className="pay-ill" src={plan2} alt="" />
                <div className="pay-price">{prices.month} ₽</div>
                <div className="pay-sub">безлимит на месяц</div>
              </button>
              <button className={`pay-card ${plan === 'year' ? 'active' : ''}`} onClick={() => setPlan('year')} type="button">
                <img className="pay-ill" src={plan3} alt="" />
                <div className="pay-price">{prices.year} ₽</div>
                <div className="pay-sub">безлимит на год</div>
              </button>
            </div>

            <div className={`pay-controls ${promoError ? 'error' : ''}`}>
              <div className="promo">
                <label className="field-label">Промокод</label>
                <div className="promo-row">
                  <input value={promo} onChange={e => { setPromo(e.target.value); setPromoError('') }} placeholder="Введите промокод" />
                  {promo && (
                    <button className="promo-clear" onClick={() => { setPromo(''); setPromoError(''); setPromoPercent(0) }}>×</button>
                  )}
                </div>
                {promoError && <div className="promo-err">{promoError}</div>}
              </div>

              <div className="pay-buttons">
                <button className="btn btn-lite" onClick={applyPromo}><span className="label">Активировать</span></button>
                <button className="btn" onClick={startPurchase}>
                  <span className="label">
                    Оплатить {Math.max(0, (prices[plan] || 0) * (100 - promoPercent) / 100)} ₽
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {libOpen && (
        <div className="modal-overlay" onClick={() => setLibOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(420px,92vw)', height: 'min(70vh,560px)', display: 'flex', flexDirection: 'column' }}>
            <button className="modal-x" onClick={() => setLibOpen(false)}>×</button>
            <h3 className="modal-title">Библиотека</h3>

            <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '8px' }}>
              <div className="defaults-grid" style={{ gridTemplateColumns: '1fr' }}>
                {signLib.map(item => (
                  <div key={item.id} className="thumb">
                    {item.url && (
                      <img
                        src={item.url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                        onClick={() => { placeFromLib(item.url); setLibOpen(false) }}
                      />
                    )}

                    <button
                      className="thumb-x x-btn x-btn--small"
                      onClick={async () => {
                        if (!window.confirm('Удалить элемент из библиотеки?')) return
                        try {
                          await (item.is_default && item.gid ? AuthAPI.hideDefaultSign(item.gid) : AuthAPI.deleteSign(item.id))
                          await loadLibrary()
                          toast('Удалено', 'success')
                        } catch (e) { toast(e.message || 'Не удалось удалить', 'error') }
                      }}
                    >
                      <img src={icClose} alt="Удалить" />
                    </button>
                  </div>
                ))}
                {(signLib.length === 0) && <div style={{ gridColumn: '1 / -1', opacity: 0.7, padding: 8 }}>Пока пусто</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      <input ref={docFileRef} type="file" accept={ACCEPT_DOC} hidden multiple onChange={onPickDocument} />
      <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={() => {}} />

      <input
        ref={signFileRef}
        type="file"
        accept=".png,.jpg,.jpeg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] || null
          e.target.value = ''
          if (!f) return
          const reader = new FileReader()
          reader.onload = () => {
            setCropSrc(String(reader.result || ''))
            setCropKind('signature')
            setCropThresh(40)
            setCropOpen(true)
          }
          reader.readAsDataURL(f)
        }}
      />

      <CropModal
        open={cropOpen}
        src={cropSrc}
        defaultKind={cropKind}
        defaultThreshold={cropThresh}
        onClose={() => setCropOpen(false)}
        onConfirm={async (kind, dataUrl) => {
          try {
            try { await AuthAPI.addSign({ kind, data_url: dataUrl }); await loadLibrary() } catch {}
            const page = pagesRef.current[cur]
            if (page && engineRef.current) {
              const img = await loadImageEl(dataUrl)
              engineRef.current.addImageOverlay(img, { src: dataUrl })
              scheduleSaveDraftRef.current?.()
              forceLayoutSyncRef.current?.()
            }
          } catch (e) {
            toast(e.message || 'Не удалось обработать изображение', 'error')
          } finally {
            setCropOpen(false)
          }
        }}
      />
    </div>
  )
}

function UnifiedPager ({ total, current, pgText, setPgText, onGo, onPrev, onNext, canPrev, canNext, hasDoc, onAdd }) {
  const onChange = (e) => {
    const v = e.target.value.replace(/[^\d]/g, '')
    setPgText(v)
  }
  const onBlur = () => {
    if (!hasDoc) return
    onGo(pgText)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onGo(pgText)
    }
  }
  return (
    <div className="ed-pager" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button className="pager-btn" onClick={onPrev} disabled={!canPrev} title="Предыдущая">
        <img src={icPrev} alt="Prev" />
      </button>

      <div className="pg" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {hasDoc ? (
          <>
            <input
              className="pg-input"
              type="number"
              min={1}
              max={Math.max(1, total)}
              value={pgText}
              onChange={onChange}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              style={{ width: 64, textAlign: 'center', height: 36 }}
            />
            <span className="pg-total">/ {total || 0}</span>
          </>
        ) : (
          <span className="pg-total">0/0</span>
        )}
      </div>

      <button className="pager-btn" onClick={onNext} title={canNext ? 'Следующая' : 'Добавить документ'}>
        {canNext ? (
          <img src={icPrev} alt="Next" style={{ transform: 'rotate(180deg)' }} />
        ) : (
          <img src={icPlus} alt="+" onClick={onAdd} />
        )}
      </button>
    </div>
  )
}
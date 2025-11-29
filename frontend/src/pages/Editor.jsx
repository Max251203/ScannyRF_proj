// FIXED VERSION Editor.jsx — часть 1/3
import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric, ensurePDFJS, ensureHtml2Canvas, ensureMammothCDN,
  ensureSheetJS, ensureJsPDF, ensureJSZip, ensureScripts
} from '../utils/scriptLoader'
import { EditorWS } from '../utils/wsClient'
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

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

// Иконки крестика и поворота
import icClose from '../assets/icons/x-close.svg'
import icRotateHandle from '../assets/icons/rotate-handle.svg'

const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial', 'Times New Roman', 'Ermilov', 'Segoe UI', 'Roboto', 'Georgia']
const PDF_RENDER_SCALE = 3.0
const RASTER_RENDER_SCALE = 3.0

// UI-константы (в ЭКРАННЫХ пикселях)
const UI_CORNER_SIZE = 10
const UI_TOUCH_CORNER_SIZE = 24
const UI_DELETE_RADIUS = 11           // радиус кружка delete
const UI_DELETE_OFFSET = 14           // отступ delete от рамки
const UI_ROT_OFFSET = 80  // было 48–60, делаем явно больше

// Глобальные картинки для кастомных контроллов
let DELETE_ICON_IMG = null
let ROTATE_ICON_IMG = null

function ensureControlIconsLoaded () {
  if (!DELETE_ICON_IMG) {
    DELETE_ICON_IMG = new Image()
    DELETE_ICON_IMG.src = icClose
  }
  if (!ROTATE_ICON_IMG) {
    ROTATE_ICON_IMG = new Image()
    ROTATE_ICON_IMG.src = icRotateHandle
  }
}

// FIX#4: гасим скролл от скрытого textarea Fabric + уводим его за экран
function suppressFabricScroll () {
  const F = window.fabric
  if (!F || !F.hiddenTextarea) return
  const ta = F.hiddenTextarea
  if (ta.__noScrollPatched) return
  try {
    ta.scrollIntoView = () => {}
  } catch {}
  ta.style.position = 'fixed'
  ta.style.top = '-10000px'
  ta.style.left = '-10000px'
  ta.__noScrollPatched = true
}

async function ensurePDFLib () {
  if (window.PDFLib) return window.PDFLib
  await ensureScripts(['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'])
  if (!window.PDFLib) throw new Error('Не удалось загрузить pdf-lib')
  return window.PDFLib
}

function toUint8Copy (input) {
  if (input instanceof Uint8Array) {
    const out = new Uint8Array(input.length); out.set(input); return out
  }
  if (input instanceof ArrayBuffer) {
    const view = new Uint8Array(input); const out = new Uint8Array(view.length); out.set(view); return out
  }
  return new Uint8Array()
}
function u8ToB64 (u8) {
  let bin = ''; const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
  return btoa(bin)
}
function b64ToU8 (b64) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
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
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
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
    tctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, tmp.width, tmp.height)
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

function fitCanvasForPage (page) {
  if (!page || !page.canvas) return
  const cv = page.canvas
  const wrap = cv.wrapperEl ? cv.wrapperEl.parentNode : null
  const container = document.querySelector('.ed-canvas-wrap')
  if (!wrap || !container) return

  const contW = container.clientWidth
  const contH = container.clientHeight
  if (contW < 10 || contH < 10) return

  const docW = cv.width
  const docH = cv.height

  const isMobile = window.matchMedia('(max-width: 960px)').matches
  const margin = isMobile ? 0 : 24

  const availW = Math.max(100, contW - margin)
  const availH = Math.max(100, contH - margin)

  const scale = Math.min(availW / docW, availH / docH) || 1

  const finalW = Math.floor(docW * scale)
  const finalH = Math.floor(docH * scale)

  wrap.style.width = `${finalW}px`
  wrap.style.height = `${finalH}px`

  if (cv.wrapperEl) {
    cv.wrapperEl.style.transform = `scale(${scale}) translateZ(0)`
    cv.wrapperEl.style.transformOrigin = 'top left'
    cv.wrapperEl.style.width = `${docW}px`
    cv.wrapperEl.style.height = `${docH}px`
  }

  cv.__uiScale = scale
  page.__uiScale = scale
  cv.calcOffset()
}

function randDocId () { return String(Math.floor(1e15 + Math.random() * 9e15)) }
function genDefaultName () { const a = Math.floor(Math.random() * 1e6), b = Math.floor(Math.random() * 1e6); return `${a}-${b}` }
function sanitizeName (s) {
  s = (s || '').normalize('NFKC')
  s = s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '')
  return s.slice(0, 64) || genDefaultName()
}
function setDraftHint (flag) {
  try {
    localStorage.setItem('has_draft', flag ? '1' : '0')
  } catch {}
}

// ---------- КОМПОНЕНТ EDITOR ----------

export default function Editor () {
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState([])
  const [cur, setCur] = useState(0)
  const hasDoc = pages.length > 0
  const canPrev = hasDoc && cur > 0
  const canNext = hasDoc && cur < pages.length - 1
  const [signLib, setSignLib] = useState([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [font, setFont] = useState('Arial')
  const [fontSize, setFontSize] = useState(42)
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [color, setColor] = useState('#000000')
  const [menuActionsOpen, setMenuActionsOpen] = useState(false)
  const [menuAddOpen, setMenuAddOpen] = useState(false)
  const [menuDownloadOpen, setMenuDownloadOpen] = useState(false)
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
  const showBanner = (text, timeout = 1800) => {
    setBanner(text)
    window.clearTimeout(showBanner._t)
    showBanner._t = window.setTimeout(() => setBanner(''), timeout)
  }
  const [libOpen, setLibOpen] = useState(false)
  const pagesRef = useRef(pages)
  const docIdRef = useRef(docId)
  const fileNameRef = useRef(fileName)
  useEffect(() => { pagesRef.current = pages }, [pages])
  useEffect(() => { docIdRef.current = docId }, [docId])
  useEffect(() => { fileNameRef.current = fileName }, [fileName])
  const wsRef = useRef(null)
  const draftExistsRef = useRef(false)
  const initialRenderPendingRef = useRef(false)
  const restPatchBufferRef = useRef([])
  const restPatchTimerRef = useRef(0)

  const [progress, setProgress] = useState({
    active: false,
    mode: null,
    phase: null,
    label: '',
    val: 0,
    max: 0,
    suffix: ''
  })

  function flushRestPatchesSoon () {
    window.clearTimeout(restPatchTimerRef.current)
    restPatchTimerRef.current = window.setTimeout(async () => {
      const ops = restPatchBufferRef.current
      restPatchBufferRef.current = []
      if (!isAuthed || ops.length === 0) return
      try { await AuthAPI.patchDraft(ops); setDraftHint(true) } catch {}
    }, 240)
  }
  function sendPatch (ops) {
    if (!isAuthed || !ops || ops.length === 0) return
    try { wsRef.current?.sendPatch(ops) } catch {}
    restPatchBufferRef.current.push(...ops)
    flushRestPatchesSoon()
  }

  useEffect(() => {
    document.body.classList.add('no-footer')
    document.documentElement.classList.add('no-footer')
    return () => {
      document.body.classList.remove('no-footer')
      document.documentElement.classList.remove('no-footer')
    }
  }, [])

  const canvasWrapRef = useRef(null)
  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const sheetActionsRef = useRef(null)
  const sheetAddRef = useRef(null)
  const sheetDownloadRef = useRef(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches)

  // FIX#1.0: гарантируем настройку глобальных контроллов Fabric сразу после монтирования редактора
  useEffect(() => {
    (async () => {
      try {
        await ensureFabric()
        installDeleteControl()
        suppressFabricScroll()
      } catch {}
    })()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const on = () => setIsMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const onTopMenuClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8 + window.scrollY, left: r.left + window.scrollX })
    setMenuActionsOpen(o => !o)
  }

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
        loadLibrary()
        if (docIdRef.current) ensureWS()
      } else {
        try { wsRef.current?.destroy?.() } catch {}
        wsRef.current = null
      }
    }
    const onBill = (e) => {
      const st = e.detail
      setBilling(st)
      if (st && ('price_single' in st)) {
        setPrices({
          single: Number(st.price_single || 0),
          month: Number(st.price_month || 0),
          year: Number(st.price_year || 0)
        })
      }
    }
    const onStorage = () => {
      const t = localStorage.getItem('access') || ''
      if (wsRef.current) wsRef.current.setToken(t)
    }
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('user:update', onUser)
      window.removeEventListener('billing:update', onBill)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  function throttle (fn, wait = 160) {
    let last = 0; let tid = null
    return (...args) => {
      const now = Date.now()
      if (now - last >= wait) {
        last = now
        fn(...args)
      } else {
        clearTimeout(tid)
        tid = setTimeout(() => { last = Date.now(); fn(...args) }, wait)
      }
    }
  }

  useEffect(() => {
    if (!canvasWrapRef.current) return
    const handleResize = throttle(() => {
      pagesRef.current.forEach((p) => { if (p?.canvas) fitCanvasForPage(p) })
    }, 50)
    const ro = new ResizeObserver(handleResize)
    ro.observe(canvasWrapRef.current)
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  async function loadLibrary () {
    if (!isAuthed) { setSignLib([]); return }
    try {
      const list = await AuthAPI.listSigns()
      setSignLib(Array.isArray(list) ? list : [])
    } catch {
      setSignLib([])
    }
  }

  useEffect(() => {
    if (isAuthed) loadLibrary()
  }, [isAuthed])

  function ensureWS () {
    if (!isAuthed || !docIdRef.current) return
    const token = localStorage.getItem('access') || ''
    if (!token) return
    const apiBase = AuthAPI.getApiBase()
    if (!wsRef.current) {
      wsRef.current = new EditorWS({ clientId: docIdRef.current, token, apiBase })
    } else {
      wsRef.current.setClientId(docIdRef.current)
      wsRef.current.setToken(token)
    }
    try { wsRef.current.connect() } catch {}
  }

  useEffect(() => {
    if (isAuthed && docId) ensureWS()
  }, [isAuthed, docId])

  useEffect(() => {
    return () => {
      try { wsRef.current?.destroy?.() } catch {}
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isAuthed) return

    ;(async () => {
      let srv
      try {
        srv = await AuthAPI.getDraft()
      } catch {
        return
      }
      if (!srv || !srv.exists || !srv.data) {
        setDraftHint(false)
        return
      }

      const total = Array.isArray(srv.data.pages) ? srv.data.pages.length : 0

      setProgress({
        active: true,
        mode: 'restore',
        phase: null,
        label: 'Восстановление документа',
        val: 0,
        max: total || 1,
        suffix: 'стр.'
      })

      await restoreDocumentFromDraft(srv.data, (idx, t) => {
        setProgress(p => ({ ...p, val: idx, max: t || p.max || 1 }))
      })

      setDraftHint(true)
      setProgress(p => ({ ...p, val: p.max, active: false }))
      showBanner('Восстановлен последний документ')
    })()
  }, [isAuthed])

  const ctxRef = useRef(null)
  const ensurePageRenderedRef = useRef(null)
  useEffect(() => {
    const ctx = { pagesRef, setPages, sendPatch }
    ctxRef.current = ctx
    ensurePageRenderedRef.current = ensurePageRenderedFactory(ctx)
  }, [pagesRef, setPages, sendPatch])

  function ensurePageRendered (index) {
    let fn = ensurePageRenderedRef.current
    if (typeof fn !== 'function') {
      ensurePageRenderedRef.current = ensurePageRenderedFactory(ctxRef.current || { pagesRef, setPages, sendPatch })
      fn = ensurePageRenderedRef.current
    }
    return fn(index)
  }

  useEffect(() => {
    if (initialRenderPendingRef.current && pages.length > 0) {
      const fn = (typeof ensurePageRenderedRef.current === 'function')
        ? ensurePageRenderedRef.current
        : ensurePageRenderedFactory(ctxRef.current || { pagesRef, setPages, sendPatch })
      ;(async () => {
        for (let i = 0; i < pages.length; i++) {
          await fn(i)
        }
        initialRenderPendingRef.current = false
      })()
    }
  }, [pages])

  // ---------- КАСТОМНЫЕ КОНТРОЛЛЫ FABRIC (DELETE + ROTATE) ----------

  function installDeleteControl () {
  const fobj = window.fabric?.Object
  if (!fobj || fobj.__scannyControlsPatched) return
  const F = window.fabric
  ensureControlIconsLoaded()
  suppressFabricScroll()

  F.Object.prototype.borderScaleFactor = 3
  F.Object.prototype.transparentCorners = false
  F.Object.prototype.cornerStyle = 'circle'
  F.Object.prototype.cornerColor = '#E26D5C'
  F.Object.prototype.borderColor = '#3C6FD8'

  const origMtr = fobj.prototype.controls.mtr || F.Object.prototype.controls.mtr

  const del = new F.Control({
    x: 0.5,
    y: -0.5,
    offsetX: 0,
    offsetY: 0,
    cursorStyle: 'pointer',
    mouseUpHandler: (_, tr) => {
      const t = tr?.target
      const cv = t?.canvas
      if (!cv || !t) return true
      const pageIndex = typeof cv.__pageIndex === 'number' ? cv.__pageIndex : -1
      const onPatch = cv.__onPatch
      const oid = t.__scannyId || null

      if (!window.confirm('Удалить объект со страницы?')) return true

      cv.remove(t)
      cv.discardActiveObject()
      cv.requestRenderAll()

      if (oid && pageIndex >= 0 && typeof onPatch === 'function') {
        onPatch([{ op: 'overlay_remove', page: pageIndex, id: oid }])
      }
      toast('Объект удалён', 'success')
      return true
    },
    render: (ctx, left, top, styleOverride, fabricObject) => {
      const uiScale = fabricObject?.canvas?.__uiScale || 1
      const radiusScreen = UI_DELETE_RADIUS
      const radiusCanvas = radiusScreen / uiScale
      const iconSizeScreen = radiusScreen * 2 * 0.9
      const iconSizeCanvas = iconSizeScreen / uiScale

      ctx.save()
      ctx.beginPath()
      ctx.arc(left, top, radiusCanvas, 0, Math.PI * 2)
      ctx.fillStyle = '#E26D5C'
      ctx.fill()

      if (DELETE_ICON_IMG && DELETE_ICON_IMG.complete) {
        ctx.drawImage(
          DELETE_ICON_IMG,
          left - iconSizeCanvas / 2,
          top - iconSizeCanvas / 2,
          iconSizeCanvas,
          iconSizeCanvas
        )
      } else {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 / uiScale
        const c = radiusCanvas * 0.6
        ctx.beginPath()
        ctx.moveTo(left - c, top - c)
        ctx.lineTo(left + c, top + c)
        ctx.moveTo(left + c, top - c)
        ctx.lineTo(left - c, top + c)
        ctx.stroke()
      }
      ctx.restore()
    }
  })

  const mtrCfg = {
    ...(origMtr || {}),
    withConnection: false,
    render: (ctx, left, top, styleOverride, fabricObject) => {
      const uiScale = fabricObject?.canvas?.__uiScale || 1
      const sizeScreen = 24
      const sizeCanvas = sizeScreen / uiScale

      ctx.save()
      if (ROTATE_ICON_IMG && ROTATE_ICON_IMG.complete) {
        ctx.drawImage(
          ROTATE_ICON_IMG,
          left - sizeCanvas / 2,
          top - sizeCanvas / 2,
          sizeCanvas,
          sizeCanvas
        )
      } else {
        ctx.fillStyle = '#E26D5C'
        ctx.beginPath()
        ctx.arc(left, top, sizeCanvas / 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }
  const mtr = new F.Control(mtrCfg)

  window.__scannyDelControl = del
  window.__scannyMtrControl = mtr

  fobj.prototype.controls.tr = del
  fobj.prototype.controls.mtr = mtr
  fobj.__scannyControlsPatched = true
}

    function ensureDeleteControlFor (obj) {
    try {
      // 1) Гарантируем, что глобальные контроллы проинициализированы
      installDeleteControl()

      const cv = obj.canvas
      const uiScale = cv?.__uiScale || 1

      if (obj.controls) {
        if (window.__scannyDelControl) {
          obj.controls.tr = window.__scannyDelControl
        }
        if (window.__scannyMtrControl) {
          obj.controls.mtr = window.__scannyMtrControl
        }
      }

      const rotOffsetCanvas = UI_ROT_OFFSET / uiScale
      const delOffsetCanvas = UI_DELETE_OFFSET / uiScale

      obj.set({
        hasControls: true,
        hasBorders: true,
        lockUniScaling: false,
        transparentCorners: false,
        cornerStyle: 'circle',
        cornerColor: '#E26D5C',
        borderColor: '#3C6FD8',
        borderDashArray: null,
        borderScaleFactor: 3,
        hasRotatingPoint: true,
        rotatingPointOffset: rotOffsetCanvas,
        cornerSize: Math.max(4, Math.round(UI_CORNER_SIZE / uiScale)),
        touchCornerSize: Math.max(8, Math.round(UI_TOUCH_CORNER_SIZE / uiScale))
      })

      if (obj.controls && obj.controls.tr) {
        obj.controls.tr.offsetX = delOffsetCanvas
        obj.controls.tr.offsetY = -delOffsetCanvas
      }

      obj.setCoords()
    } catch {}
  }

  function clamp (obj) {
    obj.setCoords()
    const w = obj.canvas.width
    const h = obj.canvas.height
    const r = obj.getBoundingRect()
    const EPS = 1
    if (r.width - w > EPS) {
      const currentScale = obj.scaleX || 1
      const newScale = currentScale * (w / r.width)
      obj.scaleX = newScale
      obj.scaleY = newScale
      obj.setCoords()
    }
    if (r.height - h > EPS) {
      const currentScale = obj.scaleY || 1
      const newScale = currentScale * (h / r.height)
      obj.scaleX = newScale
      obj.scaleY = newScale
      obj.setCoords()
    }
    const br = obj.getBoundingRect()
    let dx = 0
    let dy = 0
    if (br.left < -EPS) {
      dx = -br.left
    } else if (br.left + br.width - w > EPS) {
      dx = w - (br.left + br.width)
    }
    if (br.top < -EPS) {
      dy = -br.top
    } else if (br.top + br.height - h > EPS) {
      dy = h - (br.top + br.height)
    }
    if (dx || dy) {
      obj.left += dx
      obj.top += dy
      obj.setCoords()
    }
  }

  async function ensureCanvas (page, pageIndex, onPatch) {
    await ensureFabric()
    installDeleteControl()
    suppressFabricScroll()
    if (page.canvas) return page.canvas
    await new Promise((res, rej) => {
      const t0 = Date.now()
      ;(function loop () {
        const el = document.getElementById(page.elId)
        if (el) return res(el)
        if (Date.now() - t0 > 8000) return rej(new Error('Canvas element timeout'))
        requestAnimationFrame(loop)
      })()
    })
    const c = new window.fabric.Canvas(page.elId, {
      backgroundColor: '#fff',
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: true
    })
    c.targetFindTolerance = 20
    c.perPixelTargetFind = false
    c.defaultCursor = 'default'
    c.hoverCursor = 'move'
    c.__pageRef = page
    c.__pageIndex = pageIndex
    c.__onPatch = onPatch
    page.canvas = c

    const onSelectionChanged = (e) => {
      const obj = e?.selected?.[0]
      if (obj && obj.type === 'textbox') {
        setPanelOpen(true)
        setFont(obj.fontFamily || 'Arial')
        setFontSize(Number(obj.fontSize || 42))
        setBold(!!(obj.fontWeight === 'bold' || obj.fontWeight === 700))
        setItalic(!!(obj.fontStyle === 'italic'))
        setColor(obj.fill || '#000000')
      } else setPanelOpen(false)
    }
    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', () => setPanelOpen(false))
    c.on('object:moving', (e) => { if (e.target) clamp(e.target) })
    c.on('object:scaling', (e) => { if (e.target) clamp(e.target) })
    c.on('object:rotating', (e) => { if (e.target) clamp(e.target) })

    function overlayFromObject (obj) {
      const base = {
        id: obj.__scannyId || ('ov_' + Math.random().toString(36).slice(2)),
        left: obj.left || 0,
        top: obj.top || 0,
        angle: obj.angle || 0,
        flipX: !!obj.flipX,
        flipY: !!obj.flipY,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1
      }
      if (obj.type === 'textbox') {
        return {
          t: 'tb', ...base,
          text: obj.text || '',
          fontFamily: obj.fontFamily || 'Arial',
          fontSize: obj.fontSize || 42,
          fontStyle: obj.fontStyle || 'normal',
          fontWeight: obj.fontWeight || 'normal',
          fill: obj.fill || '#000',
          width: Math.max(20, Number(obj.width || 200)),
          textAlign: obj.textAlign || 'left'
        }
      } else if (obj.type === 'image') {
        const src = obj.__srcOriginal || (obj._originalElement?.src || obj._element?.src) || ''
        return { t: 'im', ...base, src }
      }
      return { t: 'unknown', ...base }
    }
    function sendUpsertForObject (obj) {
      if (!c.__onPatch) return
      const ov = overlayFromObject(obj)
      if (!obj.__scannyId) obj.__scannyId = ov.id
      c.__onPatch([{ op: 'overlay_upsert', page: c.__pageIndex, obj: ov }])
    }
    c.on('object:modified', (e) => { if (e.target) sendUpsertForObject(e.target) })
    try { c.on('text:changed', (e) => { if (e.target) { c.requestRenderAll(); sendUpsertForObject(e.target) } }) } catch {}

    installDeleteControl()

    return c
  }

  function ensurePageRenderedFactory (ctx) {
    const { pagesRef, sendPatch } = ctx
    return async function ensurePageRenderedInner (index) {
      const page = pagesRef.current?.[index]
      if (!page) return
      const cv = await ensureCanvas(page, index, sendPatch)
      if (page._bgRendered) {
        fitCanvasForPage(page)
        const objs = cv.getObjects() || []
        for (const o of objs) {
          if (o !== page.bgObj) {
            ensureDeleteControlFor(o)
          }
        }
        cv.requestRenderAll()
        return
      }
      try {
        const pg = page.meta || {}
        if (pg.type === 'pdf' && pg.bytes) {
          await ensurePDFJS()
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({ data: pg.bytes.slice() }).promise
          const off = await renderPDFPageToCanvas(pdf, (pg.index || 0) + 1, PDF_RENDER_SCALE)
          const url = off.toDataURL('image/png')
          // eslint-disable-next-line no-undef
          const img = new fabric.Image(await loadImageEl(url), {
            selectable: false, evented: false, objectCaching: false, noScaleCache: true
          })
          if (!pg.doc_w || !pg.doc_h) {
            pg.doc_w = off.width
            pg.doc_h = off.height
          }
          placeBgObject(cv, page, img)
        } else if ((pg.type === 'image' || pg.type === 'raster') && pg.src) {
          const im = await loadImageEl(pg.src)
          // eslint-disable-next-line no-undef
          const img = new fabric.Image(im, {
            selectable: false, evented: false, objectCaching: false, noScaleCache: true
          })
          if (!pg.doc_w || !pg.doc_h) {
            pg.doc_w = pg.w || im.naturalWidth || im.width
            pg.doc_h = pg.h || im.naturalHeight || im.height
          }
          placeBgObject(cv, page, img)
        }
        page._bgRendered = true
        const overlays = Array.isArray(page._pendingOverlays) ? page._pendingOverlays : []
        if (overlays.length) {
          // eslint-disable-next-line no-undef
          const F = fabric
          for (const o of overlays) {
            const type = o.t || (o.text !== undefined ? 'tb' : (o.src ? 'im' : 'unknown'))
            if (type === 'tb') {
              const tb = new F.Textbox(o.text || '', {
                left: o.left || 0, top: o.top || 0, angle: o.angle || 0,
                fontFamily: o.fontFamily || 'Arial',
                fontSize: o.fontSize || 42,
                fontStyle: o.fontStyle || 'normal',
                fontWeight: o.fontWeight || 'normal',
                fill: o.fill || '#000',
                width: Math.max(20, Number(o.width || 200)),
                textAlign: o.textAlign || 'left',
                scaleX: Number(o.scaleX || 1), scaleY: Number(o.scaleY || 1),
                selectable: true, objectCaching: true, noScaleCache: false
              })
              tb.__scannyId = o.id || ('ov_' + Math.random().toString(36).slice(2))
              ensureDeleteControlFor(tb); cv.add(tb)
            } else if (type === 'im' && o.src) {
              const im = new F.Image(await loadImageEl(o.src), {
                left: o.left || 0, top: o.top || 0, angle: o.angle || 0,
                flipX: !!o.flipX, flipY: !!o.flipY,
                scaleX: Number(o.scaleX || 1), scaleY: Number(o.scaleY || 1),
                selectable: true, objectCaching: true, noScaleCache: false
              })
              im.__scannyId = o.id || ('ov_' + Math.random().toString(36).slice(2))
              im.__srcOriginal = o.src
              ensureDeleteControlFor(im); cv.add(im)
            }
          }
          page._pendingOverlays = []
        }
        fitCanvasForPage(page)
        const objs = cv.getObjects() || []
        for (const o of objs) {
          if (o !== page.bgObj) {
            ensureDeleteControlFor(o)
          }
        }
        cv.requestRenderAll()
      } catch (e) {
        console.warn('ensurePageRendered failed', e)
      }
    }
  }

  function placeBgObject (cv, page, img) {
    page.bgObj = img
    const meta = page.meta || {}
    const contentW = meta.type === 'pdf'
      ? (meta.pdf_w || img.width || 1)
      : (meta.w || img.width || 1)
    const contentH = meta.type === 'pdf'
      ? (meta.pdf_h || img.height || 1)
      : (meta.h || img.height || 1)
    const targetW = meta.doc_w || contentW
    const targetH = meta.doc_h || contentH
    cv.setDimensions({ width: targetW, height: targetH })
    cv.add(img)
    img.sendToBack()
    const s = Math.min(targetW / contentW, targetH / contentH) || 1
    img.scaleX = s
    img.scaleY = s
    img.center()
    img.setCoords()
  }

  async function rotatePage () {
    if (!pagesRef.current || pagesRef.current.length === 0) return
    const page = pagesRef.current[cur]
    const cv = await ensureCanvas(page, cur, sendPatch)

    const oldW = cv.width
    const oldH = cv.height
    let anchorX = oldW / 2
    let anchorY = oldH / 2
    let oldBgScale = 1

    if (page.bgObj) {
      const center = page.bgObj.getCenterPoint()
      anchorX = center.x
      anchorY = center.y
      oldBgScale = page.bgObj.scaleX || 1
    }

    const newW = oldH
    const newH = oldW
    const newCx = newW / 2
    const newCy = newH / 2
    cv.setDimensions({ width: newW, height: newH })

    let newBgScale = 1
    if (page.bgObj) {
      const w = page.bgObj.width || 1
      const h = page.bgObj.height || 1
      newBgScale = Math.min(newW / w, newH / h)
    } else {
      newBgScale = newW / oldW
    }
    const scaleFactor = newBgScale / oldBgScale

    if (page.bgObj) {
      page.bgObj.scaleX = newBgScale
      page.bgObj.scaleY = newBgScale
      page.bgObj.center()
      page.bgObj.setCoords()
    }

    const objs = cv.getObjects().filter(o => o !== page.bgObj)
    // FIX#1: поворачиваем все объекты вокруг центра страницы (как раньше)
    for (const obj of objs) {
      const objCenter = obj.getCenterPoint()
      const vecX = objCenter.x - anchorX
      const vecY = objCenter.y - anchorY
      const newVecX = vecX * scaleFactor
      const newVecY = vecY * scaleFactor
      const finalX = newCx + newVecX
      const finalY = newCy + newVecY
      obj.scaleX = obj.scaleX * scaleFactor
      obj.scaleY = obj.scaleY * scaleFactor
      // eslint-disable-next-line no-undef
      obj.setPositionByOrigin(new fabric.Point(finalX, finalY), 'center', 'center')
      obj.setCoords()
      clamp(obj)
    }

    page.meta.doc_w = newW
    page.meta.doc_h = newH
    page.landscape = !page.landscape
    fitCanvasForPage(page)

    cv.getObjects().forEach(o => {
      if (o !== page.bgObj) ensureDeleteControlFor(o)
    })
    cv.requestRenderAll()

    const active = cv.getActiveObject()
    if (active) {
      active.setCoords()
      cv.fire('object:modified', { target: active })
    }

    try {
      const snapshot = await serializeDocument()
      if (snapshot) {
        await AuthAPI.saveDraft(snapshot)
        setDraftHint(true)
      }
    } catch {}
  }

  async function deletePageAt (idx) {
    if (!pagesRef.current?.length) return
    if (pagesRef.current.length <= 1) {
      if (!window.confirm('Удалить весь документ?')) return
      pagesRef.current.forEach(pp => { try { pp.canvas?.dispose?.() } catch {} })
      setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
      try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
      try { await AuthAPI.clearDraft() } catch {}
      draftExistsRef.current = false
      setDocId(null)
      setDraftHint(false)
      toast('Документ удалён', 'success')
      return
    }
    if (!window.confirm('Удалить текущую страницу?')) return
    const p = pagesRef.current[idx]; try { p.canvas?.dispose?.() } catch {}
    const nextPages = pagesRef.current.filter((_, i) => i !== idx)
    setPages(nextPages)
    setCur(i => Math.max(0, idx - 1))
    await persistPageOps([{ op: 'page_remove', index: idx }])
    toast('Страница удалена', 'success')
  }

  async function persistPageOps (ops = []) {
    const list = Array.isArray(ops) ? ops.filter(Boolean) : []
    if (list.length === 0) return
    if (!draftExistsRef.current) {
      const snapshot = await serializeDocument()
      if (snapshot) {
        try {
          await AuthAPI.saveDraft(snapshot)
          wsRef.current?.commit?.(snapshot)
          draftExistsRef.current = true
          setDraftHint(true)
        } catch {}
      }
      return
    }
    try { wsRef.current?.sendPatch?.(list) } catch {}
    try {
      await AuthAPI.patchDraft(list)
      setDraftHint(true)
    } catch {
      try {
        const snapshot = await serializeDocument()
        if (snapshot) {
          await AuthAPI.saveDraft(snapshot)
          wsRef.current?.commit?.(snapshot)
          draftExistsRef.current = true
          setDraftHint(true)
        }
      } catch {}
    }
  }

  async function createPageFromImage (dataUrl, w, h, mime = 'image/png', landscape = false, opsOut = null, index = null) {
    const id = 'p_' + Math.random().toString(36).slice(2)
    const elId = 'cv_' + id
    const meta = { type: 'image', src: dataUrl, w, h, mime, doc_w: w, doc_h: h }
    const page = { id, elId, canvas: null, bgObj: null, landscape: !!landscape, meta, _bgRendered: false, _pendingOverlays: [] }
    setPages(prev => [...prev, page])
    if (Array.isArray(opsOut) && Number.isInteger(index)) {
      opsOut.push({ op: 'page_add', index, page: { type: 'image', src: dataUrl, w: Math.round(w), h: Math.round(h), mime, landscape: !!landscape, overlays: [] } })
    }
    await new Promise(r => requestAnimationFrame(r))
    return page
  }

  async function addRasterPagesFromCanvas (canvas, opsOut = null, indexStart = null) {
    const slices = sliceCanvasToPages(canvas)
    let count = 0
    for (const url of slices) {
      const im = await loadImageEl(url)
      const w = im.naturalWidth || im.width; const h = im.naturalHeight || im.height
      const idx = Number.isInteger(indexStart) ? indexStart + count : null
      await createPageFromImage(url, w, h, 'image/png', false, opsOut, idx)
      count += 1
    }
    return count
  }

  async function addPagesFromPDFBytes (bytes, opsOut = null, indexStart = null) {
    await ensurePDFJS()
    // eslint-disable-next-line no-undef
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const total = pdf.numPages
    const bytes_b64 = u8ToB64(bytes)
    let added = 0
    for (let i = 1; i <= total; i++) {
      const p = await pdf.getPage(i)
      const vp1 = p.getViewport({ scale: PDF_RENDER_SCALE })
      const pdf_w = Math.round(vp1.width); const pdf_h = Math.round(vp1.height)
      const id = 'p_' + Math.random().toString(36).slice(2); const elId = 'cv_' + id
      const meta = { type: 'pdf', bytes: toUint8Copy(bytes), index: i - 1, pdf_w, pdf_h, doc_w: pdf_w, doc_h: pdf_h }
      const page = { id, elId, canvas: null, bgObj: null, landscape: false, meta, _bgRendered: false, _pendingOverlays: [] }
      setPages(prev => [...prev, page])
      if (Array.isArray(opsOut) && Number.isInteger(indexStart)) {
        opsOut.push({ op: 'page_add', index: indexStart + added, page: { type: 'pdf', index: i - 1, bytes_b64, pdf_w, pdf_h, landscape: false, overlays: [] } })
      }
      added += 1
      await new Promise(r => requestAnimationFrame(r))
    }
    return added
  }

  function baseName () {
    const nm = (fileNameRef.current || '').trim()
    if (!nm) { toast('Введите название файла при скачивании', 'error'); return null }
    return sanitizeName(nm)
  }

  const filePickBusyRef = useRef(false)

  function pickDocument () {
    if (filePickBusyRef.current) return
    filePickBusyRef.current = true
    try { docFileRef.current?.click() } finally { setTimeout(() => { filePickBusyRef.current = false }, 1500) }
  }

  async function onPickDocument (e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    await handleFiles(files)
    filePickBusyRef.current = false
  }

  async function onPickBgFile (e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    await assignFirstFileToCurrent(files[0])
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
        phase: null,
        label: 'Обработка документа',
        val: 0,
        max: totalUnits,
        suffix: 'стр.'
      })

      let curDocId = docIdRef.current
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId) }
      ensureWS()
      const baseIndex = pagesRef.current?.length || 0
      let addedPages = 0
      let initialName = fileNameRef.current
      const opsAdd = []
      let doneUnits = 0
      const tick = (inc = 1) => {
        doneUnits += inc
        setProgress(p => ({ ...p, val: doneUnits }))
      }

      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (!initialName) {
          const base = f.name.replace(/\.[^.]+$/, '')
          initialName = sanitizeName(base)
          setFileName(initialName)
        }
        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          const url = await readAsDataURL(f); const img = await loadImageEl(url); const idx = baseIndex + addedPages
          await createPageFromImage(url, img.naturalWidth || img.width, img.naturalHeight || img.height, f.type || 'image/png', false, opsAdd, idx)
          addedPages += 1; tick(1)
        } else if (ext === 'pdf') {
          const ab = await f.arrayBuffer(); const bytes = toUint8Copy(ab); const n = await addPagesFromPDFBytes(bytes, opsAdd, baseIndex + addedPages)
          addedPages += n; tick(n)
        } else if (['docx', 'doc'].includes(ext)) {
          const canv = await renderDOCXToCanvas(f); const n = await addRasterPagesFromCanvas(canv, opsAdd, baseIndex + addedPages)
          addedPages += n; tick(Math.max(1, n))
        } else if (['xls', 'xlsx'].includes(ext)) {
          const canv = await renderXLSXToCanvas(f); const n = await addRasterPagesFromCanvas(canv, opsAdd, baseIndex + addedPages)
          addedPages += n; tick(Math.max(1, n))
        } else {
          toast(`Формат не поддерживается: ${ext}`, 'error')
          tick(1)
        }
      }
      await new Promise(r => requestAnimationFrame(r))
      for (let i = 0; i < pagesRef.current.length; i++) { await ensurePageRendered(i) }
      if (addedPages > 0) { await persistPageOps(opsAdd) }
      try {
        if (isAuthed && addedPages > 0) {
          const nm = sanitizeName(initialName || fileNameRef.current || genDefaultName())
          await AuthAPI.recordUpload(curDocId, nm, addedPages)
        }
      } catch {}
      toast('Страницы добавлены', 'success')
    } catch (err) {
      console.error(err)
      toast(err.message || 'Ошибка загрузки файлов', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  async function assignFirstFileToCurrent (file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const page = pages[cur]
    if (!page) return
    setProgress({
      active: true,
      mode: 'upload',
      phase: null,
      label: 'Обновление страницы',
      val: 0,
      max: 0,
      suffix: ''
    })
    try {
      if (['jpg', 'jpeg', 'png'].includes(ext)) {
        const url = await readAsDataURL(file); const img = await loadImageEl(url)
        page.meta = { type: 'image', src: url, w: img.naturalWidth, h: img.naturalHeight, mime: 'image/png', doc_w: img.naturalWidth, doc_h: img.naturalHeight }
        page._bgRendered = false; await ensurePageRendered(cur)
      } else if (ext === 'pdf') {
        const ab = await file.arrayBuffer(); const bytes = toUint8Copy(ab)
        // eslint-disable-next-line no-undef
        const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; const p1 = await pdf.getPage(1); const vp1 = p1.getViewport({ scale: PDF_RENDER_SCALE })
        page.meta = { type: 'pdf', bytes, index: 0, pdf_w: vp1.width, pdf_h: vp1.height, doc_w: vp1.width, doc_h: vp1.height }
        page._bgRendered = false; await ensurePageRendered(cur)
      } else {
        const canv = ext.includes('doc') ? await renderDOCXToCanvas(file) : await renderXLSXToCanvas(file)
        const url = sliceCanvasToPages(canv)[0]; const img = await loadImageEl(url)
        page.meta = { type: 'image', src: url, w: img.naturalWidth, h: img.naturalHeight, mime: 'image/png', doc_w: img.naturalWidth, doc_h: img.naturalHeight }
        page._bgRendered = false; await ensurePageRendered(cur)
      }
      const snapshot = await serializeDocument()
      if (snapshot) {
        await AuthAPI.saveDraft(snapshot)
        wsRef.current?.commit?.(snapshot)
        draftExistsRef.current = true
        setDraftHint(true)
      }
    } catch (e) {
      toast(e.message || 'Ошибка', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  async function serializeDocument () {
    if (!pagesRef.current || pagesRef.current.length === 0) return null
    const pagesLocal = pagesRef.current
    const outPages = []
    for (let i = 0; i < pagesLocal.length; i++) {
      const p = pagesLocal[i]
      const cv = await ensureCanvas(p, i, sendPatch)
      const meta = p.meta || {}
      const rawObjs = (cv.getObjects() || []).filter(o => o !== p.bgObj)
      const overlays = []
      for (const o of rawObjs) {
        if (o.type === 'textbox') {
          overlays.push({
            t: 'tb', id: o.__scannyId, text: o.text, left: o.left, top: o.top, angle: o.angle,
            fontFamily: o.fontFamily, fontSize: o.fontSize, fontStyle: o.fontStyle,
            fontWeight: o.fontWeight, fill: o.fill, width: o.width, textAlign: o.textAlign,
            scaleX: o.scaleX, scaleY: o.scaleY
          })
        } else if (o.type === 'image') {
          const src = o.__srcOriginal || o._element?.src
          overlays.push({
            t: 'im', id: o.__scannyId, src, left: o.left, top: o.top,
            angle: o.angle, scaleX: o.scaleX, scaleY: o.scaleY,
            flipX: o.flipX, flipY: o.flipY
          })
        }
      }
      if (meta.type === 'pdf' && meta.bytes) {
        outPages.push({
          type: 'pdf',
          index: meta.index || 0,
          bytes_b64: u8ToB64(meta.bytes),
          pdf_w: meta.pdf_w,
          pdf_h: meta.pdf_h,
          doc_w: meta.doc_w,
          doc_h: meta.doc_h,
          landscape: !!p.landscape,
          overlays
        })
      } else if (meta.type === 'image' || meta.type === 'raster') {
        outPages.push({
          type: meta.type,
          src: meta.src,
          w: meta.w,
          h: meta.h,
          mime: meta.mime,
          doc_w: meta.doc_w,
          doc_h: meta.doc_h,
          landscape: !!p.landscape,
          overlays
        })
      } else {
        outPages.push({
          type: 'raster',
          src: '',
          w: 2480,
          h: 3508,
          landscape: !!p.landscape,
          overlays
        })
      }
    }
    return { client_id: docIdRef.current || null, name: fileNameRef.current || genDefaultName(), pages: outPages }
  }

  async function restoreDocumentFromDraft (draft, onStep) {
    try {
      await ensurePDFJS()
      await ensureFabric()
      installDeleteControl()
      suppressFabricScroll()

      const pagesData = Array.isArray(draft?.pages) ? draft.pages : []
      const total = pagesData.length || 1
      const created = []

      for (let i = 0; i < pagesData.length; i++) {
        const pg = pagesData[i] || {}
        const id = 'p_' + Math.random().toString(36).slice(2)
        const elId = 'cv_' + id
        let meta

        if (pg.type === 'pdf' && pg.bytes_b64) {
          meta = {
            type: 'pdf',
            bytes: b64ToU8(pg.bytes_b64),
            index: Number(pg.index || 0),
            pdf_w: pg.pdf_w || 2480,
            pdf_h: pg.pdf_h || 3508,
            doc_w: pg.doc_w || pg.pdf_w || 2480,
            doc_h: pg.doc_h || pg.pdf_h || 3508
          }
        } else if (pg.type === 'image' || pg.type === 'raster') {
          meta = {
            type: pg.type,
            src: pg.src,
            w: pg.w || 2480,
            h: pg.h || 3508,
            mime: pg.mime || 'image/png',
            doc_w: pg.doc_w || pg.w || 2480,
            doc_h: pg.doc_h || pg.h || 3508
          }
        } else {
          meta = { type: 'raster', src: '', w: 2480, h: 3508, mime: 'image/png', doc_w: 2480, doc_h: 3508 }
        }

        created.push({
          id,
          elId,
          canvas: null,
          bgObj: null,
          landscape: !!pg.landscape,
          meta,
          _bgRendered: false,
          _pendingOverlays: Array.isArray(pg.overlays) ? pg.overlays : []
        })
      }

      pagesRef.current = created
      setPages(created)
      setCur(created.length ? 0 : 0)
      setFileName((draft?.name || '').trim() || genDefaultName())
      setDocId(draft?.client_id || randDocId())
      draftExistsRef.current = true

      await new Promise(r => setTimeout(r, 0))

      for (let i = 0; i < created.length; i++) {
        await ensurePageRendered(i)
        if (onStep) onStep(i + 1, total)
        await new Promise(r => requestAnimationFrame(r))
      }
    } catch (e) {
      console.error('restoreDocumentFromDraft error', e)
    }
  }

  async function addText () {
    if (!pagesRef.current || pagesRef.current.length === 0) {
      toast('Сначала добавьте страницу', 'error'); return
    }
    // eslint-disable-next-line no-undef
    const F = fabric
    const page = pagesRef.current[cur]
    const cv = await ensureCanvas(page, cur, sendPatch)
    await ensurePageRendered(cur)
    const tb = new F.Textbox('Вставьте текст', {
      left: Math.round(cv.width / 2 - 100),
      top: Math.round(cv.height / 2 - 20),
      fontSize: 48,
      fill: '#000000',
      fontFamily: 'Arial',
      fontWeight: 'bold',
      width: 200,
      textAlign: 'center',
      selectable: true,
      objectCaching: true,
      noScaleCache: false
    })
    tb.__scannyId = 'ov_' + Math.random().toString(36).slice(2)
    ensureDeleteControlFor(tb)
    cv.add(tb)
    cv.setActiveObject(tb)
    cv.requestRenderAll()
    sendPatch([{
      op: 'overlay_upsert',
      page: cur,
      obj: {
        t: 'tb',
        id: tb.__scannyId,
        left: tb.left,
        top: tb.top,
        angle: tb.angle,
        scaleX: tb.scaleX,
        scaleY: tb.scaleY,
        text: tb.text,
        fontFamily: 'Arial',
        fontSize: 48,
        fontWeight: 'bold',
        fill: '#000000',
        width: 200,
        textAlign: 'center'
      }
    }])
    setUndoStack(stk => [...stk, { type: 'add_one', page: cur, id: tb.__scannyId }])
    setPanelOpen(true)
  }

  const applyPanel = useCallback(() => {
    const page = pagesRef.current?.[cur]
    const cv = page?.canvas
    if (!cv) return
    const obj = cv.getActiveObject()
    if (!obj || obj.type !== 'textbox') return
    obj.set({
      fontFamily: font,
      fontSize: fontSize,
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      fill: color
    })
    cv.requestRenderAll()
    sendPatch([{
      op: 'overlay_upsert',
      page: cur,
      obj: {
        t: 'tb',
        id: obj.__scannyId,
        left: obj.left,
        top: obj.top,
        angle: obj.angle,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        text: obj.text,
        fontFamily: font,
        fontSize,
        fontStyle: italic ? 'italic' : 'normal',
        fontWeight: bold ? 'bold' : 'normal',
        fill: color,
        width: obj.width,
        textAlign: obj.textAlign
      }
    }])
  }, [cur, font, fontSize, bold, italic, color])

  useEffect(() => { if (panelOpen) applyPanel() }, [panelOpen, applyPanel])

  async function applyToAllPages () {
    if (!pagesRef.current || pagesRef.current.length === 0) return
    // eslint-disable-next-line no-undef
    const F = fabric
    const srcPage = pagesRef.current[cur]
    const cvSrc = await ensureCanvas(srcPage, cur, sendPatch)
    const obj = cvSrc.getActiveObject()
    if (!obj) { toast('Выберите объект на странице', 'error'); return }
    const clones = []
    for (let i = 0; i < pagesRef.current.length; i++) {
      if (i === cur) continue
      const dstPage = pagesRef.current[i]
      const cvDst = await ensureCanvas(dstPage, i, sendPatch)
      await ensurePageRendered(i)
      if (obj.type === 'textbox') {
        const tb = new F.Textbox(obj.text || '', {
          left: obj.left,
          top: obj.top,
          fontFamily: obj.fontFamily,
          fontStyle: obj.fontStyle,
          fontWeight: obj.fontWeight,
          fill: obj.fill,
          fontSize: obj.fontSize,
          angle: obj.angle,
          width: obj.width,
          textAlign: obj.textAlign,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY,
          selectable: true,
          objectCaching: true,
          noScaleCache: false
        })
        tb.__scannyId = 'ov_' + Math.random().toString(36).slice(2)
        ensureDeleteControlFor(tb)
        cvDst.add(tb)
        cvDst.requestRenderAll()
        clones.push({ page: i, id: tb.__scannyId })
        sendPatch([{
          op: 'overlay_upsert',
          page: i,
          obj: {
            t: 'tb',
            id: tb.__scannyId,
            left: tb.left,
            top: tb.top,
            angle: tb.angle,
            scaleX: tb.scaleX,
            scaleY: tb.scaleY,
            text: tb.text,
            fontFamily: tb.fontFamily,
            fontSize: tb.fontSize,
            fontStyle: tb.fontStyle,
            fontWeight: tb.fontWeight,
            fill: tb.fill,
            width: tb.width,
            textAlign: tb.textAlign
          }
        }])
      } else if (obj.type === 'image') {
        const orig = obj.__srcOriginal || (obj._element?.src)
        const imgEl = await loadImageEl(orig)
        const im = new F.Image(imgEl, {
          angle: obj.angle,
          selectable: true,
          flipX: !!obj.flipX,
          flipY: !!obj.flipY,
          objectCaching: true,
          noScaleCache: false,
          left: obj.left,
          top: obj.top,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY
        })
        im.__scannyId = 'ov_' + Math.random().toString(36).slice(2)
        im.__srcOriginal = orig
        ensureDeleteControlFor(im)
        cvDst.add(im)
        cvDst.requestRenderAll()
        clones.push({ page: i, id: im.__scannyId })
        sendPatch([{
          op: 'overlay_upsert',
          page: i,
          obj: {
            t: 'im',
            id: im.__scannyId,
            left: im.left,
            top: im.top,
            angle: im.angle,
            flipX: !!im.flipX,
            flipY: !!im.flipY,
            scaleX: im.scaleX,
            scaleY: im.scaleY,
            src: orig
          }
        }])
      }
    }
    if (clones.length) {
      setUndoStack(stk => [...stk, { type: 'apply_all', clones }])
      toast('Объект добавлен на все страницы', 'success')
    }
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

  function placeFromLib (url) {
    if (!pagesRef.current || pagesRef.current.length === 0) { toast('Сначала добавьте страницу', 'error'); return }
    // eslint-disable-next-line no-undef
    const F = fabric
    const page = pagesRef.current[cur]
    ensureCanvas(page, cur, sendPatch).then(async (cv) => {
      await ensurePageRendered(cur)
      const img = new F.Image(await loadImageEl(url), { objectCaching: true, noScaleCache: false })
      const s = Math.min(1, (cv.width * 0.25) / (img.width || 1))
      img.set({
        left: Math.round(cv.width / 2 - (img.width * s) / 2),
        top: Math.round(cv.height / 2 - (img.height * s) / 2),
        scaleX: s,
        scaleY: s,
        selectable: true
      })
      img.__srcOriginal = url
      ensureDeleteControlFor(img)
      img.__scannyId = 'ov_' + Math.random().toString(36).slice(2)
      cv.add(img)
      cv.setActiveObject(img)
      cv.requestRenderAll()
      clamp(img)
      sendPatch([{
        op: 'overlay_upsert',
        page: cur,
        obj: {
          t: 'im',
          id: img.__scannyId,
          left: img.left,
          top: img.top,
          angle: img.angle,
          flipX: !!img.flipX,
          flipY: !!img.flipY,
          scaleX: img.scaleX,
          scaleY: img.scaleY,
          src: url
        }
      }])
      setUndoStack(stk => [...stk, { type: 'add_one', page: cur, id: img.__scannyId }])
    })
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

  async function exportJPG () {
    try {
      if (!pagesRef.current || pagesRef.current.length === 0) return
      const bn = baseName()
      if (!bn) return
      const count = pagesRef.current.length
      if ((billing?.free_left ?? 0) < count) { setPlan('single'); setPayOpen(true); return }

      setProgress({
        active: true,
        mode: 'export',
        phase: 'prepare',
        label: 'Подготовка JPG',
        val: 0,
        max: count,
        suffix: 'стр.'
      })

      await ensureJSZip()
      // eslint-disable-next-line no-undef
      const zip = new JSZip()
      for (let i = 0; i < pagesRef.current.length; i++) {
        await ensurePageRendered(i)
        const p = pagesRef.current[i]
        const cv = p.canvas
        const dataUrl = cv.toDataURL({ format: 'jpeg', quality: 1.0, multiplier: 2 })
        const blob = await (await fetch(dataUrl)).blob()
        zip.file(`${bn}-p${i + 1}.jpg`, blob)
        setProgress(pr => ({ ...pr, val: i + 1 }))
        await new Promise(r => requestAnimationFrame(r))
      }

      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })

      setProgress({
        active: true,
        mode: 'export',
        phase: 'download',
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
      if (!pagesRef.current || pagesRef.current.length === 0) return
      const bn = baseName()
      if (!bn) return
      const count = pagesRef.current.length
      if ((billing?.free_left ?? 0) < count) { setPlan('single'); setPayOpen(true); return }

      setProgress({
        active: true,
        mode: 'export',
        phase: 'prepare',
        label: 'Подготовка PDF',
        val: 0,
        max: count,
        suffix: 'стр.'
      })

      const PDFLib = await ensurePDFLib()
      const out = await PDFLib.PDFDocument.create()
      for (let i = 0; i < pagesRef.current.length; i++) {
        await ensurePageRendered(i)
        const p = pagesRef.current[i]
        const cv = p.canvas
        const dataUrl = cv.toDataURL({ format: 'jpeg', quality: 1.0, multiplier: 2 })
        const bytes = await (await fetch(dataUrl)).arrayBuffer()
        const img = await out.embedJpg(bytes)
        const pageRef = out.addPage([img.width, img.height])
        pageRef.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
        setProgress(pr => ({ ...pr, val: i + 1 }))
        await new Promise(r => requestAnimationFrame(r))
      }

      const pdfBytes = await out.save()

      setProgress({
        active: true,
        mode: 'export',
        phase: 'download',
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && pagesRef.current?.[cur]?.canvas) {
        const cv = pagesRef.current[cur].canvas
        const obj = cv.getActiveObject()
        if (obj) {
          e.preventDefault()
          const id = obj.__scannyId || null
          cv.remove(obj)
          cv.discardActiveObject()
          cv.requestRenderAll()
          if (id) sendPatch([{ op: 'overlay_remove', page: cur, id }])
          toast('Объект удалён', 'success')
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cur])

  const onRenameChange = (e) => { setFileName(sanitizeName(e.target.value)) }
  const onRenameBlur = () => { if (pagesRef.current?.length) sendPatch([{ op: 'set_name', name: fileNameRef.current || '' }]) }

  const [pgText, setPgText] = useState('1')
  useEffect(() => { setPgText(String(pagesRef.current?.length ? (cur + 1) : 0)) }, [cur, pages.length])

  const onPagerGo = (v) => {
    if (!pagesRef.current?.length) return
    const n = Math.max(1, Math.min(pagesRef.current.length, Number(v) || 1))
    setCur(n - 1)
  }

  return (
    <div className="doc-editor page" style={{ paddingTop: 0 }}>
      <ProgressOverlay
        open={progress.active}
        label={progress.label}
        val={progress.val}
        max={progress.max}
        suffix={progress.suffix}
      />

      {(menuActionsOpen || menuAddOpen || menuDownloadOpen) && (
        <div
          className="ed-dim"
          onClick={() => {
            setMenuActionsOpen(false)
            setMenuAddOpen(false)
            setMenuDownloadOpen(false)
          }}
        />
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
              onBlur={onRenameBlur}
              style={{ margin: '0 auto' }}
            />
          </div>
          <div style={{ width: 36 }} className="desktop-only" />
        </div>
      ) : (
        <div className="ed-top">
          <div className="ed-toolbar" style={{ margin: '0 auto' }}>
            <select value={font} onChange={e => setFont(e.target.value)}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="sep" />
            <button onClick={() => setFontSize(s => Math.max(6, s - 2))}>−</button>
            <span className="val">{fontSize}</span>
            <button onClick={() => setFontSize(s => Math.min(300, s + 2))}>+</button>
            <div className="sep" />
            <input type="color" value={color} onChange={e => setColor(e.target.value)} title="Цвет текста" />
            <button className={bold ? 'toggled' : ''} onClick={() => setBold(b => !b)}><b>B</b></button>
            <button className={italic ? 'toggled' : ''} onClick={() => setItalic(i => !i)}><i>I</i></button>
          </div>
        </div>
      )}

      <div className="ed-body">
        <aside className="ed-left">
          <div className="ed-tools">
            <button className={`ed-tool ${pagesRef.current?.length ? '' : 'disabled'}`} onClick={addText}>
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
                <img
                  src={item.url}
                  alt=""
                  onClick={() => placeFromLib(item.url)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                />
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
          </div>
        </aside>

        <section className="ed-center">
          <div
            className="ed-canvas-wrap"
            ref={canvasWrapRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onCanvasDrop}
            style={{ position: 'relative' }}
          >
            {pages.map((p, idx) => (
              <div key={p.id} className={`ed-canvas ${idx === cur ? 'active' : ''}`}>
                <button
                  className="ed-page-x desktop-only x-btn x-btn--medium"
                  title="Удалить эту страницу"
                  onClick={() => deletePageAt(idx)}
                >
                  <img src={icClose} alt="Удалить страницу" />
                </button>
                <canvas id={p.elId} />
              </div>
            ))}

            {!pagesRef.current?.length && (
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
              className={`ed-action ${pagesRef.current?.length ? '' : 'disabled'}`}
              onClick={async () => {
                if (!pagesRef.current?.length) return
                if (!window.confirm('Удалить весь документ?')) return
                pagesRef.current.forEach(p => { try { p.canvas?.dispose?.() } catch {} })
                setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
                try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
                try { await AuthAPI.clearDraft() } catch {}
                draftExistsRef.current = false
                setDocId(null)
                setDraftHint(false)
                toast('Документ удалён', 'success')
              }}
            >
              <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Удалить документ
            </button>
            <button
              className={`ed-action ${canUndo ? '' : 'disabled'}`}
              onClick={() => {
                const stk = [...undoStack]
                const last = stk.pop()
                if (!last) return
                if (last.type === 'add_one') {
                  const p = pagesRef.current[last.page]
                  const cv = p?.canvas
                  if (cv) {
                    const obj = cv.getObjects().find(o => o.__scannyId === last.id)
                    if (obj) {
                      cv.remove(obj)
                      cv.discardActiveObject()
                      cv.requestRenderAll()
                      sendPatch([{ op: 'overlay_remove', page: last.page, id: last.id }])
                    }
                  }
                } else if (last.type === 'apply_all') {
                  last.clones.forEach(({ page, id }) => {
                    const p = pagesRef.current[page]
                    const cv = p?.canvas
                    if (cv) {
                      const obj = cv.getObjects().find(o => o.__scannyId === id)
                      if (obj) cv.remove(obj)
                      cv.requestRenderAll()
                      sendPatch([{ op: 'overlay_remove', page, id }])
                    }
                  })
                }
                setUndoStack(stk)
              }}
            >
              <img src={icUndo} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Отменить
            </button>
            <button
              className={`ed-action ${pagesRef.current?.length ? '' : 'disabled'}`}
              onClick={rotatePage}
            >
              <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Повернуть страницу
            </button>
            <button
              className={`ed-action ${pagesRef.current?.length && !!(pagesRef.current[cur]?.canvas?.getActiveObject()) ? '' : 'disabled'}`}
              onClick={applyToAllPages}
            >
              <img src={icAddPage} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />На все страницы
            </button>
          </div>

          <div className="ed-download">
            <div className="ed-dl-title">Скачать бесплатно:</div>
            <div className="ed-dl-row">
              <button className={`btn btn-lite ${(!pagesRef.current?.length) ? 'disabled' : ''}`} onClick={exportJPG}>
                <img src={icJpgFree} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />JPG
              </button>
              <button className={`btn btn-lite ${(!pagesRef.current?.length) ? 'disabled' : ''}`} onClick={exportPDF}>
                <img src={icPdfFree} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />PDF
              </button>
            </div>
            <div className="ed-dl-title" style={{ marginTop: 10 }}>Купить:</div>
            <div className="ed-dl-row ed-dl-row-paid">
              <button className={`btn ${(!pagesRef.current?.length) ? 'disabled' : ''}`} onClick={() => { if (pagesRef.current?.length) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icJpgPaid} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />JPG
              </button>
              <button className={`btn ${(!pagesRef.current?.length) ? 'disabled' : ''}`} onClick={() => { if (pagesRef.current?.length) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icPdfPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />PDF
              </button>
            </div>
          </div>
        </aside>
      </div>

      <div className="ed-bottom">
        <button className="fab fab-add mobile-only" onClick={() => { if (pagesRef.current?.length) { setMenuAddOpen(o => !o) } else { pickDocument() } }} title="Добавить">
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
          hasDoc={!!pagesRef.current?.length}
          onAdd={pickDocument}
        />
        <button className="fab fab-dl mobile-only" onClick={() => { if (!pagesRef.current?.length) return; setMenuDownloadOpen(o => !o) }} title="Скачать">
          <img src={icDownload} alt="↓" />
        </button>
      </div>

      {menuActionsOpen && (
        <div
          className="ed-sheet"
          ref={sheetActionsRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, maxWidth: '96vw', minWidth: 240 }}
        >
          <button className={pagesRef.current?.length ? '' : 'disabled'} onClick={() => { setMenuActionsOpen(false); rotatePage() }}>
            <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Повернуть страницу
          </button>
          <button className={(pagesRef.current?.length && pagesRef.current.length > 1) ? '' : 'disabled'} onClick={async () => { setMenuActionsOpen(false); await deletePageAt(cur) }}>
            <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Удалить страницу
          </button>
          <button className={(pagesRef.current?.length && !!(pagesRef.current[cur]?.canvas?.getActiveObject())) ? '' : 'disabled'} onClick={() => { setMenuActionsOpen(false); applyToAllPages() }}>
            <img src={icAddPage} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />На все страницы
          </button>
          <button
            className={pagesRef.current?.length ? '' : 'disabled'}
            onClick={async () => {
              setMenuActionsOpen(false)
              if (!pagesRef.current?.length) return
              if (!window.confirm('Удалить весь документ?')) return
              pagesRef.current.forEach(p => { try { p.canvas?.dispose?.() } catch {} })
              setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
              try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
              try { await AuthAPI.clearDraft() } catch {}
              draftExistsRef.current = false
              setDocId(null)
              setDraftHint(false)
              toast('Документ удалён', 'success')
            }}
          >
            <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Удалить документ
          </button>
        </div>
      )}

      {menuAddOpen && (
        <div className="ed-sheet bottom-left" ref={sheetAddRef}>
          <button className={pagesRef.current?.length ? '' : 'disabled'} onClick={() => { setMenuAddOpen(false); addText() }}>
            <img src={icText} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить текст
          </button>
          <button onClick={() => { setMenuAddOpen(false); signFileRef.current?.click() }}>
            <img src={icSign} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить подпись/печать
          </button>
          <button onClick={() => { setMenuAddOpen(false); pickDocument() }}>
            <img src={icPlus} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Добавить документ/страницу
          </button>
        </div>
      )}

      {menuDownloadOpen && (
        <div className="ed-sheet bottom-right" ref={sheetDownloadRef} style={{ padding: 6 }}>
          <button className={`btn ${pagesRef.current?.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current?.length) { setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icJpgPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить JPG
          </button>
          <button className={`btn ${pagesRef.current?.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current?.length) { setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icPdfPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить PDF
          </button>
          <button className={`btn btn-lite ${pagesRef.current?.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current?.length) { setMenuDownloadOpen(false); exportJPG() } }}>
            <img src={icJpgFree} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Скачать бесплатно JPG
          </button>
          <button className={`btn btn-lite ${pagesRef.current?.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current?.length) { setMenuDownloadOpen(false); exportPDF() } }}>
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
                <button className="btn" onClick={startPurchase}><span className="label">Оплатить {Math.max(0, (prices[plan] || 0) * (100 - promoPercent) / 100)} ₽</span></button>
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
                    <img
                      src={item.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                      onClick={() => { placeFromLib(item.url); setLibOpen(false) }}
                    />
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
      <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={onPickBgFile} />
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
          reader.onload = () => { setCropSrc(String(reader.result || '')); setCropKind('signature'); setCropThresh(40); setCropOpen(true) }
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
            if (pagesRef.current?.length > 0) {
              // eslint-disable-next-line no-undef
              const F = fabric
              const page = pagesRef.current[cur]
              const cv = await ensureCanvas(page, cur, sendPatch)
              const image = new F.Image(await loadImageEl(dataUrl))
              image.__srcOriginal = dataUrl
              const W = cv.getWidth(); const H = cv.getHeight()
              const s = Math.min(1, (W * 0.35) / (image.width || 1))
              image.set({ left: Math.round(W * 0.15), top: Math.round(H * 0.15), scaleX: s, scaleY: s, selectable: true })
              ensureDeleteControlFor(image)
              image.__scannyId = 'ov_' + Math.random().toString(36).slice(2)
              cv.add(image); cv.setActiveObject(image); cv.requestRenderAll()
              function clampInner (obj) {
                obj.setCoords()
                const coords = obj.getCoords ? obj.getCoords() : []
                if (!coords.length) return
                const xs = coords.map(p => p.x), ys = coords.map(p => p.y)
                const w = cv.width, h = cv.height
                let minX = Math.min(...xs), maxX = Math.max(...xs)
                let minY = Math.min(...ys), maxY = Math.max(...ys)
                let dx = 0, dy = 0
                if (minX < 0) dx = -minX
                else if (maxX > w) dx = w - maxX
                if (minY < 0) dy = -minY
                else if (maxY > h) dy = h - maxY
                if (dx || dy) { obj.left += dx; obj.top += dy; obj.setCoords() }
              }
              clampInner(image)
              ensureDeleteControlFor(image)
              sendPatch([{
                op: 'overlay_upsert',
                page: cur,
                obj: {
                  t: 'im',
                  id: image.__scannyId,
                  left: image.left || 0,
                  top: image.top || 0,
                  angle: image.angle || 0,
                  flipX: !!image.flipX,
                  flipY: !!image.flipY,
                  scaleX: image.scaleX || 1,
                  scaleY: image.scaleY || 1,
                  src: dataUrl
                }
              }])
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
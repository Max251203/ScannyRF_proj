// frontend/src/pages/Editor.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensurePDFJS,
  ensureHtml2Canvas,
  ensureMammothCDN,
  ensureSheetJS,
  ensureJsPDF,
  ensureJSZip
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

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

import icClose from '../assets/icons/x-close.svg'

const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial', 'Times New Roman', 'Ermilov', 'Segoe UI', 'Roboto', 'Georgia']
const PDF_RENDER_SCALE = 3.0
const RASTER_RENDER_SCALE = 3.0

function randDocId () { return String(Math.floor(1e15 + Math.random() * 9e15)) }
function genDefaultName () { const a = Math.floor(Math.random() * 1e6), b = Math.floor(Math.random() * 1e6); return `${a}-${b}` }
function sanitizeName (s) {
  s = (s || '').normalize('NFKC')
  s = s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '')
  return s.slice(0, 64) || genDefaultName()
}
function setDraftHint (flag) {
  try { localStorage.setItem('has_draft', flag ? '1' : '0') } catch {}
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
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

function b64ToU8 (b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
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

// Рендер страницы в offscreen-канвас для экспорта
function renderPageOffscreen (page, scaleMul = 2) {
  const rot = page.rotation || 0
  const docW = page.docWidth || 1000
  const docH = page.docHeight || 1414

  const outW = rot === 0 ? docW : docH
  const outH = rot === 0 ? docH : docW

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(outW * scaleMul)
  canvas.height = Math.round(outH * scaleMul)
  const ctx = canvas.getContext('2d')

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const s = scaleMul
  ctx.setTransform(s, 0, 0, s, 0, 0)

  if (rot === 90) {
    // Для экспорта можно физически повернуть страницу,
    // но чтобы не ломать логику, пока оставляем портретный контент.
    // (при необходимости можно добавить здесь transform)
  }

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
    ctx.scale(ov.scaleX || 1, ov.scaleY || 1)
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
      const fontSize = d.fontSize || 48
      const fontFamily = d.fontFamily || 'Arial'
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
      ctx.textAlign = d.textAlign || 'center'
      ctx.textBaseline = 'middle'
      const text = d.text || ''
      ctx.fillText(text, 0, 0)
    }
    ctx.restore()
  }

  return canvas
}

// ---------- КОМПОНЕНТ EDITOR ----------

export default function Editor () {
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState([]) // [{id, docWidth, docHeight, bgImage, bgSrc, overlays, rotation}]
  const pagesRef = useRef(pages)
  useEffect(() => { pagesRef.current = pages }, [pages])

  const [cur, setCur] = useState(0)
  const curRef = useRef(cur)
  useEffect(() => { curRef.current = cur }, [cur])

  const hasDoc = pages.length > 0
  const canPrev = hasDoc && cur > 0
  const canNext = hasDoc && cur < pages.length - 1

  const docIdRef = useRef(docId)
  useEffect(() => { docIdRef.current = docId }, [docId])
  const fileNameRef = useRef(fileName)
  useEffect(() => { fileNameRef.current = fileName }, [fileName])

  const prevPageRef = useRef(null)

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

  const [progress, setProgress] = useState({
    active: false,
    mode: null,
    label: '',
    val: 0,
    max: 0,
    suffix: '',
    stat: ''
  })

  const canvasRef = useRef(null)
  const canvasWrapRef = useRef(null)
  const engineRef = useRef(null)
  const [docRect, setDocRect] = useState(null)

  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const sheetActionsRef = useRef(null)
  const sheetAddRef = useRef(null)
  const sheetDownloadRef = useRef(null)

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches)

  // Режим редактирования текста (двойной клик)
  const [textEdit, setTextEdit] = useState(null)
  const [textEditValue, setTextEditValue] = useState('')

  const saveTimerRef = useRef(0)

  function scheduleSaveDraft () {
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
  }

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
          scaleX: ov.scaleX || 1,
          scaleY: ov.scaleY || 1,
          angleRad: ov.angleRad || 0
        }
        if (ov.type === 'image') {
          return {
            ...base,
            data: { src: d.src || null }
          }
        }
        if (ov.type === 'text') {
          return {
            ...base,
            data: {
              text: d.text || '',
              fontSize: d.fontSize || 48,
              fontFamily: d.fontFamily || 'Arial',
              fontWeight: d.fontWeight || 'bold',
              fontStyle: d.fontStyle || 'normal',
              fill: d.fill || '#000000',
              textAlign: d.textAlign || 'center'
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

    return {
      client_id: cid,
      name,
      pages: pagesData
    }
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

  // Billing + цены
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
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    return () => {
      window.removeEventListener('user:update', onUser)
      window.removeEventListener('billing:update', onBill)
    }
  }, [])

  const onTopMenuClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8 + window.scrollY, left: r.left + window.scrollX })
    setMenuActionsOpen(o => !o)
  }

  // Инициализация движка
  useEffect(() => {
    if (!hasDoc) return
    if (!canvasRef.current) return
    if (engineRef.current) return

    const engine = new CustomCanvasEngine(canvasRef.current, {
      viewMargin: 24,
      onBeforeOverlayChange: (snapshot) => {
        const pageIndex = curRef.current
        setUndoStack(stk => [...stk, { type: 'page', pageIndex, overlays: snapshot }])
      },
      onOverlayChange: (ov) => {
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
          return copy
        })
        scheduleSaveDraft()
      },
      onOverlayDelete: (id) => {
        setPages(prev => {
          const pageIndex = curRef.current
          const copy = [...prev]
          const page = copy[pageIndex]
          if (!page) return prev
          copy[pageIndex] = {
            ...page,
            overlays: (page.overlays || []).filter(o => o.id !== id)
          }
          return copy
        })
        scheduleSaveDraft()
      },
      onSelectionChange: (ov) => {
        if (ov && ov.type === 'text') {
          setPanelOpen(true)
          const d = ov.data || {}
          setFont(d.fontFamily || 'Arial')
          setFontSize(d.fontSize || 42)
          setBold(d.fontWeight === 'bold' || d.fontWeight === 700)
          setItalic(d.fontStyle === 'italic')
          setColor(d.fill || '#000000')
        } else {
          setPanelOpen(false)
        }
      },
      onTextEditRequest: (ov, bounds) => {
        const d = ov.data || {}
        setTextEditValue(d.text || '')
        setTextEdit({
          overlayId: ov.id,
          rectCanvas: bounds,
          fontFamily: d.fontFamily || 'Arial',
          fontSize: d.fontSize || 42,
          fontWeight: d.fontWeight || 'bold',
          fontStyle: d.fontStyle || 'normal',
          fill: d.fill || '#000000'
        })
      }
    })

    engineRef.current = engine

    const handleResize = () => {
      if (!canvasWrapRef.current || !engineRef.current) return
      const rect = canvasWrapRef.current.getBoundingClientRect()
      if (rect.width < 50 || rect.height < 50) return
      engineRef.current.resize(rect.width, rect.height)
      setDocRect(engineRef.current.getDocumentScreenRect())
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    const ro = new ResizeObserver(handleResize)
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current)

    return () => {
      engineRef.current?.destroy()
      engineRef.current = null
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
      ro.disconnect()
    }
  }, [hasDoc])

  // При смене режима — обновляем режим движка (учёт rotation) и margin
  useEffect(() => {
    if (!engineRef.current) return
    engineRef.current.setViewMargin(24)
    engineRef.current.setMode(isMobile)
    setDocRect(engineRef.current.getDocumentScreenRect())
  }, [isMobile])

  // При смене страницы / её данных — подаём её в движок
  useEffect(() => {
    const page = pages[cur]
    if (!page || !engineRef.current) {
      prevPageRef.current = page || null
      return
    }

    const prev = prevPageRef.current
    const onlyRotationChanged =
      prev &&
      prev.id === page.id &&
      prev.docWidth === page.docWidth &&
      prev.docHeight === page.docHeight &&
      prev.bgImage === page.bgImage &&
      prev.bgSrc === page.bgSrc &&
      prev.overlays === page.overlays &&
      prev.rotation !== page.rotation

    if (onlyRotationChanged) {
      prevPageRef.current = page
      setDocRect(engineRef.current.getDocumentScreenRect())
      return
    }

    engineRef.current.setDocument({
      docWidth: page.docWidth,
      docHeight: page.docHeight,
      backgroundImage: page.bgImage,
      overlays: page.overlays || [],
      rotation: page.rotation || 0
    })
    setDocRect(engineRef.current.getDocumentScreenRect())
    prevPageRef.current = page
  }, [pages, cur])

  // Загрузка библиотеки подписей
  async function loadLibrary () {
    if (!isAuthed) { setSignLib([]); return }
    try {
      const list = await AuthAPI.listSigns()
      setSignLib(Array.isArray(list) ? list : [])
    } catch {
      setSignLib([])
    }
  }
  useEffect(() => { if (isAuthed) loadLibrary() }, [isAuthed])

  useEffect(() => {
    if (!hasDoc) setDocRect(null)
  }, [hasDoc])

  // Восстановление черновика
  useEffect(() => {
    if (!isAuthed) return

    ;(async () => {
      let srv
      try {
        srv = await AuthAPI.getDraft()
      } catch {
        return
      }
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
        suffix: 'стр.',
        stat: `0/${total} стр.`
      })

      const restored = []
      let idx = 0
      const isNewFormat = !!pagesData[0].docWidth

      if (isNewFormat) {
        for (const pg of pagesData) {
          let img = null
          if (pg.bg_src) {
            try { img = await loadImageEl(pg.bg_src) } catch {}
          }
          const docWidth = pg.docWidth || img?.naturalWidth || img?.width || 1000
          const docHeight = pg.docHeight || img?.naturalHeight || img?.height || 1414

          const overlays = []
          for (const ov of (pg.overlays || [])) {
            const o = {
              id: ov.id || `ov_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              type: ov.type || 'image',
              cx: ov.cx ?? 0,
              cy: ov.cy ?? 0,
              w: ov.w || 200,
              h: ov.h || 100,
              scaleX: ov.scaleX ?? 1,
              scaleY: ov.scaleY ?? 1,
              angleRad: ov.angleRad ?? 0,
              data: { ...(ov.data || {}) }
            }
            if (o.type === 'image' && o.data.src) {
              try { o.data.image = await loadImageEl(o.data.src) } catch {}
            }
            overlays.push(o)
          }

          restored.push({
            id: pg.id || `p_${Date.now()}_${Math.random().toString(36).slice(2)}_${idx}`,
            docWidth,
            docHeight,
            bgImage: img,
            bgSrc: pg.bg_src || null,
            overlays,
            rotation: pg.rotation || 0
          })
          idx += 1
          setProgress(p => ({
            ...p,
            val: idx,
            stat: `${idx}/${total} стр.`
          }))
        }
      } else {
        for (const pg of pagesData) {
          let img = null
          let bgSrc = null
          let docWidth = 1000
          let docHeight = 1414

          if (pg.type === 'pdf' && pg.bytes_b64) {
            try {
              await ensurePDFJS()
              const bytes = b64ToU8(pg.bytes_b64)
              // eslint-disable-next-line no-undef
              const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
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

          const overlays = []
          for (const o of (pg.overlays || [])) {
            if (o.t === 'tb') {
              const w = o.width || 200
              const h = (o.fontSize || 48) * 1.4
              const scaleX = o.scaleX || 1
              const scaleY = o.scaleY || 1
              const cx = (o.left || 0) + (w * scaleX) / 2
              const cy = (o.top || 0) + (h * scaleY) / 2
              overlays.push({
                id: o.id || `ov_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                type: 'text',
                cx,
                cy,
                w,
                h,
                scaleX,
                scaleY,
                angleRad: (o.angle || 0) * Math.PI / 180,
                data: {
                  text: o.text || '',
                  fontFamily: o.fontFamily || 'Arial',
                  fontSize: o.fontSize || 48,
                  fontWeight: o.fontWeight || 'bold',
                  fontStyle: o.fontStyle || 'normal',
                  fill: o.fill || '#000000',
                  textAlign: o.textAlign || 'center'
                }
              })
            } else if (o.t === 'im' && o.src) {
              try {
                const im = await loadImageEl(o.src)
                const w = im.naturalWidth || im.width || 200
                const h = im.naturalHeight || im.height || 100
                const scaleX = o.scaleX || 1
                const scaleY = o.scaleY || 1
                const cx = (o.left || 0) + (w * scaleX) / 2
                const cy = (o.top || 0) + (h * scaleY) / 2
                overlays.push({
                  id: o.id || `ov_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  type: 'image',
                  cx,
                  cy,
                  w,
                  h,
                  scaleX,
                  scaleY,
                  angleRad: (o.angle || 0) * Math.PI / 180,
                  data: { src: o.src, image: im }
                })
              } catch {}
            }
          }

          restored.push({
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}_${idx}`,
            docWidth,
            docHeight,
            bgImage: img,
            bgSrc,
            overlays,
            rotation: pg.landscape ? 90 : 0
          })
          idx += 1
          setProgress(p => ({
            ...p,
            val: idx,
            stat: `${idx}/${total} стр.`
          }))
        }
      }

      setPages(restored)
      if (restored.length) setCur(0)
      setDraftHint(true)
      setDocId(data.client_id || randDocId())
      setFileName((data.name || '').trim() || genDefaultName())

      await new Promise(r => requestAnimationFrame(r))
      setProgress(p => ({ ...p, active: false }))
      showBanner('Восстановлен последний документ')
    })()
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

  // ---------- Работа со страницами / документом ----------

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
    const file = files[0]
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const page = pagesRef.current[cur]
    if (!page) return
    setProgress({
      active: true,
      mode: 'upload',
      label: 'Обновление страницы',
      val: 0,
      max: 0,
      suffix: '',
      stat: ''
    })
    try {
      let img
      let src = null
      if (['jpg', 'jpeg', 'png'].includes(ext)) {
        src = await readAsDataURL(file)
        img = await loadImageEl(src)
      } else if (ext === 'pdf') {
        await ensurePDFJS()
        // eslint-disable-next-line no-undef
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
        const cv = await renderPDFPageToCanvas(pdf, 1, PDF_RENDER_SCALE)
        img = cv
        src = cv.toDataURL('image/png')
      } else if (['doc', 'docx'].includes(ext)) {
        const cv = await renderDOCXToCanvas(file)
        const u = sliceCanvasToPages(cv)[0]
        src = u
        img = await loadImageEl(u)
      } else if (['xls', 'xlsx'].includes(ext)) {
        const cv = await renderXLSXToCanvas(file)
        const u = sliceCanvasToPages(cv)[0]
        src = u
        img = await loadImageEl(u)
      } else {
        toast('Формат не поддерживается', 'error')
        return
      }
      const docWidth = img.width || img.naturalWidth
      const docHeight = img.height || img.naturalHeight
      setPages(prev => {
        const copy = [...prev]
        if (!copy[cur]) return prev
        copy[cur] = {
          ...copy[cur],
          docWidth,
          docHeight,
          bgImage: img,
          bgSrc: src
        }
        return copy
      })
      scheduleSaveDraft()
    } catch (err) {
      console.error(err)
      toast(err.message || 'Ошибка', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
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
        suffix: 'стр.',
        stat: `0/${totalUnits} стр.`
      })

      let curDocId = docIdRef.current
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId) }
      let addedPages = 0
      let initialName = fileNameRef.current
      let doneUnits = 0
      const tick = (inc = 1) => {
        doneUnits += inc
        setProgress(p => ({
          ...p,
          val: doneUnits,
          stat: `${doneUnits}/${p.max} стр.`
        }))
      }

      let newPages = [...pagesRef.current]

      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (!initialName) {
          const base = f.name.replace(/\.[^.]+$/, '')
          initialName = sanitizeName(base)
          setFileName(initialName)
        }

        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          const url = await readAsDataURL(f)
          const img = await loadImageEl(url)
          const page = {
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            docWidth: img.width || img.naturalWidth,
            docHeight: img.height || img.naturalHeight,
            bgImage: img,
            bgSrc: url,
            overlays: [],
            rotation: 0
          }
          newPages.push(page)
          addedPages += 1
          tick(1)
        } else if (ext === 'pdf') {
          await ensurePDFJS()
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise
          const total = pdf.numPages
          for (let i = 1; i <= total; i++) {
            const cv = await renderPDFPageToCanvas(pdf, i, PDF_RENDER_SCALE)
            const url = cv.toDataURL('image/png')
            const page = {
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              docWidth: cv.width,
              docHeight: cv.height,
              bgImage: cv,
              bgSrc: url,
              overlays: [],
              rotation: 0
            }
            newPages.push(page)
            addedPages += 1
            tick(1)
          }
        } else if (['docx', 'doc'].includes(ext)) {
          const big = await renderDOCXToCanvas(f)
          const slices = sliceCanvasToPages(big)
          for (const url of slices) {
            const img = await loadImageEl(url)
            const page = {
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              docWidth: img.width || img.naturalWidth,
              docHeight: img.height || img.naturalHeight,
              bgImage: img,
              bgSrc: url,
              overlays: [],
              rotation: 0
            }
            newPages.push(page)
            addedPages += 1
            tick(1)
          }
        } else if (['xls', 'xlsx'].includes(ext)) {
          const big = await renderXLSXToCanvas(f)
          const slices = sliceCanvasToPages(big)
          for (const url of slices) {
            const img = await loadImageEl(url)
            const page = {
              id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              docWidth: img.width || img.naturalWidth,
              docHeight: img.height || img.naturalHeight,
              bgImage: img,
              bgSrc: url,
              overlays: [],
              rotation: 0
            }
            newPages.push(page)
            addedPages += 1
            tick(1)
          }
        } else {
          toast(`Формат не поддерживается: ${ext}`, 'error')
          tick(1)
        }
      }

      setPages(newPages)
      if (!hasDoc && newPages.length) setCur(0)
      scheduleSaveDraft()

      if (isAuthed && addedPages > 0) {
        try {
          const nm = sanitizeName(initialName || fileNameRef.current || genDefaultName())
          await AuthAPI.recordUpload(curDocId, nm, addedPages)
        } catch {}
      }

      toast('Страницы добавлены', 'success')
    } catch (err) {
      console.error(err)
      toast(err.message || 'Ошибка загрузки файлов', 'error')
    } finally {
      setProgress(p => ({ ...p, active: false }))
    }
  }

  async function deletePageAt (idx) {
    if (!pagesRef.current.length) return
    if (pagesRef.current.length <= 1) {
      if (!window.confirm('Удалить весь документ?')) return
      setPages([])
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
    setPages(prev => prev.filter((_, i) => i !== idx))
    setCur(i => Math.max(0, idx - 1))
    scheduleSaveDraft()
    toast('Страница удалена', 'success')
  }

  // ---------- Оверлеи и поворот ----------

  async function addText () {
    const page = pagesRef.current[cur]
    if (!page) { toast('Сначала добавьте страницу', 'error'); return }
    if (!engineRef.current) return
    engineRef.current.addTextOverlay('Вставьте текст', {
      fontFamily: 'Arial',
      fontSize: 48,
      fontWeight: 'bold',
      fill: '#000000',
      textAlign: 'center'
    })
    scheduleSaveDraft()
  }

  const applyPanel = useCallback(() => {
    const page = pagesRef.current[cur]
    if (!page || !engineRef.current) return
    const overlays = page.overlays || []
    const activeId = engineRef.current.activeId
    const active = overlays.find(o => o.id === activeId)
    if (!active || active.type !== 'text') return

    const snapshot = overlays.map(o => ({ ...o, data: { ...o.data } }))
    setUndoStack(stk => [...stk, { type: 'page', pageIndex: cur, overlays: snapshot }])

    setPages(prev => {
      const copy = [...prev]
      const p = copy[cur]
      if (!p) return prev
      const ovs = p.overlays.map(o => {
        if (o.id !== activeId) return o
        return {
          ...o,
          data: {
            ...o.data,
            fontFamily: font,
            fontSize,
            fontWeight: bold ? 'bold' : 'normal',
            fontStyle: italic ? 'italic' : 'normal',
            fill: color
          }
        }
      })
      copy[cur] = { ...p, overlays: ovs }
      return copy
    })
    scheduleSaveDraft()
  }, [cur, font, fontSize, bold, italic, color])

  useEffect(() => {
    if (panelOpen) applyPanel()
  }, [panelOpen, applyPanel])

  async function rotatePage () {
    const page = pagesRef.current[cur]
    if (!page || !engineRef.current) return
    const newRot = page.rotation === 90 ? 0 : 90

    setPages(prev => {
      const copy = [...prev]
      const p = copy[cur]
      if (!p) return prev
      copy[cur] = { ...p, rotation: newRot }
      return copy
    })

    engineRef.current.setPageRotation(newRot, isMobile)
    setDocRect(engineRef.current.getDocumentScreenRect())
    scheduleSaveDraft()
  }

  function placeFromLib (url) {
    const page = pagesRef.current[cur]
    if (!page) { toast('Сначала добавьте страницу', 'error'); return }
    if (!engineRef.current) return
    loadImageEl(url).then(img => {
      const snapshot = (page.overlays || []).map(o => ({ ...o, data: { ...o.data } }))
      setUndoStack(stk => [...stk, { type: 'page', pageIndex: cur, overlays: snapshot }])
      engineRef.current.addImageOverlay(img, { src: url })
      scheduleSaveDraft()
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
    setPages(prev => {
      const copy = [...prev]
      if (last.type === 'page') {
        const p = copy[last.pageIndex]
        if (!p) return prev
        copy[last.pageIndex] = { ...p, overlays: last.overlays }
      } else if (last.type === 'multi') {
        for (const ch of last.pages) {
          const p = copy[ch.pageIndex]
          if (!p) continue
          copy[ch.pageIndex] = { ...p, overlays: ch.overlays }
        }
      }
      return copy
    })
    scheduleSaveDraft()
  }

  function applyToAllPages () {
    const pagesArr = pagesRef.current
    const currentPage = pagesArr[cur]
    if (!currentPage || !engineRef.current) return
    const activeId = engineRef.current.activeId
    const src = (currentPage.overlays || []).find(o => o.id === activeId)
    if (!src) {
      toast('Выберите объект на странице', 'error')
      return
    }

    const snapshotAll = pagesArr.map((p, idx) => ({
      pageIndex: idx,
      overlays: (p.overlays || []).map(o => ({ ...o, data: { ...o.data } }))
    }))
    setUndoStack(stk => [...stk, { type: 'multi', pages: snapshotAll }])

    const srcW = currentPage.docWidth || 1
    const srcH = currentPage.docHeight || 1
    const relCx = src.cx / srcW
    const relCy = src.cy / srcH
    const relW = (src.w * (src.scaleX || 1)) / srcW
    const relH = (src.h * (src.scaleY || 1)) / srcH

    const newPages = pagesArr.map((page, idx) => {
      if (idx === cur) return page
      const dstW = page.docWidth || srcW
      const dstH = page.docHeight || srcH

      const newW = relW * dstW
      const newH = relH * dstH

      const newOv = {
        ...src,
        id: `${src.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        cx: relCx * dstW,
        cy: relCy * dstH,
        w: newW,
        h: newH,
        scaleX: 1,
        scaleY: 1,
        data: { ...src.data }
      }

      return {
        ...page,
        overlays: [...(page.overlays || []), newOv]
      }
    })

    setPages(newPages)
    scheduleSaveDraft()
    toast('Объект добавлен на все страницы', 'success')
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

  // ---------- Экспорт ----------

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
        suffix: 'стр.',
        stat: `0/${count} стр.`
      })

      await ensureJSZip()
      // eslint-disable-next-line no-undef
      const zip = new JSZip()

      for (let i = 0; i < pagesRef.current.length; i++) {
        const p = pagesRef.current[i]
        const off = renderPageOffscreen(p, 2)
        const dataUrl = off.toDataURL('image/jpeg', 1.0)
        const blob = await (await fetch(dataUrl)).blob()
        zip.file(`${bn}-p${i + 1}.jpg`, blob)
        setProgress(pr => ({
          ...pr,
          val: i + 1,
          stat: `${i + 1}/${count} стр.`
        }))
        await new Promise(r => requestAnimationFrame(r))
      }

      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })

      setProgress({
        active: true,
        mode: 'export',
        label: 'Скачивание JPG',
        val: 1,
        max: 1,
        suffix: '',
        stat: 'Формирование архива...'
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
        suffix: 'стр.',
        stat: `0/${count} стр.`
      })

      await ensureJsPDF()
      // eslint-disable-next-line no-undef
      const { jsPDF } = window.jspdf
      const doc = new jsPDF({
        unit: 'px',
        format: 'a4',
        compressPdf: true
      })

      for (let i = 0; i < pagesRef.current.length; i++) {
        const p = pagesRef.current[i]
        const off = renderPageOffscreen(p, 2)
        const dataUrl = off.toDataURL('image/jpeg', 1.0)

        if (i > 0) doc.addPage()
        const pageW = doc.internal.pageSize.getWidth()
        const pageH = doc.internal.pageSize.getHeight()
        doc.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH)

        setProgress(pr => ({
          ...pr,
          val: i + 1,
          stat: `${i + 1}/${count} стр.`
        }))
        await new Promise(r => requestAnimationFrame(r))
      }

      setProgress({
        active: true,
        mode: 'export',
        label: 'Скачивание PDF',
        val: 1,
        max: 1,
        suffix: '',
        stat: 'Формирование файла...'
      })

      doc.save(`${bn}.pdf`)

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
        const snapshot = (page.overlays || []).map(o => ({ ...o, data: { ...o.data } }))
        setUndoStack(stk => [...stk, { type: 'page', pageIndex: curRef.current, overlays: snapshot }])
        setPages(prev => {
          const copy = [...prev]
          const p = copy[curRef.current]
          if (!p) return prev
          copy[curRef.current] = { ...p, overlays: (p.overlays || []).filter(o => o.id !== activeId) }
          return copy
        })
        scheduleSaveDraft()
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

  function commitTextEdit () {
    if (!textEdit) return
    const { overlayId } = textEdit
    const page = pagesRef.current[cur]
    if (!page) { setTextEdit(null); return }

    const snapshot = (page.overlays || []).map(o => ({ ...o, data: { ...o.data } }))
    setUndoStack(stk => [...stk, { type: 'page', pageIndex: cur, overlays: snapshot }])

    setPages(prev => {
      const copy = [...prev]
      const p = copy[cur]
      if (!p) return prev
      const ovs = (p.overlays || []).map(o => {
        if (o.id !== overlayId) return o
        return {
          ...o,
          data: {
            ...o.data,
            text: textEditValue
          }
        }
      })
      copy[cur] = { ...p, overlays: ovs }
      return copy
    })

    setTextEdit(null)
    scheduleSaveDraft()
  }

  function cancelTextEdit () {
    setTextEdit(null)
  }

  const textEditorStyle = textEdit && canvasWrapRef.current
    ? {
        position: 'absolute',
        left: `${textEdit.rectCanvas.x}px`,
        top: `${textEdit.rectCanvas.y}px`,
        width: `${Math.max(40, textEdit.rectCanvas.w)}px`,
        height: `${Math.max(30, textEdit.rectCanvas.h)}px`,
        fontFamily: textEdit.fontFamily,
        fontSize: `${textEdit.fontSize}px`,
        fontWeight: textEdit.fontWeight,
        fontStyle: textEdit.fontStyle,
        color: textEdit.fill,
        border: '1px solid #3C6FD8',
        borderRadius: '4px',
        padding: '4px 6px',
        resize: 'none',
        outline: 'none',
        background: 'rgba(255,255,255,0.95)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 200
      }
    : null

  return (
    <div className="doc-editor page" style={{ paddingTop: 0 }}>
      <ProgressOverlay
        open={progress.active}
        label={progress.label}
        percent={progress.max ? (progress.val / progress.max) * 100 : 0}
        indeterminate={!progress.max}
        extra={progress.stat}
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
            {hasDoc && (
              <>
                <canvas
                  ref={canvasRef}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
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
                    style={textEditorStyle}
                    value={textEditValue}
                    onChange={e => setTextEditValue(e.target.value)}
                    onBlur={commitTextEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        commitTextEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelTextEdit()
                      }
                    }}
                    autoFocus
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
                setPages([]); setCur(0); setFileName(''); setUndoStack([])
                try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
                try { await AuthAPI.clearDraft() } catch {}
                setDraftHint(false)
                toast('Документ удалён', 'success')
              }}
            >
              <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Удалить документ
            </button>
            <button
              className={`ed-action ${canUndo ? '' : 'disabled'}`}
              onClick={undoLast}
            >
              <img src={icUndo} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Отменить
            </button>
            <button
              className={`ed-action ${pagesRef.current.length ? '' : 'disabled'}`}
              onClick={rotatePage}
            >
              <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 8 }} />Повернуть страницу
            </button>
            <button
              className={`ed-action ${hasActiveOverlay ? '' : 'disabled'}`}
              onClick={applyToAllPages}
            >
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
        <button className="fab fab-add mobile-only" onClick={() => { if (pagesRef.current.length) { setMenuAddOpen(o => !o) } else { pickDocument() } }} title="Добавить">
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
        <button className="fab fab-dl mobile-only" onClick={() => { if (!pagesRef.current.length) return; setMenuDownloadOpen(o => !o) }} title="Скачать">
          <img src={icDownload} alt="↓" />
        </button>
      </div>

      {menuActionsOpen && (
        <div
          className="ed-sheet"
          ref={sheetActionsRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, maxWidth: '96vw', minWidth: 240 }}
        >
          <button className={pagesRef.current.length ? '' : 'disabled'} onClick={() => { setMenuActionsOpen(false); rotatePage() }}>
            <img src={icRotate} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Повернуть страницу
          </button>
          <button className={(pagesRef.current.length && pagesRef.current.length > 1) ? '' : 'disabled'} onClick={async () => { setMenuActionsOpen(false); await deletePageAt(cur) }}>
            <img src={icDelete} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Удалить страницу
          </button>
          <button className={hasActiveOverlay ? '' : 'disabled'} onClick={() => { setMenuActionsOpen(false); applyToAllPages() }}>
            <img src={icAddPage} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />На все страницы
          </button>
          <button
            className={pagesRef.current.length ? '' : 'disabled'}
            onClick={async () => {
              setMenuActionsOpen(false)
              if (!pagesRef.current.length) return
              if (!window.confirm('Удалить весь документ?')) return
              setPages([]); setCur(0); setFileName(''); setUndoStack([])
              try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
              try { await AuthAPI.clearDraft() } catch {}
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
          <button className={pagesRef.current.length ? '' : 'disabled'} onClick={() => { setMenuAddOpen(false); addText() }}>
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
          <button className={`btn ${pagesRef.current.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current.length) { setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icJpgPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить JPG
          </button>
          <button className={`btn ${pagesRef.current.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current.length) { setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icPdfPaid} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Купить PDF
          </button>
          <button className={`btn btn-lite ${pagesRef.current.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current.length) { setMenuDownloadOpen(false); exportJPG() } }}>
            <img src={icJpgFree} alt="" style={{ width: 18, height: 18, marginRight: 10 }} />Скачать бесплатно JPG
          </button>
          <button className={`btn btn-lite ${pagesRef.current.length ? '' : 'disabled'}`} style={{ padding: '10px 14px' }} onClick={() => { if (pagesRef.current.length) { setMenuDownloadOpen(false); exportPDF() } }}>
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
            const page = pagesRef.current[cur]
            if (page && engineRef.current) {
              const img = await loadImageEl(dataUrl)
              const snapshot = (page.overlays || []).map(o => ({ ...o, data: { ...o.data } }))
              setUndoStack(stk => [...stk, { type: 'page', pageIndex: cur, overlays: snapshot }])
              engineRef.current.addImageOverlay(img, { src: dataUrl })
              scheduleSaveDraft()
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
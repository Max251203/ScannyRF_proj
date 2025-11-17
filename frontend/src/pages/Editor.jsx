// src/pages/Editor.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric, ensurePDFJS, ensureHtml2Canvas, ensureMammothCDN,
  ensureSheetJS, ensureJsPDF, ensureJSZip, ensureScripts
} from '../utils/scriptLoader'
import { EditorWS } from '../utils/wsClient' // WS-клиент

import CropModal from '../components/CropModal.jsx'

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
import icLibrary from '../assets/icons/library.png' // библиотека

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

const PAGE_W = 794
const PAGE_H = 1123
const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial','Times New Roman','Ermilov','Segoe UI','Roboto','Georgia']

// Единое качество для экранного рендера
const PDF_RENDER_SCALE = 3
const RASTER_RENDER_SCALE = 3

function randDocId(){ return String(Math.floor(1e15 + Math.random()*9e15)) }
function genDefaultName(){ const a = Math.floor(Math.random()*1e6), b = Math.floor(Math.random()*1e6); return `${a}-${b}` }
function sanitizeName(s){ s=(s||'').normalize('NFKC'); s=s.replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/-+/g,'-').replace(/^[-_.]+|[-_.]+$/g,''); return s.slice(0,64)||genDefaultName() }

// pdf-lib через CDN
async function ensurePDFLib(){
  if (window.PDFLib) return window.PDFLib
  await ensureScripts(['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'])
  if (!window.PDFLib) throw new Error('Не удалось загрузить pdf-lib')
  return window.PDFLib
}

// безопасное копирование в новый Uint8Array
function toUint8Copy(input){
  if (input instanceof Uint8Array){
    const out = new Uint8Array(input.length); out.set(input); return out
  }
  if (input instanceof ArrayBuffer){
    const view = new Uint8Array(input); const out = new Uint8Array(view.length); out.set(view); return out
  }
  return new Uint8Array()
}

// base64 для PDF в JSON
function u8ToB64(u8){
  let bin = ''; const chunk = 0x8000
  for(let i=0; i<u8.length; i+=chunk){ bin += String.fromCharCode.apply(null, u8.subarray(i, i+chunk)) }
  return btoa(bin)
}
function b64ToU8(b64){
  const bin = atob(b64); const u8 = new Uint8Array(bin.length)
  for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i)
  return u8
}

// Стабильный dataURL для overlay-изображений
async function ensureSerializableSrcForImage(obj){
  const el = obj?._originalElement || obj?._element
  const src = el?.src || ''
  if (!src) return ''
  if (src.startsWith('data:')) return src
  const w = el?.naturalWidth || el?.width || obj.getScaledWidth() || 1
  const h = el?.naturalHeight || el?.height || obj.getScaledHeight() || 1
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d', { willReadFrequently: true, alpha: true, desynchronized: true })
  try { ctx.textBaseline = 'alphabetic' } catch {}
  try { ctx.drawImage(el, 0, 0, c.width, c.height); return c.toDataURL('image/png') } catch { return src }
}

// helpers чтения/рендера
function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file) }) }
function loadImageEl(src){ return new Promise((res,rej)=>{ const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>res(img); img.onerror=rej; img.src=src }) }

// Рендер DOCX/XLSX в растр
async function renderDOCXToCanvas(file){
  await ensureMammothCDN(); await ensureHtml2Canvas()
  const ab=await file.arrayBuffer()
  const res=await window.mammoth.convertToHtml({ arrayBuffer: ab })
  const holder=document.createElement('div')
  Object.assign(holder.style,{position:'fixed',left:'-9999px',top:'-9999px',width:'1100px',padding:'24px',background:'#fff'})
  holder.innerHTML=res.value||'<div/>'
  document.body.appendChild(holder)
  const canvas=await window.html2canvas(holder,{backgroundColor:'#fff',scale:RASTER_RENDER_SCALE})
  document.body.removeChild(holder)
  return canvas
}
async function renderXLSXToCanvas(file){
  await ensureSheetJS(); await ensureHtml2Canvas()
  const ab=await file.arrayBuffer()
  const wb=window.XLSX.read(ab,{type:'array'})
  const sheetName=wb.SheetNames[0]
  const html=window.XLSX.utils.sheet_to_html(wb.Sheets[sheetName])
  const holder=document.createElement('div')
  Object.assign(holder.style,{position:'fixed',left:'-9999px',top:'-9999px',width:'1200px',padding:'16px',background:'#fff'})
  holder.innerHTML=html
  document.body.appendChild(holder)
  const canvas=await window.html2canvas(holder,{backgroundColor:'#fff',scale:RASTER_RENDER_SCALE})
  document.body.removeChild(holder)
  return canvas
}
function sliceCanvasToPages(canvas){
  const out=[], totalH=canvas.height, pagePx=3508
  for(let y=0;y<totalH;y+=pagePx){
    const sliceH=Math.min(pagePx,totalH-y)
    const tmp=document.createElement('canvas'); const tctx=tmp.getContext('2d', { willReadFrequently: true })
    tmp.width=canvas.width; tmp.height=sliceH
    try { tctx.textBaseline='alphabetic' } catch {}
    tctx.drawImage(canvas,0,y,canvas.width,sliceH,0,0,tmp.width,tmp.height)
    out.push(tmp.toDataURL('image/png'))
  }
  return out
}

// Утилиты геометрии и укладки фона без искажений
function contentTargetSizeForPage(page){
  const meta = page?.meta || {}
  let w = meta.w || meta.pdf_w || PAGE_W
  let h = meta.h || meta.pdf_h || PAGE_H
  if (page?.landscape) [w, h] = [h, w]
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}
function fitValueToCanvasNoPadding(wrapW, wrapH, targetW, targetH){
  const marginX = 12, marginY = 12
  const availW = Math.max(50, wrapW - marginX*2)
  const availH = Math.max(50, wrapH - marginY*2)
  const s = Math.max(0.1, Math.min(availW/targetW, availH/targetH))
  const cssW = Math.min(availW, Math.max(1, Math.round(targetW * s)))
  const cssH = Math.min(availH, Math.max(1, Math.round(targetH * s)))
  return { cssW, cssH }
}
function rectChanged(a, b){
  const eps = 0.5
  return Math.abs(a.l - b.l) > eps || Math.abs(a.t - b.t) > eps || Math.abs(a.w - b.w) > eps || Math.abs(a.h - b.h) > eps
}
function placeBgObject(cv, page, img){
  // Режим "contain": фон не искажается и центрируется
  const iw = img.width || 1
  const ih = img.height || 1
  const cvw = cv.getWidth()
  const cvh = cv.getHeight()
  const s = Math.min(cvw/iw, cvh/ih)
  img.set({
    left: Math.round((cvw - iw * s)/2),
    top: Math.round((cvh - ih * s)/2),
    selectable:false, evented:false, hoverCursor:'default', objectCaching:false,
    scaleX: s, scaleY: s,
  })
  try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
  page.bgObj = img
  cv.add(img); img.moveTo(0); cv.requestRenderAll()
  page._layoutRect = { l: Math.max(0,img.left||0), t: Math.max(0,img.top||0), w: img.getScaledWidth(), h: img.getScaledHeight() }
}
function transformOverlaysBetweenRects(page, fromRect, toRect){
  const cv = page?.canvas
  if (!cv) return
  const objs = (cv.getObjects()||[]).filter(o => o !== page.bgObj)
  const sx = toRect.w / Math.max(1, fromRect.w)
  const sy = toRect.h / Math.max(1, fromRect.h)
  for (const o of objs){
    const relX = (o.left - fromRect.l)
    const relY = (o.top  - fromRect.t)
    const newLeft = toRect.l + relX * sx
    const newTop  = toRect.t + relY * sy
    o.set({ left: newLeft, top: newTop })
  }
  cv.requestRenderAll()
}
function clampObjectToRect(obj, rect){
  const w = obj.getScaledWidth?.() || obj.width || 0
  const h = obj.getScaledHeight?.() || obj.height || 0
  let left = (obj.left ?? 0)
  let top  = (obj.top  ?? 0)
  const minL = rect.l
  const minT = rect.t
  const maxL = rect.l + rect.w - w
  const maxT = rect.t + rect.h - h
  if (left < minL) left = minL
  if (top  < minT) top  = minT
  if (left > maxL) left = maxL
  if (top  > maxT) top  = maxT
  obj.set({ left, top })
}
function ensureDeleteControlInside(obj, rect){
  try{
    obj.setCoords()
    const tr = obj.oCoords?.tr
    if (!tr) return
    let dx = 0, dy = 0
    if (tr.x < rect.l) dx = rect.l - tr.x
    if (tr.x > rect.l + rect.w) dx = (rect.l + rect.w) - tr.x
    if (tr.y < rect.t) dy = rect.t - tr.y
    if (tr.y > rect.t + rect.h) dy = (rect.t + rect.h) - tr.y
    if (dx || dy){
      obj.set({ left: (obj.left||0) + dx, top: (obj.top||0) + dy })
      obj.setCoords()
    }
  }catch{}
}

// Кнопка удаления
function installDeleteControl(){
  // eslint-disable-next-line no-undef
  const fobj=fabric.Object; if(!fobj || fobj.__delPatched) return
  // eslint-disable-next-line no-undef
  const F=fabric
  const del=new F.Control({
    x:0.5,y:-0.5,offsetX:14,offsetY:-14,cursorStyle:'pointer',
    mouseUpHandler:(_,tr)=>{
      const t=tr.target,cv=t?.canvas
      if (!cv) return true
      if (window.confirm('Удалить объект со страницы?')) {
        const idx = (cv.__pageIndex ?? -1)
        const oid = t.__scannyId || null
        cv.remove(t); cv.discardActiveObject(); cv.requestRenderAll()
        if (oid && idx >= 0) cv.__onPatch?.([{ op: 'overlay_remove', page: idx, id: oid }])
      }
      return true
    },
    render:(ctx,left,top)=>{ const r=14; ctx.save(); ctx.fillStyle='#E26D5C'; ctx.beginPath(); ctx.arc(left,top,r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.beginPath(); ctx.moveTo(left-6,top-6); ctx.lineTo(left+6,top+6); ctx.moveTo(left+6,top-6); ctx.lineTo(left-6,top+6); ctx.stroke(); ctx.restore(); }
  })
  fobj.prototype.controls.tr=del
  // eslint-disable-next-line no-undef
  window.__scannyDelControl = del
  fobj.__delPatched=true
}
function ensureDeleteControlFor(obj){
  try{
    // eslint-disable-next-line no-undef
    if (obj && obj.controls && window.__scannyDelControl) obj.controls.tr = window.__scannyDelControl
    obj.set({
      hasControls: true,
      hasBorders: true,
      lockUniScaling: false,
      transparentCorners: false,
      cornerStyle: 'circle',
      cornerColor: '#E26D5C',
      objectCaching: true,
      noScaleCache: false,
    })
  }catch{}
}

export default function Editor(){
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')

  // page: { id, elId, canvas, bgObj, landscape, meta, _bgRendered?, _layoutRect?, _pendingOverlays? }
  const [pages, setPages] = useState([])
  const [cur, setCur] = useState(0)
  const [loading, setLoading] = useState(true)

  const hasDoc = pages.length>0
  const canPrev = hasDoc && cur>0
  const canNext = hasDoc && cur<pages.length-1

  const [signLib, setSignLib] = useState([])
  const [libLoading, setLibLoading] = useState(false)

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

  // Единая кроп‑модалка
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropKind, setCropKind] = useState('signature')
  const [cropThresh, setCropThresh] = useState(40)

  const [plan, setPlan] = useState('month')
  const [promo, setPromo] = useState('')
  const [promoError, setPromoError] = useState('')
  const [prices, setPrices] = useState({ single:0, month:0, year:0 })
  const [promoPercent, setPromoPercent] = useState(0)
  const price = useMemo(()=>{
    let v = prices[plan] || 0
    if (promoPercent>0) v = Math.max(0, Math.round(v*(100-promoPercent)/100))
    return v
  },[plan,promoPercent,prices])

  const [billing, setBilling] = useState(null)
  const isAuthed = !!localStorage.getItem('access')

  const [undoStack, setUndoStack] = useState([])
  const canUndo = undoStack.length>0

  // Локальный верхний баннер
  const [banner, setBanner] = useState('')
  const showBanner = (text, timeout=1800) => {
    setBanner(text)
    window.clearTimeout(showBanner._t)
    showBanner._t = window.setTimeout(()=>setBanner(''), timeout)
  }

  // Мобильная модалка библиотеки
  const [libOpen, setLibOpen] = useState(false)

  // сериализация/WS
  const pagesRef = useRef(pages)
  const docIdRef = useRef(docId)
  const fileNameRef = useRef(fileName)
  useEffect(()=>{ pagesRef.current = pages }, [pages])
  useEffect(()=>{ docIdRef.current = docId }, [docId])
  useEffect(()=>{ fileNameRef.current = fileName }, [fileName])

  const wsRef = useRef(null)
  const draftExistsRef = useRef(false)
  const isDeletingRef = useRef(false)

  // Флаг для «первичного» рендера после setPages(created)
  const initialRenderPendingRef = useRef(false)

  // Дебаунс REST‑патчей как резерв, если WS не доставит
  const restPatchBufferRef = useRef([])
  const restPatchTimerRef = useRef(0)
  function flushRestPatchesSoon(){
    window.clearTimeout(restPatchTimerRef.current)
    restPatchTimerRef.current = window.setTimeout(async () => {
      const ops = restPatchBufferRef.current
      restPatchBufferRef.current = []
      if (!isAuthed || ops.length === 0) return
      try { await AuthAPI.patchDraft(ops) } catch {}
    }, 240)
  }
  function sendPatch(ops){
    if (!isAuthed || !ops || ops.length === 0) return
    try { wsRef.current?.sendPatch(ops) } catch {}
    // дублируем в REST‑буфер с дебаунсом как страховку
    restPatchBufferRef.current.push(...ops)
    flushRestPatchesSoon()
  }

  // Единая фиксация изменений страниц (добавление/удаление) на сервере.
// Если черновика ещё нет — один раз сохраняем полный снапшот и коммитим WS.
  // Единая фиксация изменений страниц (добавление/удаление) на сервере.
// Делает гарантированный REST-патч СРАЗУ (без дебаунса) + параллельно шлёт WS.
// Если черновика ещё нет — сначала создаём его полным снапшотом.
// Единая фиксация изменений страниц (page_add / page_remove).
// 1) Если черновика ещё нет — создаём его полным снимком и выходим.
// 2) Иначе: отправляем WS-патч (best-effort) и ОБЯЗАТЕЛЬНО фиксируем REST-патчем.
// 3) Сразу после удачного REST-патча делаем saveDraft(текущий snapshot) как финальный консолидационный шаг.
async function persistPageOps(ops = []) {
  const list = Array.isArray(ops) ? ops.filter(Boolean) : []
  if (list.length === 0) return

  // 1) Нет серверного черновика — создаём снапшотом и выходим (патчи тут не нужны)
  if (!draftExistsRef.current) {
    const snapshot = await serializeDocument()
    if (snapshot) {
      try {
        await AuthAPI.saveDraft(snapshot)
        wsRef.current?.commit?.(snapshot)
        draftExistsRef.current = true
      } catch (e) {
        console.debug('[persistPageOps] saveDraft (init) failed:', e)
      }
    }
    return
  }

  // 2) отправляем WS-патч best-effort (не критично)
  try { wsRef.current?.sendPatch?.(list) } catch (e) {
    console.debug('[persistPageOps] ws sendPatch failed:', e)
  }

  // 2b) ГАРАНТИРОВАННАЯ фиксация REST-патчем
  try {
    await AuthAPI.patchDraft(list)
  } catch (e) {
    console.debug('[persistPageOps] REST patchDraft failed, fallback to full save:', e)
    // Фолбэк: полноценный снапшот, чтобы не потерять состояние
    try {
      const snapshot = await serializeDocument()
      if (snapshot) {
        await AuthAPI.saveDraft(snapshot)
        wsRef.current?.commit?.(snapshot)
        draftExistsRef.current = true
      }
    } catch (e2) {
      console.debug('[persistPageOps] fallback saveDraft failed:', e2)
    }
    return
  }

  // 3) Консолидация: сразу сохраняем полный актуальный снапшот,
  // чтобы при восстановлении состояние было идентично локальному.
  try {
    const snapshot = await serializeDocument()
    if (snapshot) {
      await AuthAPI.saveDraft(snapshot)
      wsRef.current?.commit?.(snapshot)
    }
  } catch (e) {
    console.debug('[persistPageOps] saveDraft (consolidate) failed:', e)
  }
}

  // прячем футер
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

  const [isMobile, setIsMobile] = useState(()=>window.matchMedia('(max-width: 960px)').matches)
  useEffect(()=>{
    const mq=window.matchMedia('(max-width: 960px)')
    const on=()=>setIsMobile(mq.matches)
    mq.addEventListener('change',on)
    return ()=>mq.removeEventListener('change',on)
  },[])

  // Предзагрузка pdf.js worker (до первого getDocument)
  useEffect(()=>{ ensurePDFJS().catch(()=>{}) },[])

  // верхнее меню (позиция под кнопкой)
  const onTopMenuClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8 + window.scrollY, left: r.left + window.scrollX })
    setMenuActionsOpen(o=>!o)
  }

  // биллинг/цены — первичная загрузка
  useEffect(()=>{
    if(isAuthed){
      AuthAPI.getBillingStatus()
        .then((st)=>{
          setBilling(st)
          if (st && ('price_single' in st)) {
            setPrices({ single: Number(st.price_single||0), month: Number(st.price_month||0), year: Number(st.price_year||0) })
          }
        })
        .catch(()=>{})
    }
  },[isAuthed])

  // реакции на смену юзера/биллинга/хранилища и явное подключение WS
  useEffect(()=>{
    const onUser=async()=>{
      if(localStorage.getItem('access')){
        try{
          const st = await AuthAPI.getBillingStatus();
          setBilling(st)
          if (st && ('price_single' in st)) {
            setPrices({ single: Number(st.price_single||0), month: Number(st.price_month||0), year: Number(st.price_year||0) })
          }
        }catch{}
        loadLibrary()
        // если docId уже есть — подключим WS
        if (docIdRef.current) ensureWS()
      } else {
        // токен исчез — закрыть WS
        try { wsRef.current?.destroy?.() } catch {}
        wsRef.current = null
      }
    }
    const onBill=(e)=>{
      const st = e.detail;
      setBilling(st)
      if (st && ('price_single' in st)) {
        setPrices({ single: Number(st.price_single||0), month: Number(st.price_month||0), year: Number(st.price_year||0) })
      }
    }
    const onStorage = () => {
      const t = localStorage.getItem('access') || ''
      if (wsRef.current) wsRef.current.setToken(t);
    }
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    window.addEventListener('storage', onStorage)
    return ()=>{ window.removeEventListener('user:update', onUser); window.removeEventListener('billing:update', onBill); window.removeEventListener('storage', onStorage) }
  },[])

  // Клики вне листов
  useEffect(()=>{
    function onDoc(e){
      const t=e.target
      if(menuActionsOpen && sheetActionsRef.current && !sheetActionsRef.current.contains(t) && !t.closest('.ed-menu-btn')) setMenuActionsOpen(false)
      if(menuAddOpen && sheetAddRef.current && !sheetAddRef.current.contains(t) && !t.closest('.fab-add')) setMenuAddOpen(false)
      if(menuDownloadOpen && sheetDownloadRef.current && !sheetDownloadRef.current.contains(t) && !t.closest('.fab-dl')) setMenuDownloadOpen(false)
    }
    if(menuActionsOpen || menuAddOpen || menuDownloadOpen){
      document.addEventListener('click',onDoc,true)
      return ()=>document.removeEventListener('click',onDoc,true)
    }
  },[menuActionsOpen, menuAddOpen, menuDownloadOpen])

  function throttle(fn, wait=160){
    let last = 0, tid = null
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

  // Подгон размеров (без повторного рендера PDF, переносим/центрируем фон и оверлеи)
  function fitCanvasForPage(page){
    if(!page || !page.canvas) return
    const cv = page.canvas
    const wrap = canvasWrapRef.current
    if(!wrap) return

    const wrapW = Math.max(1, wrap.clientWidth || 0)
    const wrapH = Math.max(1, wrap.clientHeight || 0)
    if (wrapW < 10 || wrapH < 10) {
      requestAnimationFrame(()=>fitCanvasForPage(page))
      return
    }

    const tgt = contentTargetSizeForPage(page)
    const { cssW, cssH } = fitValueToCanvasNoPadding(wrapW, wrapH, tgt.w, tgt.h)

    const edCanvasEl = cv.lowerCanvasEl?.parentElement?.parentElement
    const cont  = cv.lowerCanvasEl?.parentElement

    if (edCanvasEl){
      edCanvasEl.style.width = cssW+'px'
      edCanvasEl.style.height = cssH+'px'
      edCanvasEl.style.maxWidth = '100%'
      edCanvasEl.style.transform = 'none'
      edCanvasEl.style.margin = '0 auto'
    }
    if (cont){
      cont.style.width  = cssW+'px'
      cont.style.height = cssH+'px'
      cont.style.maxWidth = '100%'
      cont.style.transform = 'none'
    }

    const prevRect = page._layoutRect ? { ...page._layoutRect } : null

    cv.setDimensions({ width: cssW, height: cssH })
    cv.renderAll()

    // фон «contain» в центр, пересчёт прямоугольника контента
    if (page.bgObj) {
      placeBgObject(cv, page, page.bgObj)
    } else {
      page._layoutRect = { l:0, t:0, w:cssW, h:cssH }
    }

    if (prevRect && page._layoutRect && rectChanged(prevRect, page._layoutRect)) {
      transformOverlaysBetweenRects(page, prevRect, page._layoutRect)
    }
  }
  function fitCanvas(idx){ const p=pages[idx]; if(!p||!p.canvas) return; fitCanvasForPage(p) }

  // Resize / orientation: подгон + возможный ререндер рядом
  useEffect(() => {
    const handle = throttle(() => {
      const pagesLocal = pagesRef.current || []
      for (const p of pagesLocal) {
        if (p?.canvas) {
          fitCanvasForPage(p)
        }
      }
      const cidx = cur
      if (typeof cidx === 'number') {
        ensurePageRendered(cidx)
        if (cidx + 1 < pagesLocal.length) ensurePageRendered(cidx + 1)
      }
    }, 160)

    window.addEventListener('resize', handle, { passive: true })
    window.addEventListener('orientationchange', handle, { passive: true })
    const vv = window.visualViewport
    if (vv && vv.addEventListener) vv.addEventListener('resize', handle, { passive: true })

    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('orientationchange', handle)
      if (vv && vv.removeEventListener) vv.removeEventListener('resize', handle)
    }
  }, [cur])

  // ResizeObserver -> подгон канвы при смене контейнера
  useEffect(()=>{
    if(!canvasWrapRef.current) return
    const ro=new ResizeObserver(()=>{
      pages.forEach((p)=>{
        if (p?.canvas) {
          fitCanvasForPage(p)
        }
      })
    })
    ro.observe(canvasWrapRef.current)
    return ()=>ro.disconnect()
  },[pages])

  // При смене режима (мобайл/десктоп)
  useEffect(()=>{
    pages.forEach((p)=>{ if (p?.canvas) fitCanvasForPage(p) })
    if (hasDoc) {
      ensurePageRendered(cur)
      if (cur+1<pages.length) ensurePageRendered(cur+1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isMobile])

  // Загрузка библиотеки подписей/печати
  async function loadLibrary(){
    if (!isAuthed) { setSignLib([]); return }
    setLibLoading(true)
    try{
      const list=await AuthAPI.listSigns()
      setSignLib(Array.isArray(list)?list:[])
    }catch{
      setSignLib([])
    } finally {
      setLibLoading(false)
    }
  }
  useEffect(()=>{ if (isAuthed) loadLibrary() },[isAuthed])

  // WS lifecycle — явное подключение
  function getAccessToken(){ return localStorage.getItem('access') || '' }
  function ensureWS(){
    if (!isAuthed || !docIdRef.current) return
    const token = getAccessToken()
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
  // подключаем WS сразу, когда появился docId и есть токен
  useEffect(() => {
    if (isAuthed && docId) ensureWS()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, docId])

  useEffect(()=>{
    return () => {
      try { wsRef.current?.destroy?.() } catch {}
      wsRef.current = null
    }
  }, [])

  // Восстановление черновика: НЕ рендерим сразу (боремся с гонкой), а ставим флаг initialRenderPending
  useEffect(()=>{
    (async ()=>{
      if (hasDoc || isDeletingRef.current) { setLoading(false); return; }
      if (!localStorage.getItem('access')) { setLoading(false); return; }

      try{
        setLoading(true)
        const srv = await AuthAPI.getDraft()
        if (isDeletingRef.current) return
        if (srv && srv.exists && srv.data) {
          // помечаем, что серверный черновик существует
          draftExistsRef.current = true
          await restoreDocumentFromDraft(srv.data)
          showBanner('Восстановлен последний документ')
        }
      } catch (e) {
        console.error('restore draft failed', e)
      } finally {
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  // Контекст и фабрика отрисовки страницы
  const ctxRef = useRef(null)
  const ensurePageRenderedRef = useRef(null)
  useEffect(() => {
    const ctx = { pagesRef, setPages, sendPatch }
    ctxRef.current = ctx
    ensurePageRenderedRef.current = ensurePageRenderedFactory(ctx)
  }, [pagesRef, setPages, sendPatch])

  // Ленивый вызов ensurePageRendered (если фабрика ещё не готова)
  function ensurePageRendered(index){
    let fn = ensurePageRenderedRef.current
    if (typeof fn !== 'function') {
      ensurePageRenderedRef.current = ensurePageRenderedFactory(ctxRef.current || { pagesRef, setPages, sendPatch })
      fn = ensurePageRenderedRef.current
    }
    return fn(index)
  }

  // Как только setPages(created) отработал и initialRenderPendingRef = true — рендерим все страницы
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  // === продолжение файла Editor.jsx ===

  // Создание канвы и события объектов (патчи вместо полного сохранения)
  async function ensureCanvas(page, pageIndex, onPatch){
    await ensureFabric()
    if(page.canvas) return page.canvas

    // Ждём появления <canvas id={page.elId}>
    await new Promise((res, rej)=>{
      const t0 = Date.now()
      ;(function loop(){
        const el = document.getElementById(page.elId)
        if (el) return res(el)
        if (Date.now()-t0 > 8000) return rej(new Error('Canvas element timeout'))
        requestAnimationFrame(loop)
      })()
    })

    // eslint-disable-next-line no-undef
    const c = new fabric.Canvas(page.elId,{ backgroundColor:'#fff', preserveObjectStacking:true, selection:true })
    c.set({ selection:true, preserveObjectStacking:true })
    // eslint-disable-next-line no-undef
    c.enableRetinaScaling = true

    c.targetFindTolerance = 10
    c.perPixelTargetFind = false
    c.defaultCursor = 'default'
    c.hoverCursor = 'move'

    // Ссылки для патчей
    c.__pageRef = page
    c.__pageIndex = pageIndex
    c.__onPatch = onPatch

    page.canvas = c

    // Панель текста — включаем при выделении textbox
    const onSelectionChanged = (e) => {
      const obj=e?.selected?.[0]
      if(obj && obj.type==='textbox'){
        setPanelOpen(true)
        setFont(obj.fontFamily||'Arial')
        setFontSize(Number(obj.fontSize||42))
        setBold(!!(obj.fontWeight==='bold'||obj.fontWeight===700))
        setItalic(!!(obj.fontStyle==='italic'))
        setColor(obj.fill||'#000000')
      }else setPanelOpen(false)
    }
    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', ()=>setPanelOpen(false))

    // Ограничения перемещения/масштаба/поворота внутри layoutRect
    c.on('object:moving',  (e) => {
      const obj = e?.target
      if (!obj) return
      const rect = page._layoutRect || { l:0, t:0, w:c.getWidth(), h:c.getHeight() }
      clampObjectToRect(obj, rect)
      ensureDeleteControlInside(obj, rect)
      c.requestRenderAll()
    })
    c.on('object:scaling', (e) => {
      const obj = e?.target
      if (!obj) return
      const rect = page._layoutRect || { l:0, t:0, w:c.getWidth(), h:c.getHeight() }
      const baseW = obj.width || 1, baseH = obj.height || 1
      const maxSX = rect.w / baseW, maxSY = rect.h / baseH
      const uni = Math.max(0.01, Math.min(obj.scaleX, obj.scaleY, maxSX, maxSY))
      obj.set({ scaleX: uni, scaleY: uni })
      clampObjectToRect(obj, rect)
      ensureDeleteControlInside(obj, rect)
      c.requestRenderAll()
    })
    c.on('object:rotating', (e) => {
      const obj = e?.target
      if (!obj) return
      const rect = page._layoutRect || { l:0, t:0, w:c.getWidth(), h:c.getHeight() }
      clampObjectToRect(obj, rect)
      ensureDeleteControlInside(obj, rect)
      c.requestRenderAll()
    })

    // Преобразование объекта Fabric в overlay JSON
    function overlayFromObject(obj){
      const base = {
        id: obj.__scannyId || ('ov_'+Math.random().toString(36).slice(2)),
        left: obj.left || 0,
        top: obj.top || 0,
        angle: obj.angle || 0,
        flipX: !!obj.flipX,
        flipY: !!obj.flipY,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
      }
      if (obj.type === 'textbox') {
        return {
          t: 'tb',
          ...base,
          text: obj.text || '',
          fontFamily: obj.fontFamily || 'Arial',
          fontSize: obj.fontSize || 42,
          fontStyle: obj.fontStyle || 'normal',
          fontWeight: obj.fontWeight || 'normal',
          fill: obj.fill || '#000',
          width: Math.max(20, Number(obj.width || 200)),
          textAlign: obj.textAlign || 'left',
        }
      } else if (obj.type === 'image') {
        const src = (obj._originalElement?.src || obj._element?.src) || ''
        return { t: 'im', ...base, src }
      }
      return { t: 'unknown', ...base }
    }

    // Отправка патча после изменения объекта
    function sendUpsertForObject(obj){
      if (!c.__onPatch) return
      const ov = overlayFromObject(obj)
      if (!obj.__scannyId) obj.__scannyId = ov.id
      c.__onPatch([{ op: 'overlay_upsert', page: c.__pageIndex, obj: ov }])
    }

    c.on('object:modified', (e) => {
      const obj = e?.target
      if (!obj) return
      sendUpsertForObject(obj)
    })
    try {
      c.on('text:changed', (e) => {
        const obj = e?.target
        if (!obj) return
        c.requestRenderAll()
        sendUpsertForObject(obj)
      })
    } catch {}

    installDeleteControl()
    return c
  }

  // Ререндер PDF-фона под текущую CSS-ширину (устраняет «пустые» страницы)
  async function rerenderPdfBackgroundAtCurrentWidth(page){
    if (!page || !page.canvas || !page.meta || page.meta.type !== 'pdf' || !page.meta.bytes) return
    await ensurePDFJS()
    // eslint-disable-next-line no-undef
    const pdf = await pdfjsLib.getDocument({ data: page.meta.bytes.slice() }).promise
    const index = (page.meta.index || 0) + 1
    const p = await pdf.getPage(index)
    const vp1 = p.getViewport({ scale: 1 })
    const cv = page.canvas
    const targetW = cv.getWidth()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const scale = Math.max(1, Math.min(4, (targetW * dpr) / Math.max(1, vp1.width)))
    const off = await renderPDFPageToCanvas(pdf, index, scale)
    const url = off.toDataURL('image/png')
    // eslint-disable-next-line no-undef
    const img = new fabric.Image(await loadImageEl(url), { selectable:false, evented:false, objectCaching:false, noScaleCache:true })
    placeBgObject(cv, page, img)
    page._bgRendered = true
    cv.requestRenderAll()
  }

  // Базовый рендер PDF-страницы (offscreen)
  async function renderPDFPageToCanvas(pdf, pageNum, scale){
    const p = await pdf.getPage(pageNum)
    const vp = p.getViewport({ scale: Math.max(1, scale) })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true })
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    ctx.imageSmoothingEnabled = true
    try { ctx.imageSmoothingQuality = 'high'; ctx.textBaseline = 'alphabetic' } catch {}
    ctx.fillStyle = '#fff'
    ctx.fillRect(0,0,canvas.width,canvas.height)
    await p.render({ canvasContext: ctx, viewport: vp }).promise
    return canvas
  }

  // Фабрика ensurePageRendered (НЕ async, возвращает async-функцию)
  function ensurePageRenderedFactory(ctx){
    const { pagesRef, setPages, sendPatch } = ctx
    return async function ensurePageRendered(index){
      const page = pagesRef.current?.[index]
      if (!page) return

      const cv = await ensureCanvas(page, index, sendPatch)
      // Подгон размеров канвы без полей
      fitCanvasForPage(page)

      if (page._bgRendered) return

      try {
        const pg = page.meta || {}
        if (pg.type === 'pdf' && pg.bytes) {
          await ensurePDFJS()
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({data: pg.bytes.slice()}).promise
          const p = await pdf.getPage((pg.index||0)+1)
          const vp1 = p.getViewport({ scale: 1 })
          const targetW = cv.getWidth()
          const dpr = Math.max(1, window.devicePixelRatio || 1)
          const scale = Math.max(1, Math.min(4, (targetW * dpr) / Math.max(1, vp1.width)))
          const off = await renderPDFPageToCanvas(pdf, (pg.index||0)+1, scale)
          const url = off.toDataURL('image/png')
          // eslint-disable-next-line no-undef
          const img=new fabric.Image(await loadImageEl(url),{ selectable:false, evented:false, objectCaching:false, noScaleCache:true })
          placeBgObject(cv, page, img)
        } else if ((pg.type === 'image' || pg.type === 'raster') && pg.src) {
          // eslint-disable-next-line no-undef
          const img=new fabric.Image(await loadImageEl(pg.src),{ selectable:false, evented:false, objectCaching:false, noScaleCache:true })
          placeBgObject(cv, page, img)
        }
        page._bgRendered = true

        // Наложение оверлеев
        const overlays = Array.isArray(page._pendingOverlays) ? page._pendingOverlays : []
        if (overlays.length) {
          // eslint-disable-next-line no-undef
          const F = fabric
          for (const o of overlays){
            const type = o.t || (o.text !== undefined ? 'tb' : (o.src ? 'im' : 'unknown'))
            if (type === 'tb'){
              const tb=new F.Textbox(o.text||'',{
                left:o.left||0, top:o.top||0, angle:o.angle||0,
                fontFamily:o.fontFamily||'Arial', fontSize:o.fontSize||42,
                fontStyle:o.fontStyle||'normal', fontWeight:o.fontWeight||'normal',
                fill:o.fill||'#000', width: Math.max(20, Number(o.width||200)),
                textAlign: o.textAlign || 'left',
                scaleX: Number(o.scaleX||1), scaleY: Number(o.scaleY||1),
                selectable:true, objectCaching:true, noScaleCache:false,
              })
              tb.__scannyId = o.id || ('ov_'+Math.random().toString(36).slice(2))
              ensureDeleteControlFor(tb); cv.add(tb)
              const rect = page._layoutRect || { l:0, t:0, w:cv.getWidth(), h:cv.getHeight() }
              clampObjectToRect(tb, rect)
              ensureDeleteControlInside(tb, rect)
            } else if (type === 'im' && o.src){
              const im = new F.Image(await loadImageEl(o.src),{
                left:o.left||0, top:o.top||0, angle:o.angle||0,
                flipX: !!o.flipX, flipY: !!o.flipY,
                scaleX: Number(o.scaleX||1), scaleY: Number(o.scaleY||1),
                selectable:true, objectCaching:true, noScaleCache:false,
              })
              im.__scannyId = o.id || ('ov_'+Math.random().toString(36).slice(2))
              ensureDeleteControlFor(im); cv.add(im)
              const rect = page._layoutRect || { l:0, t:0, w:cv.getWidth(), h:cv.getHeight() }
              clampObjectToRect(im, rect)
              ensureDeleteControlInside(im, rect)
            }
          }
          page._pendingOverlays = []
        }

        cv.requestRenderAll()
      } catch (e) {
        console.warn('ensurePageRendered failed', e)
      }
    }
  }

  // ---------- Операции над документом ----------
  async function createPageFromImage(dataUrl, w, h, mime = 'image/png', landscape = false, opsOut = null, index = null) {
    const id = 'p_' + Math.random().toString(36).slice(2)
    const elId = 'cv_' + id
    const page = {
      id, elId, canvas: null, bgObj: null, landscape: !!landscape,
      meta: { type: 'image', src: dataUrl, w: w, h: h, mime },
      _bgRendered: false, _pendingOverlays: []
    }
    setPages(prev => {
      const arr = [...prev, page]
      return arr
    })
    // Патч на добавление (если просили и указан индекс вставки)
    if (Array.isArray(opsOut) && Number.isInteger(index)) {
      opsOut.push({
        op: 'page_add',
        index,
        page: {
          type: 'image',
          src: dataUrl,
          w: Math.max(1, Math.round(w || 1)),
          h: Math.max(1, Math.round(h || 1)),
          mime: mime || 'image/png',
          landscape: !!landscape,
          overlays: []
        }
      })
    }
    await new Promise(r => requestAnimationFrame(r))
    return page
  }

  async function addRasterPagesFromCanvas(canvas, opsOut = null, indexStart = null) {
    const slices = sliceCanvasToPages(canvas)
    let count = 0
    for (const url of slices) {
      const im = await loadImageEl(url)
      const w = im.naturalWidth || im.width
      const h = im.naturalHeight || im.height
      const idx = Number.isInteger(indexStart) ? indexStart + count : null
      await createPageFromImage(url, w, h, 'image/png', false, opsOut, idx)
      count += 1
    }
    return count
  }

  async function addPagesFromPDFBytes(bytes, opsOut = null, indexStart = null) {
    await ensurePDFJS()
    // eslint-disable-next-line no-undef
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const total = pdf.numPages
    const bytes_b64 = u8ToB64(bytes)

    let added = 0
    for (let i = 1; i <= total; i++) {
      const p = await pdf.getPage(i)
      const vp1 = p.getViewport({ scale: 1 })
      const off = await renderPDFPageToCanvas(pdf, i, 2.5)
      const url = off.toDataURL('image/png')

      const id = 'p_' + Math.random().toString(36).slice(2)
      const elId = 'cv_' + id
      const page = {
        id, elId, canvas: null, bgObj: null, landscape: false,
        meta: {
          type: 'pdf',
          bytes: toUint8Copy(bytes),
          index: i - 1,
          pdf_w: Math.round(vp1.width),
          pdf_h: Math.round(vp1.height)
        },
        _bgRendered: false,
        _pendingOverlays: []
      }
      setPages(prev => {
        const arr = [...prev, page]
        return arr
      })

      // Патч на добавление этой страницы (если просили)
      if (Array.isArray(opsOut) && Number.isInteger(indexStart)) {
        opsOut.push({
          op: 'page_add',
          index: indexStart + added,
          page: {
            type: 'pdf',
            index: i - 1,
            bytes_b64,
            pdf_w: Math.round(vp1.width),
            pdf_h: Math.round(vp1.height),
            landscape: false,
            overlays: []
          }
        })
      }

      added += 1
      await new Promise(r => requestAnimationFrame(r))
    }
    return added
  }

  function baseName(){
    const nm=(fileNameRef.current||'').trim()
    if(!nm){ toast('Введите название файла вверху','error'); return null }
    return sanitizeName(nm)
  }

  // ---------- Загрузка/страницы ----------
  const filePickBusyRef = useRef(false)
  function pickDocument(){
    if (filePickBusyRef.current) return
    filePickBusyRef.current = true
    try { docFileRef.current?.click() } finally {
      setTimeout(()=>{ filePickBusyRef.current=false }, 1500)
    }
  }
  async function onPickDocument(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await handleFiles(files); filePickBusyRef.current=false }
  async function onPickBgFile(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await assignFirstFileToCurrent(files[0]) }

  async function handleFiles(files) {
    setLoading(true)
    try {
      let curDocId = docIdRef.current
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId) }
      ensureWS()

      const hadDoc = (pagesRef.current?.length || 0) > 0
      const baseIndex = pagesRef.current?.length || 0

      let addedPages = 0
      let initialName = fileNameRef.current
      const opsAdd = []

      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (!initialName) {
          const base = f.name.replace(/\.[^.]+$/, '')
          initialName = sanitizeName(base); setFileName(initialName)
        }

        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          const url = await readAsDataURL(f)
          const img = await loadImageEl(url)
          const idx = baseIndex + addedPages
          await createPageFromImage(
            url,
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
            f.type || (url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'),
            false,
            opsAdd,
            idx
          )
          addedPages += 1
        } else if (ext === 'pdf') {
          const ab = await f.arrayBuffer()
          const bytes = toUint8Copy(ab)
          const n = await addPagesFromPDFBytes(bytes, opsAdd, baseIndex + addedPages)
          addedPages += n
        } else if (['docx', 'doc'].includes(ext)) {
          const canv = await renderDOCXToCanvas(f)
          const n = await addRasterPagesFromCanvas(canv, opsAdd, baseIndex + addedPages)
          addedPages += n
        } else if (['xls', 'xlsx'].includes(ext)) {
          const canv = await renderXLSXToCanvas(f)
          const n = await addRasterPagesFromCanvas(canv, opsAdd, baseIndex + addedPages)
          addedPages += n
        } else {
          toast(`Формат не поддерживается: ${ext}`, 'error')
        }
      }

      // Отрисовка
      await new Promise(r => requestAnimationFrame(r))
      for (let i = 0; i < pagesRef.current.length; i++) {
        await ensurePageRendered(i)
      }

      // Фиксация на сервере
      if (addedPages > 0) {
        if (!hadDoc && !draftExistsRef.current) {
          const snapshot = await serializeDocument()
          if (snapshot) {
            await AuthAPI.saveDraft(snapshot)
            wsRef.current?.commit?.(snapshot)
            draftExistsRef.current = true
          }
        } else {
          await persistPageOps(opsAdd)
        }
      }

      try {
        if (isAuthed && addedPages > 0) {
          const nm = sanitizeName(initialName || fileNameRef.current || genDefaultName())
          await AuthAPI.recordUpload(curDocId, nm, addedPages)
        }
      } catch {}

      toast('Страницы добавлены', 'success')
    } catch (err) {
      console.error(err); toast(err.message || 'Ошибка загрузки файлов', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function assignFirstFileToCurrent(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase()
    const page=pages[cur]; if(!page) return
    setLoading(true)
    try{
      if(['jpg','jpeg','png'].includes(ext)){
        const url=await readAsDataURL(file)
        await setPageBackgroundFromImage(cur,url)
      }else if(ext==='pdf'){
        const ab = await file.arrayBuffer()
        const bytes = toUint8Copy(ab)
        await setPageBackgroundFromFirstPDFPage(cur, bytes)
      }else if(['docx','doc'].includes(ext)){
        const canv=await renderDOCXToCanvas(file)
        const slices=sliceCanvasToPages(canv)
        await setPageBackgroundFromImage(cur, slices[0]||canv.toDataURL('image/png'))
      }else if(['xls','xlsx'].includes(ext)){
        const canv=await renderXLSXToCanvas(file)
        const slices=sliceCanvasToPages(canv)
        await setPageBackgroundFromImage(cur, slices[0]||canv.toDataURL('image/png'))
      }else toast('Этот формат не поддерживается','error')

      // После замены фона коммитим snapshot
      const snapshot = await serializeDocument()
      if (snapshot) {
        await AuthAPI.saveDraft(snapshot)
        wsRef.current?.commit?.(snapshot)
      }
    }catch(e){ toast(e.message||'Не удалось назначить страницу','error') }
    finally{ setLoading(false) }
  }

  async function setPageBackgroundFromImage(idx, dataUrl){
    const page=pages[idx]; if(!page) return
    const cv=await ensureCanvas(page, idx, sendPatch)
    // eslint-disable-next-line no-undef
    const img=new fabric.Image(await loadImageEl(dataUrl),{ selectable:false, evented:false, objectCaching:false, noScaleCache:true })
    const prevRect = page._layoutRect ? { ...page._layoutRect } : null
    fitCanvasForPage(page)
    placeBgObject(cv,page,img)
    const im = await loadImageEl(dataUrl)
    page.meta = { type:'image', src:dataUrl, w:im.naturalWidth||im.width, h:im.naturalHeight||im.height, mime: dataUrl.startsWith('data:image/jpeg')?'image/jpeg':'image/png' }
    page._bgRendered = true
    fitCanvasForPage(page)
    if (prevRect && page._layoutRect && rectChanged(prevRect, page._layoutRect)) {
      transformOverlaysBetweenRects(page, prevRect, page._layoutRect)
    }
  }

  async function setPageBackgroundFromFirstPDFPage(idx, bytes){
    await ensurePDFJS()
    const page=pages[idx]; if(!page) return
    const cv = await ensureCanvas(page, idx, sendPatch)
    // eslint-disable-next-line no-undef
    const pdf=await pdfjsLib.getDocument({data: bytes.slice()}).promise
    const p = await pdf.getPage(1)
    const vp1 = p.getViewport({ scale: 1 })
    const off = await renderPDFPageToCanvas(pdf,1, 2.5)
    const url = off.toDataURL('image/png')
    // eslint-disable-next-line no-undef
    const img=new fabric.Image(await loadImageEl(url),{ selectable:false, evented:false, objectCaching:false, noScaleCache:true })
    const prevRect = page._layoutRect ? { ...page._layoutRect } : null
    fitCanvasForPage(page)
    placeBgObject(cv,page,img)
    page.meta = { type:'pdf', bytes: toUint8Copy(bytes), index: 0, pdf_w: Math.round(vp1.width), pdf_h: Math.round(vp1.height) }
    page._bgRendered = true
    fitCanvasForPage(page)
    if (prevRect && page._layoutRect && rectChanged(prevRect, page._layoutRect)) {
      transformOverlaysBetweenRects(page, prevRect, page._layoutRect)
    }
  }

  // ---------- СЕРИАЛИЗАЦИЯ ----------
  async function serializeDocument(){
    if(!pagesRef.current || pagesRef.current.length === 0) return null
    const pagesLocal = pagesRef.current
    const outPages = []
    for (let i=0; i<pagesLocal.length; i++){
      const p = pagesLocal[i]
      const cv = await ensureCanvas(p, i, sendPatch)
      const meta = p.meta || {}
      const rawObjs = (cv.getObjects()||[]).filter(o=>o!==p.bgObj)
      const overlays = []
      for (const o of rawObjs){
        if (o.type === 'textbox') {
          overlays.push({
            t:'tb',
            id: o.__scannyId || ('ov_'+Math.random().toString(36).slice(2)),
            text:o.text||'', left:o.left||0, top:o.top||0, angle:o.angle||0,
            fontFamily:o.fontFamily||'Arial', fontSize:o.fontSize||42, fontStyle:o.fontStyle||'normal', fontWeight:o.fontWeight||'normal',
            fill:o.fill||'#000', width: Math.round(o.width || 200), textAlign: o.textAlign || 'left',
            scaleX: o.scaleX || 1, scaleY: o.scaleY || 1,
          })
        } else if (o.type === 'image') {
          const src = await ensureSerializableSrcForImage(o)
          overlays.push({
            t:'im',
            id: o.__scannyId || ('ov_'+Math.random().toString(36).slice(2)),
            src, left:o.left||0, top:o.top||0, scaleX:o.scaleX||1, scaleY:o.scaleY||1,
            angle:o.angle||0, flipX: !!o.flipX, flipY: !!o.flipY,
          })
        }
      }

      if (meta.type === 'pdf' && meta.bytes) {
        outPages.push({ type:'pdf', index: meta.index||0, bytes_b64: u8ToB64(meta.bytes), pdf_w: meta.pdf_w||PAGE_W, pdf_h: meta.pdf_h||PAGE_H, landscape: !!p.landscape, overlays })
      } else if (meta.type === 'image' || meta.type === 'raster') {
        outPages.push({ type: meta.type, src: meta.src, w: meta.w, h: meta.h, mime: meta.mime||'image/png', landscape: !!p.landscape, overlays })
      } else {
        // fallback — снимок холста
        const url = cv.toDataURL({ format:'png', multiplier: RASTER_RENDER_SCALE })
        outPages.push({ type:'raster', src:url, w:cv.getWidth()*RASTER_RENDER_SCALE, h:cv.getHeight()*RASTER_RENDER_SCALE, mime:'image/png', landscape: !!p.landscape, overlays })
      }
    }
    return { client_id: docIdRef.current || null, name: fileNameRef.current || genDefaultName(), pages: outPages }
  }

  // ---------- Текст ----------
  async function addText(){
    if(!pagesRef.current || pagesRef.current.length === 0){ toast('Сначала добавьте страницу','error'); return }
    // eslint-disable-next-line no-undef
    const F = fabric
    const page = pagesRef.current[cur]
    const cv = await ensureCanvas(page, cur, sendPatch)
    await ensurePageRendered(cur)
    const tb=new F.Textbox('Вставьте текст',{
      left:Math.round(cv.getWidth()*0.1),
      top:Math.round(cv.getHeight()*0.15),
      fontSize:48,
      fill:'#000000',
      fontFamily:'Arial',
      fontWeight:'bold',
      width: Math.round(cv.getWidth()*0.6),
      textAlign: 'left',
      selectable:true,
      objectCaching:true, noScaleCache:false,
    })
    tb.__scannyId = 'ov_'+Math.random().toString(36).slice(2)
    ensureDeleteControlFor(tb)
    cv.add(tb); cv.setActiveObject(tb); cv.requestRenderAll()
    const rect = page._layoutRect || { l:0, t:0, w:cv.getWidth(), h:cv.getHeight() }
    clampObjectToRect(tb, rect)
    ensureDeleteControlInside(tb, rect)
    sendPatch([{
      op: 'overlay_upsert',
      page: cur,
      obj: {
        t: 'tb',
        id: tb.__scannyId,
        left: tb.left || 0,
        top: tb.top || 0,
        angle: tb.angle || 0,
        scaleX: tb.scaleX || 1,
        scaleY: tb.scaleY || 1,
        text: tb.text || '',
        fontFamily: tb.fontFamily || 'Arial',
        fontSize: tb.fontSize || 42,
        fontStyle: 'normal',
        fontWeight: 'bold',
        fill: '#000000',
        width: Math.max(20, Number(tb.width || 200)),
        textAlign: tb.textAlign || 'left',
      }
    }])
    setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:tb.__scannyId}])
    setPanelOpen(true)
  }

  // ---------- Панель стилей ----------
  const applyPanel = useCallback(() => {
    const page = pagesRef.current?.[cur]; const cv=page?.canvas; if(!cv) return; const obj=cv.getActiveObject(); if(!obj||obj.type!=='textbox') return;
    obj.set({ fontFamily:font, fontSize:fontSize, fontWeight:bold?'bold':'normal', fontStyle:italic?'italic':'normal', fill:color })
    cv.requestRenderAll()
    sendPatch([{
      op: 'overlay_upsert',
      page: cur,
      obj: {
        t: 'tb',
        id: obj.__scannyId || ('ov_'+Math.random().toString(36).slice(2)),
        left: obj.left || 0,
        top: obj.top || 0,
        angle: obj.angle || 0,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        text: obj.text || '',
        fontFamily: font,
        fontSize: fontSize,
        fontStyle: italic ? 'italic' : 'normal',
        fontWeight: bold ? 'bold' : 'normal',
        fill: color,
        width: Math.max(20, Number(obj.width || 200)),
        textAlign: obj.textAlign || 'left',
      }
    }])
  }, [cur, font, fontSize, bold, italic, color])
  useEffect(()=>{ if(panelOpen) applyPanel() },[panelOpen, applyPanel])

  // ---------- Поворот ----------
  async function rotatePage(){
    if(!pagesRef.current || pagesRef.current.length === 0) return
    const page = pagesRef.current[cur]
    await ensureCanvas(page, cur, sendPatch)

    page.landscape = !page.landscape
    await new Promise(r=>requestAnimationFrame(r))
    fitCanvasForPage(page)

    if (page.meta?.type === 'pdf') {
      await rerenderPdfBackgroundAtCurrentWidth(page)
    }

    sendPatch([{ op: 'rotate_page', page: cur, landscape: !!page.landscape }])
  }

  async function deletePageAt(idx) {
    if (!pagesRef.current?.length) return
    // Если последняя страница — предлагаем удалить весь документ
    if (pagesRef.current.length <= 1) {
      if (!window.confirm('Удалить весь документ?')) return
      pagesRef.current.forEach(pp => { try { pp.canvas?.dispose?.() } catch {} })
      setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
      try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
      try { await AuthAPI.clearDraft() } catch {}
      draftExistsRef.current = false
      setDocId(null)
      toast('Документ удалён', 'success')
      return
    }
    // Удаление только текущей страницы
    if (!window.confirm('Удалить текущую страницу?')) return
    const p = pagesRef.current[idx]; try { p.canvas?.dispose?.() } catch {}
    const nextPages = pagesRef.current.filter((_, i) => i !== idx)
    setPages(nextPages)
    setCur(i => Math.max(0, idx - 1))
    await persistPageOps([{ op: 'page_remove', index: idx }])
    toast('Страница удалена', 'success')
  }

  // ---------- Экспорт ----------
  async function exportJPG(){
    try{
      if(!pagesRef.current || pagesRef.current.length === 0) return
      const bn = baseName(); if(!bn) return
      const count = pagesRef.current.length
      if((billing?.free_left ?? 0) < count){ setPlan('single'); setPayOpen(true); return }
      await ensureJSZip()
      await ensurePDFJS()
      // eslint-disable-next-line no-undef
      const zip=new JSZip()
      for(let i=0;i<pagesRef.current.length;i++){
        await ensurePageRendered(i)
        const p=pagesRef.current[i], cv=p.canvas

        // База (фон) в натуральном размере
        let baseCanvas = document.createElement('canvas')
        let bctx = baseCanvas.getContext('2d', { alpha:false, desynchronized:true, willReadFrequently: true })
        try { bctx.textBaseline='alphabetic' } catch {}
        bctx.fillStyle = '#fff'

        if (p.meta?.type === 'pdf' && p.meta.bytes) {
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({ data: p.meta.bytes.slice() }).promise
          const off = await renderPDFPageToCanvas(pdf, (p.meta.index||0)+1, 4)
          baseCanvas = off
          bctx = off.getContext('2d')
          try { bctx.textBaseline='alphabetic' } catch {}
        } else if ((p.meta?.type === 'image' || p.meta?.type === 'raster') && p.meta?.src) {
          const im = await loadImageEl(p.meta.src)
          const w = p.meta.w || im.naturalWidth || im.width
          const h = p.meta.h || im.naturalHeight || im.height
          baseCanvas.width = Math.max(1, Math.round(w))
          baseCanvas.height = Math.max(1, Math.round(h))
          bctx.fillRect(0,0,baseCanvas.width, baseCanvas.height)
          bctx.drawImage(im, 0, 0, baseCanvas.width, baseCanvas.height)
        } else {
          const w = cv.getWidth(), h = cv.getHeight()
          baseCanvas.width = w*RASTER_RENDER_SCALE
          baseCanvas.height = h*RASTER_RENDER_SCALE
          bctx.fillRect(0,0,baseCanvas.width, baseCanvas.height)
          const url = cv.toDataURL({ format:'png', multiplier:RASTER_RENDER_SCALE })
          const bim = await loadImageEl(url)
          bctx.drawImage(bim, 0, 0, baseCanvas.width, baseCanvas.height)
        }

        // Оверлеи поверх
        const url = cv.toDataURL({ format:'png', multiplier: 4 })
        const r = await fetch(url); const ab = await r.arrayBuffer()
        const blob = new Blob([ab], { type:'image/png' })
        const ovImg = await loadImageEl(URL.createObjectURL(blob))
        bctx.drawImage(ovImg, 0, 0, baseCanvas.width, baseCanvas.height)
        URL.revokeObjectURL(ovImg.src)

        const outBlob = await new Promise(res => baseCanvas.toBlob(b => res(b), 'image/jpeg', 0.95))
        zip.file(`${bn}-p${i+1}.jpg`, outBlob)
      }
      const out=await zip.generateAsync({type:'blob'})
      const a=document.createElement('a'); const href=URL.createObjectURL(out); a.href=href; a.download=`${bn}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),1500)
      try{ AuthAPI.recordDownload('jpg', pagesRef.current.length, bn, 'free').catch(()=>{}) }catch{}
      toast(`Скачано страниц: ${pagesRef.current.length}`,'success')
    }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить JPG','error') }
  }

  async function exportPDF(){
    try{
      if(!pagesRef.current || pagesRef.current.length === 0) return
      const bn = baseName(); if(!bn) return
      const count=pagesRef.current.length
      if((billing?.free_left ?? 0) < count){ setPlan('single'); setPayOpen(true); return }
      const PDFLib = await ensurePDFLib()
      await ensurePDFJS()
      const out = await PDFLib.PDFDocument.create()

      for (let i=0;i<pagesRef.current.length;i++){
        await ensurePageRendered(i)
        const p = pagesRef.current[i]; const cv = p.canvas

        if (p.meta?.type === 'pdf' && p.meta.bytes) {
          const srcDoc = await PDFLib.PDFDocument.load(p.meta.bytes)
          const [copied] = await out.copyPages(srcDoc, [p.meta.index])
          const pageRef = out.addPage(copied)

          // Оверлеи PNG
          const { width, height } = pageRef.getSize()
          const url = cv.toDataURL({ format:'png', multiplier: 4 })
          const overlayBytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
          const png = await out.embedPng(overlayBytes)
          pageRef.drawImage(png, { x:0, y:0, width, height })
        } else {
          // растровая страница
          let baseW = Math.max(1, cv.getWidth())
          let baseH = Math.max(1, cv.getHeight())
          if ((p.meta?.type === 'image' || p.meta?.type === 'raster') && p.meta?.w && p.meta?.h) {
            baseW = Math.max(1, Math.round(p.meta.w))
            baseH = Math.max(1, Math.round(p.meta.h))
          }
          const off = document.createElement('canvas')
          off.width = baseW
          off.height = baseH
          const octx = off.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: true })
          try { octx.textBaseline = 'alphabetic' } catch {}
          octx.fillStyle = '#fff'
          octx.fillRect(0,0,off.width, off.height)

          if ((p.meta?.type === 'image' || p.meta?.type === 'raster') && p.meta?.src) {
            const bim = await loadImageEl(p.meta.src)
            octx.drawImage(bim, 0, 0, off.width, off.height)
          } else {
            const url = cv.toDataURL({ format:'png', multiplier:RASTER_RENDER_SCALE })
            const bim = await loadImageEl(url)
            octx.drawImage(bim, 0, 0, off.width, off.height)
          }

          // Оверлеи
          const url = cv.toDataURL({ format:'png', multiplier: 4 })
          const overlayBytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
          const png = await out.embedPng(overlayBytes)
          const pageRef = out.addPage([off.width, off.height])
          pageRef.drawImage(png, { x:0, y:0, width: off.width, height: off.height })
        }
      }

      const pdfBytes = await out.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const a=document.createElement('a'); const href=URL.createObjectURL(blob); a.href=href; a.download=`${bn}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),1500)
      try{ AuthAPI.recordDownload('pdf', pagesRef.current.length, bn, 'free').catch(()=>{}) }catch{}
      toast(`Скачан PDF (${pagesRef.current.length} стр.)`,'success')
    }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить PDF','error') }
  }

  // ---------- DnD / промо / покупка ----------
  function onCanvasDrop(e){
    e.preventDefault(); const dt=e.dataTransfer; if(!dt) return
    const types=Array.from(dt.types||[])
    if(types.includes('application/x-sign-url')){
      const url=dt.getData('application/x-sign-url')
      if(url && url!=='add') placeFromLib(url)
      return
    }
    const fs=Array.from(dt.files||[]); if(fs.length) handleFiles(fs)
  }

  async function applyPromo(){
    try{
      if(!promo){ setPromoPercent(0); setPromoError(''); return }
      const res=await AuthAPI.validatePromo(promo)
      const percent=Number(res?.percent||0)
      if(percent>0){ setPromoPercent(percent); setPromoError('') }
      else { setPromoPercent(0); setPromoError('Промокод не найден') }
    }catch(e){ setPromoPercent(0); setPromoError(e.message||'Ошибка промокода') }
  }
  async function startPurchase(){
    try{
      const r=await AuthAPI.startPurchase(plan, promo||'')
      if(r?.url){ window.open(r.url,'_blank'); setPayOpen(false) }
      else toast('Не удалось сформировать оплату','error')
    }catch(e){ toast(e.message||'Ошибка оплаты','error') }
  }

  // Переименование — патч имени
  const onRenameChange = (e) => { setFileName(sanitizeName(e.target.value)) }
  const onRenameBlur = () => { if(pagesRef.current?.length) sendPatch([{ op:'set_name', name: fileNameRef.current || '' }]) }

  // Удаление по клавиатуре
  useEffect(()=>{
    const onKey=(e)=>{
      const tag = String(e.target?.tagName || '').toLowerCase()
      const isTyping = tag==='input' || tag==='textarea' || e.target?.isContentEditable
      if(isTyping) return
      if((e.key==='Delete' || e.key==='Backspace') && pagesRef.current?.[cur]?.canvas){
        const cv = pagesRef.current[cur].canvas
        const obj = cv.getActiveObject()
        if(obj){
          e.preventDefault()
          const id = obj.__scannyId || null
          cv.remove(obj); cv.discardActiveObject(); cv.requestRenderAll()
          if (id) sendPatch([{ op: 'overlay_remove', page: cur, id }])
          toast('Объект удалён','success')
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return ()=>document.removeEventListener('keydown', onKey)
  },[cur])

  // ---------- Восстановление из серверного черновика ----------
  async function restoreDocumentFromDraft(draft){
    try{
      await ensurePDFJS()
      await ensureFabric()

      const pagesData = Array.isArray(draft?.pages) ? draft.pages : []
      const created = []

      for (let i=0;i<pagesData.length;i++){
        const pg = pagesData[i] || {}
        const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
        const meta =
          (pg.type==='pdf' && pg.bytes_b64)
            ? { type:'pdf', bytes: b64ToU8(pg.bytes_b64), index: Number(pg.index||0), pdf_w: pg.pdf_w||PAGE_W, pdf_h: pg.pdf_h||PAGE_H }
            : (pg.type==='image' || pg.type==='raster')
              ? { type: pg.type, src: pg.src, w: pg.w||PAGE_W, h: pg.h||PAGE_H, mime: pg.mime||'image/png' }
              : { type:'raster', src:'', w: PAGE_W, h: PAGE_H, mime:'image/png' }

        created.push({
          id, elId, canvas:null, bgObj:null, landscape: !!pg.landscape,
          meta, _bgRendered:false, _pendingOverlays: Array.isArray(pg.overlays) ? pg.overlays : []
        })
      }

      setPages(created)
      // ВАЖНО: ставим флаг "нужно сразу отрисовать все страницы" в эфф. по pages
      initialRenderPendingRef.current = true

      setCur(created.length ? 0 : 0)
      setFileName((draft?.name||'').trim() || genDefaultName())
      setDocId(draft?.client_id || randDocId())

      // серверный черновик существует
      draftExistsRef.current = true

      await new Promise(r=>requestAnimationFrame(r))
    }catch(e){
      console.error('restoreDocumentFromDraft error', e)
    }
  }

  // ----- Размещение из библиотеки -----
  function uniqueObjId(){ return 'obj_'+Math.random().toString(36).slice(2) }
  function placeFromLib(url){
    if(!pagesRef.current || pagesRef.current.length===0){ toast('Сначала добавьте страницу','error'); return }
    // eslint-disable-next-line no-undef
    const F = fabric
    const page=pagesRef.current[cur]
    ensureCanvas(page, cur, sendPatch).then(async (cv)=>{
      await ensurePageRendered(cur)
      const img=new F.Image(await loadImageEl(url), { objectCaching:true, noScaleCache:false })
      const w=cv.getWidth(),h=cv.getHeight()
      const s=Math.min(1,(w*0.35)/(img.width||1))
      img.set({left:Math.round(w*0.15),top:Math.round(h*0.15),scaleX:s,scaleY:s,selectable:true})
      ensureDeleteControlFor(img)
      img.__scannyId=uniqueObjId()
      cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
      const rect = page._layoutRect || { l:0, t:0, w:cv.getWidth(), h:cv.getHeight() }
      clampObjectToRect(img, rect)
      ensureDeleteControlInside(img, rect)
      sendPatch([{
        op: 'overlay_upsert',
        page: cur,
        obj: {
          t: 'im',
          id: img.__scannyId,
          left: img.left || 0,
          top: img.top || 0,
          angle: img.angle || 0,
          flipX: !!img.flipX,
          flipY: !!img.flipY,
          scaleX: img.scaleX || 1,
          scaleY: img.scaleY || 1,
          src: url,
        }
      }])
      setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:img.__scannyId}])
    })
  }

  // Дублирование выделенного объекта на все страницы
  async function applyToAllPages(){
    if(!pagesRef.current || pagesRef.current.length===0) return
    // eslint-disable-next-line no-undef
    const F = fabric
    const srcPage = pagesRef.current[cur]
    const cvSrc = await ensureCanvas(srcPage, cur, sendPatch)
    await ensurePageRendered(cur)
    const obj = cvSrc.getActiveObject()
    if(!obj){ toast('Выберите объект на странице','error'); return }

    const clones = []
    for(let i=0;i<pagesRef.current.length;i++){
      if(i===cur) continue
      const dstPage = pagesRef.current[i]
      const cvDst = await ensureCanvas(dstPage, i, sendPatch)
      await ensurePageRendered(i)

      if(obj.type==='textbox'){
        const tb=new F.Textbox(obj.text||'',{
          left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(),
          top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(),
          fontFamily:obj.fontFamily||'Arial',
          fontStyle:obj.fontStyle||'normal',
          fontWeight:obj.fontWeight||'normal',
          fill:obj.fill||'#000',
          fontSize:Math.max(6,(obj.fontSize||42)*cvDst.getHeight()/cvSrc.getHeight()),
          angle:obj.angle||0,
          selectable:true,
          width: Math.max(20, (obj.width||200)*cvDst.getWidth()/cvSrc.getWidth()),
          textAlign: obj.textAlign || 'left',
          scaleX: obj.scaleX || 1,
          scaleY: obj.scaleY || 1,
          objectCaching:true, noScaleCache:false,
        })
        tb.__scannyId = uniqueObjId()
        ensureDeleteControlFor(tb)
        cvDst.add(tb); cvDst.requestRenderAll()
        const rect = dstPage._layoutRect || { l:0, t:0, w:cvDst.getWidth(), h:cvDst.getHeight() }
        clampObjectToRect(tb, rect)
        ensureDeleteControlInside(tb, rect)
        clones.push({page:i,id:tb.__scannyId})
        sendPatch([{
          op: 'overlay_upsert',
          page: i,
          obj: {
            t: 'tb',
            id: tb.__scannyId,
            left: tb.left || 0,
            top: tb.top || 0,
            angle: tb.angle || 0,
            scaleX: tb.scaleX || 1,
            scaleY: tb.scaleY || 1,
            text: tb.text || '',
            fontFamily: tb.fontFamily || 'Arial',
            fontSize: tb.fontSize || 42,
            fontStyle: tb.fontStyle || 'normal',
            fontWeight: tb.fontWeight || 'normal',
            fill: tb.fill || '#000',
            width: Math.max(20, Number(tb.width || 200)),
            textAlign: tb.textAlign || 'left',
          }
        }])
      }else if(obj.type==='image'){
        const src=(obj._originalElement?.src||obj._element?.src)
        const imgEl=await loadImageEl(src)
        const im=new F.Image(imgEl,{ angle:obj.angle||0, selectable:true, flipX: !!obj.flipX, flipY: !!obj.flipY, objectCaching:true, noScaleCache:false })
        const dispW=obj.getScaledWidth(), dispH=obj.getScaledHeight()
        const targetW=dispW*cvDst.getWidth()/cvSrc.getWidth(), targetH=dispH*cvDst.getHeight()/cvSrc.getHeight()
        const baseW=(im.width||1), baseH=(im.height||1)
        const sUni = Math.min(targetW/baseW, targetH/baseH)
        im.set({
          left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(),
          top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(),
          scaleX:sUni, scaleY:sUni
        })
        im.__scannyId = uniqueObjId()
        ensureDeleteControlFor(im)
        cvDst.add(im); cvDst.requestRenderAll()
        const rect = dstPage._layoutRect || { l:0, t:0, w:cvDst.getWidth(), h:cvDst.getHeight() }
        clampObjectToRect(im, rect)
        ensureDeleteControlInside(im, rect)
        clones.push({page:i,id:im.__scannyId})
        sendPatch([{
          op: 'overlay_upsert',
          page: i,
          obj: {
            t: 'im',
            id: im.__scannyId,
            left: im.left || 0,
            top: im.top || 0,
            angle: im.angle || 0,
            flipX: !!im.flipX,
            flipY: !!im.flipY,
            scaleX: im.scaleX || 1,
            scaleY: im.scaleY || 1,
            src,
          }
        }])
      }
    }

    if(clones.length){
      setUndoStack(stk=>[...stk,{type:'apply_all',clones}])
      toast('Объект добавлен на все страницы','success')
    }
  }

  // ---------- Рендер ----------
  const [pgText, setPgText] = useState('1')
  useEffect(() => { setPgText(String(pagesRef.current?.length ? (cur+1) : 0)) }, [cur, pages.length])

  const onPagerGo = (v) => {
    if (!pagesRef.current?.length) return
    const n = Math.max(1, Math.min(pagesRef.current.length, Number(v)||1))
    setCur(n-1)
  }

  return (
  <div className="doc-editor page" style={{ paddingTop: 0 }}>
    {banner && <div className="ed-banner">{banner}</div>}

    {!panelOpen ? (
      <div className="ed-top">
        <button className="ed-menu-btn mobile-only" aria-label="Меню действий" onClick={onTopMenuClick}>
          <img src={icMore} alt="" style={{ width: 18, height: 18 }} />
        </button>
        <button className="ed-menu-btn mobile-only" aria-label="Библиотека" onClick={()=>setLibOpen(true)} title="Библиотека">
          <img src={icLibrary} alt="" style={{ width: 18, height: 18 }} />
        </button>
        <div className="ed-docid" style={{flex:1, display:'flex', justifyContent:'center'}}>
          <input className="ed-filename" placeholder="Название файла при скачивании"
                 value={fileName} onChange={onRenameChange} onBlur={onRenameBlur}
                 style={{ margin: '0 auto' }}/>
        </div>
        <div style={{width:36}} className="desktop-only" />
      </div>
    ) : (
      <div className="ed-top">
        <div className="ed-toolbar" style={{ margin:'0 auto' }}>
          <select value={font} onChange={e=>setFont(e.target.value)}>{FONTS.map(f=><option key={f} value={f}>{f}</option>)}</select>
          <div className="sep"/><button onClick={()=>setFontSize(s=>Math.max(6,s-2))}>−</button><span className="val">{fontSize}</span><button onClick={()=>setFontSize(s=>Math.min(300,s+2))}>+</button>
          <div className="sep"/><input type="color" value={color} onChange={e=>setColor(e.target.value)} title="Цвет текста"/>
          <button className={bold?'toggled':''} onClick={()=>setBold(b=>!b)}><b>B</b></button>
          <button className={italic?'toggled':''} onClick={()=>setItalic(i=>!i)}><i>I</i></button>
        </div>
      </div>
    )}

    <div className="ed-body">
      <aside className="ed-left">
        <div className="ed-tools">
          <button className={`ed-tool ${pagesRef.current?.length?'':'disabled'}`} onClick={addText}><img className="ico" src={icText} alt=""/><span>Добавить текст</span></button>
          <button className="ed-tool" onClick={()=>signFileRef.current?.click()}><img className="ico" src={icSign} alt=""/><span>Загрузить подпись</span></button>
        </div>
        <div className="ed-sign-list">
          <div className="thumb add" draggable onDragStart={(e)=>{ try{ e.dataTransfer.setData('application/x-sign-url','add') }catch{} }} onClick={()=>signFileRef.current?.click()}><img src={icPlus} alt="+" style={{width:22,height:22,opacity:.6}}/></div>
          {libLoading && <div style={{gridColumn:'1 / -1',opacity:.7,padding:8}}>Загрузка…</div>}
          {signLib.map(item=>(
            <div key={item.id} className="thumb" draggable onDragStart={(e)=>{ try{ e.dataTransfer.setData('application/x-sign-url', item.url) }catch{} }}>
              <img src={item.url} alt="" onClick={()=>placeFromLib(item.url)} style={{width:'100%',height:'100%',objectFit:'contain',cursor:'pointer'}}/>
              <button className="thumb-x" onClick={async ()=>{
                if(!window.confirm('Удалить элемент из библиотеки?')) return
                try{
                  await (item.is_default && item.gid ? AuthAPI.hideDefaultSign(item.gid) : AuthAPI.deleteSign(item.id))
                  await loadLibrary()
                  toast('Удалено','success')
                }catch(e){ toast(e.message||'Не удалось удалить','error') }
              }}>×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="ed-center">
        <div className="ed-canvas-wrap" ref={canvasWrapRef} onDragOver={(e)=>e.preventDefault()} onDrop={onCanvasDrop}>
          {pages.map((p,idx)=>(
            <div key={p.id} className={`ed-canvas ${idx===cur?'active':''}`}>
              <button
                className="ed-page-x desktop-only"
                title="Удалить эту страницу"
                onClick={() => deletePageAt(idx)}
              >×</button>
              <canvas id={p.elId}/>
            </div>
          ))}
          {!pagesRef.current?.length && (
            <div className="ed-dropzone" onClick={pickDocument}>
              <img src={icDocAdd} alt="" style={{width:140,height:'auto',opacity:.9}}/>
              <div className="dz-title">Загрузите документы</div>
              <div className="dz-sub">Можно перетащить их в это поле</div>
              <div className="dz-types">JPG, JPEG, PNG, PDF, DOC, DOCX, XLS, XLSX</div>
            </div>
          )}
          {loading && <div className="ed-canvas-loading"><div className="spinner" aria-hidden="true"></div>Загрузка…</div>}
        </div>
      </section>

      <aside className="ed-right">
        <div className="ed-actions">
          <button className={`ed-action ${pagesRef.current?.length?'':'disabled'}`} onClick={async ()=>{
            if (!pagesRef.current?.length) return
            if (!window.confirm('Удалить весь документ?')) return
            pagesRef.current.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
            setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
            try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
            try { await AuthAPI.clearDraft() } catch {}
            draftExistsRef.current = false
            setDocId(null)
            toast('Документ удалён','success')
          }}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ</button>
          <button className={`ed-action ${canUndo?'':'disabled'}`} onClick={()=>{
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
          }}><img src={icUndo} alt="" style={{width:18,height:18,marginRight:8}}/>Отменить</button>
          <button className={`ed-action ${pagesRef.current?.length?'':'disabled'}`} onClick={rotatePage}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу</button>
          <button className={`ed-action ${pagesRef.current?.length && !!(pagesRef.current[cur]?.canvas?.getActiveObject()) ? '' : 'disabled'}`} onClick={applyToAllPages}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы</button>
        </div>

        <div className="ed-download">
          <div className="ed-dl-title">Скачать бесплатно:</div>
          <div className="ed-dl-row">
            <button className={`btn btn-lite ${(!pagesRef.current?.length)?'disabled':''}`} onClick={exportJPG}><img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:8}}/>JPG</button>
            <button className={`btn btn-lite ${(!pagesRef.current?.length)?'disabled':''}`} onClick={exportPDF}><img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:8}}/>PDF</button>
          </div>
          <div className="ed-dl-title" style={{marginTop:10}}>Купить:</div>
          <div className="ed-dl-row ed-dl-row-paid">
            <button className={`btn ${(!pagesRef.current?.length)?'disabled':''}`} onClick={()=>{ if(pagesRef.current?.length){ setPlan('single'); setPayOpen(true) } }}><img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:8}}/>JPG</button>
            <button className={`btn ${(!pagesRef.current?.length)?'disabled':''}`} onClick={()=>{ if(pagesRef.current?.length){ setPlan('single'); setPayOpen(true) } }}><img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:8}}/>PDF</button>
          </div>
        </div>
      </aside>
    </div>

    {/* ЕДИНАЯ нижняя панель */}
    <div className="ed-bottom">
      <button className="fab fab-add mobile-only" onClick={()=>{ if(pagesRef.current?.length){ setMenuAddOpen(o=>!o) } else { pickDocument() } }} title="Добавить">
        <img src={icPlus} alt="+" />
      </button>

      <UnifiedPager
        total={pages.length}
        current={cur}
        pgText={pgText}
        setPgText={setPgText}
        onGo={onPagerGo}
        onPrev={()=>setCur(i=>Math.max(0, i-1))}
        onNext={()=>{ if(canNext) setCur(i=>Math.min(pages.length-1, i+1)); else pickDocument() }}
        canPrev={canPrev}
        canNext={canNext}
        hasDoc={!!pagesRef.current?.length}
        onAdd={pickDocument}
      />

      <button className="fab fab-dl mobile-only" onClick={()=>{ if(!pagesRef.current?.length) return; setMenuDownloadOpen(o=>!o) }} title="Скачать">
        <img src={icDownload} alt="↓" />
      </button>
    </div>

    {/* Меню действий — под кнопкой (мобила) */}
    {menuActionsOpen && (
      <div
        className="ed-sheet"
        ref={sheetActionsRef}
        style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, maxWidth:'96vw', minWidth:240 }}
      >
        <button className={pagesRef.current?.length?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); rotatePage() }}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:10}}/>Повернуть страницу</button>
        <button className={(pagesRef.current?.length && pagesRef.current.length>1)?'':''} onClick={async ()=>{ setMenuActionsOpen(false); await deletePageAt(cur) }}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:10}}/>Удалить страницу</button>
        <button className={(pagesRef.current?.length && !!(pagesRef.current[cur]?.canvas?.getActiveObject()))?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); applyToAllPages() }}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:10}}/>На все страницы</button>
        <button className={pagesRef.current?.length?'':'disabled'} onClick={async ()=>{ setMenuActionsOpen(false);
          if (!pagesRef.current?.length) return
          if (!window.confirm('Удалить весь документ?')) return
          pagesRef.current.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
          setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
          try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
          try { await AuthAPI.clearDraft() } catch {}
          draftExistsRef.current = false
          setDocId(null)
          toast('Документ удалён','success')
        }}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:10}}/>Удалить документ</button>
      </div>
    )}

    {menuAddOpen && (
      <div className="ed-sheet bottom-left" ref={sheetAddRef}>
        <button className={pagesRef.current?.length?'':'disabled'} onClick={()=>{ setMenuAddOpen(false); addText() }}><img src={icText} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить текст</button>
        <button onClick={()=>{ setMenuAddOpen(false); signFileRef.current?.click() }}><img src={icSign} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить подпись/печать</button>
        <button onClick={()=>{ setMenuAddOpen(false); pickDocument() }}><img src={icPlus} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить документ/страницу</button>
      </div>
    )}

    {menuDownloadOpen && (
      <div className="ed-sheet bottom-right" ref={sheetDownloadRef} style={{ padding: 6 }}>
        <button className={`btn ${pagesRef.current?.length?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(pagesRef.current?.length){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
          <img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить JPG
        </button>
        <button className={`btn ${pagesRef.current?.length?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(pagesRef.current?.length){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
          <img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить PDF
        </button>
        <button className={`btn btn-lite ${pagesRef.current?.length?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(pagesRef.current?.length){ setMenuDownloadOpen(false); exportJPG() } }}>
          <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно JPG
        </button>
        <button className={`btn btn-lite ${pagesRef.current?.length?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(pagesRef.current?.length){ setMenuDownloadOpen(false); exportPDF() } }}>
          <img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно PDF
        </button>
      </div>
    )}

    {payOpen && (
      <div className="modal-overlay" onClick={()=>setPayOpen(false)}>
        <div className="modal pay-modal" onClick={e=>e.stopPropagation()}>
          <button className="modal-x" onClick={()=>setPayOpen(false)}>×</button>
          <h3 className="modal-title">Чтобы выгрузить документ придётся немного заплатить</h3>
          <div className="pay-grid">
            <button className={`pay-card ${plan==='single'?'active':''}`} onClick={()=>setPlan('single')} type="button"><img className="pay-ill" src={plan1} alt="" /><div className="pay-price">{prices.single} ₽</div><div className="pay-sub">один (этот) документ</div></button>
            <button className={`pay-card ${plan==='month'?'active':''}`} onClick={()=>setPlan('month')} type="button"><img className="pay-ill" src={plan2} alt="" /><div className="pay-price">{prices.month} ₽</div><div className="pay-sub">безлимит на месяц</div></button>
            <button className={`pay-card ${plan==='year'?'active':''}`} onClick={()=>setPlan('year')} type="button"><img className="pay-ill" src={plan3} alt="" /><div className="pay-price">{prices.year} ₽</div><div className="pay-sub">безлимит на год</div></button>
          </div>
          <div className={`pay-controls ${promoError?'error':''}`}>
            <div className="promo"><label className="field-label">Промокод</label><div className="promo-row"><input value={promo} onChange={e=>{ setPromo(e.target.value); setPromoError('') }} placeholder="Введите промокод"/>{promo && <button className="promo-clear" onClick={()=>{ setPromo(''); setPromoError(''); setPromoPercent(0) }}>×</button>}</div>{promoError && <div className="promo-err">{promoError}</div>}</div>
            <div className="pay-buttons"><button className="btn btn-lite" onClick={applyPromo}><span className="label">Активировать</span></button><button className="btn" onClick={startPurchase}><span className="label">Оплатить {Math.max(0, (prices[plan]||0) * (100 - promoPercent) / 100)} ₽</span></button></div>
          </div>
        </div>
      </div>
    )}

    {/* Мобильная библиотека */}
    {libOpen && (
      <div className="modal-overlay" onClick={()=>setLibOpen(false)}>
        <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:'min(420px,92vw)', height:'min(70vh,560px)', display:'flex', flexDirection:'column' }}>
          <button className="modal-x" onClick={()=>setLibOpen(false)}>×</button>
          <h3 className="modal-title">Библиотека</h3>
          <div style={{ flex:'1 1 auto', overflowY:'auto', padding:'8px' }}>
            <div className="defaults-grid" style={{ gridTemplateColumns:'1fr' }}>
              {libLoading && <div style={{gridColumn:'1 / -1',opacity:.7,padding:8}}>Загрузка…</div>}
              {signLib.map(item=>(
                <div key={item.id} className="thumb">
                  <img src={item.url} alt="" style={{width:'100%',height:'100%',objectFit:'contain',cursor:'pointer'}} onClick={()=>{ placeFromLib(item.url); setLibOpen(false) }}/>
                  <button className="thumb-x" onClick={async ()=>{
                    if(!window.confirm('Удалить элемент из библиотеки?')) return
                    try{
                      await (item.is_default && item.gid ? AuthAPI.hideDefaultSign(item.gid) : AuthAPI.deleteSign(item.id))
                      await loadLibrary()
                      toast('Удалено','success')
                    }catch(e){ toast(e.message||'Не удалось удалить','error') }
                  }}>×</button>
                </div>
              ))}
              {(!libLoading && signLib.length===0) && <div style={{gridColumn:'1 / -1',opacity:.7,padding:8}}>Пока пусто</div>}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* инпуты выбора файлов */}
    <input ref={docFileRef} type="file" accept={ACCEPT_DOC} hidden multiple onChange={onPickDocument}/>
    <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={onPickBgFile}/>
    <input ref={signFileRef} type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e)=>{
      const f=e.target.files?.[0]||null
      e.target.value=''
      if(!f) return
      const reader=new FileReader()
      reader.onload=()=>{ setCropSrc(String(reader.result||'')); setCropKind('signature'); setCropThresh(40); setCropOpen(true) }
      reader.readAsDataURL(f)
    }}/>

    {/* Единая кроп-модалка */}
    <CropModal
      open={cropOpen}
      src={cropSrc}
      defaultKind={cropKind}
      defaultThreshold={cropThresh}
      onClose={()=>setCropOpen(false)}
      onConfirm={async (kind, dataUrl) => {
        try {
          // 1) В библиотеку
          try { await AuthAPI.addSign({ kind, data_url: dataUrl }); await loadLibrary() } catch {}
          // 2) На страницу
          if (pagesRef.current?.length > 0) {
            // eslint-disable-next-line no-undef
            const F = fabric
            const page = pagesRef.current[cur]
            const cv = await ensureCanvas(page, cur, sendPatch)
            const image = new F.Image(await loadImageEl(dataUrl))
            const W = cv.getWidth(), H = cv.getHeight()
            const s = Math.min(1, (W * 0.35) / (image.width || 1))
            image.set({ left: Math.round(W * 0.15), top: Math.round(H * 0.15), scaleX: s, scaleY: s, selectable: true })
            ensureDeleteControlFor(image)
            image.__scannyId = 'ov_'+Math.random().toString(36).slice(2)
            cv.add(image); cv.setActiveObject(image); cv.requestRenderAll()
            const rect = page._layoutRect || { l:0, t:0, w:cv.getWidth(), h:cv.getHeight() }
            clampObjectToRect(image, rect)
            ensureDeleteControlInside(image, rect)
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
                src: dataUrl,
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

// Унифицированный пагинатор
function UnifiedPager({ total, current, pgText, setPgText, onGo, onPrev, onNext, canPrev, canNext, hasDoc, onAdd }) {
  const onChange = (e) => {
    const v = e.target.value.replace(/[^\d]/g,'')
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
    <div className="ed-pager" style={{ display:'flex', alignItems:'center', gap:10 }}>
      <button className="pager-btn" onClick={onPrev} disabled={!canPrev} title="Предыдущая">
        <img src={icPrev} alt="Prev" />
      </button>

      <div className="pg" style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
        {hasDoc ? (
          <>
            <input
              className="pg-input"
              type="number"
              min={1}
              max={Math.max(1,total)}
              value={pgText}
              onChange={onChange}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              style={{ width:64, textAlign:'center', height:36 }}
            />
            <span className="pg-total">/ {total || 0}</span>
          </>
        ) : (
          <span className="pg-total">0/0</span>
        )}
      </div>

      <button className="pager-btn" onClick={onNext} title={canNext ? 'Следующая' : 'Добавить документ'}>
        {canNext ? <img src={icPrev} alt="Next" style={{ transform:'rotate(180deg)' }} /> : <img src={icPlus} alt="+" onClick={onAdd}/>}
      </button>
    </div>
  )
}
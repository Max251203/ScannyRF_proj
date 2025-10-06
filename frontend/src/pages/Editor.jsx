import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric,
  ensurePDFJS,
  ensureHtml2Canvas,
  ensureMammothCDN,
  ensureSheetJS,
  ensureJsPDF,
  ensureCropper
} from '../utils/scriptLoader'

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
import icNext from '../assets/icons/next.png'
import icDocAdd from '../assets/icons/doc-add.svg'

import plan1 from '../assets/images/plan-1.png'
import plan2 from '../assets/images/plan-2.png'
import plan3 from '../assets/images/plan-3.png'

const PAGE_W = 794
const PAGE_H = 1123

function randDocId(){ return String(Math.floor(1e15 + Math.random()*9e15)) }
function genDefaultName(){
  const a = Math.floor(Math.random()*1e6)
  const b = Math.floor(Math.random()*1e6)
  return `${a}-${b}`
}
function sanitizeName(s){
  s = (s||'').normalize('NFKC')
  s = s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g,'-').replace(/^[-_.]+|[-_.]+$/g,'')
  return s.slice(0,64) || genDefaultName()
}

const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial', 'Times New Roman', 'Ermilov', 'Segoe UI', 'Roboto', 'Georgia']

export default function Editor(){
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState([])  // {id, elId, canvas, bgObj, landscape}
  const [cur, setCur] = useState(0)
  const [loading, setLoading] = useState(false)

  const hasDoc = pages.length>0
  const canPrev = hasDoc && cur>0
  const canNext = hasDoc && cur<pages.length-1

  // sign library
  const [signLib, setSignLib] = useState([]) // {id,url,type}

  // text panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [font, setFont] = useState('Arial')
  const [fontSize, setFontSize] = useState(42)
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [color, setColor] = useState('#000000')

  // sheets
  const [menuAddOpen, setMenuAddOpen] = useState(false)
  const [menuMoreOpen, setMenuMoreOpen] = useState(false)
  const [menuDownloadOpen, setMenuDownloadOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  // crop modal
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropOrig, setCropOrig] = useState('')
  const [cropType, setCropType] = useState('signature')
  const [cropThresh, setCropThresh] = useState(40)
  const cropImgRef = useRef(null)
  const cropperRef = useRef(null)

  // pay
  const [plan, setPlan] = useState('month')
  const [promo, setPromo] = useState('')
  const [promoError, setPromoError] = useState('')
  const basePrice = { single:99, month:399, year:3999 }
  const price = useMemo(()=>{
    let v = basePrice[plan] || 0
    if (/^SCANNY50$/i.test(promo)) v = Math.round(v*0.5)
    return v
  },[plan,promo])

  // billing/status
  const [billing, setBilling] = useState(null)
  const isAuthed = !!localStorage.getItem('access')
  const [guestQuota, setGuestQuota] = useState(()=>{
    try{
      const raw = JSON.parse(localStorage.getItem('guest_quota')||'{}')
      const today = new Date().toISOString().slice(0,10)
      if (!raw.date || raw.date!==today) return {date:today,left:3}
      return {date:today,left: typeof raw.left==='number'? raw.left:3}
    }catch{ return {date:new Date().toISOString().slice(0,10), left:3} }
  })
  const guestLeft = guestQuota.left

  useEffect(()=>{ if (isAuthed) AuthAPI.getBillingStatus().then(setBilling).catch(()=>{}) }, [isAuthed])
  useEffect(()=>{
    const onUser = ()=>{ if (localStorage.getItem('access')) AuthAPI.getBillingStatus().then(setBilling).catch(()=>{}); else setBilling(null) }
    const onBill = (e)=> setBilling(e.detail)
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    return ()=>{ window.removeEventListener('user:update', onUser); window.removeEventListener('billing:update', onBill) }
  }, [])

  // refs
  const canvasWrapRef = useRef(null)
  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const moreRef = useRef(null)
  const sheetRef = useRef(null)
  const dlRef = useRef(null)

  // responsive
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches)
  useEffect(()=>{
    const mq = window.matchMedia('(max-width: 960px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return ()=>mq.removeEventListener('change', onChange)
  },[])

  // закрытие листов по клику вне
  useEffect(()=>{
    function onDoc(e){
      const t = e.target
      if (menuMoreOpen && moreRef.current && !moreRef.current.contains(t)) setMenuMoreOpen(false)
      if (menuAddOpen && sheetRef.current && !sheetRef.current.contains(t)) setMenuAddOpen(false)
      if (menuDownloadOpen && dlRef.current && !dlRef.current.contains(t)) setMenuDownloadOpen(false)
    }
    if (menuMoreOpen || menuAddOpen || menuDownloadOpen) {
      document.addEventListener('click', onDoc, true)
      return ()=>document.removeEventListener('click', onDoc, true)
    }
  },[menuMoreOpen,menuAddOpen,menuDownloadOpen])

  // пересчёт масштаба при ресайзе контейнера
  useEffect(()=>{
    if (!canvasWrapRef.current) return
    const ro = new ResizeObserver(()=> { pages.forEach((_,i)=>fitCanvas(i)) })
    ro.observe(canvasWrapRef.current)
    return ()=> ro.disconnect()
  }, [pages])

  // при смене текущей страницы — доп.подгон
  useEffect(()=>{
    if (pages[cur]?.canvas) {
      requestAnimationFrame(()=>fitCanvas(cur))
      setTimeout(()=>fitCanvas(cur), 0)
    }
  }, [cur, pages.length, isMobile])

  // ===== canvas =====
  async function waitForElm(id, timeout=8000){
    const t0 = Date.now()
    return new Promise((res,rej)=>{
      (function loop(){
        const el = document.getElementById(id)
        if (el) return res(el)
        if (Date.now()-t0>timeout) return rej(new Error('Canvas element timeout'))
        requestAnimationFrame(loop)
      })()
    })
  }

  async function ensureCanvas(page){
    await ensureFabric()
    if (page.canvas) return page.canvas
    await waitForElm(page.elId)
    // eslint-disable-next-line no-undef
    const c = new fabric.Canvas(page.elId, { backgroundColor:'#fff', preserveObjectStacking:true, selection:true })
    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', () => setPanelOpen(false))
    page.canvas = c
    fitCanvasForPage(page)
    return c
  }

  function onSelectionChanged(e){
    const obj = e?.selected?.[0]
    if (obj && obj.type === 'textbox'){
      setPanelOpen(true)
      setFont(obj.fontFamily || 'Arial')
      setFontSize(Number(obj.fontSize || 42))
      setBold(!!(obj.fontWeight==='bold' || obj.fontWeight===700))
      setItalic(!!(obj.fontStyle==='italic'))
      setColor(obj.fill || '#000000')
    } else setPanelOpen(false)
  }

  // helpers для фона как объекта
  function getImgOriginalSize(fabImg){
    if (typeof fabImg.getOriginalSize === 'function') {
      return fabImg.getOriginalSize()
    }
    const el = fabImg._element
    return { width: el?.naturalWidth || fabImg.width || 1, height: el?.naturalHeight || fabImg.height || 1 }
  }
  function fitValueToCanvas(cv, iw, ih){
    const cw = cv.getWidth(), ch = cv.getHeight()
    const s = Math.min(cw/iw, ch/ih)
    return { scale:s, left:(cw-iw*s)/2, top:(ch-ih*s)/2 }
  }
  function placeBgObject(cv, page, img){
    const { width:iw, height:ih } = getImgOriginalSize(img)
    const { scale, left, top } = fitValueToCanvas(cv, iw, ih)
    img.set({ left, top, scaleX:scale, scaleY:scale, selectable:false, evented:false, hoverCursor:'default' })
    try{ if (page.bgObj) cv.remove(page.bgObj) }catch{}
    page.bgObj = img
    cv.add(img)
    img.moveTo(0)
    cv.requestRenderAll()
  }
  function adjustBgObject(page){
    if (!page?.canvas || !page?.bgObj) return
    const cv = page.canvas
    const img = page.bgObj
    const { width:iw, height:ih } = getImgOriginalSize(img)
    const { scale, left, top } = fitValueToCanvas(cv, iw, ih)
    img.set({ left, top, scaleX:scale, scaleY:scale })
    cv.requestRenderAll()
  }
  function fitCanvasForPage(page){
    if (!page || !page.canvas) return
    const box = canvasWrapRef.current?.getBoundingClientRect()
    if (!box || box.width < 10) { setTimeout(()=>fitCanvasForPage(page), 30); return }
    const maxW = Math.min(box.width - 24, 980)
    const margin = 20
    const targetW = page.landscape ? PAGE_H : PAGE_W
    const targetH = page.landscape ? PAGE_W : PAGE_H
    const scale = Math.min(1, Math.max(0.1,(maxW - margin)/targetW))
    page.canvas.setWidth(Math.round(targetW*scale))
    page.canvas.setHeight(Math.round(targetH*scale))
    page.canvas.requestRenderAll()
    adjustBgObject(page)
  }
  function fitCanvas(idx){ const p = pages[idx]; if(!p || !p.canvas) return; fitCanvasForPage(p) }

  // ===== pages =====
  function removeDocument(){
    pages.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
    setPages([]); setCur(0); setDocId(null); setPanelOpen(false); setFileName('')
    toast('Документ удалён','success')
  }
  async function removePage(idx = cur){
    if (pages.length<=1) { removeDocument(); return }
    setPages(prev => prev.filter((_,i)=>i!==idx))
    setCur(i=>Math.max(0, i-1))
    toast('Страница удалена','success')
  }

  // ===== import files =====
  function pickDocument(){ docFileRef.current?.click() }
  function pickBgForCurrent(){ bgFileRef.current?.click() }

  async function onPickDocument(e){
    const files = Array.from(e.target.files||[])
    e.target.value = ''
    if (!files.length) return
    await handleFiles(files)
  }
  async function onPickBgFile(e){
    const files = Array.from(e.target.files||[])
    e.target.value=''
    if (!files.length) return
    await assignFirstFileToCurrent(files[0])
  }

  async function handleFiles(files){
    setLoading(true)
    try{
      for (let i=0;i<files.length;i++){
        const f = files[i]
        const ext = (f.name.split('.').pop()||'').toLowerCase()
        if (!docId) setDocId(randDocId())
        if (!fileName) {
          const base = f.name.replace(/\.[^.]+$/, '')
          setFileName(sanitizeName(base))
        }
        if (['jpg','jpeg','png'].includes(ext)){
          const url = await readAsDataURL(f)
          await addPageFromImage(url)
        } else if (ext==='pdf'){
          await addPagesFromPDF(f)
        } else if (['docx','doc'].includes(ext)){
          const canv = await renderDOCXToCanvas(f)
          const slices = sliceCanvasToPages(canv, PAGE_W, PAGE_H)
          for (const url of slices) await addPageFromImage(url)
        } else if (['xls','xlsx'].includes(ext)){
          const canv = await renderXLSXToCanvas(f)
          const slices = sliceCanvasToPages(canv, PAGE_W, PAGE_H)
          for (const url of slices) await addPageFromImage(url)
        } else {
          toast(`Формат не поддерживается: ${ext}`,'error')
        }
      }
      toast('Страницы добавлены','success')
    }catch(err){
      console.error(err); toast(err.message || 'Ошибка загрузки файлов','error')
    }finally{ setLoading(false) }
  }

  function loadImageEl(src){
    return new Promise((resolve,reject)=>{
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = ()=>resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  async function assignFirstFileToCurrent(file){
    const ext = (file.name.split('.').pop()||'').toLowerCase()
    const page = pages[cur]; if(!page) return
    setLoading(true)
    try{
      if (['jpg','jpeg','png'].includes(ext)){
        const url = await readAsDataURL(file); await setPageBackgroundFromImage(cur, url)
      } else if (ext==='pdf'){
        await setPageBackgroundFromFirstPDFPage(cur, file)
      } else if (['docx','doc'].includes(ext)){
        const canv = await renderDOCXToCanvas(file)
        const slices = sliceCanvasToPages(canv, PAGE_W, PAGE_H)
        await setPageBackgroundFromImage(cur, slices[0] || canv.toDataURL('image/png'))
      } else if (['xls','xlsx'].includes(ext)){
        const canv = await renderXLSXToCanvas(file)
        const slices = sliceCanvasToPages(canv, PAGE_W, PAGE_H)
        await setPageBackgroundFromImage(cur, slices[0] || canv.toDataURL('image/png'))
      } else toast('Этот формат не поддерживается','error')
    }catch(e){ toast(e.message || 'Не удалось назначить страницу','error') }
    finally{ setLoading(false) }
  }

  async function addPageFromImage(dataUrl){
    const id = 'p_' + Math.random().toString(36).slice(2)
    const elId = 'cv_' + id
    const page = { id, elId, canvas:null, bgObj:null, landscape:false }
    setPages(prev => {
      const arr = [...prev, page]
      setCur(arr.length-1)
      return arr
    })
    requestAnimationFrame(async()=>{
      const cv = await ensureCanvas(page)
      await ensureFabric()
      const imgEl = await loadImageEl(dataUrl)
      // eslint-disable-next-line no-undef
      const img = new fabric.Image(imgEl, { selectable:false, evented:false })
      placeBgObject(cv, page, img)
    })
  }

  async function setPageBackgroundFromImage(idx, dataUrl){
    const page = pages[idx]; if(!page) return
    const cv = await ensureCanvas(page)
    await ensureFabric()
    const imgEl = await loadImageEl(dataUrl)
    // eslint-disable-next-line no-undef
    const img = new fabric.Image(imgEl, { selectable:false, evented:false })
    placeBgObject(cv, page, img)
  }

  async function addPagesFromPDF(file){
    await ensurePDFJS()
    const ab = await file.arrayBuffer()
    // eslint-disable-next-line no-undef
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise
    for (let i=1;i<=pdf.numPages;i++){
      const url = await renderPDFPageToDataURL(pdf, i, 2.0)
      await addPageFromImage(url)
    }
  }
  async function setPageBackgroundFromFirstPDFPage(idx, file){
    await ensurePDFJS()
    const ab = await file.arrayBuffer()
    // eslint-disable-next-line no-undef
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise
    const url = await renderPDFPageToDataURL(pdf, 1, 2.0)
    await setPageBackgroundFromImage(idx, url)
  }

  async function renderPDFPageToDataURL(pdf, pageNum, scale){
    const p = await pdf.getPage(pageNum)
    const vp = p.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = vp.width; canvas.height = vp.height
    await p.render({ canvasContext: ctx, viewport: vp }).promise
    const out = document.createElement('canvas')
    out.width = PAGE_W; out.height = PAGE_H
    const octx = out.getContext('2d')
    octx.fillStyle = '#fff'; octx.fillRect(0,0,out.width,out.height)
    const s = Math.min(out.width/canvas.width, out.height/canvas.height)
    const dw = canvas.width*s, dh = canvas.height*s
    const dx = (out.width - dw)/2, dy = (out.height - dh)/2
    octx.drawImage(canvas, dx, dy, dw, dh)
    return out.toDataURL('image/png')
  }

  async function renderDOCXToCanvas(file){
    await ensureMammothCDN(); await ensureHtml2Canvas()
    const ab = await file.arrayBuffer()
    const res = await window.mammoth.convertToHtml({ arrayBuffer: ab })
    const holder = document.createElement('div')
    holder.style.position='fixed'; holder.style.left='-9999px'; holder.style.top='-9999px'
    holder.style.width=PAGE_W+'px'; holder.style.padding='24px'; holder.style.background='#fff'
    holder.innerHTML = res.value || '<div/>'
    document.body.appendChild(holder)
    const canvas = await window.html2canvas(holder, { backgroundColor:'#fff', scale:2 })
    document.body.removeChild(holder)
    return canvas
  }

  async function renderXLSXToCanvas(file){
    await ensureSheetJS(); await ensureHtml2Canvas()
    const ab = await file.arrayBuffer()
    const wb = window.XLSX.read(ab, { type:'array' })
    const sheetName = wb.SheetNames[0]
    const html = window.XLSX.utils.sheet_to_html(wb.Sheets[sheetName])
    const holder = document.createElement('div')
    holder.style.position='fixed'; holder.style.left='-9999px'; holder.style.top='-9999px'
    holder.style.width='900px'; holder.style.padding='16px'; holder.style.background='#fff'
    holder.innerHTML = html
    document.body.appendChild(holder)
    const canvas = await window.html2canvas(holder, { backgroundColor:'#fff', scale:2 })
    document.body.removeChild(holder)
    return canvas
  }

  function sliceCanvasToPages(canvas, pageW, pageH){
    const out = []
    const totalH = canvas.height
    const pagePx = pageH*2
    for(let y=0; y<totalH; y+=pagePx){
      const sliceH = Math.min(pagePx, totalH - y)
      const tmp = document.createElement('canvas')
      tmp.width = canvas.width
      tmp.height = sliceH
      const tctx = tmp.getContext('2d')
      tctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, tmp.width, tmp.height)
      const dst = document.createElement('canvas')
      dst.width = pageW; dst.height = pageH
      const dctx = dst.getContext('2d')
      dctx.fillStyle = '#fff'; dctx.fillRect(0,0,dst.width,dst.height)
      const s = Math.min(dst.width/tmp.width, dst.height/tmp.height)
      const dw = tmp.width*s, dh = tmp.height*s
      const dx = (dst.width-dw)/2, dy = (dst.height-dh)/2
      dctx.drawImage(tmp, dx, dy, dw, dh)
      out.push(dst.toDataURL('image/png'))
    }
    return out
  }

  // подписи
  function pickSignature(){ signFileRef.current?.click() }
  async function onPickSignature(e){
    const f = e.target.files?.[0]; e.target.value=''
    if (!f) return
    const src = await readAsDataURL(f)
    setCropOrig(src); setCropSrc(src); setCropOpen(true); setCropType('signature'); setCropThresh(40)
  }
  useEffect(()=>{
    if (!cropOpen) return
    (async()=>{
      await ensureCropper()
      if (cropperRef.current) { try{ cropperRef.current.destroy() }catch{}; cropperRef.current = null }
      const imgEl = cropImgRef.current; if (!imgEl) return
      // eslint-disable-next-line no-undef
      const inst = new Cropper(imgEl, { viewMode:1, dragMode:'move', guides:true, background:false, autoCrop:true })
      cropperRef.current = inst
    })()
    return ()=>{ if (cropperRef.current) { try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } }
  },[cropOpen])

  useEffect(()=>{
    if (!cropOpen || !cropperRef.current || !cropOrig) return
    ;(async()=>{
      const thr = Math.round(255*(cropThresh/100))
      const url = await removeWhiteBackground(cropOrig, thr)
      try{ cropperRef.current.replace(url, true) }catch{}
    })()
  },[cropThresh, cropOpen, cropOrig])

  async function cropConfirm(){
    try{
      const cr = cropperRef.current; if (!cr) return
      const c = cr.getCroppedCanvas({ imageSmoothingEnabled:true, imageSmoothingQuality:'high' })
      let dataUrl = c.toDataURL('image/png')
      const thr = Math.round(255 * (cropThresh/100))
      dataUrl = await removeWhiteBackground(dataUrl, thr)
      if (cropType === 'round_seal'){
        const imgEl = await loadImageEl(dataUrl)
        const cc = document.createElement('canvas'), ctx = cc.getContext('2d')
        cc.width = imgEl.width; cc.height = imgEl.height
        ctx.save(); ctx.beginPath(); ctx.arc(cc.width/2, cc.height/2, Math.min(cc.width,cc.height)/2, 0, Math.PI*2); ctx.closePath(); ctx.clip()
        ctx.drawImage(imgEl,0,0); ctx.restore()
        dataUrl = cc.toDataURL('image/png')
      }
      const id = 's_' + Math.random().toString(36).slice(2)
      setSignLib(arr => [{ id, url: dataUrl, type: cropType }, ...arr].slice(0,30))
      if (hasDoc){
        const page = pages[cur]; const cv = await ensureCanvas(page)
        const imgEl = await loadImageEl(dataUrl)
        // eslint-disable-next-line no-undef
        const img = new fabric.Image(imgEl)
        const w=cv.getWidth(), h=cv.getHeight()
        const scale = Math.min(1, (w*0.35)/img.width)
        img.set({ left:w*0.15, top:h*0.15, scaleX:scale, scaleY:scale, selectable:true })
        cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
      }
      setCropOpen(false)
    }catch(e){ toast(e.message || 'Не удалось обработать изображение','error') }
  }

  async function removeWhiteBackground(src, threshold=245){
    const imgEl = await loadImageEl(src)
    const w = imgEl.naturalWidth||imgEl.width; const h = imgEl.naturalHeight||imgEl.height
    const c = document.createElement('canvas'); const ctx = c.getContext('2d'); c.width=w; c.height=h
    ctx.drawImage(imgEl,0,0); const data = ctx.getImageData(0,0,w,h); const d = data.data
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2]
      if (r>threshold && g>threshold && b>threshold) d[i+3]=0
      else { const avg=(r+g+b)/3; if (avg>220) d[i+3]=Math.max(0,d[i+3]-120) }
    }
    ctx.putImageData(data,0,0); return c.toDataURL('image/png')
  }

  function startDragSign(url, e){
    try{ e.dataTransfer.setData('application/x-sign-url', url); e.dataTransfer.effectAllowed='copy' }catch{}
  }
  function placeFromLib(url){
    if (!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    const page = pages[cur]; ensureCanvas(page).then(cv=>{
      loadImageEl(url).then(imgEl=>{
        // eslint-disable-next-line no-undef
        const img = new fabric.Image(imgEl)
        const w=cv.getWidth(), h=cv.getHeight()
        const scale = Math.min(1, (w*0.35)/img.width)
        img.set({ left:w*0.15, top:h*0.15, scaleX:scale, scaleY:scale, selectable:true })
        cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
      })
    })
  }
  function removeFromLib(id){ setSignLib(list=>list.filter(i=>i.id!==id)) }

  async function addText(){
    if (!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    await ensureFabric()
    const page = pages[cur]; const cv = await ensureCanvas(page)
    // eslint-disable-next-line no-undef
    const tb = new fabric.Textbox('Вставьте текст', {
      left: Math.round(cv.getWidth()*0.1), top: Math.round(cv.getHeight()*0.15),
      fontSize: 48, fill:'#000000', fontFamily:'Arial', fontWeight:'bold'
    })
    cv.add(tb); cv.setActiveObject(tb); cv.requestRenderAll(); setPanelOpen(true)
  }
  async function applyPanel(){
    const page = pages[cur]; const cv = page?.canvas; if(!cv) return
    const obj = cv.getActiveObject(); if(!obj || obj.type!=='textbox') return
    obj.set({ fontFamily:font, fontSize:fontSize, fontWeight:bold?'bold':'normal', fontStyle:italic?'italic':'normal', fill:color })
    cv.requestRenderAll()
  }
  useEffect(()=>{ if(panelOpen) applyPanel() },[font,fontSize,bold,italic,color])

  async function rotatePage(){
    if (!hasDoc) return
    const page = pages[cur]
    await ensureCanvas(page)
    page.landscape = !page.landscape
    fitCanvasForPage(page)
    adjustBgObject(page)
  }

  function canUndo(){
    if (!hasDoc) return false
    const page = pages[cur]; const cv = page?.canvas; if(!cv) return false
    const obj = cv.getActiveObject(); return !!obj || (cv.getObjects?.()?.length>0)
  }
  function undo(){
    if (!canUndo()) return
    const page = pages[cur]; const cv = page.canvas; const obj = cv.getActiveObject()
    if (obj){ cv.remove(obj); setPanelOpen(false) }
    else { const arr=cv.getObjects(); if(arr.length>0) cv.remove(arr[arr.length-1]) }
    cv.discardActiveObject(); cv.requestRenderAll()
  }

  function baseName(){
    const nm = (fileName||'').trim()
    if (!nm){ toast('Введите название файла вверху','error'); return null }
    return sanitizeName(nm)
  }
  function freeLeft(){ return isAuthed ? (billing?.free_left ?? 3) : guestLeft }
  function consumeFree(kind, bn){
    if (isAuthed) AuthAPI.recordDownload(kind, 1, bn, 'free').catch(()=>{})
    else {
      const today = new Date().toISOString().slice(0,10)
      const next = { date: today, left: Math.max(0, guestLeft-1) }
      setGuestQuota(next)
      localStorage.setItem('guest_quota', JSON.stringify(next))
    }
  }

  async function exportJPG(all=false){
    if (!hasDoc) return
    const bn = baseName(); if (!bn) return
    if (freeLeft()<=0 && !all){ setPayOpen(true); return }
    if (pages.length>1 && !all){
      const page = pages[cur]; const url = page.canvas.toDataURL({ format:'jpeg', quality:0.95 })
      downloadDataURL(url, `${bn}-p${cur+1}.jpg`); consumeFree('jpg', bn); toast('Скачана текущая страница (бесплатно)','info'); return
    }
    if (pages.length>1 && all){ setPayOpen(true); return }
    const page = pages[0]; const url = page.canvas.toDataURL({ format:'jpeg', quality:0.95 })
    downloadDataURL(url, `${bn}.jpg`); consumeFree('jpg', bn)
  }

  async function exportPDF(all=false){
    if (!hasDoc) return
    const bn = baseName(); if (!bn) return
    if (freeLeft()<=0 && !all){ setPayOpen(true); return }
    await ensureJsPDF()
    if (pages.length>1 && !all){
      const p = pages[cur]; const url = p.canvas.toDataURL('image/jpeg',0.95)
      // eslint-disable-next-line no-undef
      const pdf = new window.jspdf.jsPDF({ orientation: p.canvas.getWidth()>p.canvas.getHeight()?'l':'p', unit:'px', format:[p.canvas.getWidth(), p.canvas.getHeight()] })
      pdf.addImage(url, 'JPEG', 0,0,p.canvas.getWidth(), p.canvas.getHeight()); pdf.save(`${bn}-p${cur+1}.pdf`); consumeFree('pdf', bn); toast('Скачана текущая страница (бесплатно)','info'); return
    }
    if (pages.length>1 && all){ setPayOpen(true); return }
    const p = pages[0]; const url = p.canvas.toDataURL('image/jpeg',0.95)
    // eslint-disable-next-line no-undef
    const pdf = new window.jspdf.jsPDF({ orientation: p.canvas.getWidth()>p.canvas.getHeight()?'l':'p', unit:'px', format:[p.canvas.getWidth(), p.canvas.getHeight()] })
    pdf.addImage(url, 'JPEG', 0,0,p.canvas.getWidth(), p.canvas.getHeight()); pdf.save(`${bn}.pdf`); consumeFree('pdf', bn)
  }

  function prev(){ if (canPrev) setCur(i=>Math.max(0, i-1)) }
  function next(){ if (canNext) setCur(i=>Math.min(pages.length-1, i+1)) }
  function closeAllSheets(){ setMenuAddOpen(false); setMenuDownloadOpen(false); setMenuMoreOpen(false) }
  function downloadDataURL(url, filename){ const a=document.createElement('a'); a.href=url; a.download=filename||'file'; document.body.appendChild(a); a.click(); a.remove() }
  function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file) }) }
  function loadImageEl(src){ return new Promise((res,rej)=>{ const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>res(img); img.onerror=rej; img.src=src }) }

  const canRotate = hasDoc
  const canDelDoc = hasDoc
  const canDelPage = hasDoc && pages.length>1
  const canAddText = hasDoc

  function onCanvasDrop(e){
    e.preventDefault()
    const dt = e.dataTransfer
    if (!dt) return
    const types = Array.from(dt.types||[])
    if (types.includes('application/x-sign-url')){
      const url = dt.getData('application/x-sign-url')
      if (url && url!=='add') placeFromLib(url)
      return
    }
    const fs = Array.from(dt.files||[])
    if (fs.length) handleFiles(fs)
  }

  // ====== RENDER ======
  return (
    <div className="doc-editor page">
      {/* mobile top bar */}
      <div className="ed-top" style={{display: isMobile && hasDoc ? undefined : 'none'}}>
        <button className="ed-menu-btn" aria-label="Ещё" onClick={()=>setMenuMoreOpen(o=>!o)}>
          <img src={icMore} alt="" />
        </button>
        <div className="ed-docid"></div>
        <div className="ed-top-right"></div>
        {menuMoreOpen && (
          <div className="ed-menu" ref={moreRef}>
            <button className={canRotate?'':'disabled'} onClick={rotatePage}>
              <img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу
            </button>
            <button className={canDelPage?'':'disabled'} onClick={()=>removePage()}>
              <img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить страницу
            </button>
            <button className={canDelDoc?'':'disabled'} onClick={removeDocument}>
              <img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ
            </button>
          </div>
        )}
      </div>

      {/* панель форматирования текста */}
      {panelOpen && (
        <div className="ed-toolbar">
          <select value={font} onChange={e=>setFont(e.target.value)}>
            {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          <div className="sep"/>
          <button onClick={()=>setFontSize(s=>Math.max(6,s-2))}>−</button>
          <span className="val">{fontSize}</span>
          <button onClick={()=>setFontSize(s=>Math.min(300,s+2))}>+</button>
          <div className="sep"/>
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} title="Цвет текста" />
          <button className={bold?'toggled':''} onClick={()=>setBold(b=>!b)}><b>B</b></button>
          <button className={italic?'toggled':''} onClick={()=>setItalic(i=>!i)}><i>I</i></button>
        </div>
      )}

      <div className="ed-body">
        {/* left */}
        <aside className="ed-left">
          <div className="ed-tools">
            <button className={`ed-tool ${canAddText?'':'disabled'}`} onClick={addText}>
              <img className="ico" src={icText} alt=""/><span>Добавить текст</span>
            </button>
            <button className="ed-tool" onClick={pickSignature}>
              <img className="ico" src={icSign} alt=""/><span>Загрузить подпись</span>
            </button>
          </div>

          <div className="ed-sign-list">
            <div className="thumb add" draggable onDragStart={(e)=>startDragSign('add',e)} onClick={pickSignature}>
              <img src={icPlus} alt="+" style={{width:22,height:22,opacity:.6}}/>
            </div>
            {signLib.map(item=>(
              <div key={item.id} className="thumb" draggable onDragStart={(e)=>startDragSign(item.url, e)}>
                <img src={item.url} alt="" onClick={()=>placeFromLib(item.url)} style={{width:'100%',height:'100%',objectFit:'contain',cursor:'pointer'}}/>
                <button className="thumb-x" onClick={()=>removeFromLib(item.id)}>×</button>
              </div>
            ))}
          </div>
        </aside>

        {/* center */}
        <section className="ed-center">
          {isMobile && signLib.length>0 && (
            <div className="ed-sign-top" style={{display:'flex',gap:10,overflowX:'auto',margin:'4px 0 8px',paddingBottom:4}}>
              {signLib.map(item=>(
                <button key={item.id} className="thumb" style={{width:72,minWidth:72,height:72}} draggable onDragStart={(e)=>startDragSign(item.url, e)} onClick={()=>placeFromLib(item.url)}>
                  <img src={item.url} alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/>
                </button>
              ))}
              <button className="thumb add" style={{width:72,minWidth:72,height:72}} onClick={pickSignature}>
                <img src={icPlus} alt="" style={{width:18,opacity:.6}}/>
              </button>
            </div>
          )}

          {!isMobile && (
            <div className="ed-namebar">
              <input className="ed-filename" placeholder="Название файла при скачивании" value={fileName} onChange={e=>setFileName(sanitizeName(e.target.value))}/>
            </div>
          )}

          <div className="ed-canvas-wrap" ref={canvasWrapRef} onDragOver={(e)=>e.preventDefault()} onDrop={onCanvasDrop}>
            {pages.map((p, idx)=>(
              <div key={p.id} className={`ed-canvas ${idx===cur?'active':''}`}>
                <button className="ed-page-x" title="Удалить эту страницу" onClick={()=>removePage(idx)}>×</button>
                <canvas id={p.elId}/>
              </div>
            ))}

            {!hasDoc && (
              <div className="ed-dropzone" onClick={pickDocument}>
                <img src={icDocAdd} alt="" style={{width:140,height:'auto',opacity:.9}}/>
                <div className="dz-title">Загрузите документы</div>
                <div className="dz-sub">Можно перетащить их в это поле</div>
                <div className="dz-types">JPG, JPEG, PNG, PDF, DOC, DOCX, XLS, XLSX</div>
              </div>
            )}

            {loading && (
              <div className="ed-canvas-loading">
                <div className="spinner" aria-hidden="true"></div>
                Загрузка…
              </div>
            )}
          </div>

          <div className="ed-pages">
            {pages.map((p, i)=>(
              <div key={p.id} className={`ed-page-btn ${i===cur?'active':''}`} onClick={()=>setCur(i)}>{i+1}</div>
            ))}
            <button className="ed-page-add" onClick={pickDocument}><img src={icPlus} alt="+"/></button>
          </div>

          <div className="ed-bottom" style={{display: isMobile ? undefined : 'none'}}>
            <div className="ed-pager">
              <button onClick={prev} disabled={!canPrev}><img src={icPrev} alt="Prev" /></button>
              <span className="pg">{hasDoc ? `${cur+1}/${pages.length}` : '0/0'}</span>
              <button onClick={next} disabled={!canNext}><img src={icNext} alt="Next" /></button>
            </div>
            <div className="ed-bottom-actions">
              <button className="fab" onClick={()=>setMenuAddOpen(o=>!o)}><img src={icPlus} alt="+" /></button>
              <button className={`fab main ${(!hasDoc)?'disabled':''}`} onClick={()=>setMenuDownloadOpen(o=>!o)}><img src={icDownload} alt="↓" /></button>
            </div>
          </div>
        </section>

        {/* right */}
        <aside className="ed-right">
          <div className="ed-actions">
            <button className={`ed-action ${hasDoc?'':'disabled'}`} onClick={removeDocument}>
              <img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ
            </button>
            <button className={`ed-action ${canUndo()?'':'disabled'}`} onClick={undo}>
              <img src={icUndo} alt="" style={{width:18,height:18,marginRight:8}}/>Отменить
            </button>
            <button className={`ed-action ${hasDoc?'':'disabled'}`} onClick={rotatePage}>
              <img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу
            </button>
            <button className="ed-action disabled" disabled>
              <img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы
            </button>
          </div>

          <div className="ed-download">
            <div className="ed-dl-title">Скачать бесплатно:</div>
            <div className="ed-dl-row">
              <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={()=>exportJPG(false)}>
                <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:8}}/>JPG
              </button>
              <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={()=>exportPDF(false)}>
                <img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:8}}/>PDF
              </button>
            </div>

            <div className="ed-dl-title" style={{marginTop:10}}>Купить:</div>
            <div className="ed-dl-row ed-dl-row-paid">
              <button className={`btn ${(!hasDoc)?'disabled':''}`} onClick={()=>{ if(hasDoc) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:8}}/>JPG
              </button>
              <button className={`btn ${(!hasDoc)?'disabled':''}`} onClick={()=>{ if(hasDoc) { setPlan('single'); setPayOpen(true) } }}>
                <img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:8}}/>PDF
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* add sheet */}
      {menuAddOpen && (
        <div className="ed-sheet" ref={sheetRef}>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuAddOpen(false); addText() } }}>
            <img src={icText} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить текст
          </button>
          <button onClick={()=>{ setMenuAddOpen(false); pickSignature() }}>
            <img src={icSign} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить подпись/печать
          </button>
          {!isMobile && (
            <button onClick={()=>{ setMenuAddOpen(false); pickDocument() }}>
              <img src={icDocAdd} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить документ
            </button>
          )}
        </div>
      )}

      {/* download sheet */}
      {menuDownloadOpen && (
        <div className="ed-sheet" ref={dlRef}>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить JPG
          </button>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить PDF
          </button>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportJPG(false) } }}>
            <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно JPG
          </button>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportPDF(false) } }}>
            <img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно PDF
          </button>
        </div>
      )}

      {(menuAddOpen || menuDownloadOpen || menuMoreOpen) && <div className="ed-dim" onClick={closeAllSheets}/>}

      {/* crop modal */}
      {cropOpen && (
        <div className="modal-overlay" onClick={()=>setCropOpen(false)}>
          <div className="modal crop-modal" onClick={e=>e.stopPropagation()}>
            <button className="modal-x" onClick={()=>setCropOpen(false)}>×</button>
            <h3 className="modal-title">1. Выделите область</h3>
            <div className="crop-row">
              <select value={cropType} onChange={e=>setCropType(e.target.value)}>
                <option value="signature">подпись</option>
                <option value="sig_seal">подпись + печать</option>
                <option value="round_seal">круглая печать</option>
              </select>
            </div>
            <div className="crop-area">
              <img ref={cropImgRef} src={cropSrc} alt="" style={{maxWidth:'100%',maxHeight:'46vh'}}/>
            </div>
            <div className="crop-controls">
              <h4>2. Настройте прозрачность фона:</h4>
              <div className="thr-row">
                <input type="range" min="0" max="100" value={cropThresh} onChange={e=>setCropThresh(Number(e.target.value))}/>
                <input type="number" min="0" max="100" value={cropThresh} onChange={e=>{ const v=Math.max(0,Math.min(100,Number(e.target.value)||0)); setCropThresh(v) }} />
                <span>%</span>
              </div>
              <button className="btn" onClick={cropConfirm}><span className="label">Загрузить</span></button>
            </div>
          </div>
        </div>
      )}

      {/* pay modal */}
      {payOpen && (
        <div className="modal-overlay" onClick={()=>setPayOpen(false)}>
          <div className="modal pay-modal" onClick={e=>e.stopPropagation()}>
            <button className="modal-x" onClick={()=>setPayOpen(false)}>×</button>
            <h3 className="modal-title">Чтобы выгрузить документ придется немножко заплатить</h3>

            <div className="pay-grid">
              <button className={`pay-card ${plan==='single'?'active':''}`} onClick={()=>setPlan('single')} type="button">
                <img className="pay-ill" src={plan1} alt="" />
                <div className="pay-price">99 ₽</div>
                <div className="pay-sub">один (этот) документ</div>
              </button>

              <button className={`pay-card ${plan==='month'?'active':''}`} onClick={()=>setPlan('month')} type="button">
                <img className="pay-ill" src={plan2} alt="" />
                <div className="pay-price">399 ₽</div>
                <div className="pay-sub">безлимит на месяц</div>
              </button>

              <button className={`pay-card ${plan==='year'?'active':''}`} onClick={()=>setPlan('year')} type="button">
                <img className="pay-ill" src={plan3} alt="" />
                <div className="pay-price">3999 ₽</div>
                <div className="pay-sub">безлимит на год</div>
              </button>
            </div>

            <div className={`pay-controls ${promoError?'error':''}`}>
              <div className="promo">
                <label>Промокод</label>
                <div className="promo-row">
                  <input value={promo} onChange={e=>{ setPromo(e.target.value); setPromoError('') }} placeholder="Введите промокод"/>
                  {promo && <button className="promo-clear" onClick={()=>{ setPromo(''); setPromoError('') }}>×</button>}
                </div>
                {promoError && <div className="promo-err">{promoError}</div>}
              </div>

              <div className="pay-buttons">
                <button className="btn btn-lite" onClick={applyPromo}><span className="label">Активировать</span></button>
                <button className="btn" onClick={startPurchase}><span className="label">Оплатить {price} ₽</span></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* hidden inputs */}
      <input ref={docFileRef} type="file" accept={ACCEPT_DOC} hidden multiple onChange={onPickDocument}/>
      <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={onPickBgFile}/>
      <input ref={signFileRef} type="file" accept=".png,.jpg,.jpeg" hidden onChange={onPickSignature}/>
    </div>
  )
}
// src/pages/Editor.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric, ensurePDFJS, ensureHtml2Canvas, ensureMammothCDN,
  ensureSheetJS, ensureJsPDF, ensureCropper, ensureJSZip, ensureScripts
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
import icDocAdd from '../assets/icons/doc-add.svg'

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

const PAGE_W = 794
const PAGE_H = 1123
const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial','Times New Roman','Ermilov','Segoe UI','Roboto','Georgia']

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

// безопасное копирование в новый Uint8Array (без slice у ArrayBuffer)
function toUint8Copy(input){
  if (input instanceof Uint8Array){
    const out = new Uint8Array(input.length)
    out.set(input)
    return out
  }
  if (input instanceof ArrayBuffer){
    const view = new Uint8Array(input)
    const out = new Uint8Array(view.length)
    out.set(view)
    return out
  }
  return new Uint8Array()
}

// Кодирование/декодирование в base64 для сохранения PDF-страниц в JSON
function u8ToB64(u8){
  let bin = ''
  const chunk = 0x8000
  for(let i=0; i<u8.length; i+=chunk){
    bin += String.fromCharCode.apply(null, u8.subarray(i, i+chunk))
  }
  return btoa(bin)
}
function b64ToU8(b64){
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export default function Editor(){
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')

  // page: {id, elId, canvas, bgObj, landscape, meta}
  // meta:
  //  - image: { type:'image', src, w, h, mime }
  //  - pdf:   { type:'pdf', bytes(Uint8Array), index }
  //  - raster:{ type:'raster', src, w, h }
  const [pages, setPages] = useState([])
  const [cur, setCur] = useState(0)
  const [loading, setLoading] = useState(false)

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

  const [menuAddOpen, setMenuAddOpen] = useState(false)
  const [menuMoreOpen, setMenuMoreOpen] = useState(false)
  const [menuDownloadOpen, setMenuDownloadOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropType, setCropType] = useState('signature')
  const [cropThresh, setCropThresh] = useState(40)
  const cropImgRef = useRef(null)
  const cropperRef = useRef(null)

  const [plan, setPlan] = useState('month')
  const [promo, setPromo] = useState('')
  const [promoError, setPromoError] = useState('')
  // Цены приходят из BillingConfig (бэкенд) через /billing/status/
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

  // ----- Рефы, чтобы сериализация всегда видела АКТУАЛЬНОЕ состояние -----
  const pagesRef = useRef(pages)
  const docIdRef = useRef(docId)
  const fileNameRef = useRef(fileName)
  useEffect(()=>{ pagesRef.current = pages }, [pages])
  useEffect(()=>{ docIdRef.current = docId }, [docId])
  useEffect(()=>{ fileNameRef.current = fileName }, [fileName])

  // ----- Автосохранение черновика на сервер -----
  const saveDebounceRef = useRef(0)
  function scheduleSaveDraft(delay=600){
    if(!hasDoc) return
    window.clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = window.setTimeout(()=>{ saveDraftNow().catch(()=>{}) }, delay)
  }
  async function saveDraftNow(){
    if(!hasDoc) return
    const s = await serializeDocument()
    try {
      await AuthAPI.saveDraft(s)
    } catch {}
  }

  // Флаш при скрытии вкладки/уходе со страницы
  useEffect(()=>{
    const onVis = () => { if (document.hidden) saveDraftNow().catch(()=>{}) }
    const onHide = () => { saveDraftNow().catch(()=>{}) }
    window.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [hasDoc])

  // Флаш при размонтировании (смена страницы)
  useEffect(() => {
    return () => { try { saveDraftNow() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(()=>{
    if(isAuthed){
      AuthAPI.getBillingStatus()
        .then((st)=>{
          setBilling(st)
          if (st && ('price_single' in st)) {
            setPrices({
              single: Number(st.price_single||0),
              month: Number(st.price_month||0),
              year: Number(st.price_year||0),
            })
          }
        })
        .catch(()=>{})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isAuthed])

  useEffect(()=>{
    const onUser=async()=>{
      if(localStorage.getItem('access')){
        try{
          const st = await AuthAPI.getBillingStatus()
          setBilling(st)
          if (st && ('price_single' in st)) {
            setPrices({
              single: Number(st.price_single||0),
              month: Number(st.price_month||0),
              year: Number(st.price_year||0),
            })
          }
        }catch{}
        loadLibrary()
      }
    }
    const onBill=(e)=>{
      const st = e.detail
      setBilling(st)
      if (st && ('price_single' in st)) {
        setPrices({
          single: Number(st.price_single||0),
          month: Number(st.price_month||0),
          year: Number(st.price_year||0),
        })
      }
    }
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    return ()=>{ window.removeEventListener('user:update', onUser); window.removeEventListener('billing:update', onBill) }
  },[])

  const canvasWrapRef = useRef(null)
  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const moreRef = useRef(null)
  const sheetRef = useRef(null)
  const dlRef = useRef(null)

  const [isMobile, setIsMobile] = useState(()=>window.matchMedia('(max-width: 960px)').matches)
  useEffect(()=>{
    const mq=window.matchMedia('(max-width: 960px)')
    const on=()=>setIsMobile(mq.matches)
    mq.addEventListener('change',on)
    return ()=>mq.removeEventListener('change',on)
  },[])

  // На мобильном скрываем футер и отключаем прокрутку страницы — работаем в «режиме редактора»
  useEffect(()=>{
    if (isMobile) {
      document.body.classList.add('no-footer')
      document.documentElement.classList.add('no-footer')
    } else {
      document.body.classList.remove('no-footer')
      document.documentElement.classList.remove('no-footer')
    }
    return () => {
      document.body.classList.remove('no-footer')
      document.documentElement.classList.remove('no-footer')
    }
  }, [isMobile])

  useEffect(()=>{
    function onDoc(e){
      const t=e.target
      if(menuMoreOpen && moreRef.current && !moreRef.current.contains(t)) setMenuMoreOpen(false)
      if(menuAddOpen && sheetRef.current && !sheetRef.current.contains(t)) setMenuAddOpen(false)
      if(menuDownloadOpen && dlRef.current && !dlRef.current.contains(t)) setMenuDownloadOpen(false)
    }
    if(menuMoreOpen||menuAddOpen||menuDownloadOpen){
      document.addEventListener('click',onDoc,true)
      return ()=>document.removeEventListener('click',onDoc,true)
    }
  },[menuMoreOpen,menuAddOpen,menuDownloadOpen])

  useEffect(()=>{
    if(!canvasWrapRef.current) return
    const ro=new ResizeObserver(()=>{ pages.forEach((_,i)=>fitCanvas(i)) })
    ro.observe(canvasWrapRef.current)
    return ()=>ro.disconnect()
  },[pages])
  useEffect(()=>{ if(pages[cur]?.canvas){ requestAnimationFrame(()=>fitCanvas(cur)); setTimeout(()=>fitCanvas(cur),0) } },[cur,pages.length,isMobile])

  // ---- Восстановление черновика последнего документа — только с сервера ----
  useEffect(()=>{
    (async ()=>{
      if(hasDoc) return
      setLoading(true)
      try{
        if (localStorage.getItem('access')) {
          const srv = await AuthAPI.getDraft()
          if (srv && srv.exists && srv.data) {
            await restoreDocumentFromDraft(srv.data)
            toast('Восстановлен последний документ','info')
          }
        }
      }catch(e){
        console.error('restore draft failed',e)
      }finally{
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  async function loadLibrary(){
    setLibLoading(true)
    try{
      const list=await AuthAPI.listSigns()
      setSignLib(Array.isArray(list)?list:[])
    }catch{ setSignLib([]) } finally{ setLibLoading(false) }
  }
  useEffect(()=>{ loadLibrary() },[])

  function uniqueObjId(){ return 'obj_'+Math.random().toString(36).slice(2) }
  async function waitForElm(id, timeout=8000){ const t0=Date.now(); return new Promise((res,rej)=>{ (function loop(){ const el=document.getElementById(id); if(el) return res(el); if(Date.now()-t0>timeout) return rej(new Error('Canvas element timeout')); requestAnimationFrame(loop) })() }) }

  function getImgOriginalSize(fabImg){
    if (typeof fabImg.getOriginalSize === 'function') return fabImg.getOriginalSize()
    const el = fabImg._originalElement || fabImg._element
    return { width: el?.naturalWidth || fabImg.width || 1, height: el?.naturalHeight || fabImg.height || 1 }
  }
  function fitValueToCanvas(cv, iw, ih){
    const cw = cv.getWidth(), ch = cv.getHeight()
    const s = Math.min(cw/iw, ch/ih)
    return { scale:s, left:(cw-iw*s)/2, top:(ch-ih*s)/2 }
  }
  function placeBgObject(cv,page,img){
    const { width:iw, height:ih } = getImgOriginalSize(img)
    const { scale, left, top } = fitValueToCanvas(cv, iw, ih)
    img.set({ left, top, scaleX:scale, scaleY:scale, selectable:false, evented:false, hoverCursor:'default' })
    try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
    page.bgObj=img; cv.add(img); img.moveTo(0); cv.requestRenderAll()
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
    if(!page) return
    const cv = page.canvas
    if(!cv){ return }
    const box = canvasWrapRef.current?.getBoundingClientRect()
    if(!box||box.width<10){ setTimeout(()=>fitCanvasForPage(page),30); return }
    const maxW = Math.min(box.width - 24, 980)
    const margin = 20
    const tW = page.landscape ? PAGE_H : PAGE_W
    const tH = page.landscape ? PAGE_W : PAGE_H
    const scale = Math.min(1, Math.max(0.1, (maxW - margin) / tW))
    cv.setWidth(Math.round(tW*scale))
    cv.setHeight(Math.round(tH*scale))
    cv.requestRenderAll()
    adjustBgObject(page)
  }
  function fitCanvas(idx){ const p=pages[idx]; if(!p||!p.canvas) return; fitCanvasForPage(p) }

  async function ensureCanvas(page){
    await ensureFabric()
    if(page.canvas) return page.canvas
    await waitForElm(page.elId)
    // eslint-disable-next-line no-undef
    const c=new fabric.Canvas(page.elId,{ backgroundColor:'#fff', preserveObjectStacking:true, selection:true })
    page.canvas = c
    fitCanvasForPage(page)
    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', ()=>setPanelOpen(false))

    // Больше событий — больше шансов не потерять изменения
    c.on('object:added', ()=>scheduleSaveDraft(700))
    c.on('object:modified', ()=>scheduleSaveDraft(500))
    c.on('object:removed', ()=>scheduleSaveDraft(400))
    c.on('object:moving',  ()=>scheduleSaveDraft(700))
    c.on('object:scaling', ()=>scheduleSaveDraft(700))
    c.on('object:rotating',()=>scheduleSaveDraft(700))
    // для ввода текста в Textbox
    try{ c.on('text:changed', ()=>scheduleSaveDraft(700)) }catch{}

    installDeleteControl()
    return c
  }

  function onSelectionChanged(e){
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

  // Кастомный контрол удаления
  function installDeleteControl(){
    // eslint-disable-next-line no-undef
    const fobj=fabric.Object; if(fobj.__delPatched) return
    // eslint-disable-next-line no-undef
    const F=fabric
    const del=new F.Control({
      x:0.5,y:-0.5,offsetX:12,offsetY:-12,cursorStyle:'pointer',
      mouseUpHandler:(_,tr)=>{
        const t=tr.target,cv=t.canvas
        if (window.confirm('Удалить объект со страницы?')) {
          cv.remove(t); cv.discardActiveObject(); cv.requestRenderAll()
          toast('Объект удалён','success')
          scheduleSaveDraft(300)
        }
        return true
      },
      render:(ctx,left,top)=>{ const r=12; ctx.save(); ctx.fillStyle='#E26D5C'; ctx.beginPath(); ctx.arc(left,top,r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(left-5,top-5); ctx.lineTo(left+5,top+5); ctx.moveTo(left+5,top-5); ctx.lineTo(left-5,top+5); ctx.stroke(); ctx.restore(); }
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
    }catch{}
  }

  async function removeDocument(){
    if (!hasDoc) return
    if (!window.confirm('Удалить весь документ?')) return
    pages.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
    setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
    // удаляем черновик на сервере
    try { if (localStorage.getItem('access')) await AuthAPI.clearDraft() } catch {}
    // пометить все загрузки по client_id как удалённые — теперь client_id восстанавливается из черновика
    try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
    setDocId(null)
    toast('Документ удалён','success')
  }
  function removePage(idx=cur){
    if (!hasDoc) return
    if (pages.length<=1){ removeDocument(); return }
    if (!window.confirm('Удалить текущую страницу?')) return
    const target = pages[idx]; try{ target.canvas?.dispose?.() }catch{}
    setPages(prev=>prev.filter((_,i)=>i!==idx))
    setCur(i=>Math.max(0, idx-1))
    setUndoStack(stk=>stk.filter(x=>!(x.page===idx)))
    // дожидаемся применения setState перед сериализацией
    setTimeout(()=>scheduleSaveDraft(400), 0)
    toast('Страница удалена','success')
  }

  async function applyToAllPages(){
    if(!hasDoc) return
    const srcPage=pages[cur], cvSrc=await ensureCanvas(srcPage), obj=cvSrc.getActiveObject()
    if(!obj){ toast('Выберите объект на странице','error'); return }
    const clones=[]
    for(let i=0;i<pages.length;i++){
      if(i===cur) continue
      const dstPage=pages[i], cvDst=await ensureCanvas(dstPage)
      // eslint-disable-next-line no-undef
      const F=fabric
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
        })
        tb.__scannyId=uniqueObjId()
        ensureDeleteControlFor(tb)
        cvDst.add(tb); cvDst.requestRenderAll(); clones.push({page:i,id:tb.__scannyId})
      }else if(obj.type==='image'){
        const src=(obj._originalElement?.src||obj._element?.src)
        const imgEl=await loadImageEl(src)
        const im=new F.Image(imgEl,{
          angle:obj.angle||0,
          selectable:true,
          flipX: !!obj.flipX,
          flipY: !!obj.flipY,
        })
        const dispW=obj.getScaledWidth(), dispH=obj.getScaledHeight()
        const targetW=dispW*cvDst.getWidth()/cvSrc.getWidth(), targetH=dispH*cvDst.getHeight()/cvSrc.getHeight()
        const baseW=(im.width||1), baseH=(im.height||1)
        const sUni = Math.min(targetW/baseW, targetH/baseH)
        im.set({
          left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(),
          top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(),
          scaleX:sUni, scaleY:sUni
        })
        im.__scannyId=uniqueObjId()
        ensureDeleteControlFor(im)
        cvDst.add(im); cvDst.requestRenderAll(); clones.push({page:i,id:im.__scannyId})
      }
    }
    if(clones.length){ setUndoStack(stk=>[...stk,{type:'apply_all',clones}]); scheduleSaveDraft(400); toast('Объект продублирован на все страницы','success') }
  }

  function pickDocument(){ docFileRef.current?.click() }
  function pickBgForCurrent(){ bgFileRef.current?.click() }
  async function onPickDocument(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await handleFiles(files) }
  async function onPickBgFile(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await assignFirstFileToCurrent(files[0]) }

  async function handleFiles(files){
    setLoading(true)
    try{
      // гарантируем наличие client_id
      let curDocId = docIdRef.current
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId) }

      let addedPages = 0
      let initialName = fileNameRef.current

      for(const f of files){
        const ext=(f.name.split('.').pop()||'').toLowerCase()
        if(!initialName){ const base=f.name.replace(/\.[^.]+$/,''); initialName = sanitizeName(base); setFileName(initialName) }

        if(['jpg','jpeg','png'].includes(ext)){
          const url=await readAsDataURL(f)
          const img = await loadImageEl(url)
          await createPageFromImage(url, img.naturalWidth||img.width, img.naturalHeight||img.height, f.type || (url.startsWith('data:image/png')?'image/png':'image/jpeg'), false)
          addedPages += 1
        }else if(ext==='pdf'){
          const ab = await f.arrayBuffer()
          const bytes = toUint8Copy(ab)
          addedPages += await addPagesFromPDFBytes(bytes)
        }else if(['docx','doc'].includes(ext)){
          const canv=await renderDOCXToCanvas(f)
          addedPages += await addRasterPagesFromCanvas(canv)
        }else if(['xls','xlsx'].includes(ext)){
          const canv=await renderXLSXToCanvas(f)
          addedPages += await addRasterPagesFromCanvas(canv)
        }else{
          toast(`Формат не поддерживается: ${ext}`,'error')
        }
      }

      scheduleSaveDraft(400)
      // записываем «загрузку» в историю
      try{
        if (isAuthed && addedPages>0) {
          const nm = sanitizeName(initialName || fileNameRef.current || genDefaultName())
          await AuthAPI.recordUpload(curDocId, nm, addedPages)
        }
      }catch{}

      toast('Страницы добавлены','success')
    }catch(err){ console.error(err); toast(err.message||'Ошибка загрузки файлов','error') }
    finally{ setLoading(false) }
  }

  function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file) }) }
  function loadImageEl(src){ return new Promise((res,rej)=>{ const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>res(img); img.onerror=rej; img.src=src }) }

  // Создание страницы с фоном из изображения (учёт ориентации)
  async function createPageFromImage(dataUrl, w, h, mime='image/png', landscape=false){
    const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
    const page={ id, elId, canvas:null, bgObj:null, landscape:!!landscape, meta:{ type:'image', src:dataUrl, w:Math.max(1,w||PAGE_W), h:Math.max(1,h||PAGE_H), mime } }
    setPages(prev=>{ const arr=[...prev,page]; setCur(arr.length-1); return arr })
    await new Promise(r=>requestAnimationFrame(r))
    const cv=await ensureCanvas(page)
    await ensureFabric()
    const imgEl=await loadImageEl(dataUrl)
    // eslint-disable-next-line no-undef
    const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
    placeBgObject(cv,page,img)
    scheduleSaveDraft(400)
    return page
  }

  async function addPageFromImage(dataUrl, w, h, mime='image/png'){
    await createPageFromImage(dataUrl, w, h, mime, false)
    return 1
  }
  async function addRasterPagesFromCanvas(canvas){
    const slices = sliceCanvasToPages(canvas)
    let count = 0
    for (const url of slices) {
      const im = await loadImageEl(url)
      await createPageFromImage(url, im.naturalWidth||im.width, im.naturalHeight||im.height, 'image/png', false)
      count += 1
    }
    return count
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
        page.meta = { type:'raster', src: slices[0]||canv.toDataURL('image/png'), w: PAGE_W, h: PAGE_H }
      }else if(['xls','xlsx'].includes(ext)){
        const canv=await renderXLSXToCanvas(file)
        const slices=sliceCanvasToPages(canv)
        await setPageBackgroundFromImage(cur, slices[0]||canv.toDataURL('image/png'))
        page.meta = { type:'raster', src: slices[0]||canv.toDataURL('image/png'), w: PAGE_W, h: PAGE_H }
      }else toast('Этот формат не поддерживается','error')
      scheduleSaveDraft(400)
    }catch(e){ toast(e.message||'Не удалось назначить страницу','error') }
    finally{ setLoading(false) }
  }

  async function setPageBackgroundFromImage(idx, dataUrl){
    const page=pages[idx]; if(!page) return
    const cv=await ensureCanvas(page)
    await ensureFabric()
    const imgEl=await loadImageEl(dataUrl)
    // eslint-disable-next-line no-undef
    const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
    placeBgObject(cv,page,img)
    page.meta = page.meta?.type==='image'
      ? { ...page.meta, src:dataUrl, w:imgEl.naturalWidth||imgEl.width, h:imgEl.naturalHeight||imgEl.height }
      : { type:'image', src:dataUrl, w:imgEl.naturalWidth||imgEl.width, h:imgEl.naturalHeight||imgEl.height, mime: dataUrl.startsWith('data:image/jpeg')?'image/jpeg':'image/png' }
  }

  // ===== PDF: превью — копия bytes.slice(), экспорт — оригинальные bytes =====
  async function addPagesFromPDFBytes(bytes){
    await ensurePDFJS()
    // eslint-disable-next-line no-undef
    const pdf=await pdfjsLib.getDocument({data: bytes.slice()}).promise
    const total = pdf.numPages
    for(let i=1;i<=pdf.numPages;i++){
      const url=await renderPDFPageToDataURL(pdf,i,2.0)
      const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
      const page={ id, elId, canvas:null, bgObj:null, landscape:false, meta:{ type:'pdf', bytes: toUint8Copy(bytes), index:i-1 } }
      setPages(prev=>{ const arr=[...prev,page]; setCur(arr.length-1); return arr })
      await new Promise(r=>requestAnimationFrame(r))
      const cv=await ensureCanvas(page)
      await ensureFabric()
      const imgEl=await loadImageEl(url)
      // eslint-disable-next-line no-undef
      const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
      placeBgObject(cv,page,img)
      scheduleSaveDraft(400)
    }
    return total
  }
  async function setPageBackgroundFromFirstPDFPage(idx, bytes){
    await ensurePDFJS()
    // eslint-disable-next-line no-undef
    const pdf=await pdfjsLib.getDocument({data: bytes.slice()}).promise
    const url=await renderPDFPageToDataURL(pdf,1,2.0)
    await setPageBackgroundFromImage(idx,url)
    const page = pages[idx]
    if (page) page.meta = { type:'pdf', bytes: toUint8Copy(bytes), index: 0 }
  }
  async function renderPDFPageToDataURL(pdf,pageNum,scale){
    const p=await pdf.getPage(pageNum), vp=p.getViewport({scale})
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d')
    canvas.width=Math.round(vp.width); canvas.height=Math.round(vp.height)
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height)
    await p.render({canvasContext:ctx,viewport:vp}).promise
    return canvas.toDataURL('image/png')
  }

  async function renderDOCXToCanvas(file){
    await ensureMammothCDN(); await ensureHtml2Canvas()
    const ab=await file.arrayBuffer()
    const res=await window.mammoth.convertToHtml({ arrayBuffer: ab })
    const holder=document.createElement('div')
    Object.assign(holder.style,{position:'fixed',left:'-9999px',top:'-9999px',width:'1100px',padding:'24px',background:'#fff'})
    holder.innerHTML=res.value||'<div/>'
    document.body.appendChild(holder)
    const canvas=await window.html2canvas(holder,{backgroundColor:'#fff',scale:2})
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
    const canvas=await window.html2canvas(holder,{backgroundColor:'#fff',scale:2})
    document.body.removeChild(holder)
    return canvas
  }
  function sliceCanvasToPages(canvas){
    const out=[], totalH=canvas.height, pagePx=3508
    for(let y=0;y<totalH;y+=pagePx){
      const sliceH=Math.min(pagePx,totalH-y)
      const tmp=document.createElement('canvas'); const tctx=tmp.getContext('2d')
      tmp.width=canvas.width; tmp.height=sliceH
      tctx.drawImage(canvas,0,y,canvas.width,sliceH,0,0,tmp.width,tmp.height)
      out.push(tmp.toDataURL('image/png'))
    }
    return out
  }

  // ===== Улучшение качества подписи/печати в PDF/JPG =====
  function getOverlayObjects(cv, page){
    const all = cv.getObjects() || []
    return all.filter(o => o !== page.bgObj)
  }
  function hasRotation(objs){
    return objs.some(o => Math.abs(o.angle||0) > 0.01)
  }
  function computeMultiplierForOverlay(cv, page, targetW, targetH){
    let mulX = Math.max(1, targetW / Math.max(1, cv.getWidth()))
    let mulY = Math.max(1, targetH / Math.max(1, cv.getHeight()))
    let mul = Math.ceil(Math.max(mulX, mulY))
    const objs = getOverlayObjects(cv, page)
    for(const obj of objs){
      if(obj.type==='image'){
        const dispW = obj.getScaledWidth()
        const natW = obj._element?.naturalWidth || obj._element?.width || dispW
        const dispWOnTarget = (dispW / Math.max(1, cv.getWidth())) * targetW
        const need = Math.ceil(Math.max(1, dispWOnTarget / Math.max(1, natW)))
        if(need > mul) mul = need
      }
    }
    mul = Math.min(8, Math.max(2, mul))
    if(objs.some(o => o.type==='textbox')) mul = Math.min(8, Math.max(mul, 4))
    return mul
  }

  function pickSignature(){ signFileRef.current?.click() }
  async function onPickSignature(e){
    const f=e.target.files?.[0]; e.target.value=''
    if(!f) return
    const src=await readAsDataURL(f)
    setCropSrc(src); setCropOpen(true); setCropType('signature'); setCropThresh(40)
  }
  useEffect(()=>{ if(!cropOpen) return; (async()=>{ await ensureCropper(); if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } const img=cropImgRef.current; if(!img) return; /* eslint-disable no-undef */ const inst=new Cropper(img,{viewMode:1,dragMode:'move',guides:true,background:false,autoCrop:true}); /* eslint-enable */ cropperRef.current=inst })(); return ()=>{ if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } } },[cropOpen])
  useEffect(()=>{ if(!cropOpen||!cropperRef.current||!cropSrc) return; (async()=>{ const thr=Math.round(255*(cropThresh/100)); const url=await removeWhiteBackground(cropSrc,thr); try{ cropperRef.current.replace(url,true) }catch{} })() },[cropThresh,cropOpen,cropSrc])

  async function cropConfirm(){
    try{
      const cr=cropperRef.current; if(!cr) return
      const c=cr.getCroppedCanvas({ imageSmoothingEnabled:true, imageSmoothingQuality:'high' })
      let dataUrl = c.toDataURL('image/png')
      const thr = Math.round(255 * (cropThresh / 100))
      dataUrl = await removeWhiteBackground(dataUrl, thr)

      if (hasDoc && isMobile) {
        const page = pages[cur]
        const cv = await ensureCanvas(page)
        const imgEl = await loadImageEl(dataUrl)
        // eslint-disable-next-line no-undef
        const img = new fabric.Image(imgEl)
        const w = cv.getWidth(), h = cv.getHeight()
        const s = Math.min(1, (w * 0.35) / (img.width || 1))
        img.set({ left: Math.round(w * 0.15), top: Math.round(h * 0.15), scaleX: s, scaleY: s, selectable: true })
        img.__scannyId = uniqueObjId(); ensureDeleteControlFor(img)
        cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
        setUndoStack(stk => [...stk, { type: 'add_one', page: cur, id: img.__scannyId }])
        scheduleSaveDraft(400)
      } else {
        await AuthAPI.addSign({ kind: cropType, data_url: dataUrl })
        loadLibrary()
      }
      setCropOpen(false)
    } catch (e) {
      toast(e.message || 'Не удалось обработать изображение', 'error')
    }
  }
  async function removeWhiteBackground(src,threshold=245){
    const img=await loadImageEl(src); const w=img.naturalWidth||img.width; const h=img.naturalHeight||img.height
    const c=document.createElement('canvas'), ctx=c.getContext('2d'); c.width=w; c.height=h
    ctx.drawImage(img,0,0); const data=ctx.getImageData(0,0,w,h); const d=data.data
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2]
      if(r>threshold&&g>threshold&&b>threshold) d[i+3]=0
      else { const avg=(r+g+b)/3; if(avg>220) d[i+3]=Math.max(0,d[i+3]-120) }
    }
    ctx.putImageData(data,0,0); return c.toDataURL('image/png')
  }

  function startDragSign(url,e){ try{ e.dataTransfer.setData('application/x-sign-url',url); e.dataTransfer.effectAllowed='copy' }catch{} }
  function placeFromLib(url){
    if(!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    const page=pages[cur]; ensureCanvas(page).then(cv=>{
      loadImageEl(url).then(imgEl=>{
        // eslint-disable-next-line no-undef
        const img=new fabric.Image(imgEl)
        const w=cv.getWidth(),h=cv.getHeight()
        const s=Math.min(1,(w*0.35)/(img.width||1))
        img.set({left:Math.round(w*0.15),top:Math.round(h*0.15),scaleX:s,scaleY:s,selectable:true})
        img.__scannyId=uniqueObjId(); ensureDeleteControlFor(img)
        cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
        setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:img.__scannyId}])
        scheduleSaveDraft(400)
      })
    })
  }
  async function removeFromLib(item){
    if (!window.confirm('Удалить элемент из библиотеки?')) return
    try{
      if (item.is_default && item.gid) {
        await AuthAPI.hideDefaultSign(item.gid)
      } else {
        await AuthAPI.deleteSign(item.id)
      }
      await loadLibrary()
      toast('Удалено','success')
    } catch (e){
      toast(e.message || 'Не удалось удалить','error')
    }
  }

  async function addText(){
    if(!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    await ensureFabric()
    const page=pages[cur]; const cv=await ensureCanvas(page)
    // eslint-disable-next-line no-undef
    const tb=new fabric.Textbox('Вставьте текст',{
      left:Math.round(cv.getWidth()*0.1),
      top:Math.round(cv.getHeight()*0.15),
      fontSize:48, fill:'#000000',
      fontFamily:'Arial', fontWeight:'bold',
      width: Math.round(cv.getWidth()*0.6),
      textAlign: 'left',
    })
    tb.__scannyId=uniqueObjId()
    ensureDeleteControlFor(tb)
    cv.add(tb); cv.setActiveObject(tb); cv.requestRenderAll(); setPanelOpen(true)
    setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:tb.__scannyId}])
    scheduleSaveDraft(400)
  }
  async function applyPanel(){
    const page=pages[cur]; const cv=page?.canvas; if(!cv) return; const obj=cv.getActiveObject(); if(!obj||obj.type!=='textbox') return;
    obj.set({ fontFamily:font, fontSize:fontSize, fontWeight:bold?'bold':'normal', fontStyle:italic?'italic':'normal', fill:color })
    cv.requestRenderAll()
    scheduleSaveDraft(400)
  }
  useEffect(()=>{ if(panelOpen) applyPanel() },[font,fontSize,bold,italic,color])

  async function rotatePage(){
    if(!hasDoc) return
    const page=pages[cur]; await ensureCanvas(page)
    page.landscape = !page.landscape
    fitCanvasForPage(page)
    adjustBgObject(page)
    scheduleSaveDraft(400)
  }

  function undo(){
    const stk=[...undoStack], last=stk.pop(); if(!last) return
    if(last.type==='add_one'){ const p=pages[last.page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===last.id); if(obj){ cv.remove(obj); cv.discardActiveObject(); cv.requestRenderAll() } } }
    else if(last.type==='apply_all'){ last.clones.forEach(({page,id})=>{ const p=pages[page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===id); if(obj){ cv.remove(obj) } cv.requestRenderAll() } }) }
    setUndoStack(stk)
    scheduleSaveDraft(400)
  }

  function baseName(){ const nm=(fileNameRef.current||'').trim(); if(!nm){ toast('Введите название файла вверху','error'); return null } return sanitizeName(nm) }
  function freeLeft(){ return billing?.free_left ?? 0 }

  // Получаем стабильный src (data:) для overlay-изображений (если было blob:)
  async function ensureSerializableSrcForImage(obj){
    const src = (obj._originalElement?.src || obj._element?.src || '')
    if (src && !src.startsWith('blob:')) return src
    try{
      const imgEl = obj._originalElement || obj._element
      const w = imgEl?.naturalWidth || imgEl?.width || obj.width || 1
      const h = imgEl?.naturalHeight || imgEl?.height || obj.height || 1
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(imgEl, 0, 0, w, h)
      return c.toDataURL('image/png')
    }catch{
      return src || ''
    }
  }

  // ----- Сериализация/восстановление черновика c client_id и объектами -----
  async function serializeDocument(){
    const pagesLocal = pagesRef.current || []
    const outPages = []
    for (let i=0; i<pagesLocal.length; i++){
      const p = pagesLocal[i]
      const cv = await ensureCanvas(p)
      const meta = p.meta || {}
      const rawObjs = (cv.getObjects()||[]).filter(o=>o!==p.bgObj)
      const overlays = []
      for (const o of rawObjs){
        if (o.type === 'textbox') {
          overlays.push({
            t:'tb',
            text:o.text||'',
            left:o.left||0,
            top:o.top||0,
            angle:o.angle||0,
            fontFamily:o.fontFamily||'Arial',
            fontSize:o.fontSize||42,
            fontStyle:o.fontStyle||'normal',
            fontWeight:o.fontWeight||'normal',
            fill:o.fill||'#000',
            width: Math.round(o.width || 200),
            textAlign: o.textAlign || 'left',
            scaleX: o.scaleX || 1,
            scaleY: o.scaleY || 1,
          })
        } else if (o.type === 'image') {
          const src = await ensureSerializableSrcForImage(o)
          overlays.push({
            t:'im',
            src,
            left:o.left||0,
            top:o.top||0,
            scaleX:o.scaleX||1,
            scaleY:o.scaleY||1,
            angle:o.angle||0,
            flipX: !!o.flipX,
            flipY: !!o.flipY,
          })
        }
      }

      if (meta.type === 'pdf' && meta.bytes) {
        outPages.push({ type:'pdf', index: meta.index||0, bytes_b64: u8ToB64(meta.bytes), landscape: !!p.landscape, overlays })
      } else if (meta.type === 'image' || meta.type === 'raster') {
        outPages.push({ type: meta.type, src: meta.src, w: meta.w, h: meta.h, mime: meta.mime||'image/png', landscape: !!p.landscape, overlays })
      } else {
        const url = cv.toDataURL({ format:'png', multiplier: 2 })
        outPages.push({ type:'raster', src:url, w:cv.getWidth()*2, h:cv.getHeight()*2, mime:'image/png', landscape: !!p.landscape, overlays })
      }
    }
    return { client_id: docIdRef.current || null, name: fileNameRef.current || genDefaultName(), pages: outPages }
  }

  async function restoreDocumentFromDraft(draft){
    try{
      const pagesData = Array.isArray(draft?.pages) ? draft.pages : []
      const created = []
      // Предварительно готовим объекты страниц и фоновые URL
      const bgUrls = []
      for (let i=0;i<pagesData.length;i++){
        const pg = pagesData[i]
        const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
        if (pg.type==='pdf' && pg.bytes_b64){
          await ensurePDFJS()
          const bytes = b64ToU8(pg.bytes_b64)
          // eslint-disable-next-line no-undef
          const pdf = await pdfjsLib.getDocument({data: bytes.slice()}).promise
          const url = await renderPDFPageToDataURL(pdf, (pg.index||0)+1, 2.0)
          bgUrls[i] = url
          created.push({ id, elId, canvas:null, bgObj:null, landscape:!!pg.landscape, meta:{ type:'pdf', bytes: toUint8Copy(bytes), index: pg.index||0 } })
        } else if (pg.type==='image' || pg.type==='raster'){
          bgUrls[i] = pg.src
          created.push({ id, elId, canvas:null, bgObj:null, landscape:!!pg.landscape, meta:{ type: pg.type, src: pg.src, w: pg.w||PAGE_W, h: pg.h||PAGE_H, mime: pg.mime||'image/png' } })
        }
      }
      // Сразу устанавливаем список страниц одним сетом состояния
      setPages(created)
      setCur(created.length ? 0 : 0)
      setFileName((draft?.name||'').trim() || genDefaultName())
      setDocId(draft?.client_id || null)

      // Ждём рендер, затем развешиваем фон и оверлеи
      await new Promise(r=>requestAnimationFrame(r))
      await ensureFabric()

      for (let i=0;i<created.length;i++){
        const page = created[i]
        const cv = await ensureCanvas(page)
        const url = bgUrls[i]
        if (url){
          const imgEl = await loadImageEl(url)
          // eslint-disable-next-line no-undef
          const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
          placeBgObject(cv, page, img)
        }
      }

      // Восстанавливаем объекты
      for (let i=0;i<created.length;i++){
        const page = created[i]
        const cv = await ensureCanvas(page)
        const pg = pagesData[i] || {}
        const overlays = Array.isArray(pg.overlays) ? pg.overlays : []
        for (const o of overlays){
          if (o.t === 'tb'){
            // eslint-disable-next-line no-undef
            const tb=new fabric.Textbox(o.text||'',{
              left:o.left||0, top:o.top||0, angle:o.angle||0,
              fontFamily:o.fontFamily||'Arial', fontSize:o.fontSize||42,
              fontStyle:o.fontStyle||'normal', fontWeight:o.fontWeight||'normal',
              fill:o.fill||'#000',
              width: Math.max(20, Number(o.width||200)),
              textAlign: o.textAlign || 'left',
              scaleX: Number(o.scaleX||1),
              scaleY: Number(o.scaleY||1),
            })
            tb.__scannyId=uniqueObjId(); ensureDeleteControlFor(tb); cv.add(tb)
          } else if (o.t === 'im' && o.src){
            const imgEl = await loadImageEl(o.src)
            // eslint-disable-next-line no-undef
            const im = new fabric.Image(imgEl,{
              left:o.left||0, top:o.top||0, angle:o.angle||0,
              flipX: !!o.flipX, flipY: !!o.flipY,
              scaleX: Number(o.scaleX||1), scaleY: Number(o.scaleY||1),
            })
            im.__scannyId=uniqueObjId(); ensureDeleteControlFor(im); cv.add(im)
          }
        }
        cv.requestRenderAll()
      }
    }catch(e){
      console.error('restoreDocumentFromDraft error:', e)
    }
  }

  // src/pages/Editor.jsx (продолжение файла)

// ----- Экспорт оверлея как PNG с повышенной чёткостью -----
async function exportOverlayAsPNGBytes(page, cv, targetW, targetH){
  if (!cv) return null
  const objs = cv.getObjects() || []
  const hasOverlay = objs.some(o => o !== page.bgObj)
  if (!hasOverlay) return null
  const wasBGVisible = !!page.bgObj?.visible
  const prevBGColor = cv.backgroundColor
  try{
    if (page.bgObj) page.bgObj.visible = false
    cv.setBackgroundColor('rgba(0,0,0,0)', cv.requestRenderAll.bind(cv))
    cv.discardActiveObject(); cv.requestRenderAll()
    const mul = computeMultiplierForOverlay(cv, page, targetW, targetH)
    const url = cv.toDataURL({ format:'png', multiplier: mul })
    const r = await fetch(url); const ab = await r.arrayBuffer()
    return new Uint8Array(ab)
  } finally {
    if (page.bgObj) page.bgObj.visible = wasBGVisible
    cv.setBackgroundColor(prevBGColor || '#fff', cv.requestRenderAll.bind(cv))
    cv.requestRenderAll()
  }
}

async function exportJPG(){
  try{
    if(!hasDoc) return
    const bn=baseName(); if(!bn) return
    const count=pages.length
    if(freeLeft()<count){ setPlan('single'); setPayOpen(true); return }
    await ensureJSZip()
    // eslint-disable-next-line no-undef
    const zip=new JSZip()
    for(let i=0;i<pages.length;i++){
      const p=pages[i], cv=await ensureCanvas(p)
      let mult = 3
      if (p.bgObj && p.meta && (p.meta.type==='image' || p.meta.type==='raster')) {
        const s = Math.max(1e-6, p.bgObj.scaleX || p.bgObj.scaleY || 1)
        mult = Math.max(mult, Math.min(6, Math.ceil(1 / s)))
      } else if (p.meta?.type === 'pdf') {
        mult = Math.max(mult, 4)
      }
      const url=cv.toDataURL({format:'jpeg',quality:0.95, multiplier: mult})
      const res=await fetch(url), blob=await res.blob()
      zip.file(`${bn}-p${i+1}.jpg`,blob)
    }
    const out=await zip.generateAsync({type:'blob'})
    const a=document.createElement('a'); const href=URL.createObjectURL(out); a.href=href; a.download=`${bn}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),1500)
    try{ AuthAPI.recordDownload('jpg', pages.length, bn, 'free').catch(()=>{}) }catch{}
    toast(`Скачано страниц: ${count}`,'info')
  }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить JPG','error') }
}

async function exportPDF(){
  try{
    if(!hasDoc) return
    const bn=baseName(); if(!bn) return
    const count=pages.length
    if(freeLeft()<count){ setPlan('single'); setPayOpen(true); return }
    const PDFLib = await ensurePDFLib()
    const out = await PDFLib.PDFDocument.create()
    for (let i=0;i<pages.length;i++){
      const p = pages[i]; const cv = await ensureCanvas(p)
      if (p.meta?.type === 'pdf') {
        const srcDoc = await PDFLib.PDFDocument.load(p.meta.bytes)
        const [copied] = await out.copyPages(srcDoc, [p.meta.index])
        const pageRef = out.addPage(copied)
        const { width, height } = pageRef.getSize()
        const overlayBytes = await exportOverlayAsPNGBytes(p, cv, Math.round(width), Math.round(height))
        if (overlayBytes) {
          const png = await out.embedPng(overlayBytes)
          pageRef.drawImage(png, { x:0, y:0, width, height })
        }
      } else if (p.meta?.type === 'image' || p.meta?.type === 'raster') {
        const iw = Math.max(1, p.meta.w || PAGE_W), ih = Math.max(1, p.meta.h || PAGE_H)
        const pageRef = out.addPage([iw, ih])
        const bytes = new Uint8Array(await (await fetch(p.meta.src)).arrayBuffer())
        let img
        try{
          img = p.meta.mime && /jpe?g/i.test(p.meta.mime)
            ? await out.embedJpg(bytes)
            : await out.embedPng(bytes)
        }catch{
          img = await out.embedPng(bytes)
        }
        pageRef.drawImage(img, { x:0, y:0, width:iw, height:ih })
        const overlayBytes = await exportOverlayAsPNGBytes(p, cv, iw, ih)
        if (overlayBytes) {
          const png = await out.embedPng(overlayBytes)
          pageRef.drawImage(png, { x:0, y:0, width:iw, height:ih })
        }
      } else {
        const w = cv.getWidth(), h = cv.getHeight()
        const mul = 3
        const url = cv.toDataURL({ format:'png', multiplier: mul })
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
        const pageRef = out.addPage([w*mul, h*mul])
        const png = await out.embedPng(bytes)
        pageRef.drawImage(png, { x:0, y:0, width:w*mul, height:h*mul })
      }
    }
    const pdfBytes = await out.save()
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const a=document.createElement('a'); const href=URL.createObjectURL(blob); a.href=href; a.download=`${bn}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),1500)
    try{ AuthAPI.recordDownload('pdf', pages.length, bn, 'free').catch(()=>{}) }catch{}
    toast(`Скачано страниц: ${count}`,'info')
  }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить PDF','error') }
}

function onCanvasDrop(e){
  e.preventDefault(); const dt=e.dataTransfer; if(!dt) return
  const types=Array.from(dt.types||[])
  if(types.includes('application/x-sign-url')){ const url=dt.getData('application/x-sign-url'); if(url&&url!=='add') placeFromLib(url); return }
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

// Сохраняем черновик при переименовании (если есть документ)
useEffect(()=>{ if(hasDoc) scheduleSaveDraft(600) },[fileName, hasDoc])

// Поддержка удаления по клавише Delete/Backspace (кроме ввода в поля/textarea)
useEffect(()=>{
  const onKey=(e)=>{
    const tag = String(e.target?.tagName || '').toLowerCase()
    const isTyping = tag==='input' || tag==='textarea' || e.target?.isContentEditable
    if(isTyping) return
    if((e.key==='Delete' || e.key==='Backspace') && pages[cur]?.canvas){
      const cv = pages[cur].canvas
      const obj = cv.getActiveObject()
      if(obj){
        e.preventDefault()
        cv.remove(obj); cv.discardActiveObject(); cv.requestRenderAll()
        scheduleSaveDraft(300)
        toast('Объект удалён','success')
      }
    }
  }
  document.addEventListener('keydown', onKey)
  return ()=>document.removeEventListener('keydown', onKey)
},[pages, cur])

// UI
const hasActive = hasDoc && !!(pages[cur]?.canvas?.getActiveObject())

return (
  <div className="doc-editor page">
    <div className="ed-top" style={{display: isMobile && hasDoc ? undefined : 'none'}}>
      <button className="ed-menu-btn" aria-label="Ещё" onClick={()=>setMenuMoreOpen(o=>!o)}><img src={icMore} alt=""/></button>
      <div className="ed-docid" style={{flex:1,padding:'0 8px'}}><input className="ed-filename" placeholder="Название файла при скачивании" value={fileName} onChange={e=>setFileName(sanitizeName(e.target.value))}/></div>
      <div className="ed-top-right"></div>
      {menuMoreOpen && (
        <div className="ed-menu" ref={moreRef}>
          <button onClick={rotatePage}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу</button>
          <button className={pages.length>1?'':'disabled'} onClick={()=>removePage()}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить страницу</button>
          <button className={hasActive?'':'disabled'} onClick={()=>{ if(hasActive) applyToAllPages() }}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы</button>
          <button className={hasDoc?'':'disabled'} onClick={removeDocument}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ</button>
        </div>
      )}
    </div>

    {panelOpen && (
      <div className="ed-toolbar">
        <select value={font} onChange={e=>setFont(e.target.value)}>{FONTS.map(f=><option key={f} value={f}>{f}</option>)}</select>
        <div className="sep"/><button onClick={()=>setFontSize(s=>Math.max(6,s-2))}>−</button><span className="val">{fontSize}</span><button onClick={()=>setFontSize(s=>Math.min(300,s+2))}>+</button>
        <div className="sep"/><input type="color" value={color} onChange={e=>setColor(e.target.value)} title="Цвет текста"/>
        <button className={bold?'toggled':''} onClick={()=>setBold(b=>!b)}><b>B</b></button>
        <button className={italic?'toggled':''} onClick={()=>setItalic(i=>!i)}><i>I</i></button>
      </div>
    )}

    <div className="ed-body">
      <aside className="ed-left">
        <div className="ed-tools">
          <button className={`ed-tool ${hasDoc?'':'disabled'}`} onClick={addText}><img className="ico" src={icText} alt=""/><span>Добавить текст</span></button>
          <button className="ed-tool" onClick={pickSignature}><img className="ico" src={icSign} alt=""/><span>Загрузить подпись</span></button>
        </div>
        <div className="ed-sign-list">
          <div className="thumb add" draggable onDragStart={(e)=>startDragSign('add',e)} onClick={pickSignature}><img src={icPlus} alt="+" style={{width:22,height:22,opacity:.6}}/></div>
          {libLoading && <div style={{gridColumn:'1 / -1',opacity:.7,padding:8}}>Загрузка…</div>}
          {signLib.map(item=>(
            <div key={item.id} className="thumb" draggable onDragStart={(e)=>startDragSign(item.url,e)}>
              <img src={item.url} alt="" onClick={()=>placeFromLib(item.url)} style={{width:'100%',height:'100%',objectFit:'contain',cursor:'pointer'}}/>
              <button className="thumb-x" onClick={()=>removeFromLib(item)}>×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="ed-center">
        <div className="ed-namebar desktop-only">
          <input className="ed-filename" placeholder="Название файла при скачивании" value={fileName} onChange={e=>setFileName(sanitizeName(e.target.value))}/>
        </div>

        <div className="ed-canvas-wrap" ref={canvasWrapRef} onDragOver={(e)=>e.preventDefault()} onDrop={onCanvasDrop}>
          {pages.map((p,idx)=>(
            <div key={p.id} className={`ed-canvas ${idx===cur?'active':''}`}>
              <button className="ed-page-x desktop-only" title="Удалить эту страницу" onClick={()=>removePage(idx)}>×</button>
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
          {loading && <div className="ed-canvas-loading"><div className="spinner" aria-hidden="true"></div>Загрузка…</div>}
        </div>

        <div className="ed-pages desktop-only">
          {pages.map((p,i)=>(<div key={p.id} className={`ed-page-btn ${i===cur?'active':''}`} onClick={()=>setCur(i)}>{i+1}</div>))}
          <button className="ed-page-add" onClick={pickDocument}><img src={icPlus} alt="+"/></button>
        </div>

        {isMobile && (
          <div className="ed-bottom mobile-only">
            {/* ЛЕВАЯ FAB — теперь иконка добавления документа (doc-add) */}
            <button className={`fab ${hasDoc?'':'disabled'}`} onClick={()=>{ if(!hasDoc){ return } setMenuAddOpen(o=>!o) }} title="Добавить">
              <img src={icDocAdd} alt="Добавить" />
            </button>

            <div className="ed-pager">
              <button onClick={()=>setCur(i=>Math.max(0, i-1))} disabled={!canPrev} title="Предыдущая">
                <img src={icPrev} alt="Prev" />
              </button>
              <span className="pg">{hasDoc ? `${cur+1}/${pages.length}` : '0/0'}</span>
              <button onClick={()=>{ if(canNext) setCur(i=>Math.min(pages.length-1, i+1)); else pickDocument() }} title={canNext ? 'Следующая' : 'Добавить документ'}>
                {canNext
                  ? <img src={icPrev} alt="Next" style={{ transform:'rotate(180deg)' }} />
                  : <img src={icPlus} alt="+" />
                }
              </button>
            </div>

            <button className={`fab ${(!hasDoc)?'disabled':''}`} onClick={()=>{ if(!hasDoc) return; setMenuDownloadOpen(o=>!o) }} title="Скачать">
              <img src={icDownload} alt="↓" />
            </button>
          </div>
        )}
      </section>

      <aside className="ed-right">
        <div className="ed-actions">
          <button className={`ed-action ${hasDoc?'':''}`} onClick={removeDocument}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ</button>
          <button className={`ed-action ${canUndo?'':'disabled'}`} onClick={undo}><img src={icUndo} alt="" style={{width:18,height:18,marginRight:8}}/>Отменить</button>
          <button className={`ed-action ${hasDoc?'':'disabled'}`} onClick={rotatePage}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу</button>
          <button className={`ed-action ${hasDoc && !!(pages[cur]?.canvas?.getActiveObject()) ? '' : 'disabled'}`} onClick={applyToAllPages}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы</button>
        </div>

        <div className="ed-download">
          <div className="ed-dl-title">Скачать бесплатно:</div>
          <div className="ed-dl-row">
            <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={exportJPG}><img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:8}}/>JPG</button>
            <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={exportPDF}><img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:8}}/>PDF</button>
          </div>
          <div className="ed-dl-title" style={{marginTop:10}}>Купить:</div>
          <div className="ed-dl-row ed-dl-row-paid">
            <button className={`btn ${(!hasDoc)?'disabled':''}`} onClick={()=>{ if(hasDoc){ setPlan('single'); setPayOpen(true) } }}><img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:8}}/>JPG</button>
            <button className={`btn ${(!hasDoc)?'disabled':''}`} onClick={()=>{ if(hasDoc){ setPlan('single'); setPayOpen(true) } }}><img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:8}}/>PDF</button>
          </div>
        </div>
      </aside>
    </div>

    {menuAddOpen && (
      <div className="ed-sheet" ref={sheetRef}>
        <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuAddOpen(false); addText() } }}><img src={icText} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить текст</button>
        <button onClick={()=>{ setMenuAddOpen(false); pickSignature() }}><img src={icSign} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить подпись/печать</button>
        <button onClick={()=>{ setMenuAddOpen(false); pickDocument() }}><img src={icDocAdd} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить документ/страницу</button>
      </div>
    )}

    {menuDownloadOpen && (
      <div className="ed-sheet" ref={dlRef}>
        <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}><img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить JPG</button>
        <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}><img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить PDF</button>
        <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportJPG() } }}><img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно JPG</button>
        <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportPDF() } }}><img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно PDF</button>
      </div>
    )}

    {(menuAddOpen || menuDownloadOpen || menuMoreOpen) && <div className="ed-dim" onClick={()=>{ setMenuAddOpen(false); setMenuDownloadOpen(false); setMenuMoreOpen(false) }}/>}
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
          <div className="crop-area"><img ref={cropImgRef} src={cropSrc} alt="" style={{maxWidth:'100%',maxHeight:'46vh'}}/></div>
          <div className="crop-controls">
            <h4>2. Настройте прозрачность фона:</h4>
            <div className="thr-row">
              <input type="range" min="0" max="100" value={cropThresh} onChange={e=>setCropThresh(Number(e.target.value))}/>
              <input type="number" min="0" max="100" value={cropThresh} onChange={e=>{ const v=Math.max(0,Math.min(100,Number(e.target.value)||0)); setCropThresh(v) }}/>
              <span>%</span>
            </div>
            <button className="btn" onClick={cropConfirm}><span className="label">Готово</span></button>
          </div>
        </div>
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
            <div className="promo">
              <label className="field-label">Промокод</label>
              <div className="promo-row">
                <input value={promo} onChange={e=>{ setPromo(e.target.value); setPromoError('') }} placeholder="Введите промокод"/>
                {promo && <button className="promo-clear" onClick={()=>{ setPromo(''); setPromoError(''); setPromoPercent(0) }}>×</button>}
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

    <input ref={docFileRef} type="file" accept={ACCEPT_DOC} hidden multiple onChange={onPickDocument}/>
    <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={onPickBgFile}/>
    <input ref={signFileRef} type="file" accept=".png,.jpg,.jpeg" hidden onChange={onPickSignature}/>
  </div>
)
}
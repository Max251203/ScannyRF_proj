// src/pages/Editor.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric, ensurePDFJS, ensureHtml2Canvas, ensureMammothCDN,
  ensureSheetJS, ensureJsPDF, ensureCropper, ensureJSZip, ensureScripts
} from '../utils/scriptLoader'
import { EditorWS } from '../utils/wsClient'

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
import icMenu from '../assets/icons/kebab.png'

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

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function ensurePDFLib(){
  if (window.PDFLib) return window.PDFLib
  await ensureScripts(['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'])
  if (!window.PDFLib) throw new Error('Не удалось загрузить pdf-lib')
  return window.PDFLib
}

function toUint8Copy(input){
  if (input instanceof Uint8Array){
    const out = new Uint8Array(input.length);
    out.set(input);
    return out
  }
  if (input instanceof ArrayBuffer){
    const view = new Uint8Array(input);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out
  }
  return new Uint8Array()
}

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

  const [menuActionsOpen, setMenuActionsOpen] = useState(false)
  const [menuAddOpen, setMenuAddOpen] = useState(false)
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

  const pagesRef = useRef(pages)
  const docIdRef = useRef(docId)
  const fileNameRef = useRef(fileName)
  useEffect(()=>{ pagesRef.current = pages }, [pages])
  useEffect(()=>{ docIdRef.current = docId }, [docId])
  useEffect(()=>{ fileNameRef.current = fileName }, [fileName])

  const wsRef = useRef(null)
  const draftCacheRef = useRef(null);

  const serializeDocument = useCallback(async () => {
    if(!pagesRef.current || pagesRef.current.length === 0) return null;
    const pagesLocal = pagesRef.current
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
            t:'tb', text:o.text||'', left:o.left||0, top:o.top||0, angle:o.angle||0,
            fontFamily:o.fontFamily||'Arial', fontSize:o.fontSize||42, fontStyle:o.fontStyle||'normal', fontWeight:o.fontWeight||'normal',
            fill:o.fill||'#000', width: Math.round(o.width || 200), textAlign: o.textAlign || 'left',
            scaleX: o.scaleX || 1, scaleY: o.scaleY || 1,
          })
        } else if (o.type === 'image') {
          const src = await ensureSerializableSrcForImage(o)
          overlays.push({
            t:'im', src, left:o.left||0, top:o.top||0, scaleX:o.scaleX||1, scaleY:o.scaleY||1,
            angle:o.angle||0, flipX: !!o.flipX, flipY: !!o.flipY,
          })
        }
      }

      const pageData = {
        type: meta.type || 'raster',
        landscape: !!p.landscape,
        overlays,
        world_w: p.worldW,
        world_h: p.worldH,
      };

      if (meta.type === 'pdf' && meta.bytes) {
        pageData.index = meta.index || 0;
        pageData.bytes_b64 = u8ToB64(meta.bytes);
      } else if (meta.type === 'image' || meta.type === 'raster') {
        pageData.src = meta.src;
        pageData.w = meta.w;
        pageData.h = meta.h;
        pageData.mime = meta.mime || 'image/png';
      } else {
        pageData.src = cv.toDataURL({ format:'png', multiplier: 2 });
        pageData.w = cv.getWidth() * 2;
        pageData.h = cv.getHeight() * 2;
        pageData.mime = 'image/png';
      }
      outPages.push(pageData);
    }
    return { client_id: docIdRef.current || null, name: fileNameRef.current || genDefaultName(), pages: outPages }
  }, []);

  const commitWithFetch = useCallback(async () => {
    const data = draftCacheRef.current;
    if (!data) return;
    try {
      await AuthAPI.saveDraft(data);
    } catch (e) {
      console.warn('[commitWithFetch] failed', e);
    }
  }, []);

  const debouncedCommit = useMemo(() => debounce(commitWithFetch, 2000), [commitWithFetch]);

  const markDirty = useCallback(async (kind = 'change') => {
    try {
      const s = await serializeDocument();
      if (s) {
        draftCacheRef.current = s;
        ensureWS();
        wsRef.current?.sendEvent(kind);
        debouncedCommit();
      }
    } catch (e) {
      console.warn('markDirty failed', e);
    }
  }, [debouncedCommit, serializeDocument]);
  
  useEffect(() => {
    const commitOnUnload = (e) => {
      const data = draftCacheRef.current;
      if (data) {
        // navigator.sendBeacon не может быть асинхронным, поэтому мы не можем сериализовать здесь.
        // Мы используем данные из кэша, который обновляется при каждом markDirty.
        AuthAPI.saveDraftBeacon(data);
      }
    };
    window.addEventListener('beforeunload', commitOnUnload);
    return () => window.removeEventListener('beforeunload', commitOnUnload);
  }, []);

  function getAccessToken() { return localStorage.getItem('access') || '' }
  function ensureWS() {
    if (!isAuthed || !docIdRef.current) return
    const token = getAccessToken()
    const apiBase = AuthAPI.getApiBase()
    if (!wsRef.current) {
      wsRef.current = new EditorWS({ clientId: docIdRef.current, token, apiBase })
    } else {
      wsRef.current.setClientId(docIdRef.current)
      wsRef.current.setToken(token)
    }
  }

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
        ensureWS()
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
      const t = getAccessToken();
      if (wsRef.current) wsRef.current.setToken(t);
    }
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    window.addEventListener('storage', onStorage)
    return ()=>{ window.removeEventListener('user:update', onUser); window.removeEventListener('billing:update', onBill); window.removeEventListener('storage', onStorage) }
  },[])

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

  useEffect(()=>{
    document.body.classList.add('no-footer')
    document.documentElement.classList.add('no-footer')
    return () => {
      document.body.classList.remove('no-footer')
      document.documentElement.classList.remove('no-footer')
    }
  }, [])

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

  useEffect(()=>{
    if(!canvasWrapRef.current) return
    const ro=new ResizeObserver(()=>{ pages.forEach((_,i)=>fitCanvas(i)) })
    ro.observe(canvasWrapRef.current)
    return ()=>ro.disconnect()
  },[pages])
  useEffect(()=>{ if(pages[cur]?.canvas){ requestAnimationFrame(()=>fitCanvas(cur)) } },[cur,pages.length,isMobile])

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
      }catch(e){ console.error('restore draft failed',e) }
      finally{ setLoading(false) }
    })()
  },[hasDoc])

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

  function fitCanvasForPage(page){
    if(!page || !page.canvas) return
    const cv = page.canvas
    const wrap = canvasWrapRef.current
    if(!wrap) return
    const box = wrap.getBoundingClientRect()
    if(!box || box.width<10 || box.height<10){ requestAnimationFrame(()=>fitCanvasForPage(page)); return }

    const marginX = 8, marginY = 8
    const availW = Math.max(50, box.width - marginX*2)
    const availH = Math.max(50, box.height - marginY*2)

    const worldW = Math.max(1, page.worldW)
    const worldH = Math.max(1, page.worldH)

    const s = Math.min(availW/worldW, availH/worldH)
    const cssW = Math.max(1, Math.round(worldW * s))
    const cssH = Math.max(1, Math.round(worldH * s))

    const lower = cv.lowerCanvasEl, upper = cv.upperCanvasEl
    const cont  = lower?.parentElement, edCanvasEl = cont?.parentElement

    if (lower) { lower.style.width = cssW+'px'; lower.style.height = cssH+'px'; lower.style.maxWidth='none'; lower.style.maxHeight='none' }
    if (upper) { upper.style.width = cssW+'px'; upper.style.height = cssH+'px'; upper.style.maxWidth='none'; upper.style.maxHeight='none' }
    if (cont)  { cont.style.width  = cssW+'px'; cont.style.height  = cssH+'px' }
    if (edCanvasEl) { edCanvasEl.style.width = cssW+'px'; edCanvasEl.style.height = cssH+'px' }
  }
  function fitCanvas(idx){ const p=pages[idx]; if(!p||!p.canvas) return; fitCanvasForPage(p) }

  async function ensureCanvas(page){
    await ensureFabric()
    if(page.canvas) return page.canvas
    await waitForElm(page.elId)
    const c=new fabric.Canvas(page.elId,{ backgroundColor:'#fff', preserveObjectStacking:true, selection:true })
    c.setWidth(page.worldW); c.setHeight(page.worldH)
    page.canvas = c
    fitCanvasForPage(page)

    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', ()=>setPanelOpen(false))

    c.on('object:moving',  () => markDirty('obj_moving'))
    c.on('object:scaling', () => markDirty('obj_scaling'))
    c.on('object:rotating',() => markDirty('obj_rotating'))
    c.on('object:added',   () => markDirty('obj_added'))
    c.on('object:removed', () => markDirty('obj_removed'))
    c.on('object:modified',() => markDirty('obj_modified'))
    try{
      c.on('text:changed', () => markDirty('text_changed'))
    }catch{}

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

  function installDeleteControl(){
    const fobj=fabric.Object; if(fobj.__delPatched) return
    const F=fabric
    const del=new F.Control({
      x:0.5,y:-0.5,offsetX:12,offsetY:-12,cursorStyle:'pointer',
      mouseUpHandler:(_,tr)=>{
        const t=tr.target,cv=t.canvas
        if (window.confirm('Удалить объект со страницы?')) {
          cv.remove(t); cv.discardActiveObject(); cv.requestRenderAll()
          toast('Объект удалён','success')
          markDirty('obj_deleted')
        }
        return true
      },
      render:(ctx,left,top)=>{ const r=12; ctx.save(); ctx.fillStyle='#E26D5C'; ctx.beginPath(); ctx.arc(left,top,r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(left-5,top-5); ctx.lineTo(left+5,top+5); ctx.moveTo(left+5,top-5); ctx.lineTo(left-5,top+5); ctx.stroke(); ctx.restore(); }
    })
    fobj.prototype.controls.tr=del
    window.__scannyDelControl = del
    fobj.__delPatched=true
  }
  function ensureDeleteControlFor(obj){
    try{
      if (obj && obj.controls && window.__scannyDelControl) obj.controls.tr = window.__scannyDelControl
    }catch{}
  }

  async function removeDocument(){
    if (!hasDoc) return
    if (!window.confirm('Удалить весь документ?')) return
    pages.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
    setPages([]); setCur(0); setPanelOpen(false); setFileName(''); setUndoStack([])
    draftCacheRef.current = null;
    try { if (docIdRef.current) await AuthAPI.deleteUploadsByClient(docIdRef.current) } catch {}
    try { await AuthAPI.clearDraft() } catch(e) { console.error("Failed to clear draft", e)}
    setDocId(null)
    toast('Документ удалён','success')
  }

  async function removePage(idx=cur){
    if (!hasDoc) return
    if (pages.length<=1){ await removeDocument(); return }
    if (!window.confirm('Удалить текущую страницу?')) return
    const target = pages[idx]; try{ target.canvas?.dispose?.() }catch{}
    setPages(prev=>prev.filter((_,i)=>i!==idx))
    setCur(i=>Math.max(0, idx-1))
    setUndoStack(stk=>stk.filter(x=>!(x.page===idx)))
    markDirty('remove_page')
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
      const F=fabric
      if(obj.type==='textbox'){
        const tb=new F.Textbox(obj.text||'',{
          left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(), top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(),
          fontFamily:obj.fontFamily||'Arial', fontStyle:obj.fontStyle||'normal', fontWeight:obj.fontWeight||'normal',
          fill:obj.fill||'#000', fontSize:Math.max(6,(obj.fontSize||42)*cvDst.getHeight()/cvSrc.getHeight()),
          angle:obj.angle||0, selectable:true, width: Math.max(20, (obj.width||200)*cvDst.getWidth()/cvSrc.getWidth()),
          textAlign: obj.textAlign || 'left', scaleX: obj.scaleX || 1, scaleY: obj.scaleY || 1,
        })
        tb.__scannyId=uniqueObjId(); ensureDeleteControlFor(tb)
        cvDst.add(tb); cvDst.requestRenderAll(); clones.push({page:i,id:tb.__scannyId})
      }else if(obj.type==='image'){
        const src=(obj._originalElement?.src||obj._element?.src)
        const imgEl=await loadImageEl(src)
        const im=new F.Image(imgEl,{ angle:obj.angle||0, selectable:true, flipX: !!obj.flipX, flipY: !!obj.flipY })
        const dispW=obj.getScaledWidth(), dispH=obj.getScaledHeight()
        const targetW=dispW*cvDst.getWidth()/cvSrc.getWidth(), targetH=dispH*cvDst.getHeight()/cvSrc.getHeight()
        const baseW=(im.width||1), baseH=(im.height||1)
        const sUni = Math.min(targetW/baseW, targetH/baseH)
        im.set({
          left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(), top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(),
          scaleX:sUni, scaleY:sUni
        })
        im.__scannyId=uniqueObjId(); ensureDeleteControlFor(im)
        cvDst.add(im); cvDst.requestRenderAll(); clones.push({page:i,id:im.__scannyId})
      }
    }
    if(clones.length){
      setUndoStack(stk=>[...stk,{type:'apply_all',clones}])
      markDirty('apply_all')
      toast('Объект продублирован на все страницы','success')
    }
  }

  function pickDocument(){ docFileRef.current?.click() }
  async function onPickDocument(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await handleFiles(files) }
  async function onPickBgFile(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await assignFirstFileToCurrent(files[0]) }
  
  async function handleFiles(files){
    setLoading(true)
    try{
      let curDocId = docIdRef.current;
      if (!curDocId) { curDocId = randDocId(); setDocId(curDocId); }
      ensureWS()

      let addedPages = 0
      let initialName = fileNameRef.current

      for(const f of files){
        const ext=(f.name.split('.').pop()||'').toLowerCase()
        if(!initialName){ const base=f.name.replace(/\.[^.]+$/,''); initialName = sanitizeName(base); setFileName(initialName) }

        if(['jpg','jpeg','png'].includes(ext)){
          const url=await readAsDataURL(f); const img = await loadImageEl(url)
          await createPageFromImage(url, img.naturalWidth||img.width, img.naturalHeight||img.height, f.type || (url.startsWith('data:image/png')?'image/png':'image/jpeg'), false)
          addedPages += 1
        }else if(ext==='pdf'){
          const ab = await f.arrayBuffer(); const bytes = toUint8Copy(ab)
          addedPages += await addPagesFromPDFBytes(bytes)
        }else if(['docx','doc'].includes(ext)){
          const canv=await renderDOCXToCanvas(f); addedPages += await addRasterPagesFromCanvas(canv)
        }else if(['xls','xlsx'].includes(ext)){
          const canv=await renderXLSXToCanvas(f); addedPages += await addRasterPagesFromCanvas(canv)
        }else{
          toast(`Формат не поддерживается: ${ext}`,'error')
        }
      }

      if (addedPages>0) markDirty('add_files');

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

  async function createPageFromImage(dataUrl, w, h, mime='image/png', landscape=false){
    const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
    const worldW = landscape ? Math.max(h, PAGE_H) : Math.max(w, PAGE_W);
    const worldH = landscape ? Math.max(w, PAGE_W) : Math.max(h, PAGE_H);
    const page={ id, elId, canvas:null, bgObj:null, landscape:!!landscape, worldW, worldH,
      meta:{ type:'image', src:dataUrl, w:w, h:h, mime } }
    setPages(prev=>{ const arr=[...prev,page]; setCur(arr.length-1); return arr })
    await new Promise(r=>requestAnimationFrame(r))
    const cv=await ensureCanvas(page)
    await ensureFabric()
    const imgEl=await loadImageEl(dataUrl)
    const img=new fabric.Image(imgEl,{ selectable:false, evented:false, left:0, top:0 })
    const iw = imgEl.naturalWidth||imgEl.width||1
    const ih = imgEl.naturalHeight||imgEl.height||1
    const s = Math.min(cv.getWidth()/iw, cv.getHeight()/ih)
    img.set({ scaleX:s, scaleY:s })
    try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
    page.bgObj=img; cv.add(img); img.moveTo(0); cv.requestRenderAll()
    fitCanvasForPage(page)
    return page
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

  async function addPagesFromPDFBytes(bytes){
    await ensurePDFJS()
    const pdf=await pdfjsLib.getDocument({data: bytes.slice()}).promise
    const total = pdf.numPages
    for(let i=1;i<=pdf.numPages;i++){
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 2.0 });
      const url = await renderPDFPageToDataURL(pdf,i,2.0);
      const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
      
      const landscape = vp.width > vp.height;
      const worldW = vp.width;
      const worldH = vp.height;
      
      const page={ id, elId, canvas:null, bgObj:null, landscape, worldW, worldH,
        meta:{ type:'pdf', bytes: toUint8Copy(bytes), index:i-1 } }
      setPages(prev=>{ const arr=[...prev,page]; setCur(arr.length-1); return arr })
      await new Promise(r=>requestAnimationFrame(r))
      const cv=await ensureCanvas(page)
      await ensureFabric()
      const im = await loadImageEl(url);
      const img=new fabric.Image(im,{ selectable:false, evented:false, left:0, top:0 })
      const iw = im.naturalWidth||im.width||1
      const ih = im.naturalHeight||im.height||1
      const s = Math.min(cv.getWidth()/iw, cv.getHeight()/ih)
      img.set({ scaleX:s, scaleY:s })
      try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
      page.bgObj=img; cv.add(img); img.moveTo(0); cv.requestRenderAll()
      fitCanvasForPage(page)
    }
    return total
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

  function getOverlayObjects(cv, page){
    const all = cv.getObjects() || []
    return all.filter(o => o !== page.bgObj)
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

  useEffect(()=>{ if(!cropOpen) return; (async()=>{ await ensureCropper(); if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } const img=cropImgRef.current; if(!img) return; const inst=new Cropper(img,{viewMode:1,dragMode:'move',guides:true,background:false,autoCrop:true}); cropperRef.current=inst })(); return ()=>{ if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } } },[cropOpen])
  useEffect(()=>{ if(!cropOpen||!cropperRef.current||!cropSrc) return; (async()=>{ const thr=Math.round(255*(cropThresh/100)); const url=await removeWhiteBackground(cropSrc,thr); try{ cropperRef.current.replace(url,true) }catch{} })() },[cropThresh,cropOpen,cropSrc])

  async function cropConfirm(){
    try{
      const cr=cropperRef.current; if(!cr) return
      const c=cr.getCroppedCanvas({ imageSmoothingEnabled:true, imageSmoothingQuality:'high' })
      let dataUrl = c.toDataURL('image/png')
      const thr = Math.round(255 * (cropThresh / 100))
      dataUrl = await removeWhiteBackground(dataUrl, thr)

      if (hasDoc) {
        const page = pages[cur]
        const cv = await ensureCanvas(page)
        const imgEl = await loadImageEl(dataUrl)
        const img = new fabric.Image(imgEl)
        const w = cv.getWidth(), h = cv.getHeight()
        const s = Math.min(1, (w * 0.35) / (img.width || 1))
        img.set({ left: Math.round(w * 0.15), top: Math.round(h * 0.15), scaleX: s, scaleY: s, selectable: true })
        img.__scannyId = uniqueObjId(); ensureDeleteControlFor(img)
        cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
        setUndoStack(stk => [...stk, { type: 'add_one', page: cur, id: img.__scannyId }])
        markDirty('add_signature_on_canvas')
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
    const page=pages[cur]; ensureCanvas(page).then(async (cv)=>{
      const imgEl=await loadImageEl(url)
      const img=new fabric.Image(imgEl)
      const w=cv.getWidth(),h=cv.getHeight()
      const s=Math.min(1,(w*0.35)/(img.width||1))
      img.set({left:Math.round(w*0.15),top:Math.round(h*0.15),scaleX:s,scaleY:s,selectable:true})
      img.__scannyId=uniqueObjId(); ensureDeleteControlFor(img)
      cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
      setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:img.__scannyId}])
      markDirty('place_from_library')
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
      markDirty('remove_from_library')
      toast('Удалено','success')
    } catch (e){
      toast(e.message || 'Не удалось удалить','error')
    }
  }

  async function addText(){
    if(!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    await ensureFabric()
    const page=pages[cur]; const cv=await ensureCanvas(page)
    const tb=new fabric.Textbox('Вставьте текст',{
      left:Math.round(cv.getWidth()*0.1), top:Math.round(cv.getHeight()*0.15),
      fontSize:48, fill:'#000000', fontFamily:'Arial', fontWeight:'bold',
      width: Math.round(cv.getWidth()*0.6), textAlign: 'left',
    })
    tb.__scannyId=uniqueObjId()
    ensureDeleteControlFor(tb)
    cv.add(tb); cv.setActiveObject(tb); cv.requestRenderAll(); setPanelOpen(true)
    setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:tb.__scannyId}])
    markDirty('add_textbox')
  }

  async function applyPanel(){
    const page=pages[cur]; const cv=page?.canvas; if(!cv) return; const obj=cv.getActiveObject(); if(!obj||obj.type!=='textbox') return;
    obj.set({ fontFamily:font, fontSize:fontSize, fontWeight:bold?'bold':'normal', fontStyle:italic?'italic':'normal', fill:color })
    cv.requestRenderAll()
    markDirty('textbox_style')
  }
  useEffect(()=>{ if(panelOpen) applyPanel() },[font,fontSize,bold,italic,color, panelOpen, applyPanel])

  async function rotatePage(){
    if(!hasDoc) return
    const page = pages[cur]; await ensureCanvas(page)
    
    page.landscape = !page.landscape;
    [page.worldW, page.worldH] = [page.worldH, page.worldW];

    page.canvas.setWidth(page.worldW);
    page.canvas.setHeight(page.worldH);
    
    const bg = page.bgObj
    if (bg) {
      const el = bg._originalElement || bg._element
      const iw = el?.naturalWidth || el?.width || 1
      const ih = el?.naturalHeight || el?.height || 1
      const s = Math.min(page.worldW / iw, page.worldH / ih)
      bg.set({ left: 0, top: 0, scaleX: s, scaleY: s, angle: 0 });
      page.canvas.centerObject(bg);
      page.canvas.requestRenderAll();
    }
    
    fitCanvasForPage(page)
    markDirty('rotate_page')
  }

  function undo(){
    const stk=[...undoStack], last=stk.pop(); if(!last) return
    if(last.type==='add_one'){ const p=pages[last.page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===last.id); if(obj){ cv.remove(obj); cv.discardActiveObject(); cv.requestRenderAll() } } }
    else if(last.type==='apply_all'){ last.clones.forEach(({page,id})=>{ const p=pages[page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===id); if(obj){ cv.remove(obj) } cv.requestRenderAll() } }) }
    setUndoStack(stk)
    markDirty('undo')
  }

  function baseName(){ const nm=(fileNameRef.current||'').trim(); if(!nm){ toast('Введите название файла вверху','error'); return null } return sanitizeName(nm) }
  function freeLeft(){ return billing?.free_left ?? 0 }

  async function ensureSerializableSrcForImage(obj){
    const src = (obj._originalElement?.src || obj._element?.src || '')
    if (src && !src.startsWith('blob:')) return src
    try{
      const imgEl = obj._originalElement || obj._element
      const w = imgEl?.naturalWidth || imgEl?.width || obj.width || 1
      const h = imgEl?.naturalHeight || imgEl?.height || obj.height || 1
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); ctx.drawImage(imgEl, 0, 0, w, h)
      return c.toDataURL('image/png')
    }catch{ return src || '' }
  }

  async function restoreDocumentFromDraft(draft){
    try{
      const pagesData = Array.isArray(draft?.pages) ? draft.pages : []
      if (pagesData.length === 0) return;
      
      const created = []
      const bgUrls = []
      for (let i=0;i<pagesData.length;i++){
        const pg = pagesData[i]
        const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
        let worldW = pg.world_w || pg.w || PAGE_W;
        let worldH = pg.world_h || pg.h || PAGE_H;
        
        if (pg.type==='pdf' && pg.bytes_b64){
          await ensurePDFJS()
          const bytes = b64ToU8(pg.bytes_b64)
          const pdf = await pdfjsLib.getDocument({data: bytes.slice()}).promise
          const url = await renderPDFPageToDataURL(pdf, (pg.index||0)+1, 2.0)
          bgUrls[i] = url
          created.push({ id, elId, canvas:null, bgObj:null, landscape:!!pg.landscape, worldW, worldH,
            meta:{ type:'pdf', bytes: toUint8Copy(bytes), index: pg.index||0 } })
        } else if (pg.type==='image' || pg.type==='raster'){
          const url = pg.src
          bgUrls[i] = url
          created.push({ id, elId, canvas:null, bgObj:null, landscape:!!pg.landscape, worldW, worldH,
            meta:{ type: pg.type, src: pg.src, w: pg.w||worldW, h: pg.h||worldH, mime: pg.mime||'image/png' } })
        }
      }
      setPages(created)
      setCur(created.length ? 0 : 0)
      setFileName((draft?.name||'').trim() || genDefaultName())
      setDocId(draft?.client_id || null)
      ensureWS()

      await new Promise(r=>requestAnimationFrame(r))
      await ensureFabric()

      for (let i=0;i<created.length;i++){
        const page = created[i]
        const cv = await ensureCanvas(page)
        const url = bgUrls[i]
        if (url){
          const imgEl = await loadImageEl(url)
          const img=new fabric.Image(imgEl,{ selectable:false, evented:false, left:0, top:0 })
          const iw = imgEl.naturalWidth||imgEl.width||1
          const ih = imgEl.naturalHeight||imgEl.height||1
          const s = Math.min(cv.getWidth()/iw, cv.getHeight()/ih)
          img.set({ scaleX:s, scaleY:s })
          try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
          page.bgObj=img; cv.add(img); img.moveTo(0); cv.requestRenderAll()
        }
      }

      for (let i=0;i<created.length;i++){
        const page = created[i]
        const cv = await ensureCanvas(page)
        const pg = pagesData[i] || {}
        const overlays = Array.isArray(pg.overlays) ? pg.overlays : []
        for (const o of overlays){
          if (o.t === 'tb'){
            const tb=new fabric.Textbox(o.text||'',{
              left:o.left||0, top:o.top||0, angle:o.angle||0, fontFamily:o.fontFamily||'Arial', fontSize:o.fontSize||42,
              fontStyle:o.fontStyle||'normal', fontWeight:o.fontWeight||'normal', fill:o.fill||'#000',
              width: Math.max(20, Number(o.width||200)), textAlign: o.textAlign || 'left',
              scaleX: Number(o.scaleX||1), scaleY: Number(o.scaleY||1),
            })
            tb.__scannyId=uniqueObjId(); ensureDeleteControlFor(tb); cv.add(tb)
          } else if (o.t === 'im' && o.src){
            const imgEl = await loadImageEl(o.src)
            const im = new fabric.Image(imgEl,{
              left:o.left||0, top:o.top||0, angle:o.angle||0, flipX: !!o.flipX, flipY: !!o.flipY,
              scaleX: Number(o.scaleX||1), scaleY: Number(o.scaleY||1),
            })
            im.__scannyId=uniqueObjId(); ensureDeleteControlFor(im); cv.add(im)
          }
        }
        cv.requestRenderAll()
      }
      markDirty('restore');
    }catch(e){
      console.error('restoreDocumentFromDraft error:', e)
    }
  }

  async function exportJPG(){
    try{
      if(!hasDoc) return
      const bn=baseName(); if(!bn) return
      const count=pages.length
      if(freeLeft()<count){ setPlan('single'); setPayOpen(true); return }
      await ensureJSZip()
      const zip=new JSZip()
      for(let i=0;i<pages.length;i++){
        const p=pages[i], cv=await ensureCanvas(p)
        const targetW = Math.max(1, p.worldW || cv.getWidth())
        const targetH = Math.max(1, p.worldH || cv.getHeight())
        const off = document.createElement('canvas'); off.width = targetW; off.height = targetH
        const octx = off.getContext('2d'); octx.fillStyle = '#fff'; octx.fillRect(0,0,off.width,off.height)

        if (p.meta?.type === 'pdf' && p.meta.bytes) {
          await ensurePDFJS()
          const pdf = await pdfjsLib.getDocument({ data: p.meta.bytes.slice() }).promise
          const pj = await pdf.getPage((p.meta.index||0)+1)
          const vp = pj.getViewport({ scale: 1 })
          const scale = Math.min(off.width / vp.width, off.height / vp.height)
          const cv2 = document.createElement('canvas'); cv2.width = Math.round(vp.width * scale); cv2.height = Math.round(vp.height * scale)
          await pj.render({ canvasContext: cv2.getContext('2d'), viewport: pj.getViewport({ scale }) }).promise
          const dx = Math.round((off.width - cv2.width)/2); const dy = Math.round((off.height - cv2.height)/2)
          octx.drawImage(cv2, dx, dy)
        } else if (p.meta?.type === 'image' || p.meta?.type === 'raster') {
          const img = await loadImageEl(p.meta.src)
          const iw = img.naturalWidth||img.width||1; const ih = img.naturalHeight||img.height||1
          const s = Math.min(off.width/iw, off.height/ih)
          const dw = Math.round(iw*s), dh = Math.round(ih*s)
          const dx = Math.round((off.width - dw)/2); const dy = Math.round((off.height - dh)/2)
          octx.drawImage(img, dx, dy, dw, dh)
        } else {
          const url = cv.toDataURL({ format:'png', multiplier: 3 })
          const img = await loadImageEl(url)
          octx.drawImage(img, 0, 0, off.width, off.height)
        }

        const overlayBytes = await exportOverlayAsPNGBytes(p, cv, off.width, off.height)
        if (overlayBytes) {
          const blob = new Blob([overlayBytes], { type:'image/png' })
          const src = URL.createObjectURL(blob)
          const img = await loadImageEl(src)
          octx.drawImage(img, 0, 0, off.width, off.height)
          URL.revokeObjectURL(src)
        }
        const blob = await new Promise(res => off.toBlob(b => res(b), 'image/jpeg', 0.95))
        zip.file(`${bn}-p${i+1}.jpg`, blob)
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
          out.addPage(copied)
          const pageRef = out.getPages()[out.getPageCount()-1]
          const { width, height } = pageRef.getSize()
          const overlayBytes = await exportOverlayAsPNGBytes(p, cv, Math.round(width), Math.round(height))
          if (overlayBytes) {
            const png = await out.embedPng(overlayBytes)
            pageRef.drawImage(png, { x:0, y:0, width, height })
          }
        } else if (p.meta?.type === 'image' || p.meta?.type === 'raster') {
          const iw = Math.max(1, p.worldW), ih = Math.max(1, p.worldH)
          const pageRef = out.addPage([iw, ih])
          const bytes = new Uint8Array(await (await fetch(p.meta.src)).arrayBuffer())
          let img;
          try{ img = p.meta.mime && /jpe?g/i.test(p.meta.mime) ? await out.embedJpg(bytes) : await out.embedPng(bytes) }catch{ img = await out.embedPng(bytes) }
          pageRef.drawImage(img, { x:0, y:0, width:iw, height:ih })
          const overlayBytes = await exportOverlayAsPNGBytes(p, cv, iw, ih)
          if (overlayBytes) {
            const png = await out.embedPng(overlayBytes)
            pageRef.drawImage(png, { x:0, y:0, width:iw, height:ih })
          }
        } else {
          const w = cv.getWidth(), h = cv.getHeight()
          const mul = 3; const url = cv.toDataURL({ format:'png', multiplier: mul })
          const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
          const pageRef = out.addPage([w*mul, h*mul]); const png = await out.embedPng(bytes)
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

  const onRenameChange = (e) => { setFileName(sanitizeName(e.target.value)); markDirty('rename') }
  const onRenameBlur = () => { if(hasDoc) markDirty('rename_blur').catch(()=>{}) }

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
          markDirty('delete_by_key')
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return ()=>document.removeEventListener('keydown', onKey)
  },[pages, cur, markDirty])

  return (
    <div className="doc-editor page" style={{ paddingTop: 0 }}>
      {!panelOpen ? (
        <div className="ed-top">
          <button className="ed-menu-btn mobile-only" aria-label="Меню действий" onClick={()=>setMenuActionsOpen(o=>!o)}>
            <img src={icMenu} alt="" style={{ width: 18, height: 18 }} />
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
          <div className="ed-canvas-wrap" ref={canvasWrapRef} onDragOver={(e)=>e.preventDefault()} onDrop={onCanvasDrop}>
            {pages.map((p,idx)=>(
              <div key={p.id} className={`ed-canvas ${idx===cur?'active':''}`}>
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
          
          <div className="ed-bottom desktop-only">
            <DesktopPager pages={pages} current={cur} onSelect={setCur} onAdd={pickDocument} />
          </div>

          <div className="ed-bottom mobile-only">
            <button className={`fab fab-add ${hasDoc?'':'disabled'}`} onClick={()=>{ if(hasDoc){ setMenuAddOpen(o=>!o) } }} title="Добавить">
              <img src={icPlus} alt="+" />
            </button>
            <div className="ed-pager">
              <button onClick={()=>setCur(i=>Math.max(0, i-1))} disabled={!canPrev} title="Предыдущая"><img src={icPrev} alt="Prev" /></button>
              <span className="pg">{hasDoc ? `${cur+1}/${pages.length}` : '0/0'}</span>
              <button onClick={()=>{ if(canNext) setCur(i=>Math.min(pages.length-1, i+1)); else pickDocument() }} title={canNext ? 'Следующая' : 'Добавить документ'}>
                {canNext ? <img src={icPrev} alt="Next" style={{ transform:'rotate(180deg)' }} /> : <img src={icPlus} alt="+" />}
              </button>
            </div>
            <button className={`fab fab-dl ${!hasDoc?'disabled':''}`} onClick={()=>{ if(!hasDoc) return; setMenuDownloadOpen(o=>!o) }} title="Скачать">
              <img src={icDownload} alt="↓" />
            </button>
          </div>
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

      {menuActionsOpen && (
        <div className="ed-sheet top-left" ref={sheetActionsRef}>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); rotatePage() }}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:10}}/>Повернуть страницу</button>
          <button className={(hasDoc && pages.length>1)?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); removePage() }}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:10}}/>Удалить страницу</button>
          <button className={(hasDoc && !!(pages[cur]?.canvas?.getActiveObject()))?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); applyToAllPages() }}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:10}}/>На все страницы</button>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ setMenuActionsOpen(false); removeDocument() }}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:10}}/>Удалить документ</button>
        </div>
      )}
      {menuAddOpen && (
        <div className="ed-sheet bottom-left" ref={sheetAddRef}>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ setMenuAddOpen(false); addText() }}><img src={icText} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить текст</button>
          <button onClick={()=>{ setMenuAddOpen(false); pickSignature() }}><img src={icSign} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить подпись/печать</button>
          <button onClick={()=>{ setMenuAddOpen(false); pickDocument() }}><img src={icPlus} alt="" style={{width:18,height:18,marginRight:10}}/>Добавить документ/страницу</button>
        </div>
      )}
      {menuDownloadOpen && (
        <div className="ed-sheet bottom-right" ref={sheetDownloadRef} style={{ padding: 6 }}>
          <button className={`btn ${hasDoc?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icJpgPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить JPG
          </button>
          <button className={`btn ${hasDoc?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); setPlan('single'); setPayOpen(true) } }}>
            <img src={icPdfPaid} alt="" style={{width:18,height:18,marginRight:10}}/>Купить PDF
          </button>
          <button className={`btn btn-lite ${hasDoc?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportJPG() } }}>
            <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно JPG
          </button>
          <button className={`btn btn-lite ${hasDoc?'':'disabled'}`} style={{padding:'10px 14px'}} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportPDF() } }}>
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
              <div className="pay-buttons"><button className="btn btn-lite" onClick={applyPromo}><span className="label">Активировать</span></button><button className="btn" onClick={startPurchase}><span className="label">Оплатить {price} ₽</span></button></div>
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

function DesktopPager({ pages, current, onSelect, onAdd }) {
  const total = pages.length;

  if (total === 0) {
    return <div className="ed-pages" />;
  }

  const items = [];
  if (total <= 5) {
    for (let i = 0; i < total; i++) {
      items.push(i);
    }
  } else {
    items.push(0, 1);
    if (current > 2 && current < total - 3) {
      items.push('...');
      items.push(current);
      items.push('...');
    } else if (current <= 2) {
      items.push(2, '...');
    } else { 
      items.push('...');
    }
    items.push(total - 2, total - 1);
  }
  
  const finalItems = [...new Set(items)].filter((v, i, arr) => !(v === '...' && arr[i-1] === '...'));

  return (
    <div className="ed-pages">
      {finalItems.map((item, index) =>
        item === '...' ? (
          <span key={`dot-${index}`} className="ed-page-dots">...</span>
        ) : (
          <button
            key={item}
            className={`ed-page-btn ${current === item ? 'active' : ''}`}
            onClick={() => onSelect(item)}
          >
            {item + 1}
          </button>
        )
      )}
      <button className="ed-page-add" onClick={onAdd} title="Добавить документ">
        <img src={icPlus} alt="+" />
      </button>
    </div>
  );
}
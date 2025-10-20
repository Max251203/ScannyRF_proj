import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import {
  ensureFabric, ensurePDFJS, ensureHtml2Canvas, ensureMammothCDN,
  ensureSheetJS, ensureJsPDF, ensureCropper, ensureJSZip
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

import plan1 from '../assets/images/один документ.png'
import plan2 from '../assets/images/безлимит.png'
import plan3 from '../assets/images/безлимит про.png'

function randDocId(){ return String(Math.floor(1e15 + Math.random()*9e15)) }
function genDefaultName(){ const a = Math.floor(Math.random()*1e6), b = Math.floor(Math.random()*1e6); return `${a}-${b}` }
function sanitizeName(s){ s=(s||'').normalize('NFKC'); s=s.replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/-+/g,'-').replace(/^[-_.]+|[-_.]+$/g,''); return s.slice(0,64)||genDefaultName() }

const ACCEPT_DOC = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx'
const FONTS = ['Arial','Times New Roman','Ermilov','Segoe UI','Roboto','Georgia']

export default function Editor(){
  const [docId, setDocId] = useState(null)
  const [fileName, setFileName] = useState('')
  // page: {id, elId, canvas, bgObj, baseW, baseH}
  const [pages, setPages] = useState([])
  const [cur, setCur] = useState(0)
  const [loading, setLoading] = useState(false)

  const hasDoc = pages.length>0
  const canPrev = hasDoc && cur>0
  const canNext = hasDoc && cur<pages.length-1

  // библиотека (на мобиле скрыта стилями)
  const [signLib, setSignLib] = useState([])
  const [libLoading, setLibLoading] = useState(false)

  // панель текста
  const [panelOpen, setPanelOpen] = useState(false)
  const [font, setFont] = useState('Arial')
  const [fontSize, setFontSize] = useState(42)
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [color, setColor] = useState('#000000')

  // шиты/оплата
  const [menuAddOpen, setMenuAddOpen] = useState(false)
  const [menuMoreOpen, setMenuMoreOpen] = useState(false)
  const [menuDownloadOpen, setMenuDownloadOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  // кроппер
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropOrig, setCropOrig] = useState('')
  const [cropType, setCropType] = useState('signature')
  const [cropThresh, setCropThresh] = useState(40)
  const cropImgRef = useRef(null)
  const cropperRef = useRef(null)

  // оплата
  const [plan, setPlan] = useState('month')
  const [promo, setPromo] = useState('')
  const [promoError, setPromoError] = useState('')
  const basePrice = { single:99, month:399, year:3999 }
  const [promoPercent, setPromoPercent] = useState(0)
  const price = useMemo(()=>{ let v=basePrice[plan]||0; if(promoPercent>0) v=Math.max(0,Math.round(v*(100-promoPercent)/100)); return v },[plan,promoPercent])

  // биллинг
  const [billing, setBilling] = useState(null)
  const isAuthed = !!localStorage.getItem('access')
  const [guestQuota, setGuestQuota] = useState(()=>{
    try{ const raw=JSON.parse(localStorage.getItem('guest_quota')||'{}'); const today=new Date().toISOString().slice(0,10); if(!raw.date||raw.date!==today) return {date:today,left:3}; return {date:today,left: typeof raw.left==='number'? raw.left:3} }catch{ return {date:new Date().toISOString().slice(0,10),left:3} }
  })
  const guestLeft = guestQuota.left

  // undo
  const [undoStack, setUndoStack] = useState([])
  const canUndo = undoStack.length>0

  useEffect(()=>{ if(isAuthed) AuthAPI.getBillingStatus().then(setBilling).catch(()=>{}) },[isAuthed])
  useEffect(()=>{
    const onUser=async()=>{ if(localStorage.getItem('access')){ try{ setBilling(await AuthAPI.getBillingStatus()) }catch{}; loadLibrary() } else { setBilling(null); loadLibrary() } }
    const onBill=(e)=>setBilling(e.detail)
    window.addEventListener('user:update', onUser)
    window.addEventListener('billing:update', onBill)
    return ()=>{ window.removeEventListener('user:update', onUser); window.removeEventListener('billing:update', onBill) }
  },[])

  // refs
  const canvasWrapRef = useRef(null)
  const docFileRef = useRef(null)
  const bgFileRef = useRef(null)
  const signFileRef = useRef(null)
  const moreRef = useRef(null)
  const sheetRef = useRef(null)
  const dlRef = useRef(null)

  // responsive
  const [isMobile, setIsMobile] = useState(()=>window.matchMedia('(max-width: 960px)').matches)
  useEffect(()=>{ const mq=window.matchMedia('(max-width: 960px)'); const on=()=>setIsMobile(mq.matches); mq.addEventListener('change',on); return ()=>mq.removeEventListener('change',on) },[])

  // клики вне
  useEffect(()=>{
    function onDoc(e){ const t=e.target; if(menuMoreOpen && moreRef.current && !moreRef.current.contains(t)) setMenuMoreOpen(false); if(menuAddOpen && sheetRef.current && !sheetRef.current.contains(t)) setMenuAddOpen(false); if(menuDownloadOpen && dlRef.current && !dlRef.current.contains(t)) setMenuDownloadOpen(false) }
    if(menuMoreOpen||menuAddOpen||menuDownloadOpen){ document.addEventListener('click',onDoc,true); return ()=>document.removeEventListener('click',onDoc,true) }
  },[menuMoreOpen,menuAddOpen,menuDownloadOpen])

  // ресайз контейнера -> подгон масштаба
  useEffect(()=>{
    if(!canvasWrapRef.current) return
    const ro=new ResizeObserver(()=>{ pages.forEach((_,i)=>fitCanvas(i)) })
    ro.observe(canvasWrapRef.current)
    return ()=>ro.disconnect()
  },[pages])

  useEffect(()=>{ if(pages[cur]?.canvas){ requestAnimationFrame(()=>fitCanvas(cur)); setTimeout(()=>fitCanvas(cur),0) } },[cur,pages.length,isMobile])

  async function loadLibrary(){
    setLibLoading(true)
    try{
      if(localStorage.getItem('access')){ const list=await AuthAPI.listSigns(); setSignLib(Array.isArray(list)?list:[]) }
      else { const local=JSON.parse(localStorage.getItem('sign_lib')||'[]'); setSignLib(Array.isArray(local)?local:[]) }
    }catch{ setSignLib([]) } finally{ setLibLoading(false) }
  }
  useEffect(()=>{ loadLibrary() },[])

  function uniqueObjId(){ return 'obj_'+Math.random().toString(36).slice(2) }
  async function waitForElm(id, timeout=8000){ const t0=Date.now(); return new Promise((res,rej)=>{ (function loop(){ const el=document.getElementById(id); if(el) return res(el); if(Date.now()-t0>timeout) return rej(new Error('Canvas element timeout')); requestAnimationFrame(loop) })() }) }

  async function createCanvasForPage(page){
    await ensureFabric(); await waitForElm(page.elId)
    // eslint-disable-next-line no-undef
    const c=new fabric.Canvas(page.elId,{ backgroundColor:'#fff', preserveObjectStacking:true, selection:true })
    c.setWidth(Math.max(10,Math.round(page.baseW||794)))
    c.setHeight(Math.max(10,Math.round(page.baseH||1123)))
    c.on('selection:created', onSelectionChanged)
    c.on('selection:updated', onSelectionChanged)
    c.on('selection:cleared', ()=>setPanelOpen(false))
    installDeleteControl()
    page.canvas=c
    fitCanvasForPage(page)
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
    // eslint-disable-next-line no-undef
    const fobj=fabric.Object; if(fobj.__delPatched) return
    // eslint-disable-next-line no-undef
    const F=fabric
    const del=new F.Control({
      x:0.5,y:-0.5,offsetX:12,offsetY:-12,cursorStyle:'pointer',
      mouseUpHandler:(_,tr)=>{ const t=tr.target,cv=t.canvas; cv.remove(t); cv.discardActiveObject(); cv.requestRenderAll(); return true; },
      render:(ctx,left,top)=>{ const r=12; ctx.save(); ctx.fillStyle='#E26D5C'; ctx.beginPath(); ctx.arc(left,top,r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(left-5,top-5); ctx.lineTo(left+5,top+5); ctx.moveTo(left+5,top-5); ctx.lineTo(left-5,top+5); ctx.stroke(); ctx.restore(); }
    })
    fobj.prototype.controls.tr=del
    fobj.__delPatched=true
  }

  function placeBgObject(cv,page,img){
    img.set({ left:0, top:0, scaleX: cv.getWidth()/(img.width||1), scaleY: cv.getHeight()/(img.height||1), selectable:false, evented:false, hoverCursor:'default' })
    try{ if(page.bgObj) cv.remove(page.bgObj) }catch{}
    page.bgObj=img; cv.add(img); img.moveTo(0); cv.requestRenderAll()
  }

  function fitCanvasForPage(page){
    if(!page||!page.canvas) return
    const cv=page.canvas
    const box=canvasWrapRef.current?.getBoundingClientRect()
    if(!box||box.width<10){ setTimeout(()=>fitCanvasForPage(page),30); return }
    const maxW=Math.max(200,Math.min(box.width-24,980))
    const baseW=Math.max(10,page.baseW||cv.getWidth()), baseH=Math.max(10,page.baseH||cv.getHeight())
    const scale=Math.min(1, Math.max(0.1, maxW/baseW))
    cv.setDimensions({ width:Math.round(baseW*scale), height:Math.round(baseH*scale) }, { cssOnly:true })
    cv.setZoom(scale)
    cv.requestRenderAll()
  }
  function fitCanvas(idx){ const p=pages[idx]; if(!p||!p.canvas) return; fitCanvasForPage(p) }

  function removeDocument(){
    pages.forEach(p=>{ try{ p.canvas?.dispose?.() }catch{} })
    setPages([]); setCur(0); setDocId(null); setPanelOpen(false); setFileName(''); setUndoStack([])
    toast('Документ удалён','success')
  }
  async function removePage(idx=cur){
    if(pages.length<=1){ removeDocument(); return }
    const target=pages[idx]; try{ target.canvas?.dispose?.() }catch{}
    setPages(prev=>prev.filter((_,i)=>i!==idx))
    setCur(i=>Math.max(0, Math.min(idx-1, (pages.length-2))))
    toast('Страница удалена','success')
  }

  function pickDocument(){ docFileRef.current?.click() }
  function pickBgForCurrent(){ bgFileRef.current?.click() }

  async function onPickDocument(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await handleFiles(files) }
  async function onPickBgFile(e){ const files=Array.from(e.target.files||[]); e.target.value=''; if(!files.length) return; await assignFirstFileToCurrent(files[0]) }

  async function handleFiles(files){
    setLoading(true)
    try{
      for(const f of files){
        const ext=(f.name.split('.').pop()||'').toLowerCase()
        if(!docId) setDocId(randDocId())
        if(!fileName){ const base=f.name.replace(/\.[^.]+$/,''); setFileName(sanitizeName(base)) }
        if(['jpg','jpeg','png'].includes(ext)){ const url=await readAsDataURL(f); await addPageFromImage(url) }
        else if(ext==='pdf'){ await addPagesFromPDF(f) }
        else if(['docx','doc'].includes(ext)){ const canv=await renderDOCXToCanvas(f); const slices=sliceCanvasToPages(canv); for(const url of slices) await addPageFromImage(url) }
        else if(['xls','xlsx'].includes(ext)){ const canv=await renderXLSXToCanvas(f); const slices=sliceCanvasToPages(canv); for(const url of slices) await addPageFromImage(url) }
        else toast(`Формат не поддерживается: ${ext}`,'error')
      }
      toast('Страницы добавлены','success')
    }catch(err){ console.error(err); toast(err.message||'Ошибка загрузки файлов','error') }
    finally{ setLoading(false) }
  }

  function loadImageEl(src){ return new Promise((res,rej)=>{ const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>res(img); img.onerror=rej; img.src=src }) }

  async function assignFirstFileToCurrent(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase()
    const page=pages[cur]; if(!page) return
    setLoading(true)
    try{
      if(['jpg','jpeg','png'].includes(ext)){ const url=await readAsDataURL(file); await setPageBackgroundFromImage(cur,url) }
      else if(ext==='pdf'){ await setPageBackgroundFromFirstPDFPage(cur,file) }
      else if(['docx','doc'].includes(ext)){ const canv=await renderDOCXToCanvas(file); const slices=sliceCanvasToPages(canv); await setPageBackgroundFromImage(cur, slices[0]||canv.toDataURL('image/png')) }
      else if(['xls','xlsx'].includes(ext)){ const canv=await renderXLSXToCanvas(file); const slices=sliceCanvasToPages(canv); await setPageBackgroundFromImage(cur, slices[0]||canv.toDataURL('image/png')) }
      else toast('Этот формат не поддерживается','error')
    }catch(e){ toast(e.message||'Не удалось назначить страницу','error') }
    finally{ setLoading(false) }
  }

  async function addPageFromImage(dataUrl){
    const id='p_'+Math.random().toString(36).slice(2), elId='cv_'+id
    const page={ id, elId, canvas:null, bgObj:null, baseW:0, baseH:0 }
    setPages(prev=>{ const arr=[...prev,page]; setCur(arr.length-1); return arr })
    requestAnimationFrame(async()=>{
      const imgEl=await loadImageEl(dataUrl)
      page.baseW=imgEl.naturalWidth||imgEl.width||794
      page.baseH=imgEl.naturalHeight||imgEl.height||1123
      const cv=await createCanvasForPage(page)
      await ensureFabric()
      // eslint-disable-next-line no-undef
      const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
      placeBgObject(cv,page,img)
    })
  }

  async function setPageBackgroundFromImage(idx,dataUrl){
    const page=pages[idx]; if(!page) return
    const imgEl=await loadImageEl(dataUrl)
    const w=imgEl.naturalWidth||imgEl.width||794, h=imgEl.naturalHeight||imgEl.height||1123
    page.baseW=w; page.baseH=h
    const cv=page.canvas || await createCanvasForPage(page)
    if(cv.getWidth()!==w || cv.getHeight()!==h){ cv.setWidth(w); cv.setHeight(h) }
    await ensureFabric()
    // eslint-disable-next-line no-undef
    const img=new fabric.Image(imgEl,{ selectable:false, evented:false })
    placeBgObject(cv,page,img)
    fitCanvasForPage(page)
  }

  async function addPagesFromPDF(file){
    await ensurePDFJS(); const ab=await file.arrayBuffer()
    // eslint-disable-next-line no-undef
    const pdf=await pdfjsLib.getDocument({data:ab}).promise
    for(let i=1;i<=pdf.numPages;i++){ const url=await renderPDFPageToDataURL(pdf,i,2.0); await addPageFromImage(url) }
  }
  async function setPageBackgroundFromFirstPDFPage(idx,file){
    await ensurePDFJS(); const ab=await file.arrayBuffer()
    // eslint-disable-next-line no-undef
    const pdf=await pdfjsLib.getDocument({data:ab}).promise
    const url=await renderPDFPageToDataURL(pdf,1,2.0)
    await setPageBackgroundFromImage(idx,url)
  }

  async function renderPDFPageToDataURL(pdf,pageNum,scale){
    const p=await pdf.getPage(pageNum), vp=p.getViewport({scale})
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d')
    canvas.width=Math.round(vp.width); canvas.height=Math.round(vp.height)
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height)
    await p.render({canvasContext:ctx, viewport:vp}).promise
    return canvas.toDataURL('image/png')
  }

  async function renderDOCXToCanvas(file){
    await ensureMammothCDN(); await ensureHtml2Canvas()
    const ab=await file.arrayBuffer()
    const res=await window.mammoth.convertToHtml({ arrayBuffer:ab })
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
      const tmp=document.createElement('canvas'), tctx=tmp.getContext('2d')
      tmp.width=canvas.width; tmp.height=sliceH
      tctx.drawImage(canvas,0,y,canvas.width,sliceH,0,0,tmp.width,tmp.height)
      out.push(tmp.toDataURL('image/png'))
    }
    return out
  }

  function pickSignature(){ signFileRef.current?.click() }
  async function onPickSignature(e){
    const f=e.target.files?.[0]; e.target.value=''
    if(!f) return
    const src=await readAsDataURL(f)
    setCropOrig(src); setCropSrc(src); setCropOpen(true); setCropType('signature'); setCropThresh(40)
  }

  useEffect(()=>{ if(!cropOpen) return; (async()=>{ await ensureCropper(); if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } const img=cropImgRef.current; if(!img) return; // eslint-disable-next-line no-undef
    const inst=new Cropper(img,{viewMode:1,dragMode:'move',guides:true,background:false,autoCrop:true}); cropperRef.current=inst })(); return ()=>{ if(cropperRef.current){ try{ cropperRef.current.destroy() }catch{}; cropperRef.current=null } } },[cropOpen])

  useEffect(()=>{ if(!cropOpen||!cropperRef.current||!cropOrig) return; (async()=>{ const thr=Math.round(255*(cropThresh/100)); const url=await removeWhiteBackground(cropOrig,thr); try{ cropperRef.current.replace(url,true) }catch{} })() },[cropThresh,cropOpen,cropOrig])

  async function cropConfirm(){
    try{
      const cr=cropperRef.current; if(!cr) return
      const c=cr.getCroppedCanvas({ imageSmoothingEnabled:true, imageSmoothingQuality:'high' })
      let dataUrl=c.toDataURL('image/png')
      const thr=Math.round(255*(cropThresh/100))
      dataUrl=await removeWhiteBackground(dataUrl,thr)
      if(hasDoc && isMobile){
        const page=pages[cur]; const cv=await ensureCanvas(page); const imgEl=await loadImageEl(dataUrl)
        // eslint-disable-next-line no-undef
        const img=new fabric.Image(imgEl); const w=cv.getWidth(),h=cv.getHeight()
        const scale=Math.min(1,(w*0.35)/img.width); img.set({left:w*0.15,top:h*0.15,scaleX:scale,scaleY:scale,selectable:true})
        img.__scannyId=uniqueObjId(); cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
        setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:img.__scannyId}])
      } else {
        if(localStorage.getItem('access')){ const saved=await AuthAPI.addSign({kind:cropType,data_url:dataUrl}); if(saved&&saved.id){ setSignLib(list=>[{id:saved.id,url:saved.url,kind:saved.kind},...list].slice(0,100)) } }
        else { const item={id:'g_'+Math.random().toString(36).slice(2),url:dataUrl,kind:cropType}; const next=[item,...signLib].slice(0,100); setSignLib(next); localStorage.setItem('sign_lib',JSON.stringify(next)) }
      }
      toast('Изображение обработано','success'); setCropOpen(false)
    }catch(e){ toast(e.message||'Не удалось обработать изображение','error') }
  }

  async function removeWhiteBackground(src,threshold=245){
    const imgEl=await loadImageEl(src)
    const w=imgEl.naturalWidth||imgEl.width, h=imgEl.naturalHeight||imgEl.height
    const c=document.createElement('canvas'), ctx=c.getContext('2d'); c.width=w; c.height=h
    ctx.drawImage(imgEl,0,0); const data=ctx.getImageData(0,0,w,h); const d=data.data
    for(let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2]; if(r>threshold&&g>threshold&&b>threshold) d[i+3]=0; else { const avg=(r+g+b)/3; if(avg>220) d[i+3]=Math.max(0,d[i+3]-120) } }
    ctx.putImageData(data,0,0); return c.toDataURL('image/png')
  }

  function startDragSign(url,e){ try{ e.dataTransfer.setData('application/x-sign-url',url); e.dataTransfer.effectAllowed='copy' }catch{} }
  function placeFromLib(url){
    if(!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    const page=pages[cur]; ensureCanvas(page).then(cv=>{
      loadImageEl(url).then(imgEl=>{
        // eslint-disable-next-line no-undef
        const img=new fabric.Image(imgEl); const w=cv.getWidth(),h=cv.getHeight()
        const scale=Math.min(1,(w*0.35)/img.width); img.set({left:w*0.15,top:h*0.15,scaleX:scale,scaleY:scale,selectable:true})
        img.__scannyId=uniqueObjId(); cv.add(img); cv.setActiveObject(img); cv.requestRenderAll()
        setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:img.__scannyId}])
      })
    })
  }
  function removeFromLib(id,isServer=true){
    setSignLib(list=>list.filter(i=>i.id!==id))
    if(localStorage.getItem('access') && isServer && String(id).startsWith('g_')===false){ AuthAPI.deleteSign(id).catch(()=>{}) }
    else { const next=signLib.filter(i=>i.id!==id); localStorage.setItem('sign_lib',JSON.stringify(next)) }
  }

  async function addText(){
    if(!hasDoc){ toast('Сначала добавьте страницу','error'); return }
    await ensureFabric()
    const page=pages[cur]; const cv=await ensureCanvas(page)
    // eslint-disable-next-line no-undef
    const tb=new fabric.Textbox('Вставьте текст',{ left:Math.round(cv.getWidth()*0.1), top:Math.round(cv.getHeight()*0.15), fontSize:48, fill:'#000000', fontFamily:'Arial', fontWeight:'bold' })
    tb.__scannyId=uniqueObjId(); cv.add(tb); cv.setActiveObject(tb); cv.requestRenderAll(); setPanelOpen(true)
    setUndoStack(stk=>[...stk,{type:'add_one',page:cur,id:tb.__scannyId}])
  }
  async function applyPanel(){ const page=pages[cur]; const cv=page?.canvas; if(!cv) return; const obj=cv.getActiveObject(); if(!obj||obj.type!=='textbox') return; obj.set({ fontFamily:font, fontSize:fontSize, fontWeight:bold?'bold':'normal', fontStyle:italic?'italic':'normal', fill:color }); cv.requestRenderAll() }
  useEffect(()=>{ if(panelOpen) applyPanel() },[font,fontSize,bold,italic,color])

  async function rotatePage(){
    if(!hasDoc) return
    const page=pages[cur]; const cv=await ensureCanvas(page)
    if(!page.bgObj || !page.bgObj._element){ toast('Фон не найден','error'); return }
    const el=page.bgObj._element
    const w=el.naturalWidth||el.width, h=el.naturalHeight||el.height
    // рисуем повернутый фон
    const tmp=document.createElement('canvas'), ctx=tmp.getContext('2d')
    tmp.width=h; tmp.height=w
    ctx.translate(h/2,w/2); ctx.rotate(Math.PI/2); ctx.drawImage(el,-w/2,-h/2)
    const dataUrl=tmp.toDataURL('image/png')
    await setPageBackgroundFromImage(cur,dataUrl) // обновит baseW/baseH и подгонит масштаб
  }

  function undo(){
    const stk=[...undoStack], last=stk.pop(); if(!last) return
    if(last.type==='add_one'){ const p=pages[last.page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===last.id); if(obj){ cv.remove(obj); cv.discardActiveObject(); cv.requestRenderAll() } } }
    else if(last.type==='apply_all'){ last.clones.forEach(({page,id})=>{ const p=pages[page], cv=p?.canvas; if(cv){ const obj=cv.getObjects().find(o=>o.__scannyId===id); if(obj){ cv.remove(obj) } cv.requestRenderAll() } }) }
    setUndoStack(stk)
  }

  function baseName(){ const nm=(fileName||'').trim(); if(!nm){ toast('Введите название файла вверху','error'); return null } return sanitizeName(nm) }
  function freeLeft(){ return isAuthed ? (billing?.free_left ?? 3) : guestLeft }
  function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file) }) }
  function downloadBlob(blob,filename){ const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=filename||'file'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000) }

  async function ensureCanvas(page){ if(page.canvas) return page.canvas; return await createCanvasForPage(page) }

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
        const tb=new F.Textbox(obj.text||'',{ left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(), top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(), fontFamily:obj.fontFamily||'Arial', fontStyle:obj.fontStyle||'normal', fontWeight:obj.fontWeight||'normal', fill:obj.fill||'#000', fontSize:Math.max(6,(obj.fontSize||42)*cvDst.getHeight()/cvSrc.getHeight()), angle:obj.angle||0, selectable:true })
        tb.set({ scaleX:obj.scaleX||1, scaleY:obj.scaleY||1 }); tb.__scannyId=uniqueObjId(); cvDst.add(tb); cvDst.requestRenderAll(); clones.push({page:i,id:tb.__scannyId})
      }else if(obj.type==='image'){
        const src=(obj._originalElement?.src||obj._element?.src); const imgEl=await loadImageEl(src); const im=new F.Image(imgEl,{angle:obj.angle||0,selectable:true})
        const dispW=obj.getScaledWidth(), dispH=obj.getScaledHeight()
        const targetW=dispW*cvDst.getWidth()/cvSrc.getWidth(), targetH=dispH*cvDst.getHeight()/cvSrc.getHeight()
        const sX=targetW/(im.width||1), sY=targetH/(im.height||1)
        im.set({ left:(obj.left||0)*cvDst.getWidth()/cvSrc.getWidth(), top:(obj.top||0)*cvDst.getHeight()/cvSrc.getHeight(), scaleX:sX, scaleY:sY })
        im.__scannyId=uniqueObjId(); cvDst.add(im); cvDst.requestRenderAll(); clones.push({page:i,id:im.__scannyId})
      }
    }
    if(clones.length){ setUndoStack(stk=>[...stk,{type:'apply_all',clones}]); toast('Объект продублирован на все страницы','success') }
  }

  function updateGuestQuota(count){ const today=new Date().toISOString().slice(0,10); const left=Math.max(0,(guestLeft||0)-count); const next={date:today,left}; setGuestQuota(next); localStorage.setItem('guest_quota',JSON.stringify(next)) }
  function consumeFree(kind,count,bn){ if(isAuthed){ AuthAPI.recordDownload(kind,count,bn,'free').catch(()=>{}) } else updateGuestQuota(count) }

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
        const p=pages[i], cv=await ensureCanvas(p), zoom=cv.getZoom()||1
        const url=cv.toDataURL({format:'jpeg',quality:0.95,multiplier:1/zoom})
        const res=await fetch(url), blob=await res.blob()
        zip.file(`${bn}-p${i+1}.jpg`,blob)
      }
      const out=await zip.generateAsync({type:'blob'})
      downloadBlob(out,`${bn}.zip`); consumeFree('jpg',count,bn); toast(`Скачано страниц: ${count}`,'info')
    }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить JPG','error') }
  }

  async function exportPDF(){
    try{
      if(!hasDoc) return
      const bn=baseName(); if(!bn) return
      const count=pages.length
      if(freeLeft()<count){ setPlan('single'); setPayOpen(true); return }
      await ensureJsPDF()
      const first=pages[0], cv0=await ensureCanvas(first)
      // eslint-disable-next-line no-undef
      const PDF=window.jspdf.jsPDF
      const w0=cv0.getWidth(), h0=cv0.getHeight(), pdf=new PDF({orientation:w0>h0?'l':'p', unit:'px', format:[w0,h0]})
      const z0=cv0.getZoom()||1, u0=cv0.toDataURL({format:'jpeg',quality:0.95,multiplier:1/z0}); pdf.addImage(u0,'JPEG',0,0,w0,h0)
      for(let i=1;i<pages.length;i++){ const p=pages[i], cv=await ensureCanvas(p), w=cv.getWidth(), h=cv.getHeight(), z=cv.getZoom()||1, u=cv.toDataURL({format:'jpeg',quality:0.95,multiplier:1/z}); pdf.addPage([w,h],w>h?'l':'p'); pdf.addImage(u,'JPEG',0,0,w,h) }
      pdf.save(`${bn}.pdf`); consumeFree('pdf',count,bn); toast(`Скачано страниц: ${count}`,'info')
    }catch(e){ console.error(e); toast(e.message||'Не удалось выгрузить PDF','error') }
  }

  function onCanvasDrop(e){
    e.preventDefault(); const dt=e.dataTransfer; if(!dt) return
    const types=Array.from(dt.types||[])
    if(types.includes('application/x-sign-url')){ const url=dt.getData('application/x-sign-url'); if(url&&url!=='add') placeFromLib(url); return }
    const fs=Array.from(dt.files||[]); if(fs.length) handleFiles(fs)
  }

  return (
    <div className="doc-editor page">
      {/* верхняя панель (мобайл) */}
      <div className="ed-top" style={{display: isMobile && hasDoc ? undefined : 'none'}}>
        <button className="ed-menu-btn" aria-label="Ещё" onClick={()=>setMenuMoreOpen(o=>!o)}><img src={icMore} alt=""/></button>
        <div className="ed-docid" style={{flex:1,padding:'0 8px'}}><input className="ed-filename" placeholder="Название файла при скачивании" value={fileName} onChange={e=>setFileName(sanitizeName(e.target.value))}/></div>
        <div className="ed-top-right"></div>
        {menuMoreOpen && (
          <div className="ed-menu" ref={moreRef}>
            <button className={hasDoc?'':'disabled'} onClick={rotatePage}><img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу</button>
            <button className={hasDoc && pages.length>1?'':'disabled'} onClick={()=>removePage()}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить страницу</button>
            <button className={hasDoc && !!(pages[cur]?.canvas?.getActiveObject()) ? '' : 'disabled'} onClick={()=>{ setMenuMoreOpen(false); applyToAllPages() }}><img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы</button>
            <button className={hasDoc?'':'disabled'} onClick={removeDocument}><img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ</button>
          </div>
        )}
      </div>

      <div className="ed-body">
        {/* слева — скрывается на мобиле */}
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
                <button className="thumb-x" onClick={()=>removeFromLib(item.id)}>×</button>
              </div>
            ))}
          </div>
        </aside>

        {/* центр */}
        <section className="ed-center">
          {!isMobile && (
            <div className="ed-namebar">
              <input className="ed-filename" placeholder="Название файла при скачивании" value={fileName} onChange={e=>setFileName(sanitizeName(e.target.value))}/>
            </div>
          )}

          <div className="ed-canvas-wrap" ref={canvasWrapRef} onDragOver={(e)=>e.preventDefault()} onDrop={onCanvasDrop}>
            {pages.map((p,idx)=>(
              <div key={p.id} className={`ed-canvas ${idx===cur?'active':''}`}>
                {!isMobile && <button className="ed-page-x" title="Удалить эту страницу" onClick={()=>removePage(idx)}>×</button>}
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
            {loading && (<div className="ed-canvas-loading"><div className="spinner" aria-hidden="true"></div>Загрузка…</div>)}
          </div>

          {!isMobile && (
            <div className="ed-pages">
              {pages.map((p,i)=>(<div key={p.id} className={`ed-page-btn ${i===cur?'active':''}`} onClick={()=>setCur(i)}>{i+1}</div>))}
                            <button className="ed-page-add" onClick={pickDocument}><img src={icPlus} alt="+"/></button>
            </div>
          )}

          {/* нижняя панель (мобайл): слева меню «добавить», по центру пейджер, справа меню «скачать» */}
          <div className="ed-bottom" style={{display: isMobile ? undefined : 'none'}}>
            <div className="ed-pager">
              <button onClick={()=>setCur(i=>Math.max(0, i-1))} disabled={!canPrev}><img src={icPrev} alt="Prev" /></button>
              <span className="pg">{hasDoc ? `${cur+1}/${pages.length}` : '0/0'}</span>
              {canNext ? (
                <button onClick={()=>setCur(i=>Math.min(pages.length-1, i+1))}><img src={icNext} alt="Next" /></button>
              ) : (
                <button onClick={pickDocument}><img src={icPlus} alt="+"/></button>
              )}
            </div>
            <div className="ed-bottom-actions">
              <button className="fab" onClick={()=>setMenuAddOpen(o=>!o)}><img src={icPlus} alt="+" /></button>
              <button className={`fab main ${(!hasDoc)?'disabled':''}`} onClick={()=>setMenuDownloadOpen(o=>!o)}><img src={icDownload} alt="↓" /></button>
            </div>
          </div>
        </section>

        {/* справа (скрыто на мобиле) */}
        <aside className="ed-right">
          <div className="ed-actions">
            <button className={`ed-action ${hasDoc?'':'disabled'}`} onClick={removeDocument}>
              <img src={icDelete} alt="" style={{width:18,height:18,marginRight:8}}/>Удалить документ
            </button>
            <button className={`ed-action ${canUndo?'':'disabled'}`} onClick={undo}>
              <img src={icUndo} alt="" style={{width:18,height:18,marginRight:8}}/>Отменить
            </button>
            <button className={`ed-action ${hasDoc?'':'disabled'}`} onClick={rotatePage}>
              <img src={icRotate} alt="" style={{width:18,height:18,marginRight:8}}/>Повернуть страницу
            </button>
            <button className={`ed-action ${hasDoc && !!(pages[cur]?.canvas?.getActiveObject()) ? '' : 'disabled'}`} onClick={applyToAllPages}>
              <img src={icAddPage} alt="" style={{width:18,height:18,marginRight:8}}/>На все страницы
            </button>
          </div>

          <div className="ed-download">
            <div className="ed-dl-title">Скачать бесплатно:</div>
            <div className="ed-dl-row">
              <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={()=>exportJPG()}>
                <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:8}}/>JPG
              </button>
              <button className={`btn btn-lite ${(!hasDoc)?'disabled':''}`} onClick={()=>exportPDF()}>
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
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportJPG() } }}>
            <img src={icJpgFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно JPG
          </button>
          <button className={hasDoc?'':'disabled'} onClick={()=>{ if(hasDoc){ setMenuDownloadOpen(false); exportPDF() } }}>
            <img src={icPdfFree} alt="" style={{width:18,height:18,marginRight:10}}/>Скачать бесплатно PDF
          </button>
        </div>
      )}

      {(menuAddOpen || menuDownloadOpen || menuMoreOpen) && <div className="ed-dim" onClick={()=>{ setMenuAddOpen(false); setMenuDownloadOpen(false); setMenuMoreOpen(false) }}/>}

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
              <button className="btn" onClick={cropConfirm}><span className="label">Готово</span></button>
            </div>
          </div>
        </div>
      )}

      {/* pay modal */}
      {payOpen && (
        <div className="modal-overlay" onClick={()=>setPayOpen(false)}>
          <div className="modal pay-modal" onClick={e=>e.stopPropagation()}>
            <button className="modal-x" onClick={()=>setPayOpen(false)}>×</button>
            <h3 className="modal-title">Чтобы выгрузить документ придётся немного заплатить</h3>

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

      {/* inputs */}
      <input ref={docFileRef} type="file" accept={ACCEPT_DOC} hidden multiple onChange={onPickDocument}/>
      <input ref={bgFileRef} type="file" accept={ACCEPT_DOC} hidden onChange={onPickBgFile}/>
      <input ref={signFileRef} type="file" accept=".png,.jpg,.jpeg" hidden onChange={onPickSignature}/>
    </div>
  )

  // --- helpers для промо и оплаты ---
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
}
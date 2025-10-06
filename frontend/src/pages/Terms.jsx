import { useEffect, useState } from 'react'
import ModalEditor from '../components/ModalEditor.jsx'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'

export default function Terms(){
  const [data,setData]=useState(null)
  const [open,setOpen]=useState(false)
  const [admin,setAdmin]=useState(false)
  const [showTop,setShowTop]=useState(false)

  useEffect(()=>{ const u = JSON.parse(localStorage.getItem('user')||'null'); setAdmin(!!u?.is_staff); load() },[])
  useEffect(()=>{ const h=(e)=>setAdmin(!!e.detail?.is_staff); window.addEventListener('user:update',h); return ()=>window.removeEventListener('user:update',h) },[])
  useEffect(()=>{ if(!admin && open) setOpen(false) },[admin,open])

  useEffect(()=>{
    const onScroll=()=>setShowTop(window.scrollY>100)
    window.addEventListener('scroll', onScroll, { passive:true })
    onScroll()
    return ()=>window.removeEventListener('scroll', onScroll)
  },[])

  const load=async()=>{
    const r = await fetch(AuthAPI.getApiBase()+'/cms/legal/')
    const d = r.ok ? await r.json() : []
    const page = Array.isArray(d)? d.find(x=>x.slug==='terms'):null
    setData(page||null)
  }

  const onSave=async({title,html})=>{
    const payload={slug:'terms', title: title || (data?.title || 'Пользовательское соглашение'), body: html}
    const url = data ? `/cms/legal/${data.id}/` : `/cms/legal/`
    const method = data ? 'PUT':'POST'
    try {
      await AuthAPI.authed(url,{ method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      toast('Сохранено','success'); setOpen(false); load()
    } catch (e) {
      toast(e.message || 'Ошибка сохранения','error')
    }
  }

  return (
    <div className="container section legal">
      <h1>{data?.title || 'Пользовательское соглашение'}</h1>
      {admin && <button className="btn btn-lite" onClick={()=>setOpen(true)}><span className="label">Редактировать</span></button>}
      <div dangerouslySetInnerHTML={{__html: data?.body || ''}}/>
      {!data && <p>Страница пуста.</p>}

      {showTop && (
        <button className="back-to-top" title="Наверх" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑</button>
      )}

      <ModalEditor
        open={open}
        onClose={()=>setOpen(false)}
        title="Редактирование"
        initialTitle={data?.title||''}
        initialHTML={data?.body||''}
        onSave={onSave}
        protectTitle={true}
        requireTitle={false}
      />
    </div>
  )
}
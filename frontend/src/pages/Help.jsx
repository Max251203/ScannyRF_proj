import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ModalEditor from '../components/ModalEditor.jsx'
import { toast } from '../components/Toast.jsx'
import { AuthAPI } from '../api'
import iconAdd from '../assets/icons/add.png'
import iconEdit from '../assets/icons/edit.png'
import iconDelete from '../assets/icons/delete.png'

function htmlToText(html) {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  return (div.textContent || div.innerText || '').trim()
}

export default function Help() {
  const nav = useNavigate()
  const { id } = useParams()

  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [admin, setAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || 'null')
    setAdmin(!!u?.is_staff)
    load()
  }, [])

  useEffect(() => {
    const onUpd = (e) => setAdmin(!!e.detail?.is_staff)
    window.addEventListener('user:update', onUpd)
    return () => window.removeEventListener('user:update', onUpd)
  }, [])
  useEffect(() => { if (!admin && editorOpen) setEditorOpen(false) }, [admin, editorOpen])

  useEffect(() => {
    if (id) {
      fetch(AuthAPI.getApiBase() + `/cms/faq/${id}/`)
        .then(r => r.ok ? r.json() : null)
        .then(d => setDetail(d || null))
    } else {
      setDetail(null)
    }
  }, [id])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(AuthAPI.getApiBase() + '/cms/faq/')
      if (!r.ok) { toast('Не удалось загрузить вопросы','error'); return }
      const d = await r.json()
      setItems(Array.isArray(d) ? d : [])
    } finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter(x => x.title.toLowerCase().includes(s))
  }, [q, items])

  const openNew = () => { setEditRow(null); setEditorOpen(true) }
  const openEdit = (row) => { setEditRow(row); setEditorOpen(true) }
  const remove = async (row) => {
    if (!confirm('Удалить вопрос?')) return
    try {
      await AuthAPI.authed(`/cms/faq/${row.id}/`, { method: 'DELETE' })
      toast('Удалено','success'); load(); if (detail?.id === row.id) nav('/help')
    } catch (e) {
      toast(e.message || 'Не удалось удалить','error')
    }
  }

  const onSave = async ({ title, html }) => {
    try {
      const payload = { title: title.trim(), body: html }
      if (!payload.title || !payload.body) { toast('Заполните заголовок и текст','error'); return }
      const url = editRow ? `/cms/faq/${editRow.id}/` : `/cms/faq/`
      const method = editRow ? 'PUT':'POST'
      const saved = await AuthAPI.authed(url, {
        method,
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      })
      // моментально обновляем открытый detail, если редактировали именно его
      if (detail && editRow && Number(detail.id) === Number(editRow.id)) {
        setDetail(saved)
      }
      toast('Сохранено','success')
      setEditorOpen(false)
      load()
    } catch (e) {
      toast(e.message || 'Ошибка сохранения','error')
    }
  }

  if (detail) {
    return (
      <div className="help-page">
        <div className="container">
          <div className="help-head">
            <button className="help-back" onClick={()=>nav('/help')}>← Назад к вопросам</button>
            {admin && (
              <div style={{display:'flex', gap:8}}>
                <button className="icon-btn" title="Редактировать" onClick={()=>openEdit(detail)}>
                  <img src={iconEdit} alt="" style={{width:18,height:18}}/>
                </button>
                <button className="icon-btn" title="Удалить" onClick={()=>remove(detail)}>
                  <img src={iconDelete} alt="" style={{width:18,height:18}}/>
                </button>
              </div>
            )}
          </div>

          <h1 className="help-article-title">{detail.title}</h1>
          <div className="help-article-body" dangerouslySetInnerHTML={{__html: detail.body || ''}} />
        </div>

        <ModalEditor
          open={editorOpen}
          onClose={()=>setEditorOpen(false)}
          title="Редактирование вопроса"
          initialTitle={editRow?.title || ''}
          initialHTML={editRow?.body || ''}
          onSave={onSave}
          requireTitle={true}
        />
      </div>
    )
  }

  return (
    <div className="help-page">
      <div className="container">
        <div className="help-head" style={{justifyContent:'space-between'}}>
          <div className="help-search only-input">
            <input type="search" placeholder="Поиск по вопросам…" value={q} onChange={e=>setQ(e.target.value)} />
          </div>
          {admin && (
            <button className="btn" onClick={openNew}><span className="label" style={{display:'inline-flex',alignItems:'center',gap:8}}><img src={iconAdd} alt="" style={{width:16,height:16}}/>Добавить</span></button>
          )}
        </div>
        <h1 className="help-title">Общие вопросы</h1>

        <div className="help-grid">
          {loading && <div>Загрузка…</div>}
          {!loading && filtered.map(row => {
            const text = htmlToText(row.body || '')
            return (
              <div className="help-card" key={row.id} onClick={()=>nav(`/help/${row.id}`)} title="Открыть">
                <div className="help-card-title">{row.title}</div>
                <div className="help-card-text">{text}</div>
                <div className="help-card-go" aria-hidden="true">›</div>
                {admin && (
                  <div style={{position:'absolute', right:52, bottom:12, display:'flex', gap:8}}>
                    <button className="icon-btn" title="Редактировать" onClick={(e)=>{e.stopPropagation(); openEdit(row)}}>
                      <img src={iconEdit} alt="" style={{width:18,height:18}}/>
                    </button>
                    <button className="icon-btn" title="Удалить" onClick={(e)=>{e.stopPropagation(); remove(row)}}>
                      <img src={iconDelete} alt="" style={{width:18,height:18}}/>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {!loading && filtered.length===0 && <div className="help-empty">Ничего не найдено</div>}
        </div>
      </div>

      <ModalEditor
        open={editorOpen}
        onClose={()=>setEditorOpen(false)}
        title={editRow ? 'Редактирование вопроса' : 'Новый вопрос'}
        initialTitle={editRow?.title || ''}
        initialHTML={editRow?.body || ''}
        onSave={onSave}
        requireTitle={true}
      />
    </div>
  )
}
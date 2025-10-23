import { useEffect, useMemo, useRef, useState } from 'react'
import { AuthAPI } from '../api'
import camIcon from '../assets/icons/cam.png'
import { toast } from '../components/Toast.jsx'
import UserModal from '../components/UserModal.jsx'
import eyeOpen from '../assets/icons/eye-open.png'
import eyeClosed from '../assets/icons/eye-closed.png'

function PasswordField({ value, onChange, placeholder, id }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-wrap pw-wrap">
      <input id={id} type={show ? 'text' : 'password'} placeholder={placeholder} value={value} onChange={onChange} />
      <button type="button" className="pw-toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} title={show ? 'Скрыть пароль' : 'Показать пароль'}>
        <img src={show ? eyeOpen : eyeClosed} alt="" />
      </button>
    </div>
  )
}

export default function Profile(){
  const [user,setUser]=useState(()=>JSON.parse(localStorage.getItem('user')||'null'))
  const [tab,setTab]=useState('info')

  // billing
  const [billing, setBilling] = useState(null)
  const reloadBilling = async()=> {
    if (!localStorage.getItem('access')) { setBilling(null); return }
    try { setBilling(await AuthAPI.getBillingStatus()) } catch {}
  }

  useEffect(()=>{ if(!user){ AuthAPI.me().then(u=>setUser(u)).catch(()=>{}) }},[])
  useEffect(()=>{ reloadBilling() },[])

  // обновления из редактора/логина
  useEffect(() => {
    const onUpd = (e) => setUser(e.detail)
    const onBill = (e) => setBilling(e.detail)
    window.addEventListener('user:update', onUpd)
    window.addEventListener('billing:update', onBill)
    return () => { window.removeEventListener('user:update', onUpd); window.removeEventListener('billing:update', onBill) }
  }, [])

  const isAdmin = !!user?.is_staff
  useEffect(() => { if (!isAdmin && tab === 'users') setTab('info') }, [isAdmin, tab])

  // ----- Админ: конфиг биллинга и промокоды -----
  const [freeQuota, setFreeQuota] = useState(3)
  const [promos, setPromos] = useState([])
  const [promoOpen, setPromoOpen] = useState(false)
  const [editPromo, setEditPromo] = useState(null)

  const loadAdminBilling = async () => {
    if (!isAdmin || !localStorage.getItem('access')) return
    try {
      const cfg = await AuthAPI.getBillingConfig()
      setFreeQuota(Number(cfg?.free_daily_quota ?? 3))
      const list = await AuthAPI.getPromos()
      setPromos(Array.isArray(list) ? list : [])
    } catch {}
  }
  useEffect(() => { if (isAdmin && tab === 'plan') loadAdminBilling() }, [isAdmin, tab])

  const saveQuota = async () => {
    try {
      const v = Number(freeQuota)
      if (!Number.isFinite(v) || v < 0) { toast('Введите корректное число', 'error'); return }
      await AuthAPI.setBillingConfig(v)
      toast('Сохранено', 'success')
      reloadBilling()
      await loadAdminBilling()
    } catch (e) { toast(e.message || 'Ошибка сохранения', 'error') }
  }

  const openCreatePromo = () => { setEditPromo(null); setPromoOpen(true) }
  const openEditPromo = (p) => { setEditPromo(p); setPromoOpen(true) }
  const onSavedPromo = async () => { setPromoOpen(false); await loadAdminBilling() }

  return (
    <div id="profile" className="container section">
      <h1>Личный кабинет</h1>
      <div className="tabs">
        <button className={`tab ${tab==='info'?'active':''}`} onClick={()=>setTab('info')}>Личные данные</button>
        <button className={`tab ${tab==='history'?'active':''}`} onClick={()=>setTab('history')}>История</button>
        <button className={`tab ${tab==='plan'?'active':''}`} onClick={()=>setTab('plan')}>Тариф</button>
        {isAdmin && <button className={`tab ${tab==='users'?'active':''}`} onClick={()=>setTab('users')}>Пользователи</button>}
      </div>

      {tab==='info' && <InfoSection user={user} onUpdated={(u)=>{ setUser(u); window.dispatchEvent(new CustomEvent('user:update',{detail:u})) }} />}
      {tab==='history' && <HistorySection billing={billing} />}
      {tab==='plan' && (
        <PlanSection
          billing={billing}
          isAdmin={isAdmin}
          freeQuota={freeQuota}
          setFreeQuota={setFreeQuota}
          onSaveQuota={saveQuota}
          promos={promos}
          onCreatePromo={openCreatePromo}
          onEditPromo={openEditPromo}
          onDeletePromo={async (id)=>{ try{ await AuthAPI.deletePromo(id); toast('Удалено','success'); loadAdminBilling() } catch(e){ toast(e.message||'Ошибка удаления','error') } }}
        />
      )}
      {isAdmin && tab==='users' && <AdminUsers/>}

      {isAdmin && (
        <PromoModal
          open={promoOpen}
          onClose={()=>setPromoOpen(false)}
          initial={editPromo}
          onSaved={onSavedPromo}
        />
      )}
    </div>
  )
}

function PlanSection({ billing, isAdmin, freeQuota, setFreeQuota, onSaveQuota, promos, onCreatePromo, onEditPromo, onDeletePromo }){
  const total = billing?.free_total ?? 3
  const left = billing?.free_left ?? 3
  const hasSub = !!billing?.subscription
  return (
    <>
      <div className="card" style={{marginBottom:16}}>
        {!hasSub ? (
          <>
            <p>Тариф: Бесплатный</p>
            <p>Доступно сегодня: {left} из {total}</p>
            {billing?.reset_at && <p>Сброс лимита: {new Date(billing.reset_at).toLocaleString('ru-RU')}</p>}
          </>
        ) : (
          <>
            <p>Тариф: Без ограничений ({billing.subscription.plan === 'month' ? 'месяц' : 'год'})</p>
            <p>Действует до: {new Date(billing.subscription.expires_at).toLocaleDateString('ru-RU')}</p>
          </>
        )}
      </div>

      {isAdmin && (
        <>
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{marginTop:0}}>Настройки тарифа (админ)</h3>
            <div className="two-col" style={{alignItems:'end'}}>
              <div>
                <label className="subhead">Количество бесплатных страниц в сутки</label>
                <input className="text-input admin-input" type="number" min="0" value={freeQuota} onChange={e=>setFreeQuota(e.target.value)} />
              </div>
              <div>
                <button className="btn" onClick={onSaveQuota}><span className="label">Сохранить</span></button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="admin-head">
              <h3 style={{margin:'6px 0'}}>Промокоды</h3>
              <button className="btn btn-lite" onClick={onCreatePromo}><span className="label">Создать</span></button>
            </div>
            <div className="admin-grid">
              <div className="admin-list">
                {promos.map(p=>(
                  <div className="row" key={p.id}>
                    <div>{p.code} — {p.discount_percent}% {p.active ? '' : '(отключён)'}</div>
                    <div className="actions">
                      <button className="link-btn" onClick={()=>onEditPromo(p)}>Редактировать</button>
                      <button className="link-btn" onClick={()=>onDeletePromo(p.id)}>Удалить</button>
                    </div>
                  </div>
                ))}
                {promos.length===0 && <p>Промокодов нет.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function HistorySection({ billing }){
  return (
    <div className="card">
      {!billing?.history?.length && <p>История пока пуста.</p>}
      {billing?.history?.length>0 && (
        <div className="calc-table" style={{marginTop:0}}>
          <table>
            <thead>
              <tr><th>Дата</th><th>Тип</th><th>Страниц</th><th>Документ</th><th>Способ</th></tr>
            </thead>
            <tbody>
              {billing.history.map(op=>(
                <tr key={op.id}>
                  <td>{new Date(op.created_at).toLocaleString('ru-RU')}</td>
                  <td>{op.kind==='download_pdf' ? 'PDF' : 'JPG'}</td>
                  <td className="t-num">{op.pages}</td>
                  <td>{op.doc_name || '-'}</td>
                  <td>{op.free ? 'Бесплатно' : 'Оплачено'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InfoSection({user,onUpdated}){
  const [email,setEmail]=useState(user?.email||'')
  const [username,setUsername]=useState(user?.username||'')
  const [avatar,setAvatar]=useState(null) // File | 'remove' | null
  const [pwdMode,setPwdMode]=useState('known')
  const [oldPwd,setOldPwd]=useState('')
  const [newPwd,setNewPwd]=useState('')
  const [code,setCode]=useState('')
  const fileRef=useRef(null)

  useEffect(()=>{ setEmail(user?.email||''); setUsername(user?.username||'') },[user])

  const previewSrc=useMemo(()=>{
    if(avatar==='remove') return null
    if(avatar instanceof File) return URL.createObjectURL(avatar)
    return user?.avatar_url || null
  },[avatar,user])

  const onFileChange=(e)=>{ const f=e.target.files?.[0]||null; setAvatar(f); e.target.value='' }
  const removeAvatar=()=>{ setAvatar('remove') }

  const saveProfile=async()=>{
    try{
      const fd=new FormData()
      if(email) fd.append('email', email)
      fd.append('username', (username||''))
      if(avatar==='remove') fd.append('remove_avatar','true')
      else if(avatar instanceof File) fd.append('avatar',avatar)
      const u=await AuthAPI.updateProfile(fd)
      setAvatar(null)
      setEmail(u.email||''); setUsername(u.username||'')
      localStorage.setItem('user', JSON.stringify(u))
      window.dispatchEvent(new CustomEvent('user:update',{detail:u}))
      onUpdated(u)
      toast('Сохранено','success')
    }catch(e){ toast(e.message,'error') }
  }

  const sendCode=async()=>{
    try{
      const targetEmail=(email||user?.email||'').trim()
      if(!targetEmail){ toast('Сначала укажите e‑mail','error'); return }
      await AuthAPI.requestCode(targetEmail)
      toast('Код отправлен на почту','success')
    }catch(e){ toast(e.message,'error') }
  }

  const changePassword=async()=>{
    try{
      if(pwdMode==='known'){
        if(!oldPwd||!newPwd){ toast('Введите старый и новый пароль','error'); return }
        await AuthAPI.changePassword(oldPwd,newPwd)
        const me = await AuthAPI.me()
        localStorage.setItem('user', JSON.stringify(me))
        window.dispatchEvent(new CustomEvent('user:update',{detail:me}))
        setOldPwd(''); setNewPwd(''); toast('Пароль изменён','success')
      }else{
        if(!code||!newPwd){ toast('Введите код и новый пароль','error'); return }
        await AuthAPI.confirmCode((email||user?.email||'').trim(), code.trim(), newPwd)
        const me = await AuthAPI.me()
        localStorage.setItem('user', JSON.stringify(me))
        window.dispatchEvent(new CustomEvent('user:update',{detail:me}))
        setCode(''); setNewPwd(''); toast('Пароль изменён','success')
      }
    }catch(e){ toast(e.message,'error') }
  }

  return (
    <div className="card">
      <div className="form-grid">
        <div>
          <div className="avatar-uploader hint" onClick={()=>fileRef.current?.click()}>
            {previewSrc ? <img alt="" src={previewSrc}/> : <div className="avatar-placeholder"><img src={camIcon} alt="" className="cam-img"/><span>Добавить фото</span></div>}
            <input ref={fileRef} type="file" hidden accept="image/*" onChange={onFileChange}/>
          </div>
          {(previewSrc || user?.avatar_url) && <button className="link-btn" onClick={removeAvatar}>Удалить фото</button>}
        </div>
        <div>
          <div className="form-row"><input className="text-input" placeholder="E‑mail" value={email} onChange={e=>setEmail(e.target.value)} /></div>
          <div className="form-row"><input className="text-input" placeholder="Логин (необязательно)" value={username} onChange={e=>setUsername(e.target.value)} /></div>
          <div className="form-row"><button className="btn" onClick={saveProfile}><span className="label">Сохранить</span></button></div>
        </div>
      </div>

      <div className="pwd-block">
        <h3>Смена пароля</h3>
        <div className="pwd-modes">
          <label className="agree-line"><input type="radio" name="pwd" checked={pwdMode==='known'} onChange={()=>setPwdMode('known')} /> <span>Знаю старый пароль</span></label>
          <label className="agree-line"><input type="radio" name="pwd" checked={pwdMode==='forgot'} onChange={()=>setPwdMode('forgot')} /> <span>Забыл пароль</span></label>
        </div>

        {pwdMode==='known' ? (
          <div className="two-col">
            <PasswordField id="old-pass" placeholder="Старый пароль" value={oldPwd} onChange={e=>setOldPwd(e.target.value)} />
            <PasswordField id="new-pass" placeholder="Новый пароль" value={newPwd} onChange={e=>setNewPwd(e.target.value)} />
            <button className="btn" onClick={changePassword}><span className="label">Изменить</span></button>
          </div>
        ) : (
          <>
            <div className="form-note">Мы отправим код на ваш e‑mail для подтверждения смены пароля.</div>
            <div className="two-col">
              <button className="btn btn-lite" onClick={sendCode}><span className="label">Отправить код</span></button>
              <input className="text-input" placeholder="Код из письма" value={code} onChange={e=>setCode(e.target.value)}/>
              <PasswordField id="new-pass2" placeholder="Новый пароль" value={newPwd} onChange={e=>setNewPwd(e.target.value)} />
              <button className="btn" onClick={changePassword}><span className="label">Изменить</span></button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AdminUsers(){
  const [list,setList]=useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)

  const load=async()=>{
    try{
      const d = await AuthAPI.authed('/admin/users/')
      setList(Array.isArray(d)?d:[])
    }catch(e){
      setList([])
      toast(e.message || 'Ошибка загрузки пользователей','error')
    }
  }
  useEffect(()=>{ load() },[])

  const openCreate = () => { setEditUser(null); setModalOpen(true) }
  const openEdit = (u) => { setEditUser(u); setModalOpen(true) }
  const onSaved = () => load()

  const del=async(id)=>{
    const me = JSON.parse(localStorage.getItem('user')||'null')
    if(id===me?.id){ toast('Нельзя удалить свой аккаунт','error'); return }
    if(!confirm('Удалить пользователя?')) return
    try{
      await AuthAPI.authed(`/admin/users/${id}/`, { method:'DELETE' })
      toast('Удалено','success'); load()
    }catch(e){ toast(e.message || 'Ошибка удаления','error') }
  }

  return (
    <div className="card">
      <div className="admin-head">
        <h3 style={{margin:'6px 0'}}>Пользователи</h3>
        <button className="btn btn-lite" onClick={openCreate}><span className="label">Создать</span></button>
      </div>
      <div className="admin-grid">
        <div className="admin-list">
          {list.map(u=>(
            <div className="row" key={u.id}>
              <div>{u.username || u.email}</div>
              <div className="actions">
                <button className="link-btn" onClick={()=>openEdit(u)}>Редактировать</button>
                {u.id !== JSON.parse(localStorage.getItem('user')||'null')?.id && (
                  <button className="link-btn" onClick={()=>del(u.id)}>Удалить</button>
                )}
              </div>
            </div>
          ))}
          {list.length===0 && <p>Пользователи не найдены.</p>}
        </div>
      </div>

      <UserModal
        open={modalOpen}
        onClose={()=>setModalOpen(false)}
        initialUser={editUser}
        onSaved={onSaved}
      />
    </div>
  )
}

/* ===== Модалка промокода (создание/редактирование) ===== */
function PromoModal({ open, onClose, initial=null, onSaved }){
  const isEdit = !!initial
  const [code, setCode] = useState('')
  const [percent, setPercent] = useState(0)
  const [active, setActive] = useState(true)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    if(!open) return
    setCode(initial?.code || '')
    setPercent(Number(initial?.discount_percent || 0))
    setActive(initial?.active ?? true)
    setNote(initial?.note || '')
  },[open, initial])

  const save = async () => {
    try{
      if(!code.trim()){ toast('Укажите код','error'); return }
      if(percent<0 || percent>100){ toast('Скидка 0..100%','error'); return }
      setLoading(true)
      if (isEdit){
        await AuthAPI.updatePromo(initial.id, { code: code.trim(), discount_percent: Number(percent), active, note })
      } else {
        await AuthAPI.createPromo({ code: code.trim(), discount_percent: Number(percent), active, note })
      }
      toast('Сохранено','success')
      onSaved?.()
      onClose?.()
    }catch(e){ toast(e.message || 'Ошибка сохранения','error') }
    finally{ setLoading(false) }
  }

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <h3 className="modal-title">{isEdit ? 'Редактирование промокода' : 'Новый промокод'}</h3>
        <div className="form-row"><input className="text-input" placeholder="Код" value={code} onChange={e=>setCode(e.target.value)} /></div>
        <div className="form-row"><label className="subhead">Скидка, %</label><input className="text-input" type="number" min="0" max="100" placeholder="0–100" value={percent} onChange={e=>setPercent(Number(e.target.value)||0)} /></div>
        <div className="form-row"><label className="agree-line"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} /><span>Активен</span></label></div>
        <div className="form-row"><input className="text-input" placeholder="Заметка (необязательно)" value={note} onChange={e=>setNote(e.target.value)} /></div>
        <div className="form-row two">
          <button className={`btn ${loading?'loading':''}`} onClick={save} disabled={loading}><span className="spinner" aria-hidden="true" /> <span className="label">Сохранить</span></button>
          <button className="link-btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}
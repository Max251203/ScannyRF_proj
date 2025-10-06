import { useEffect, useMemo, useRef, useState } from 'react'
import { AuthAPI } from '../api'
import { toast } from './Toast.jsx'
import camIcon from '../assets/icons/cam.png'
import eyeOpen from '../assets/icons/eye-open.png'
import eyeClosed from '../assets/icons/eye-closed.png'

function PasswordField({ value, onChange, placeholder, id }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-wrap pw-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
        title={show ? 'Скрыть пароль' : 'Показать пароль'}
      >
        <img src={show ? eyeOpen : eyeClosed} alt="" />
      </button>
    </div>
  )
}

export default function UserModal({ open, onClose, initialUser=null, onSaved }) {
  const isEdit = !!initialUser
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState(null)   // File | 'remove' | null
  const fileRef = useRef(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setEmail(initialUser?.email || '')
    setUsername(initialUser?.username || '')
    setPassword('')
    setAvatar(null)
    if (fileRef.current) fileRef.current.value = ''
  }, [open, initialUser])

  const previewSrc = useMemo(() => {
    if (avatar === 'remove') return null
    if (avatar instanceof File) return URL.createObjectURL(avatar)
    return initialUser?.avatar_url || null
  }, [avatar, initialUser])

  const onPickAvatar = (e) => {
    const f = e.target.files?.[0] || null
    setAvatar(f)
    e.target.value = ''
  }
  const clearAvatar = () => {
    setAvatar('remove')
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    if (!email.trim()) { toast('Укажите e‑mail','error'); return }
    try {
      setLoading(true)

      const fd = new FormData()
      fd.append('email', email.trim())
      fd.append('username', (username || '').trim())
      if (password) fd.append('password', password)
      if (avatar === 'remove') fd.append('remove_avatar','true')
      else if (avatar instanceof File) fd.append('avatar', avatar)

      let updated = null
      if (isEdit) {
        updated = await AuthAPI.authed(`/admin/users/${initialUser.id}/`, { method: 'PUT', body: fd })
      } else {
        updated = await AuthAPI.authed(`/admin/users/`, { method: 'POST', body: fd })
      }

      // Если админ менял себя — синхронизируем шапку/профиль
      const me = JSON.parse(localStorage.getItem('user') || 'null')
      if (updated && me && Number(me.id) === Number(updated.id)) {
        localStorage.setItem('user', JSON.stringify(updated))
        window.dispatchEvent(new CustomEvent('user:update', { detail: updated }))
      }

      toast('Сохранено','success')
      onSaved?.()
      onClose?.()
    } catch (e) {
      toast(e.message || 'Ошибка', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <h3 className="modal-title">{isEdit ? 'Редактирование пользователя' : 'Создание пользователя'}</h3>

        <div className="avatar-uploader hint" onClick={()=>fileRef.current?.click()}>
          {previewSrc
            ? <img alt="" src={previewSrc}/>
            : <div className="avatar-placeholder"><img src={camIcon} alt="" className="cam-img"/><span>Добавить фото</span></div>}
          <input ref={fileRef} type="file" hidden accept="image/*" onChange={onPickAvatar}/>
        </div>
        {(previewSrc || initialUser?.avatar_url) &&
          <div className="avatar-actions" style={{textAlign:'center', marginTop:-6}}>
            <button className="link-btn" onClick={clearAvatar}>Удалить фото</button>
          </div>
        }

        <div className="form-row"><input placeholder="E‑mail" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div className="form-row"><input placeholder="Логин (опц.)" value={username} onChange={e=>setUsername(e.target.value)} /></div>
        <div className="form-row"><PasswordField id="adm-user-pass" placeholder={isEdit ? 'Новый пароль (опц.)' : 'Пароль (опц.)'} value={password} onChange={e=>setPassword(e.target.value)} /></div>

        <div className="form-row two">
          <button className={`btn ${loading?'loading':''}`} onClick={save} disabled={loading}><span className="spinner" aria-hidden="true" /> <span className="label">Сохранить</span></button>
          <button className="link-btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthAPI } from '../api'
import { toast } from './Toast.jsx'

import eyeOpen from '../assets/icons/eye-open.png'
import eyeClosed from '../assets/icons/eye-closed.png'
import camIcon from '../assets/icons/cam.png'
import iconF from '../assets/icons/social-facebook.png'
import iconVK from '../assets/icons/social-vk.png'
import iconG from '../assets/icons/social-google.png'

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export default function AuthModal({ open, onClose, onSuccess }) {
  const [mode, setMode] = useState('login')
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [idn, setIdn] = useState('')
  const [pwd, setPwd] = useState('')

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [rpwd, setRpwd] = useState('')
  const [avatar, setAvatar] = useState(null) // File | null
  const fileRef = useRef(null)

  useEffect(() => { if (!open) reset() }, [open])
  const reset = () => {
    setMode('login'); setOk(false); setLoading(false); setError('');
    setIdn(''); setPwd(''); setEmail(''); setUsername(''); setRpwd('');
    setAvatar(null); if (fileRef.current) fileRef.current.value = ''
  }

  // Слушатель ответов от popup (Google/FB/VK)
  useEffect(() => {
    if (!open) return
    const onMsg = async (e) => {
      try {
        const d = e.data || {}
        if (!d.provider) return
        setLoading(true); setError('')
        let u = null
        if (d.provider === 'google' && d.id_token) {
          u = await AuthAPI.google(d.id_token)
        } else if (d.provider === 'facebook' && d.access_token) {
          u = await AuthAPI.facebook(d.access_token)
        } else if (d.provider === 'vk' && d.access_token) {
          u = await AuthAPI.vk(d.access_token, d.email || '')
        }
        if (u) {
          window.dispatchEvent(new CustomEvent('user:update', { detail: u }))
          onSuccess?.(u); onClose?.()
        }
      } catch (err) {
        setError(err.message || 'Ошибка авторизации')
        toast(err.message || 'Ошибка авторизации', 'error')
      } finally {
        setLoading(false)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [open, onClose, onSuccess])

  const openPopup = (url) => {
    const w = 520, h = 640
    const y = Math.max(0, (window.outerHeight - h) / 2)
    const x = Math.max(0, (window.outerWidth - w) / 2)
    window.open(url, 'oauth_popup', `width=${w},height=${h},top=${y},left=${x},status=no,toolbar=no`)
  }

  const openGoogle = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      setError('Отсутствуют данные Google'); toast('Укажите VITE_GOOGLE_CLIENT_ID в .env фронта','error'); return
    }
    const redirectUri = (import.meta.env.VITE_GOOGLE_REDIRECT || (location.origin + '/')).replace(/#.*$/,'')
    const nonceBytes = new Uint8Array(16); crypto.getRandomValues(nonceBytes)
    const nonce = Array.from(nonceBytes).map(b=>b.toString(16).padStart(2,'0')).join('')
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=id_token` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&prompt=select_account` +
      `&nonce=${nonce}` +
      `&state=google`
    openPopup(url)
  }

  const openFacebook = () => {
    const appId = import.meta.env.VITE_FB_APP_ID
    const redirect = (import.meta.env.VITE_OAUTH_REDIRECT || (location.origin + '/#/oauth'))
    if (!appId) { setError('Не указан VITE_FB_APP_ID'); toast('Не указан VITE_FB_APP_ID','error'); return }
    const url =
      'https://www.facebook.com/v11.0/dialog/oauth' +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&response_type=token&scope=email` +
      `&state=facebook`
    openPopup(url)
  }

  const openVK = () => {
    const appId = import.meta.env.VITE_VK_APP_ID
    const redirect = (import.meta.env.VITE_OAUTH_REDIRECT || (location.origin + '/#/oauth'))
    if (!appId) { setError('Не указан VITE_VK_APP_ID'); toast('Не указан VITE_VK_APP_ID','error'); return }
    const url =
      'https://oauth.vk.com/authorize' +
      `?client_id=${encodeURIComponent(appId)}` +
      `&display=popup&redirect_uri=${encodeURIComponent(redirect)}` +
      `&response_type=token&v=5.131&scope=email` +
      `&state=vk`
    openPopup(url)
  }

  const canLogin = idn.trim().length > 0 && pwd.trim().length >= 1 && !loading
  const canRegister = ok && emailRx.test(email.trim()) && rpwd.trim().length >= 6 && !loading

  const submitLogin = async () => {
    if (!canLogin) return
    try {
      setLoading(true); setError('')
      const u = await AuthAPI.login(idn.trim(), pwd)
      window.dispatchEvent(new CustomEvent('user:update', { detail: u }))
      onSuccess?.(u); onClose?.()
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const onPickAvatar = (e) => { const f = e.target.files?.[0] || null; setAvatar(f); e.target.value = '' }
  const clearAvatar = () => { setAvatar(null); if (fileRef.current) fileRef.current.value = '' }

  const submitRegister = async () => {
    if (!canRegister) {
      if (!ok) setError('Подтвердите условия соглашения')
      else if (!emailRx.test(email.trim())) setError('Введите корректный e‑mail')
      else if (rpwd.trim().length < 6) setError('Пароль должен быть не менее 6 символов')
      return
    }
    try {
      setLoading(true); setError('')
      let u = await AuthAPI.register(email.trim(), username.trim(), rpwd)
      if (avatar) {
        const fd = new FormData(); fd.append('avatar', avatar)
        const u2 = await AuthAPI.updateProfile(fd)
        if (u2) u = u2
      }
      window.dispatchEvent(new CustomEvent('user:update', { detail: u }))
      onSuccess?.(u); onClose?.()
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal auth-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>×</button>
        <h3 className="modal-title">{mode === 'login' ? 'Вход' : 'Регистрация'}</h3>

        {mode === 'login' ? (
          <>
            <div className="form-row"><input placeholder="Логин или e‑mail" value={idn} onChange={e => setIdn(e.target.value)} /></div>
            <div className="form-row"><PasswordField id="login-password" placeholder="Пароль" value={pwd} onChange={e => setPwd(e.target.value)} /></div>

            {error && <div className="form-row form-error">{error}</div>}

            <div className="form-row two">
              <button className={`btn ${loading ? 'loading' : ''}`} disabled={!canLogin} onClick={submitLogin}>
                <span className="spinner" aria-hidden="true" /> <span className="label">Войти</span>
              </button>
              <button className="link-btn" onClick={() => { setMode('register'); setError('') }}>Нет аккаунта? → Регистрация</button>
            </div>
          </>
        ) : (
          <>
            <div className="avatar-section">
              <div className="avatar-uploader hint" onClick={() => fileRef.current?.click()}>
                {avatar
                  ? <img src={URL.createObjectURL(avatar)} alt="" />
                  : <div className="avatar-placeholder">
                      <img src={camIcon} alt="" className="cam-img" />
                      <span>Добавить фото</span>
                    </div>}
                <input ref={fileRef} id="reg-avatar" type="file" accept="image/*" hidden onChange={onPickAvatar} />
              </div>
              {avatar && (
                <div className="avatar-actions">
                  <button className="link-btn" onClick={clearAvatar}>Удалить фото</button>
                </div>
              )}
            </div>
            
            <div className="form-row"><input placeholder="E‑mail" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div className="form-row"><input placeholder="Логин (необязательно)" value={username} onChange={e => setUsername(e.target.value)} /></div>
            <div className="form-row"><PasswordField id="reg-password" placeholder="Пароль (мин. 6 символов)" value={rpwd} onChange={e => setRpwd(e.target.value)} /></div>

            <div className="form-row agree">
              <label className="agree-line">
                <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} />
                <span className="agree-text">Принимаю условия <Link to="/terms" onClick={onClose}>Пользовательского соглашения</Link> и <Link to="/privacy" onClick={onClose}>Политики конфиденциальности</Link></span>
              </label>
            </div>

            {error && <div className="form-row form-error">{error}</div>}

            <div className="form-row two">
              <button className={`btn ${loading ? 'loading' : ''}`} disabled={!canRegister} onClick={submitRegister}>
                <span className="spinner" aria-hidden="true" /> <span className="label">Зарегистрироваться</span>
              </button>
              <button className="link-btn" onClick={() => { setMode('login'); setError('') }}>Есть аккаунт? → Вход</button>
            </div>
          </>
        )}

        <div className="divider"><span>или</span></div>

        <div className="social-row">
          <button className="soc soc-lg" type="button" title="Google" onClick={openGoogle}><img src={iconG} alt="" /></button>
          <button className="soc soc-lg" type="button" title="Facebook" onClick={openFacebook}><img src={iconF} alt="" /></button>
          <button className="soc soc-lg" type="button" title="VK" onClick={openVK}><img src={iconVK} alt="" /></button>
        </div>
      </div>
    </div>
  )
}
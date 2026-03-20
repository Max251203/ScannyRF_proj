import { useEffect } from 'react'

export default function OAuthCatch() {
  useEffect(() => {
    try {
      const full = window.location.hash || ''
      const frag = full.includes('#') ? full.split('#').pop() : full.slice(1)
      const p = new URLSearchParams(frag || '')
      const token = p.get('access_token') || ''
      const idt = p.get('id_token') || ''
      const state = p.get('state') || ''
      const email = p.get('email') || ''

      if (state && (token || idt)) {
        // ПИШЕМ В STORAGE ВМЕСТО postMessage
        localStorage.setItem('oauth_result', JSON.stringify({
          provider: state,
          access_token: token,
          id_token: idt,
          email,
          timestamp: Date.now() // метка времени, чтобы событие было уникальным
        }))
      }
    } catch (e) {
      console.error(e)
    }
    // Закрываем окно чуть быстрее
    setTimeout(() => window.close(), 50)
  }, [])

  return <div style={{ padding: 20 }}>Авторизация...</div>
}